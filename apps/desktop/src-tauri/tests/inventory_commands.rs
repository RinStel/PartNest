use partnest_desktop_lib::commands::boxes::{create_box_service, resize_box_service, BoxInput};
use partnest_desktop_lib::commands::parts::{
    adjust_stock_service, create_part_service, list_parts_service, update_part_service, PartInput,
};
use partnest_desktop_lib::commands::CommandError;
use partnest_desktop_lib::db::{new_id, Database};

fn database() -> Database {
    let path = std::env::temp_dir().join(format!("partnest-inventory-test-{}", new_id()));
    Database::open(path).expect("open test database")
}

fn box_input(rows: i64, cols: i64) -> BoxInput {
    BoxInput {
        name: "Test box".into(),
        rows,
        cols,
    }
}

fn part_input(box_id: &str, slot: &str, quantity: i64) -> PartInput {
    PartInput {
        name: "10k resistor".into(),
        category: "resistor".into(),
        package: "0603".into(),
        manufacturer: "Acme".into(),
        mpn: "R-10K".into(),
        lcsc_code: "C123".into(),
        quantity,
        box_id: box_id.into(),
        slot: slot.into(),
        note: "test".into(),
    }
}

#[test]
fn create_part_normalizes_slot_and_rejects_out_of_range_positions() {
    let db = database();
    let box_record = create_box_service(&db, box_input(2, 100)).unwrap();

    let part = create_part_service(&db, part_input(&box_record.id, "a0", 2)).unwrap();
    assert_eq!(part.slot, "A0");
    let mut multi_input = part_input(&box_record.id, "a10", 2);
    multi_input.lcsc_code = "C124".into();
    let multi_digit = create_part_service(&db, multi_input).unwrap();
    assert_eq!(multi_digit.slot, "A10");

    assert!(create_part_service(&db, part_input(&box_record.id, "C0", 1)).is_err());
    assert!(create_part_service(&db, part_input(&box_record.id, "A100", 1)).is_err());
    for invalid in ["A01", "A+1", "A-0", "A１"] {
        assert!(
            create_part_service(&db, part_input(&box_record.id, invalid, 1)).is_err(),
            "{invalid}"
        );
    }
}

#[test]
fn box_rejects_more_than_one_hundred_columns() {
    let db = database();
    assert!(create_box_service(&db, box_input(2, 101)).is_err());
}

#[test]
fn resize_rejects_shrinking_away_an_occupied_slot() {
    let db = database();
    let box_record = create_box_service(&db, box_input(10, 10)).unwrap();
    create_part_service(&db, part_input(&box_record.id, "A9", 1)).unwrap();

    let error = resize_box_service(&db, &box_record.id, 2, 2).unwrap_err();
    assert_eq!(error.to_string(), "目标规格包含不了已占用盒位 A9");
}

#[test]
fn duplicate_slot_is_rejected() {
    let db = database();
    let box_record = create_box_service(&db, box_input(2, 2)).unwrap();
    create_part_service(&db, part_input(&box_record.id, "A0", 1)).unwrap();
    assert!(create_part_service(&db, part_input(&box_record.id, "a0", 1)).is_err());
}

#[test]
fn stale_version_update_returns_conflict() {
    let db = database();
    let box_record = create_box_service(&db, box_input(2, 2)).unwrap();
    let part = create_part_service(&db, part_input(&box_record.id, "A0", 1)).unwrap();

    let mut changed = part_input(&box_record.id, "A0", 99);
    changed.name = "updated".into();
    let updated = update_part_service(&db, &part.id, part.version, changed.clone()).unwrap();
    assert_eq!(updated.version, part.version + 1);
    assert_eq!(updated.quantity, 1);
    assert!(matches!(
        update_part_service(&db, &part.id, part.version, changed),
        Err(CommandError::Conflict)
    ));
}

#[test]
fn list_parts_filters_by_name_and_mpn() {
    let db = database();
    let box_record = create_box_service(&db, box_input(2, 2)).unwrap();
    create_part_service(&db, part_input(&box_record.id, "A0", 1)).unwrap();
    let mut other = part_input(&box_record.id, "A1", 1);
    other.name = "capacitor".into();
    other.mpn = "C-100".into();
    other.lcsc_code = "C125".into();
    create_part_service(&db, other).unwrap();

    let results = list_parts_service(&db, Some("c-100")).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].name, "capacitor");
}

#[test]
fn stock_adjustment_rejects_negative_inventory_and_writes_audit_row() {
    let db = database();
    let box_record = create_box_service(&db, box_input(2, 2)).unwrap();
    let part = create_part_service(&db, part_input(&box_record.id, "A0", 1)).unwrap();

    assert!(adjust_stock_service(&db, &part.id, -2, "consume").is_err());
    let adjusted = adjust_stock_service(&db, &part.id, 3, "restock").unwrap();
    assert_eq!(adjusted.quantity, 4);
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE part_id = ?1 AND quantity = 3 AND reason = 'restock'",
                [&part.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
}
