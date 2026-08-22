use super::{lock_error, normalize_slot, optional_text, validate_name, CommandError};
use crate::db::{new_id, utc_now, Database};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PartInput {
    pub name: String,
    pub category: String,
    pub package: String,
    pub manufacturer: String,
    pub mpn: String,
    pub lcsc_code: String,
    pub quantity: i64,
    pub box_id: String,
    pub slot: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PartView {
    pub id: String,
    pub name: String,
    pub category: Option<String>,
    pub package: Option<String>,
    pub manufacturer: Option<String>,
    pub mpn: Option<String>,
    pub lcsc_code: Option<String>,
    pub quantity: i64,
    pub box_id: String,
    pub slot: String,
    pub note: Option<String>,
    pub version: i64,
}

fn next_movement_sequence(transaction: &Transaction<'_>) -> Result<i64, CommandError> {
    transaction
        .query_row(
            "SELECT COALESCE(MAX(movement_sequence), 0) + 1 FROM inventory_movements",
            [],
            |row| row.get(0),
        )
        .map_err(CommandError::from)
}

fn validate_input(
    db: &Database,
    input: &PartInput,
    validate_quantity: bool,
) -> Result<(String, String, String), CommandError> {
    let name = validate_name(&input.name, "器件")?;
    if validate_quantity && input.quantity < 0 {
        return Err(CommandError::Validation("库存数量不能为负数".into()));
    }
    let Some((rows, cols)) = db
        .connection()
        .query_row(
            "SELECT rows, cols FROM boxes WHERE id = ?1",
            [&input.box_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?
    else {
        return Err(CommandError::NotFound("收纳盒不存在".into()));
    };
    let slot = normalize_slot(&input.slot, rows, cols)?;
    Ok((name, input.box_id.clone(), slot))
}

fn read_part(db: &Database, id: &str) -> Result<PartView, CommandError> {
    db.connection()
        .query_row(
            "SELECT id, name, category, package, manufacturer, mpn, lcsc_code, quantity, box_id, slot, note, version FROM parts WHERE id = ?1",
            [id],
            |row| Ok(PartView {
                id: row.get(0)?, name: row.get(1)?, category: row.get(2)?, package: row.get(3)?,
                manufacturer: row.get(4)?, mpn: row.get(5)?, lcsc_code: row.get(6)?, quantity: row.get(7)?,
                box_id: row.get(8)?, slot: row.get(9)?, note: row.get(10)?, version: row.get(11)?,
            }),
        )
        .optional()?
        .ok_or_else(|| CommandError::NotFound("器件不存在".into()))
}

pub fn list_parts_service(
    db: &Database,
    search: Option<&str>,
) -> Result<Vec<PartView>, CommandError> {
    let mut statement = db.connection().prepare("SELECT id, name, category, package, manufacturer, mpn, lcsc_code, quantity, box_id, slot, note, version FROM parts ORDER BY name COLLATE NOCASE, id")?;
    let rows = statement.query_map([], |row| {
        Ok(PartView {
            id: row.get(0)?,
            name: row.get(1)?,
            category: row.get(2)?,
            package: row.get(3)?,
            manufacturer: row.get(4)?,
            mpn: row.get(5)?,
            lcsc_code: row.get(6)?,
            quantity: row.get(7)?,
            box_id: row.get(8)?,
            slot: row.get(9)?,
            note: row.get(10)?,
            version: row.get(11)?,
        })
    })?;
    let needle = search
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    Ok(rows
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter(|part| {
            needle.as_ref().is_none_or(|needle| {
                [
                    part.name.as_str(),
                    part.category.as_deref().unwrap_or(""),
                    part.mpn.as_deref().unwrap_or(""),
                    part.lcsc_code.as_deref().unwrap_or(""),
                ]
                .iter()
                .any(|value| value.to_ascii_lowercase().contains(needle))
            })
        })
        .collect())
}

pub fn create_part_service(db: &Database, input: PartInput) -> Result<PartView, CommandError> {
    let (name, box_id, slot) = validate_input(db, &input, true)?;
    let id = new_id();
    let transaction = db.transaction()?;
    transaction.execute(
        "INSERT INTO parts (id, name, category, package, manufacturer, mpn, lcsc_code, quantity, box_id, slot, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![id, name, optional_text(&input.category), optional_text(&input.package), optional_text(&input.manufacturer), optional_text(&input.mpn), optional_text(&input.lcsc_code), input.quantity, box_id, slot, optional_text(&input.note)],
    )?;
    if input.quantity > 0 {
        let sequence = next_movement_sequence(&transaction)?;
        transaction.execute(
            "INSERT INTO inventory_movements (id, part_id, movement_type, quantity, reason, before_quantity, after_quantity, movement_sequence) VALUES (?1, ?2, 'in', ?3, ?4, ?5, ?6, ?7)",
            params![new_id(), id, input.quantity, "initial stock", 0_i64, input.quantity, sequence],
        )?;
    }
    transaction.commit()?;
    read_part(db, &id)
}

pub fn update_part_service(
    db: &Database,
    id: &str,
    expected_version: i64,
    input: PartInput,
) -> Result<PartView, CommandError> {
    let (name, box_id, slot) = validate_input(db, &input, false)?;
    let changed = db.connection().execute(
        "UPDATE parts SET name = ?1, category = ?2, package = ?3, manufacturer = ?4, mpn = ?5, lcsc_code = ?6, box_id = ?7, slot = ?8, note = ?9, version = version + 1, updated_at = ?10 WHERE id = ?11 AND version = ?12",
        params![name, optional_text(&input.category), optional_text(&input.package), optional_text(&input.manufacturer), optional_text(&input.mpn), optional_text(&input.lcsc_code), box_id, slot, optional_text(&input.note), utc_now(), id, expected_version],
    )?;
    if changed != 1 {
        return Err(CommandError::Conflict);
    }
    read_part(db, id)
}

pub fn adjust_stock_service(
    db: &Database,
    id: &str,
    delta: i64,
    reason: &str,
) -> Result<PartView, CommandError> {
    let reason = reason.trim();
    if delta == 0 || reason.is_empty() {
        return Err(CommandError::Validation("数量调整和原因不能为空".into()));
    }
    let transaction = db.transaction()?;
    let quantity: i64 = transaction
        .query_row("SELECT quantity FROM parts WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or_else(|| CommandError::NotFound("器件不存在".into()))?;
    let new_quantity = quantity
        .checked_add(delta)
        .ok_or_else(|| CommandError::Validation("库存数量超出范围".into()))?;
    if new_quantity < 0 {
        return Err(CommandError::Validation("库存数量不能为负数".into()));
    }
    let sequence = next_movement_sequence(&transaction)?;
    transaction.execute(
        "UPDATE parts SET quantity = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
        params![new_quantity, utc_now(), id],
    )?;
    transaction.execute("INSERT INTO inventory_movements (id, part_id, movement_type, quantity, reason, before_quantity, after_quantity, movement_sequence) VALUES (?1, ?2, 'adjust', ?3, ?4, ?5, ?6, ?7)", params![new_id(), id, delta, reason, quantity, new_quantity, sequence])?;
    transaction.commit()?;
    read_part(db, id)
}

/// A part is an audited business record. Once it has movements or welding
/// progress, deletion would orphan history, so the command rejects it.
pub fn delete_part_service(db: &Database, id: &str) -> Result<(), CommandError> {
    let quantity: Option<i64> = db
        .connection()
        .query_row("SELECT quantity FROM parts WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()?;
    let Some(quantity) = quantity else {
        return Err(CommandError::NotFound("器件不存在".into()));
    };
    let movement_count: i64 = db.connection().query_row(
        "SELECT COUNT(*) FROM inventory_movements WHERE part_id = ?1",
        [id],
        |row| row.get(0),
    )?;
    let progress_count: i64 = db.connection().query_row(
        "SELECT COUNT(*) FROM welding_progress WHERE part_id = ?1",
        [id],
        |row| row.get(0),
    )?;
    if quantity != 0 || movement_count > 0 || progress_count > 0 {
        return Err(CommandError::Constraint(
            "已有库存流水或焊接记录，不能删除器件".into(),
        ));
    }
    let changed = db
        .connection()
        .execute("DELETE FROM parts WHERE id = ?1", [id])?;
    if changed != 1 {
        return Err(CommandError::NotFound("器件不存在".into()));
    }
    Ok(())
}

#[tauri::command(rename = "list_parts")]
pub fn list_parts(
    state: State<'_, Mutex<Database>>,
    search: Option<String>,
) -> Result<Vec<PartView>, CommandError> {
    let db = state.lock().map_err(lock_error)?;
    list_parts_service(&db, search.as_deref())
}

#[tauri::command(rename = "create_part")]
pub fn create_part(
    state: State<'_, Mutex<Database>>,
    input: PartInput,
) -> Result<PartView, CommandError> {
    let db = state.lock().map_err(lock_error)?;
    create_part_service(&db, input)
}

#[tauri::command(rename = "update_part")]
pub fn update_part(
    state: State<'_, Mutex<Database>>,
    id: String,
    expected_version: i64,
    input: PartInput,
) -> Result<PartView, CommandError> {
    let db = state.lock().map_err(lock_error)?;
    update_part_service(&db, &id, expected_version, input)
}

#[tauri::command(rename = "adjust_stock")]
pub fn adjust_stock(
    state: State<'_, Mutex<Database>>,
    id: String,
    delta: i64,
    reason: String,
) -> Result<PartView, CommandError> {
    let db = state.lock().map_err(lock_error)?;
    adjust_stock_service(&db, &id, delta, &reason)
}

#[tauri::command(rename = "delete_part")]
pub fn delete_part(state: State<'_, Mutex<Database>>, id: String) -> Result<(), CommandError> {
    let db = state.lock().map_err(lock_error)?;
    delete_part_service(&db, &id)
}
