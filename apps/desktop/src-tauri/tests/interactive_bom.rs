use partnest_desktop_lib::bom::interactive_html::{parse_interactive_html, InteractiveHtmlError};
use partnest_desktop_lib::bom::types::BomSide;
use std::fs;
use std::path::{Path, PathBuf};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/bom")
        .join(name)
}

#[test]
fn parses_top_and_bottom_designators_without_mutating_source() {
    let path = fixture("interactive-minimal.html");
    let before = sha256(&path);
    let bom = parse_interactive_html(&path).expect("parse fixture");
    assert_eq!(sha256(&path), before);
    assert_eq!(bom.groups.len(), 1);
    assert_eq!(bom.groups[0].designators, ["R1", "R2", "R3"]);
    assert_eq!(bom.groups[0].quantity, 3);
    assert_eq!(
        bom.groups[0]
            .placements
            .iter()
            .filter(|p| p.side == Some(BomSide::Top))
            .count(),
        2
    );
    assert_eq!(
        bom.groups[0]
            .placements
            .iter()
            .filter(|p| p.side == Some(BomSide::Bottom))
            .count(),
        1
    );
}

#[test]
fn rejects_missing_core_sections_without_partial_groups() {
    let path = std::env::temp_dir().join(format!(
        "partnest-invalid-interactive-{}",
        std::process::id()
    ));
    fs::write(
        &path,
        r#"<script>window.files = {"bom_merge":{"data":{"comp_info":{}}}};</script>"#,
    )
    .unwrap();
    assert!(matches!(
        parse_interactive_html(&path),
        Err(InteractiveHtmlError::UnsupportedInteractiveBom(_))
    ));
    fs::remove_file(path).unwrap();
}

fn sha256(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(fs::read(path).unwrap()))
}
