use partnest_desktop_lib::{
    bom::types::{BomSide, ImportPreview, NormalizedBomDto},
    db::welding_repository::TakeResult,
};
use std::collections::BTreeSet;

#[test]
fn take_response_fields_match_the_frontend_contract() {
    let result = TakeResult {
        movement_id: "m".into(),
        session_id: "s".into(),
        component_key: "c".into(),
        side: BomSide::Top,
        part_id: "p".into(),
        take_quantity: 1,
        required_quantity: 1,
        consumed_quantity: 1,
        taken_quantity: 1,
        status: "taken".into(),
        part_version: 2,
    };
    let json = serde_json::to_value(result).unwrap();
    let rust_fields: BTreeSet<_> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    let source = include_str!("../../src/app/contracts.ts");
    let declaration = source
        .split_once("export type TakeResult = {")
        .unwrap()
        .1
        .split_once("};")
        .unwrap()
        .0;
    let ts_fields: BTreeSet<_> = declaration
        .lines()
        .filter_map(|line| line.trim().split_once(':').map(|(name, _)| name))
        .collect();
    assert_eq!(
        rust_fields, ts_fields,
        "the IPC response must not promise input-only fields"
    );
}

#[test]
fn import_preview_keeps_the_externally_tagged_wire_shape() {
    let value = ImportPreview::Ready(NormalizedBomDto {
        source_name: "board.csv".into(),
        groups: vec![],
    });
    assert_eq!(
        serde_json::to_value(value).unwrap(),
        serde_json::json!({"Ready": {"source_name": "board.csv", "groups": []}})
    );
    let mapping = ImportPreview::NeedsMapping {
        headers: vec!["Part".into()],
        suggestions: Default::default(),
    };
    assert_eq!(
        serde_json::to_value(mapping).unwrap(),
        serde_json::json!({"NeedsMapping": {"headers": ["Part"], "suggestions": {}}})
    );
}
