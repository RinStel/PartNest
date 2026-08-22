use std::{
    collections::{BTreeMap, BTreeSet},
    fmt, fs,
    path::Path,
};

use calamine::{open_workbook_auto, Data, Reader};
use csv::{ReaderBuilder, StringRecord};
use encoding_rs::UTF_16LE;

use super::types::{
    BomGroupDto, BomPlacementDto, BomSide, FieldMapping, ImportPreview, NormalizedBomDto,
};

const NORMALIZED_FIELDS: [&str; 9] = [
    "quantity",
    "designators",
    "package",
    "value",
    "name",
    "mpn",
    "manufacturer",
    "lcsc_code",
    "side",
];
#[derive(Debug)]
pub enum TabularError {
    Io(std::io::Error),
    Csv(csv::Error),
    Workbook(String),
    UnsupportedEncoding,
    InvalidRecord { row: usize, reason: String },
}

impl fmt::Display for TabularError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "I/O error: {error}"),
            Self::Csv(error) => write!(f, "CSV error: {error}"),
            Self::Workbook(error) => write!(f, "workbook error: {error}"),
            Self::UnsupportedEncoding => write!(f, "unsupported text encoding"),
            Self::InvalidRecord { row, reason } => write!(f, "invalid BOM row {row}: {reason}"),
        }
    }
}

impl std::error::Error for TabularError {}
impl From<std::io::Error> for TabularError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
impl From<csv::Error> for TabularError {
    fn from(error: csv::Error) -> Self {
        Self::Csv(error)
    }
}

#[derive(Debug, Clone)]
struct Table {
    headers: Vec<String>,
    records: Vec<Vec<String>>,
}

/// Inspect a CSV or XLSX without mutating the source file. `mapping` is a
/// per-import override keyed by normalized field name.
pub fn inspect_tabular_bom(
    path: impl AsRef<Path>,
    mapping: Option<&FieldMapping>,
) -> Result<ImportPreview, TabularError> {
    let path = path.as_ref();
    let table = if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("xlsx"))
        .unwrap_or(false)
    {
        read_xlsx(path)?
    } else {
        read_csv(path)?
    };
    let (resolved, ambiguous) = resolve_mapping(&table.headers, mapping);
    if ambiguous || !has_required_mapping(&resolved) {
        return Ok(ImportPreview::NeedsMapping {
            headers: table.headers,
            suggestions: resolved,
        });
    }
    let source_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned();
    Ok(ImportPreview::Ready(normalize_table(
        source_name,
        table,
        &resolved,
    )?))
}

fn read_csv(path: &Path) -> Result<Table, TabularError> {
    let bytes = fs::read(path)?;
    let text = decode_text(&bytes)?;
    let mut candidates = Vec::new();
    for delimiter in *b",\t" {
        let mut reader = ReaderBuilder::new()
            .has_headers(false)
            .delimiter(delimiter)
            .from_reader(text.as_bytes());
        let Ok(rows) = reader.records().collect::<Result<Vec<_>, _>>() else {
            continue;
        };
        if let Some(table) = table_from_records(rows) {
            let recognized = table
                .headers
                .iter()
                .filter(|header| canonical_header(header).is_some())
                .count();
            let width = table.headers.len();
            let stable = table.records.iter().take(20).all(|row| row.len() == width);
            candidates.push((stable, recognized, width, delimiter, table));
        }
    }
    candidates
        .sort_by_key(|candidate| (candidate.0, candidate.1, candidate.2, candidate.3 == b','));
    candidates
        .pop()
        .map(|(_, _, _, _, table)| table)
        .ok_or_else(|| TabularError::InvalidRecord {
            row: 1,
            reason: "missing header".into(),
        })
}

fn read_xlsx(path: &Path) -> Result<Table, TabularError> {
    let mut workbook =
        open_workbook_auto(path).map_err(|error| TabularError::Workbook(error.to_string()))?;
    let sheet_names = workbook.sheet_names().to_owned();
    for sheet_name in sheet_names {
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|error| TabularError::Workbook(error.to_string()))?;
        let rows: Vec<Vec<String>> = range
            .rows()
            .map(|row| row.iter().map(data_to_string).collect())
            .collect();
        if let Some(table) = table_from_rows(rows) {
            return Ok(table);
        }
    }
    Err(TabularError::InvalidRecord {
        row: 1,
        reason: "workbook has no non-empty worksheet".into(),
    })
}

fn data_to_string(value: &Data) -> String {
    match value {
        Data::Empty => String::new(),
        _ => value.to_string(),
    }
}

fn decode_text(bytes: &[u8]) -> Result<String, TabularError> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let (text, _, had_errors) = UTF_16LE.decode(&bytes[2..]);
        if had_errors {
            return Err(TabularError::UnsupportedEncoding);
        }
        return Ok(text.into_owned());
    }
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8(bytes[3..].to_vec())
            .map_err(|_| TabularError::UnsupportedEncoding);
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| TabularError::UnsupportedEncoding)
}

fn table_from_records(rows: Vec<StringRecord>) -> Option<Table> {
    table_from_rows(
        rows.into_iter()
            .map(|row| row.iter().map(str::to_owned).collect())
            .collect(),
    )
}

fn table_from_rows(rows: Vec<Vec<String>>) -> Option<Table> {
    let mut iter = rows
        .into_iter()
        .filter(|row| row.iter().any(|value| !value.trim().is_empty()));
    let headers = iter
        .next()?
        .into_iter()
        .map(|value| value.trim().to_owned())
        .collect::<Vec<_>>();
    if headers.is_empty() || headers.iter().all(String::is_empty) {
        return None;
    }
    let records = iter.collect();
    Some(Table { headers, records })
}

fn resolve_mapping(headers: &[String], supplied: Option<&FieldMapping>) -> (FieldMapping, bool) {
    if let Some(mapping) = supplied {
        let mut result = FieldMapping::new();
        let mut used = BTreeSet::new();
        let mut ambiguous = false;
        for (field, source) in mapping {
            if !NORMALIZED_FIELDS.contains(&field.as_str()) {
                continue;
            }
            let Some(index) = headers
                .iter()
                .position(|header| header.eq_ignore_ascii_case(source.trim()))
            else {
                ambiguous = true;
                continue;
            };
            if !used.insert(index) {
                ambiguous = true;
            }
            result.insert(field.clone(), headers[index].clone());
        }
        return (result, ambiguous);
    }
    let mut result = FieldMapping::new();
    let mut used = BTreeSet::new();
    let mut ambiguous = false;
    for header in headers {
        if let Some(field) = canonical_header(header) {
            if result.contains_key(field) || !used.insert(header) {
                ambiguous = true;
            } else {
                result.insert(field.to_owned(), header.clone());
            }
        }
    }
    (result, ambiguous)
}

fn has_required_mapping(mapping: &FieldMapping) -> bool {
    let has_count = mapping.contains_key("quantity") || mapping.contains_key("designators");
    let has_identity = mapping.contains_key("lcsc_code")
        || mapping.contains_key("mpn")
        || (mapping.contains_key("package")
            && (mapping.contains_key("value") || mapping.contains_key("name")));
    has_count && has_identity
}

fn canonical_header(header: &str) -> Option<&'static str> {
    let normalized = header.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "quantity" | "qty" | "count" | "数量" => Some("quantity"),
        "designator" | "designators" | "reference" | "references" | "refdes" | "位号" => {
            Some("designators")
        }
        "footprint" | "package" | "pcb footprint" | "封装" => Some("package"),
        "value" | "parameters" | "param" | "参数" => Some("value"),
        "comment" | "name" | "description" | "注释" | "名称" => Some("name"),
        "manufacturer part" | "manufacturer part number" | "mpn" | "mfr part" | "制造商型号" => {
            Some("mpn")
        }
        "manufacturer" | "mfr" | "maker" | "制造商" => Some("manufacturer"),
        "supplier part"
        | "supplier part number"
        | "lcsc"
        | "lcsc code"
        | "supplier code"
        | "立创商城编号"
        | "供应商料号" => Some("lcsc_code"),
        "side" | "layer" | "board side" | "板面" | "层" => Some("side"),
        _ => None,
    }
}

fn normalize_table(
    source_name: String,
    table: Table,
    mapping: &FieldMapping,
) -> Result<NormalizedBomDto, TabularError> {
    let index: BTreeMap<&str, usize> = mapping
        .iter()
        .filter_map(|(field, source)| {
            table
                .headers
                .iter()
                .position(|header| header == source)
                .map(|idx| (field.as_str(), idx))
        })
        .collect();
    let mut groups: BTreeMap<String, BomGroupDto> = BTreeMap::new();
    for (offset, row) in table.records.iter().enumerate() {
        if row.iter().all(|value| value.trim().is_empty()) {
            continue;
        }
        let value = |field: &str| {
            index
                .get(field)
                .and_then(|idx| row.get(*idx))
                .map(|value| value.trim().to_owned())
                .unwrap_or_default()
        };
        let designators = value("designators");
        let designator_list = split_designators(&designators);
        let quantity = parse_quantity(&value("quantity"))
            .or_else(|| (!designator_list.is_empty()).then_some(designator_list.len() as i64))
            .unwrap_or(0);
        if quantity <= 0 {
            return Err(TabularError::InvalidRecord {
                row: offset + 2,
                reason: "quantity must be positive or designators must be present".into(),
            });
        }
        let name = value("name");
        let component_key = component_key(
            &value("lcsc_code"),
            &value("mpn"),
            &value("value"),
            &value("package"),
            &name,
        );
        if component_key.is_empty() {
            return Err(TabularError::InvalidRecord {
                row: offset + 2,
                reason: "missing component identity".into(),
            });
        }
        let side = parse_side(&value("side"));
        let group = groups
            .entry(component_key.clone())
            .or_insert_with(|| BomGroupDto {
                component_key: component_key.clone(),
                name: name.clone(),
                value: value("value"),
                package: value("package"),
                manufacturer: value("manufacturer"),
                mpn: value("mpn"),
                lcsc_code: value("lcsc_code"),
                quantity: 0,
                placements: Vec::new(),
                extra_fields: BTreeMap::new(),
            });
        group.quantity += quantity;
        if side.is_some() {
            group
                .placements
                .extend(
                    designator_list
                        .into_iter()
                        .map(|designator| BomPlacementDto {
                            designator,
                            side: side.clone(),
                            component_key: component_key.clone(),
                        }),
                );
        }
        for (idx, header) in table.headers.iter().enumerate() {
            if canonical_header(header).is_none() {
                let field_value = row.get(idx).map(String::as_str).unwrap_or_default().trim();
                if !field_value.is_empty() {
                    group
                        .extra_fields
                        .insert(header.clone(), field_value.to_owned());
                }
            }
        }
    }
    Ok(NormalizedBomDto {
        source_name,
        groups: groups.into_values().collect(),
    })
}

fn parse_quantity(raw: &str) -> Option<i64> {
    raw.trim()
        .parse::<i64>()
        .ok()
        .filter(|quantity| *quantity > 0)
}
fn split_designators(raw: &str) -> Vec<String> {
    raw.split(|character: char| character == ',' || character == ';' || character.is_whitespace())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}
fn parse_side(raw: &str) -> Option<BomSide> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "top" | "topside" | "front" => Some(BomSide::Top),
        "bottom" | "bottomside" | "back" => Some(BomSide::Bottom),
        _ => None,
    }
}
fn component_key(lcsc: &str, mpn: &str, value: &str, package: &str, name: &str) -> String {
    if !lcsc.is_empty() {
        format!("lcsc:{lcsc}")
    } else if !mpn.is_empty() {
        format!("mpn:{mpn}")
    } else if !package.is_empty() && (!value.is_empty() || !name.is_empty()) {
        format!("value:{value}|package:{package}|name:{name}")
    } else {
        String::new()
    }
}
