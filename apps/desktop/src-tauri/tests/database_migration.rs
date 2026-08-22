use partnest_desktop_lib::db::Database;
use rusqlite::params;

fn test_database() -> Database {
    let path = std::env::temp_dir().join(format!(
        "partnest-database-test-{}-{}.db",
        std::process::id(),
        uuid::Uuid::now_v7()
    ));
    Database::open(&path).expect("open test database")
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
        params![uuid::Uuid::now_v7().to_string(), "Part", "resistor", "0603", "Acme", "R-1", quantity, box_id, slot, ""],
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
                params![uuid::Uuid::now_v7().to_string(), "box-1"],
            )
            .is_ok()
    );
    assert!(
        db.connection()
            .execute(
                "INSERT INTO parts (id, name, quantity, box_id, slot, lcsc_code) VALUES (?1, 'B', 1, ?2, 'A1', 'C1')",
                params![uuid::Uuid::now_v7().to_string(), "box-1"],
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

    db.connection()
        .execute(
            "INSERT INTO inventory_movements (id, part_id, movement_type, quantity, reason) VALUES ('movement-1', NULL, 'adjust', 1, 'audit')",
            [],
        )
        .unwrap();
    db.connection()
        .execute("DELETE FROM boxes WHERE id = 'box-1'", [])
        .unwrap();
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE id = 'movement-1'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}
