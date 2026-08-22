use partnest_desktop_lib::bom::types::BomSide;
use partnest_desktop_lib::commands::boxes::{create_box_service, BoxInput};
use partnest_desktop_lib::commands::parts::{create_part_service, PartInput};
use partnest_desktop_lib::commands::welding::{
    confirm_take_service, get_welding_progress_service, reverse_take_service, ConfirmTakeInput,
};
use partnest_desktop_lib::db::{new_id, Database};

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
