use std::{
    fs,
    path::{Path, PathBuf},
};

use partnest_desktop_lib::bom::tabular::inspect_tabular_bom;
use partnest_desktop_lib::bom::types::ImportPreview;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/bom")
        .join(name)
}

fn parse_fixture(name: &str) -> partnest_desktop_lib::bom::types::NormalizedBomDto {
    match inspect_tabular_bom(fixture(name), None).expect("parse fixture") {
        ImportPreview::Ready(bom) => bom,
        ImportPreview::NeedsMapping { headers, .. } => {
            panic!("fixture unexpectedly needs mapping: {headers:?}")
        }
    }
}

#[test]
fn comma_and_tab_files_normalize_identically() {
    let comma = parse_fixture("comma-utf8.csv");
    let tab = parse_fixture("tab-utf16le.csv");
    assert_eq!(comma.groups, tab.groups);
}

#[test]
fn quoted_delimiters_and_unknown_fields_are_preserved() {
    let bom = parse_fixture("fields.xlsx");
    assert_eq!(bom.groups[0].quantity, 2);
    assert!(bom.groups[0].placements.is_empty());
    assert_eq!(bom.groups[0].extra_fields["Unknown Field"], "keep-me");
    assert_eq!(bom.groups[0].lcsc_code, "C100");
}

#[test]
fn missing_optional_columns_are_blank_and_designators_supply_quantity() {
    let path = std::env::temp_dir().join(format!("partnest-tabular-{}.csv", std::process::id()));
    fs::write(&path, "Designator,Footprint,Value\nC1,C0603,100nF\n").unwrap();
    let result = inspect_tabular_bom(&path, None).expect("parse optional fixture");
    let ImportPreview::Ready(bom) = result else {
        panic!("optional columns should not need mapping")
    };
    assert_eq!(bom.groups[0].quantity, 1);
    assert_eq!(bom.groups[0].manufacturer, "");
    assert_eq!(
        bom.groups[0].placements,
        Vec::<partnest_desktop_lib::bom::types::BomPlacementDto>::new()
    );
    fs::remove_file(path).unwrap();
}

#[test]
fn duplicate_field_headers_require_mapping_instead_of_guessing() {
    let path = std::env::temp_dir().join(format!("partnest-ambiguous-{}.csv", std::process::id()));
    fs::write(
        &path,
        "Quantity,Quantity,Designator,Footprint,Value\n1,1,C1,0603,10k\n",
    )
    .unwrap();
    let result = inspect_tabular_bom(&path, None).expect("inspect ambiguous fixture");
    assert!(matches!(result, ImportPreview::NeedsMapping { .. }));
    fs::remove_file(path).unwrap();
}

#[test]
fn supplied_mapping_resolves_custom_headers() {
    let path = std::env::temp_dir().join(format!("partnest-mapping-{}.csv", std::process::id()));
    fs::write(&path, "Count,Refs,Case,Param\n2,C1,C0603,10k\n").unwrap();
    let mapping = [
        ("quantity".to_owned(), "Count".to_owned()),
        ("designators".to_owned(), "Refs".to_owned()),
        ("package".to_owned(), "Case".to_owned()),
        ("value".to_owned(), "Param".to_owned()),
    ]
    .into_iter()
    .collect();
    let result = inspect_tabular_bom(&path, Some(&mapping)).expect("parse mapped fixture");
    let ImportPreview::Ready(bom) = result else {
        panic!("custom mapping should be ready")
    };
    assert_eq!(bom.groups[0].quantity, 2);
    fs::remove_file(path).unwrap();
}

#[test]
fn side_column_creates_placements_without_inventing_side_when_absent() {
    let path = std::env::temp_dir().join(format!("partnest-side-{}.csv", std::process::id()));
    fs::write(&path, "数量,位号,封装,参数,板面\n2,C1,C0603,100nF,Bottom\n").unwrap();
    let result = inspect_tabular_bom(&path, None).expect("parse side fixture");
    let ImportPreview::Ready(bom) = result else {
        panic!("side fixture should be ready")
    };
    assert_eq!(bom.groups[0].placements.len(), 1);
    assert_eq!(
        bom.groups[0].placements[0].side,
        Some(partnest_desktop_lib::bom::types::BomSide::Bottom)
    );
    fs::remove_file(path).unwrap();
}
