//! Parser for EasyEDA interactive BOM exports.

use super::types::{BomGroupDto, BomPlacementDto, BomSide, NormalizedBomDto};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt, fs,
    path::Path,
};

#[derive(Debug)]
pub enum InteractiveHtmlError {
    Io(std::io::Error),
    InvalidJson(String),
    UnsupportedInteractiveBom(String),
}

impl fmt::Display for InteractiveHtmlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "I/O error: {error}"),
            Self::InvalidJson(error) => write!(f, "invalid interactive BOM JSON: {error}"),
            Self::UnsupportedInteractiveBom(reason) => {
                write!(f, "unsupported interactive BOM: {reason}")
            }
        }
    }
}
impl std::error::Error for InteractiveHtmlError {}
impl From<std::io::Error> for InteractiveHtmlError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

/// Parse an interactive HTML file without modifying it.
pub fn parse_interactive_html(
    path: impl AsRef<Path>,
) -> Result<NormalizedBomDto, InteractiveHtmlError> {
    let path = path.as_ref();
    let source = fs::read_to_string(path)?;
    let source_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned();
    parse_interactive_html_text(&source, source_name)
}

/// Parse a source string. This is public so callers can inspect a copied input
/// without creating a temporary source file.
pub fn parse_interactive_html_text(
    source: &str,
    source_name: impl Into<String>,
) -> Result<NormalizedBomDto, InteractiveHtmlError> {
    let object = find_window_files_object(source)
        .ok_or_else(|| unsupported("window.files object is missing"))?;
    let files: Value = serde_json::from_str(&strip_js_comments(object)).map_err(json_error)?;
    let merge = nested_json(files.get("bom_merge"), "bom_merge")?;
    let data = nested_json(merge.get("data"), "bom_merge.data")?;
    let comp_info = data
        .get("comp_info")
        .and_then(Value::as_object)
        .ok_or_else(|| unsupported("comp_info must be an object"))?;
    let designator_info = data
        .get("designator_info")
        .ok_or_else(|| unsupported("designator_info is missing"))?;
    if comp_info.is_empty() {
        return Err(unsupported("comp_info is empty"));
    }

    let mut groups: BTreeMap<String, BomGroupDto> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    let mut placements = 0usize;
    for (side, entry) in designator_entries(designator_info)? {
        let list = entry
            .as_array()
            .ok_or_else(|| unsupported("designator_info side must be an array"))?;
        for item in list {
            let item = item
                .as_object()
                .ok_or_else(|| unsupported("designator entry must be an object"))?;
            let designator = first_text(item, &["des", "designator", "reference", "ref"])
                .ok_or_else(|| unsupported("designator entry has no designator"))?;
            if !seen.insert(designator.clone()) {
                return Err(unsupported("duplicate designator"));
            }
            let component_key = first_text(item, &["lc_code", "component_key", "bom_key"])
                .ok_or_else(|| unsupported("designator entry has no component key"))?;
            let metadata = comp_info
                .get(&component_key)
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    unsupported(format!(
                        "component {component_key:?} is missing from comp_info"
                    ))
                })?;
            let group = groups
                .entry(component_key.clone())
                .or_insert_with(|| BomGroupDto {
                    component_key: component_key.clone(),
                    name: metadata_text(metadata, &["Name", "name", "Description", "description"]),
                    value: metadata_text(metadata, &["value", "Value", "Parameters", "parameters"]),
                    package: metadata_text(
                        metadata,
                        &[
                            "Supplier Footprint",
                            "supplier_footprint",
                            "Footprint",
                            "footprint",
                            "lc_pkg",
                        ],
                    ),
                    manufacturer: metadata_text(metadata, &["Manufacturer", "manufacturer"]),
                    mpn: metadata_text(
                        metadata,
                        &[
                            "Manufacturer Part",
                            "manufacturer_part",
                            "MPN",
                            "mpn",
                            "lc_model",
                        ],
                    ),
                    lcsc_code: metadata_text(
                        metadata,
                        &["Supplier Part", "supplier_part", "LCSC", "lcsc_code"],
                    ),
                    quantity: 0,
                    designators: Vec::new(),
                    placements: Vec::new(),
                    extra_fields: BTreeMap::new(),
                });
            group.quantity += 1;
            group.designators.push(designator.clone());
            group.placements.push(BomPlacementDto {
                designator,
                side: Some(side.clone()),
                component_key,
            });
            placements += 1;
        }
    }
    if placements == 0 || groups.is_empty() {
        return Err(unsupported("designator_info has no placements"));
    }
    Ok(NormalizedBomDto {
        source_name: source_name.into(),
        groups: groups.into_values().collect(),
    })
}

fn find_window_files_object(source: &str) -> Option<&str> {
    let bytes = source.as_bytes();
    let marker = b"window.files";
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'"' | b'\'' | b'`' => index = skip_js_string(bytes, index)?,
            b'/' if bytes.get(index + 1) == Some(&b'/') => index = skip_line_comment(bytes, index),
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index = skip_block_comment(bytes, index)?
            }
            _ if bytes[index..].starts_with(marker)
                && (index == 0 || !is_identifier(bytes[index - 1]))
                && !bytes
                    .get(index + marker.len())
                    .is_some_and(|byte| is_identifier(*byte)) =>
            {
                let mut cursor = skip_space_and_comments(bytes, index + marker.len())?;
                if bytes.get(cursor) == Some(&b'=') {
                    cursor = skip_space_and_comments(bytes, cursor + 1)?;
                    if bytes.get(cursor) == Some(&b'{') {
                        let end = scan_balanced_object(bytes, cursor)?;
                        return Some(&source[cursor..=end]);
                    }
                }
                index += marker.len();
            }
            _ => index += 1,
        }
    }
    None
}

fn scan_balanced_object(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut index = start;
    while index < bytes.len() {
        match bytes[index] {
            b'"' | b'\'' | b'`' => index = skip_js_string(bytes, index)?,
            b'/' if bytes.get(index + 1) == Some(&b'/') => index = skip_line_comment(bytes, index),
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index = skip_block_comment(bytes, index)?
            }
            b'{' => {
                depth += 1;
                index += 1;
            }
            b'}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
                index += 1;
            }
            _ => index += 1,
        }
    }
    None
}

fn skip_js_string(bytes: &[u8], start: usize) -> Option<usize> {
    let quote = *bytes.get(start)?;
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index += 2;
            continue;
        }
        if bytes[index] == quote {
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

fn skip_line_comment(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .position(|byte| *byte == b'\n')
        .map(|offset| start + offset + 1)
        .unwrap_or(bytes.len())
}

fn skip_block_comment(bytes: &[u8], start: usize) -> Option<usize> {
    let end = bytes[start + 2..]
        .windows(2)
        .position(|pair| pair == b"*/")?;
    Some(start + 2 + end + 2)
}

fn skip_space_and_comments(bytes: &[u8], mut index: usize) -> Option<usize> {
    loop {
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'/') {
            index = skip_line_comment(bytes, index);
        } else if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'*') {
            index = skip_block_comment(bytes, index)?;
        } else {
            return Some(index);
        }
    }
}

fn is_identifier(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

fn strip_js_comments(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'"' | b'\'' | b'`' => {
                let end = skip_js_string(bytes, index).unwrap_or(bytes.len());
                output.extend_from_slice(&bytes[index..end]);
                index = end;
            }
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                index = skip_line_comment(bytes, index);
                output.push(b'\n');
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index = skip_block_comment(bytes, index).unwrap_or(bytes.len());
                output.push(b' ');
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(output).unwrap_or_default()
}

fn nested_json(value: Option<&Value>, name: &str) -> Result<Value, InteractiveHtmlError> {
    let value = value.ok_or_else(|| unsupported(format!("{name} is missing")))?;
    match value {
        Value::String(text) => serde_json::from_str(text).map_err(json_error),
        Value::Object(_) => Ok(value.clone()),
        _ => Err(unsupported(format!(
            "{name} must be a JSON object or string"
        ))),
    }
}

fn designator_entries(value: &Value) -> Result<Vec<(BomSide, Value)>, InteractiveHtmlError> {
    let mut result = Vec::new();
    let roots: Vec<&Value> = value
        .as_array()
        .map(|items| items.iter().collect())
        .unwrap_or_else(|| vec![value]);
    for root in roots {
        let object = root
            .as_object()
            .ok_or_else(|| unsupported("designator_info must contain objects"))?;
        for (name, side) in [("top", BomSide::Top), ("bottom", BomSide::Bottom)] {
            if let Some(items) = object.get(name) {
                result.push((side.clone(), items.clone()));
            }
        }
    }
    if result.is_empty() {
        return Err(unsupported("designator_info has no top or bottom arrays"));
    }
    Ok(result)
}

fn first_text(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(value_text))
}
fn metadata_text(object: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    first_text(object, keys).unwrap_or_default()
}
fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_owned()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}
fn unsupported(reason: impl Into<String>) -> InteractiveHtmlError {
    InteractiveHtmlError::UnsupportedInteractiveBom(reason.into())
}
fn json_error(error: serde_json::Error) -> InteractiveHtmlError {
    InteractiveHtmlError::InvalidJson(error.to_string())
}
