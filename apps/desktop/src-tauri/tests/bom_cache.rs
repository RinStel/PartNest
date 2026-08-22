use partnest_desktop_lib::bom::bridge::BridgeError;
use partnest_desktop_lib::bom::cache::{InteractiveBomCache, SelectionError};
use partnest_desktop_lib::bom::types::BomSide;
use partnest_desktop_lib::db::Database;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/bom/interactive-minimal.html")
}

#[test]
fn caches_atomic_copy_with_hash_name_and_bridge_marker() {
    let root = tempdir().unwrap();
    let db = Database::open(root.path().join("partnest.db")).unwrap();
    let source = fixture();
    let before = hash(&source);
    let cache = InteractiveBomCache::new(&db, root.path().join("cache"));
    let session = cache.cache_interactive_bom(&source, "Fixture").unwrap();
    assert_eq!(hash(&source), before);
    assert_eq!(session.sha256, before);
    assert_eq!(session.cache_name, format!("{before}.html"));
    assert!(session.cache_path.is_file());
    let cached = fs::read_to_string(&session.cache_path).unwrap();
    assert!(cached.contains("bridge-v1"));
    assert_eq!(session.normalized.groups[0].designators, ["R1", "R2", "R3"]);
    assert_eq!(
        session.normalized.groups[0]
            .placements
            .iter()
            .filter(|p| p.side == Some(BomSide::Bottom))
            .count(),
        1
    );
}

#[test]
fn resolves_only_current_token_known_unique_same_group_designators() {
    let root = tempdir().unwrap();
    let db = Database::open(root.path().join("partnest.db")).unwrap();
    let cache = InteractiveBomCache::new(&db, root.path().join("cache"));
    let session = cache.cache_interactive_bom(fixture(), "Fixture").unwrap();
    let resolved = cache
        .resolve_bom_selection(&session.token, &["R1".into(), "R3".into()])
        .unwrap();
    assert_eq!(resolved.session_id, session.session_id);
    assert_eq!(resolved.designators, ["R1", "R3"]);
    assert!(matches!(
        cache.resolve_bom_selection("forged", &["R1".into()]),
        Err(BridgeError::InvalidToken)
    ));
    assert!(matches!(
        cache.resolve_bom_selection(&session.token, &["R1".into(), "R1".into()]),
        Err(SelectionError::DuplicateDesignator)
    ));
    assert!(matches!(
        cache.resolve_bom_selection(&session.token, &["Q9".into()]),
        Err(SelectionError::UnknownDesignator)
    ));
    db.connection()
        .execute(
            "UPDATE welding_sessions SET status = 'completed' WHERE id = ?1",
            [&session.session_id],
        )
        .unwrap();
    assert!(matches!(
        cache.resolve_bom_selection(&session.token, &["R1".into()]),
        Err(BridgeError::InactiveSession)
    ));
}

fn hash(path: &Path) -> String {
    hex::encode(Sha256::digest(fs::read(path).unwrap()))
}
