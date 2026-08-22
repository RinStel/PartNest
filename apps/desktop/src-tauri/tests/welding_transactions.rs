use partnest_desktop_lib::bom::cache::InteractiveBomRuntime;
use partnest_desktop_lib::bom::types::BomSide;
use partnest_desktop_lib::commands::boxes::{create_box_service, BoxInput};
use partnest_desktop_lib::commands::parts::{create_part_service, PartInput};
use partnest_desktop_lib::commands::welding::{
    confirm_take_authorized_service, confirm_take_service, get_welding_progress_service,
    reverse_take_service, ConfirmTakeInput,
};
use partnest_desktop_lib::db::{new_id, Database, Migration};

fn database() -> Database {
    let path = std::env::temp_dir().join(format!("partnest-welding-test-{}", new_id()));
    Database::open(path).expect("open test database")
}

fn fixture() -> (Database, String, String) {
    let db = database();
    let box_record = create_box_service(
        &db,
        BoxInput {
            name: "Test box".into(),
            rows: 2,
            cols: 2,
        },
    )
    .unwrap();
    let part = create_part_service(
        &db,
        PartInput {
            name: "10k resistor".into(),
            category: "resistor".into(),
            package: "0603".into(),
            manufacturer: "Acme".into(),
            mpn: "R-10K".into(),
            lcsc_code: "C123".into(),
            quantity: 10,
            box_id: box_record.id,
            slot: "A0".into(),
            note: String::new(),
        },
    )
    .unwrap();
    let bom_id = new_id();
    let session_id = new_id();
    db.connection()
        .execute(
            "INSERT INTO bom_files (id, original_name, display_name, sha256, cache_name) VALUES (?1, 'bom.html', 'BOM', 'hash', 'hash.html')",
            [&bom_id],
        )
        .unwrap();
    db.connection()
        .execute(
            "INSERT INTO welding_sessions (id, bom_file_id, status) VALUES (?1, ?2, 'active')",
            rusqlite::params![session_id, bom_id],
        )
        .unwrap();
    (db, session_id, part.id)
}

fn take(session_id: &str, part_id: &str, side: BomSide, quantity: i64) -> ConfirmTakeInput {
    ConfirmTakeInput {
        session_id: session_id.into(),
        component_key: "C123".into(),
        side,
        designators: vec!["R1".into()],
        bom_quantity: 3,
        take_quantity: quantity,
        part_id: part_id.into(),
        expected_part_version: 1,
    }
}

#[test]
fn top_and_bottom_takes_are_independent_and_additional_take_is_a_new_movement() {
    let (db, session_id, part_id) = fixture();
    let top = confirm_take_service(&db, take(&session_id, &part_id, BomSide::Top, 2)).unwrap();
    let mut bottom_input = take(&session_id, &part_id, BomSide::Bottom, 1);
    bottom_input.expected_part_version = top.part_version;
    let bottom = confirm_take_service(&db, bottom_input).unwrap();

    let mut additional = take(&session_id, &part_id, BomSide::Top, 1);
    additional.expected_part_version = bottom.part_version;
    let extra = confirm_take_service(&db, additional).unwrap();
    assert_ne!(top.movement_id, extra.movement_id);
    assert_eq!(extra.consumed_quantity, 3);

    let progress = get_welding_progress_service(&db, &session_id).unwrap();
    assert_eq!(progress.len(), 2);
    assert_eq!(
        progress
            .iter()
            .find(|p| p.side == BomSide::Top)
            .unwrap()
            .consumed_quantity,
        3
    );
    assert_eq!(
        progress
            .iter()
            .find(|p| p.side == BomSide::Bottom)
            .unwrap()
            .consumed_quantity,
        1
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT quantity FROM parts WHERE id = ?1",
                [&part_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        6
    );
}

#[test]
fn insufficient_stock_and_stale_version_are_atomic() {
    let (db, session_id, part_id) = fixture();
    let mut input = take(&session_id, &part_id, BomSide::Top, 11);
    input.bom_quantity = 11;
    assert!(confirm_take_service(&db, input).is_err());
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT quantity, version FROM parts WHERE id = ?1",
                [&part_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            )
            .unwrap(),
        (10, 1)
    );
    let first = confirm_take_service(&db, take(&session_id, &part_id, BomSide::Top, 1)).unwrap();
    let stale = confirm_take_service(&db, take(&session_id, &part_id, BomSide::Bottom, 1));
    assert!(stale.is_err());
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE session_id = ?1",
                [&session_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(first.part_version, 2);
}

#[test]
fn reversing_bottom_take_restores_stock_and_duplicate_reversal_is_rejected() {
    let (db, session_id, part_id) = fixture();
    let mut input = take(&session_id, &part_id, BomSide::Bottom, 1);
    input.expected_part_version = 1;
    let taken = confirm_take_service(&db, input).unwrap();
    let reversed = reverse_take_service(&db, &taken.movement_id).unwrap();
    assert_eq!(reversed.side, BomSide::Bottom);
    assert_eq!(reversed.consumed_quantity, 0);
    assert_eq!(reversed.status, "pending");
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT quantity FROM parts WHERE id = ?1",
                [&part_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        10
    );
    assert!(reverse_take_service(&db, &taken.movement_id).is_err());
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE session_id = ?1",
                [&session_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
}

#[test]
fn complete_sequence_keeps_side_status_and_quantities_independent() {
    let (db, session_id, part_id) = fixture();
    let mut top_input = take(&session_id, &part_id, BomSide::Top, 2);
    top_input.expected_part_version = 1;
    let top = confirm_take_service(&db, top_input).unwrap();
    assert_eq!(top.status, "partial");

    let mut bottom_input = take(&session_id, &part_id, BomSide::Bottom, 1);
    bottom_input.expected_part_version = top.part_version;
    let bottom = confirm_take_service(&db, bottom_input).unwrap();
    assert_eq!(bottom.status, "partial");

    let mut additional = take(&session_id, &part_id, BomSide::Top, 1);
    additional.expected_part_version = bottom.part_version;
    let top_done = confirm_take_service(&db, additional).unwrap();
    assert_eq!(top_done.status, "taken");

    let bottom_reversed = reverse_take_service(&db, &bottom.movement_id).unwrap();
    assert_eq!(bottom_reversed.status, "pending");
    let progress = get_welding_progress_service(&db, &session_id).unwrap();
    let top_progress = progress.iter().find(|p| p.side == BomSide::Top).unwrap();
    let bottom_progress = progress.iter().find(|p| p.side == BomSide::Bottom).unwrap();
    assert_eq!(
        (top_progress.consumed_quantity, top_progress.status.as_str()),
        (3, "taken")
    );
    assert_eq!(
        (
            bottom_progress.consumed_quantity,
            bottom_progress.status.as_str()
        ),
        (0, "pending")
    );
    assert!(reverse_take_service(&db, &bottom.movement_id).is_err());
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE session_id = ?1",
                [&session_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        4
    );
}

#[test]
fn authorized_command_requires_exact_active_designators_and_uses_authoritative_quantity() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path().join("partnest.db")).unwrap();
    let runtime = InteractiveBomRuntime::new(root.path().join("cache"));
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/bom/interactive-minimal.html");
    let session = runtime
        .cache_interactive_bom(&db, source, "Fixture")
        .unwrap();
    let box_record = create_box_service(
        &db,
        BoxInput {
            name: "Test box".into(),
            rows: 2,
            cols: 2,
        },
    )
    .unwrap();
    let part = create_part_service(
        &db,
        PartInput {
            name: "10k resistor".into(),
            category: "resistor".into(),
            package: "0603".into(),
            manufacturer: "Acme".into(),
            mpn: "ACME-10K".into(),
            lcsc_code: "C100".into(),
            quantity: 10,
            box_id: box_record.id,
            slot: "A0".into(),
            note: String::new(),
        },
    )
    .unwrap();
    let mut valid = ConfirmTakeInput {
        session_id: session.session_id.clone(),
        component_key: "C100".into(),
        side: BomSide::Top,
        designators: vec!["R1".into(), "R2".into()],
        bom_quantity: 999,
        take_quantity: 1,
        part_id: part.id.clone(),
        expected_part_version: 1,
    };
    let taken = confirm_take_authorized_service(&db, &runtime, valid.clone()).unwrap();
    assert_eq!(taken.required_quantity, 2);

    for designators in [
        vec!["R1".into()],
        vec!["R1".into(), "R2".into(), "R9".into()],
        vec!["R1".into(), "R1".into()],
        vec!["R1".into(), "R3".into()],
    ] {
        valid.designators = designators;
        valid.expected_part_version = 2;
        assert!(confirm_take_authorized_service(&db, &runtime, valid.clone()).is_err());
    }
    db.connection()
        .execute(
            "UPDATE welding_sessions SET status = 'completed' WHERE id = ?1",
            [&session.session_id],
        )
        .unwrap();
    valid.designators = vec!["R1".into(), "R2".into()];
    assert!(confirm_take_authorized_service(&db, &runtime, valid).is_err());
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT quantity, version FROM parts WHERE id = ?1",
                [&part.id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            )
            .unwrap(),
        (9, 2)
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE session_id = ?1",
                [&session.session_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn later_movement_failure_rolls_back_stock_version_and_progress() {
    let (db, session_id, part_id) = fixture();
    db.connection().execute_batch("CREATE TRIGGER fail_welding_movement BEFORE INSERT ON inventory_movements WHEN NEW.reason = 'welding take' BEGIN SELECT RAISE(ABORT, 'injected movement failure'); END").unwrap();
    let result = confirm_take_service(&db, take(&session_id, &part_id, BomSide::Top, 1));
    assert!(result.is_err());
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT quantity, version FROM parts WHERE id = ?1",
                [&part_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            )
            .unwrap(),
        (10, 1)
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE session_id = ?1",
                [&session_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM welding_progress WHERE session_id = ?1",
                [&session_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn migration_0002_upgrades_existing_welding_databases() {
    let path = std::env::temp_dir().join(format!("partnest-welding-migration-{}", new_id()));
    let initial = include_str!("../migrations/0001_initial.sql");
    Database::open_with_migrations(
        &path,
        &[Migration {
            version: 1,
            sql: initial,
        }],
    )
    .unwrap();
    let upgraded = Database::open(&path).unwrap();
    let columns = upgraded
        .connection()
        .prepare("PRAGMA table_info(inventory_movements)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(columns.iter().any(|column| column == "component_key"));
    assert!(columns.iter().any(|column| column == "side"));
}
