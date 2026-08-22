use partnest_desktop_lib::commands::boxes::{create_box_service, BoxInput};
use partnest_desktop_lib::commands::movements::list_movements_service;
use partnest_desktop_lib::commands::parts::{create_part_service, PartInput};
use partnest_desktop_lib::db::{new_id, Database};
use rusqlite::params;
use tempfile::tempdir;

fn part_input(box_id: &str) -> PartInput {
    PartInput {
        name: "10k resistor".into(),
        category: "resistor".into(),
        package: "0603".into(),
        manufacturer: "Acme".into(),
        mpn: "R-10K".into(),
        lcsc_code: "C123".into(),
        quantity: 13,
        box_id: box_id.into(),
        slot: "A0".into(),
        note: "test".into(),
    }
}

#[test]
fn movements_are_newest_first_with_stock_before_after_and_reversal_visibility() {
    let root = tempdir().unwrap();
    let db = Database::open(root.path().join("partnest.db")).unwrap();
    let box_record = create_box_service(
        &db,
        BoxInput {
            name: "Bench".into(),
            rows: 2,
            cols: 2,
        },
    )
    .unwrap();
    let part = create_part_service(&db, part_input(&box_record.id)).unwrap();
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
    db.connection().execute("INSERT INTO inventory_movements (id, part_id, session_id, movement_type, quantity, reason, component_key, created_at) VALUES ('m-old', ?1, 'session-1', 'adjust', 5, 'restock', 'R1', '2026-01-01T00:00:00.000Z')", params![part.id]).unwrap();
    db.connection().execute("INSERT INTO inventory_movements (id, part_id, session_id, movement_type, quantity, reason, component_key, created_at) VALUES ('m-take', ?1, 'session-1', 'consume', -2, 'welding take', 'R1', '2026-01-02T00:00:00.000Z')", params![part.id]).unwrap();

    let movements = list_movements_service(&db).unwrap();
    assert_eq!(movements.len(), 2);
    assert_eq!(movements[0].id, "m-take");
    assert_eq!(movements[0].before_quantity, Some(15));
    assert_eq!(movements[0].after_quantity, Some(13));
    assert_eq!(movements[0].bom_display_name.as_deref(), Some("Board note"));
    assert!(movements[0].can_reverse);

    db.connection().execute("INSERT INTO inventory_movements (id, part_id, session_id, movement_type, quantity, reason, reverses_movement_id, component_key, created_at) VALUES ('m-reverse', ?1, 'session-1', 'reverse', 2, 'welding take reversal', 'm-take', 'R1', '2026-01-03T00:00:00.000Z')", params![part.id]).unwrap();
    let movements = list_movements_service(&db).unwrap();
    assert_eq!(movements[1].id, "m-take");
    assert!(!movements[1].can_reverse);
}

#[test]
fn movement_ids_are_not_required_to_be_uuid_values() {
    let root = tempdir().unwrap();
    let db = Database::open(root.path().join(format!("{}.db", new_id()))).unwrap();
    assert!(list_movements_service(&db).unwrap().is_empty());
}
