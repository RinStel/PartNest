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
        .resolve_bom_selection(&session.token, &["R1".into(), "R2".into()])
        .unwrap();
    assert_eq!(resolved.session_id, session.session_id);
    assert_eq!(resolved.designators, ["R1", "R2"]);
    assert_eq!(resolved.side, BomSide::Top);
    assert!(matches!(
        cache.resolve_bom_selection(&session.token, &["R1".into(), "R3".into()]),
        Err(SelectionError::MixedSideSelection)
    ));
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

#[test]
fn bootstraps_current_token_and_repairs_tampered_cache() {
    let root = tempdir().unwrap();
    let db = Database::open(root.path().join("partnest.db")).unwrap();
    let cache = InteractiveBomCache::new(&db, root.path().join("cache"));
    let first = cache.cache_interactive_bom(fixture(), "Fixture").unwrap();
    let content = fs::read_to_string(&first.cache_path).unwrap();
    assert!(content.contains("__PARTNEST_BOM_BRIDGE_V1__"));
    assert!(content.contains(&first.token));
    let config_start =
        content.find("__PARTNEST_BOM_BRIDGE_V1__=").unwrap() + "__PARTNEST_BOM_BRIDGE_V1__=".len();
    let config_end = content[config_start..].find(";</script>").unwrap() + config_start;
    let config = &content[config_start..config_end];
    assert!(serde_json::from_str::<serde_json::Value>(config).is_ok());
    assert!(!config.contains("</script>"));
    fs::write(&first.cache_path, "tampered").unwrap();
    let second = cache.cache_interactive_bom(fixture(), "Fixture").unwrap();
    let repaired = fs::read_to_string(&second.cache_path).unwrap();
    assert!(repaired.contains(&second.token));
    assert!(repaired.contains("bridge-v1"));
    assert_ne!(repaired, "tampered");
}

#[test]
fn restores_active_session_with_new_token_after_runtime_restart() {
    let root = tempdir().unwrap();
    let db = Database::open(root.path().join("partnest.db")).unwrap();
    let cache_dir = root.path().join("cache");
    let first = InteractiveBomCache::new(&db, &cache_dir)
        .cache_interactive_bom(fixture(), "Fixture")
        .unwrap();
    let restarted = InteractiveBomCache::new(&db, &cache_dir);
    let restored = restarted.restore_active_session().unwrap().unwrap();
    assert_eq!(restored.session_id, first.session_id);
    assert_ne!(restored.token, first.token);
    assert!(matches!(
        restarted.resolve_bom_selection(&first.token, &["R1".into()]),
        Err(BridgeError::InvalidToken)
    ));
    assert_eq!(
        restarted
            .resolve_bom_selection(&restored.token, &["R1".into()])
            .unwrap()
            .side,
        BomSide::Top
    );
}

#[test]
fn resolver_authoritatively_rejects_oversized_direct_inputs() {
    let root = tempdir().unwrap();
    let db = Database::open(root.path().join("partnest.db")).unwrap();
    let cache = InteractiveBomCache::new(&db, root.path().join("cache"));
    let session = cache.cache_interactive_bom(fixture(), "Fixture").unwrap();
    assert!(matches!(
        cache.resolve_bom_selection(&"t".repeat(129), &["R1".into()]),
        Err(BridgeError::TokenTooLong)
    ));
    assert!(matches!(
        cache.resolve_bom_selection(&session.token, &vec!["R1".into(); 513]),
        Err(BridgeError::TooManyDesignators)
    ));
    assert!(matches!(
        cache.resolve_bom_selection(&session.token, &["".into()]),
        Err(BridgeError::EmptyDesignator)
    ));
}

fn hash(path: &Path) -> String {
    hex::encode(Sha256::digest(fs::read(path).unwrap()))
}
