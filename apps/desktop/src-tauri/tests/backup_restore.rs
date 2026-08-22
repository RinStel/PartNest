use partnest_desktop_lib::{
    backup::{create_backup, restore_database_file, validate_backup},
    db::{new_id, Database},
};
use rusqlite::{Connection, OpenFlags};
use std::fs;
use tempfile::tempdir;

fn seed_database(path: &std::path::Path) -> Database {
    let db = Database::open(path).expect("open database");
    db.connection()
        .execute(
            "INSERT INTO boxes (id, name, rows, cols) VALUES ('box-1', 'Bench', 2, 2)",
            [],
        )
        .unwrap();
    db.connection()
        .execute(
            "INSERT INTO parts (id, name, quantity, box_id, slot) VALUES ('part-1', '10k', 4, 'box-1', 'A0')",
            [],
        )
        .unwrap();
    db.connection()
        .execute(
            "INSERT INTO bom_files (id, original_name, display_name, sha256, cache_name) VALUES ('bom-1', 'board.html', 'Board note', 'hash', 'hash.html')",
            [],
        )
        .unwrap();
    db.connection()
        .execute(
            "INSERT INTO welding_sessions (id, bom_file_id, status) VALUES ('session-1', 'bom-1', 'active')",
            [],
        )
        .unwrap();
    db.connection()
        .execute(
            "INSERT INTO welding_progress (id, session_id, component_key, side, required_quantity, taken_quantity) VALUES ('progress-1', 'session-1', 'R1', 'top', 1, 1)",
            [],
        )
        .unwrap();
    db.connection()
        .execute(
            "INSERT INTO inventory_movements (id, part_id, session_id, movement_type, quantity, reason) VALUES ('movement-1', 'part-1', 'session-1', 'consume', -1, 'welding take')",
            [],
        )
        .unwrap();
    db
}

fn count(path: &std::path::Path, table: &str) -> i64 {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn backup_includes_uncheckpointed_wal_rows_and_all_business_tables() {
    let root = tempdir().unwrap();
    let db_path = root.path().join("partnest.db");
    let db = seed_database(&db_path);
    assert_eq!(
        db.connection()
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "wal"
    );
    let backup_path = create_backup(&db, root.path()).unwrap();
    drop(db);

    assert_eq!(count(&backup_path, "boxes"), 1);
    assert_eq!(count(&backup_path, "parts"), 1);
    assert_eq!(count(&backup_path, "inventory_movements"), 1);
    assert_eq!(count(&backup_path, "welding_progress"), 1);
    validate_backup(&backup_path).unwrap();
}

#[test]
fn corrupt_and_newer_schema_backups_are_rejected() {
    let root = tempdir().unwrap();
    let db_path = root.path().join("partnest.db");
    let db = seed_database(&db_path);
    let backup_path = create_backup(&db, root.path()).unwrap();
    drop(db);

    let corrupt_path = root.path().join("corrupt.db");
    fs::write(&corrupt_path, b"not sqlite").unwrap();
    assert!(validate_backup(&corrupt_path).is_err());

    let newer_path = root.path().join("newer.db");
    fs::copy(&backup_path, &newer_path).unwrap();
    let newer = Connection::open(&newer_path).unwrap();
    newer
        .execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (99, 'future')",
            [],
        )
        .unwrap();
    drop(newer);
    assert!(validate_backup(&newer_path).is_err());
}

#[test]
fn backup_rotation_keeps_newest_ten_valid_backups() {
    let root = tempdir().unwrap();
    let db = seed_database(&root.path().join("partnest.db"));
    for _ in 0..12 {
        create_backup(&db, root.path()).unwrap();
    }
    let valid = fs::read_dir(root.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "db"))
        .filter(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("partnest-"))
        })
        .filter(|path| validate_backup(path).is_ok())
        .count();
    assert_eq!(valid, 10);
}

#[test]
fn failed_restore_preserves_the_existing_database() {
    let root = tempdir().unwrap();
    let target_path = root.path().join("target.db");
    let mut target = seed_database(&target_path);
    target
        .connection()
        .execute("DELETE FROM inventory_movements", [])
        .unwrap();

    let invalid_path = root.path().join(format!("invalid-{}.db", new_id()));
    fs::write(&invalid_path, b"invalid backup").unwrap();
    assert!(restore_database_file(&mut target, &invalid_path).is_err());
    assert_eq!(count(&target_path, "inventory_movements"), 0);
}

#[test]
fn restore_replaces_live_database_from_a_valid_backup() {
    let root = tempdir().unwrap();
    let source_path = root.path().join("source.db");
    let source = seed_database(&source_path);
    let backup_path = create_backup(&source, root.path().join("backups")).unwrap();
    drop(source);

    let target_path = root.path().join("target.db");
    let mut target = seed_database(&target_path);
    target
        .connection()
        .execute("DELETE FROM inventory_movements", [])
        .unwrap();
    restore_database_file(&mut target, &backup_path).unwrap();
    assert_eq!(count(&target_path, "inventory_movements"), 1);
    assert_eq!(count(&target_path, "welding_progress"), 1);
}
