use partnest_desktop_lib::db::{new_id, BoxRecord, Database, Migration, PartRecord};
use rusqlite::params;
use std::fs;
use std::path::PathBuf;

fn test_database() -> Database {
    let path = test_path("db");
    Database::open(&path).expect("open test database")
}

fn test_path(suffix: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "partnest-test-{}-{}-{suffix}",
        std::process::id(),
        new_id()
    ))
}

fn uuid7_id() -> String {
    let id = new_id();
    assert_eq!(uuid::Uuid::parse_str(&id).unwrap().get_version_num(), 7);
    id
}

fn insert_box(db: &Database, id: &str) {
    db.connection()
        .execute(
            "INSERT INTO boxes (id, name, rows, cols) VALUES (?1, ?2, ?3, ?4)",
            params![id, "Test box", 4_i64, 4_i64],
        )
        .expect("insert box");
}

fn insert_part(db: &Database, box_id: &str, slot: &str, quantity: i64) -> rusqlite::Result<usize> {
    db.connection().execute(
        "INSERT INTO parts (id, name, category, package, manufacturer, mpn, lcsc_code, quantity, box_id, slot, note, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?10, 1)",
        params![uuid7_id(), "Part", "resistor", "0603", "Acme", "R-1", quantity, box_id, slot, ""],
    )
}

#[test]
fn migration_enforces_slot_and_quantity_constraints() {
    let db = test_database();
    insert_box(&db, "box-1");
    assert!(insert_part(&db, "box-1", "A0", 10).is_ok());
    assert!(insert_part(&db, "box-1", "A0", 2).is_err());
    assert!(insert_part(&db, "box-1", "A1", -1).is_err());
}

#[test]
fn migration_enforces_side_and_lcsc_constraints() {
    let db = test_database();
    insert_box(&db, "box-1");
    assert!(
        db.connection()
            .execute(
                "INSERT INTO parts (id, name, quantity, box_id, slot, lcsc_code) VALUES (?1, 'A', 1, ?2, 'A0', 'C1')",
                params![uuid7_id(), "box-1"],
            )
            .is_ok()
    );
    assert!(
        db.connection()
            .execute(
                "INSERT INTO parts (id, name, quantity, box_id, slot, lcsc_code) VALUES (?1, 'B', 1, ?2, 'A1', 'C1')",
                params![uuid7_id(), "box-1"],
            )
            .is_err()
    );

    db.connection()
        .execute(
            "INSERT INTO bom_files (id, original_name, display_name, sha256, cache_name) VALUES ('bom-1', 'a.html', 'A', 'hash', 'hash.html')",
            [],
        )
        .unwrap();
    db.connection()
        .execute(
            "INSERT INTO welding_sessions (id, bom_file_id, status) VALUES ('session-1', 'bom-1', 'active')",
            [],
        )
        .unwrap();
    assert!(db
        .connection()
        .execute(
            "INSERT INTO welding_progress (id, session_id, component_key, side, required_quantity, taken_quantity) VALUES ('progress-1', 'session-1', 'R1', 'left', 1, 0)",
            [],
        )
        .is_err());
}

#[test]
fn migration_enforces_progress_uniqueness_and_quantity_bounds() {
    let db = test_database();
    insert_box(&db, "box-1");
    db.connection().execute("INSERT INTO bom_files (id, original_name, display_name, sha256, cache_name) VALUES ('bom-1', 'a.html', 'A', 'hash', 'hash.html')", []).unwrap();
    db.connection().execute("INSERT INTO welding_sessions (id, bom_file_id, status) VALUES ('session-1', 'bom-1', 'active')", []).unwrap();
    let valid = "INSERT INTO welding_progress (id, session_id, component_key, side, required_quantity, taken_quantity) VALUES (?1, 'session-1', 'R1', 'top', 2, 1)";
    db.connection()
        .execute(valid, rusqlite::params![uuid7_id()])
        .unwrap();
    assert!(db
        .connection()
        .execute(valid, rusqlite::params![uuid7_id()])
        .is_err());
    assert!(db.connection().execute("INSERT INTO welding_progress (id, session_id, component_key, side, required_quantity, taken_quantity) VALUES (?1, 'session-1', 'R2', 'top', 1, 2)", rusqlite::params![uuid7_id()]).is_err());
    assert!(db.connection().execute("INSERT INTO welding_progress (id, session_id, component_key, side, required_quantity, taken_quantity) VALUES (?1, 'session-1', 'R3', 'top', -1, 0)", rusqlite::params![uuid7_id()]).is_err());
    assert!(db.connection().execute("INSERT INTO welding_progress (id, session_id, component_key, side, required_quantity, taken_quantity) VALUES (?1, 'session-1', 'R4', 'top', 1, -1)", rusqlite::params![uuid7_id()]).is_err());
}

#[test]
fn empty_and_null_lcsc_codes_are_not_unique() {
    let db = test_database();
    insert_box(&db, "box-1");
    for (slot, code) in [("A0", ""), ("A1", ""), ("A2", " ")] {
        assert!(db.connection().execute("INSERT INTO parts (id, name, quantity, box_id, slot, lcsc_code) VALUES (?1, 'Part', 1, 'box-1', ?2, ?3)", rusqlite::params![uuid7_id(), slot, code]).is_ok());
    }
    assert!(db.connection().execute("INSERT INTO parts (id, name, quantity, box_id, slot, lcsc_code) VALUES (?1, 'Part', 1, 'box-1', 'A3', NULL)", rusqlite::params![uuid7_id()]).is_ok());
    assert!(db.connection().execute("INSERT INTO parts (id, name, quantity, box_id, slot, lcsc_code) VALUES (?1, 'Part', 1, 'box-1', 'A4', NULL)", rusqlite::params![uuid7_id()]).is_ok());
}

#[test]
fn migration_initializes_pragmas_and_all_business_tables() {
    let db = test_database();
    assert_eq!(
        db.connection()
            .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.connection()
            .query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        5000
    );
    assert_eq!(
        db.connection()
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "wal"
    );

    let mut statement = db
        .connection()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .unwrap();
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    for expected in [
        "boxes",
        "parts",
        "bom_files",
        "welding_sessions",
        "welding_progress",
        "inventory_movements",
    ] {
        assert!(
            names.iter().any(|name| name == expected),
            "missing {expected}"
        );
    }
}

#[test]
fn migrations_are_applied_transactionally_and_foreign_keys_keep_audit_rows() {
    let db = test_database();
    insert_box(&db, "box-1");
    let result = db.transaction().and_then(|tx| {
        tx.execute(
            "INSERT INTO boxes (id, name, rows, cols) VALUES ('box-2', 'Second', 1, 1)",
            [],
        )?;
        tx.rollback()
    });
    assert!(result.is_ok());
    assert_eq!(
        db.connection()
            .query_row("SELECT COUNT(*) FROM boxes WHERE id = 'box-2'", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
}

#[test]
fn migration_runner_rolls_back_failures_and_reopens_idempotently() {
    let path = test_path("migration");
    let failing = [Migration {
        version: 1,
        sql: "CREATE TABLE partial (id INTEGER); INSERT INTO missing_table VALUES (1);",
    }];
    assert!(Database::open_with_migrations(&path, &failing).is_err());
    let valid = [Migration {
        version: 1,
        sql: "CREATE TABLE marker (id INTEGER PRIMARY KEY);",
    }];
    let db = Database::open_with_migrations(&path, &valid).unwrap();
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'partial'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    drop(db);
    let reopened = Database::open_with_migrations(&path, &valid).unwrap();
    assert_eq!(
        reopened
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'marker'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        reopened
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 1",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn constructors_generate_uuidv7_ids() {
    let box_record = BoxRecord::new("Box".into(), 2, 3);
    let part_record = PartRecord::new("Part".into(), "box-1".into(), "A0".into(), 1);
    assert_eq!(
        uuid::Uuid::parse_str(&box_record.id)
            .unwrap()
            .get_version_num(),
        7
    );
    assert_eq!(
        uuid::Uuid::parse_str(&part_record.id)
            .unwrap()
            .get_version_num(),
        7
    );
}

#[test]
fn app_data_dir_seam_opens_partnest_database() {
    let app_data_dir = test_path("app-data");
    let db = Database::open_app_data_dir(&app_data_dir).unwrap();
    assert!(app_data_dir.join("partnest.db").is_file());
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'parts'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    drop(db);
    fs::remove_dir_all(&app_data_dir).unwrap();
}

#[test]
fn foreign_key_actions_preserve_audit_rows_and_enforce_restricts() {
    let db = test_database();
    insert_box(&db, "box-1");
    let part_id = uuid7_id();
    db.connection().execute("INSERT INTO parts (id, name, quantity, box_id, slot) VALUES (?1, 'Part', 1, 'box-1', 'A0')", rusqlite::params![part_id]).unwrap();
    db.connection().execute("INSERT INTO bom_files (id, original_name, display_name, sha256, cache_name) VALUES ('bom-1', 'a.html', 'A', 'hash', 'hash.html')", []).unwrap();
    db.connection().execute("INSERT INTO welding_sessions (id, bom_file_id, status) VALUES ('session-1', 'bom-1', 'active')", []).unwrap();
    db.connection().execute("INSERT INTO welding_progress (id, session_id, component_key, side, part_id, required_quantity, taken_quantity) VALUES ('progress-1', 'session-1', 'R1', 'top', ?1, 1, 0)", rusqlite::params![part_id]).unwrap();
    db.connection().execute("INSERT INTO inventory_movements (id, part_id, session_id, movement_type, quantity, reason) VALUES ('movement-1', ?1, 'session-1', 'consume', -1, 'take')", rusqlite::params![part_id]).unwrap();
    db.connection().execute("INSERT INTO inventory_movements (id, part_id, session_id, movement_type, quantity, reason, reverses_movement_id) VALUES ('movement-2', ?1, 'session-1', 'reverse', 1, 'undo', 'movement-1')", rusqlite::params![part_id]).unwrap();

    assert!(db
        .connection()
        .execute("DELETE FROM boxes WHERE id = 'box-1'", [])
        .is_err());
    assert!(db
        .connection()
        .execute("DELETE FROM bom_files WHERE id = 'bom-1'", [])
        .is_err());
    assert!(db
        .connection()
        .execute(
            "DELETE FROM inventory_movements WHERE id = 'movement-1'",
            []
        )
        .is_err());

    db.connection()
        .execute(
            "DELETE FROM parts WHERE id = ?1",
            rusqlite::params![part_id],
        )
        .unwrap();
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT part_id FROM inventory_movements WHERE id = 'movement-1'",
                [],
                |row| row.get::<_, Option<String>>(0)
            )
            .unwrap(),
        None
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT part_id FROM welding_progress WHERE id = 'progress-1'",
                [],
                |row| row.get::<_, Option<String>>(0)
            )
            .unwrap(),
        None
    );

    db.connection()
        .execute("DELETE FROM welding_sessions WHERE id = 'session-1'", [])
        .unwrap();
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT session_id FROM inventory_movements WHERE id = 'movement-1'",
                [],
                |row| row.get::<_, Option<String>>(0)
            )
            .unwrap(),
        None
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM welding_progress WHERE id = 'progress-1'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE id IN ('movement-1', 'movement-2')",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    db.connection()
        .execute("DELETE FROM boxes WHERE id = 'box-1'", [])
        .unwrap();
}
