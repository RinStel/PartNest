use super::{lock_error, normalize_slot, validate_name, CommandError};
use crate::db::{new_id, utc_now, Database};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoxInput {
    pub name: String,
    pub rows: i64,
    pub cols: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoxView {
    pub id: String,
    pub name: String,
    pub rows: i64,
    pub cols: i64,
    pub occupied_slots: Vec<String>,
}

fn validate_dimensions(rows: i64, cols: i64) -> Result<(), CommandError> {
    if rows <= 0 || rows > 26 || cols <= 0 || cols > 100 {
        return Err(CommandError::Validation(
            "收纳盒行列必须为正数，行数不能超过 26，列数不能超过 100".into(),
        ));
    }
    Ok(())
}

fn read_box(db: &Database, id: &str) -> Result<BoxView, CommandError> {
    let Some((name, rows, cols)) = db
        .connection()
        .query_row(
            "SELECT name, rows, cols FROM boxes WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
    else {
        return Err(CommandError::NotFound("收纳盒不存在".into()));
    };
    let occupied_slots = db
        .connection()
        .prepare("SELECT slot FROM parts WHERE box_id = ?1 ORDER BY slot")?
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(BoxView {
        id: id.into(),
        name,
        rows,
        cols,
        occupied_slots,
    })
}

pub fn list_boxes_service(db: &Database) -> Result<Vec<BoxView>, CommandError> {
    let ids = db
        .connection()
        .prepare("SELECT id FROM boxes ORDER BY name COLLATE NOCASE, id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.into_iter().map(|id| read_box(db, &id)).collect()
}

pub fn create_box_service(db: &Database, input: BoxInput) -> Result<BoxView, CommandError> {
    validate_dimensions(input.rows, input.cols)?;
    let name = validate_name(&input.name, "收纳盒")?;
    let id = new_id();
    db.connection().execute(
        "INSERT INTO boxes (id, name, rows, cols) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, input.rows, input.cols],
    )?;
    read_box(db, &id)
}

pub fn resize_box_service(
    db: &Database,
    id: &str,
    rows: i64,
    cols: i64,
) -> Result<BoxView, CommandError> {
    validate_dimensions(rows, cols)?;
    let occupied = db
        .connection()
        .prepare("SELECT slot FROM parts WHERE box_id = ?1 ORDER BY slot")?
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for slot in occupied {
        if normalize_slot(&slot, rows, cols).is_err() {
            return Err(CommandError::Validation(format!(
                "目标规格包含不了已占用盒位 {slot}"
            )));
        }
    }
    let changed = db.connection().execute(
        "UPDATE boxes SET rows = ?1, cols = ?2, updated_at = ?3 WHERE id = ?4",
        params![rows, cols, utc_now(), id],
    )?;
    if changed != 1 {
        return Err(CommandError::NotFound("收纳盒不存在".into()));
    }
    read_box(db, id)
}

#[tauri::command(rename = "list_boxes")]
pub fn list_boxes(state: State<'_, Mutex<Database>>) -> Result<Vec<BoxView>, CommandError> {
    let db = state.lock().map_err(lock_error)?;
    list_boxes_service(&db)
}

#[tauri::command(rename = "create_box")]
pub fn create_box(
    state: State<'_, Mutex<Database>>,
    input: BoxInput,
) -> Result<BoxView, CommandError> {
    let db = state.lock().map_err(lock_error)?;
    create_box_service(&db, input)
}

#[tauri::command(rename = "resize_box")]
pub fn resize_box(
    state: State<'_, Mutex<Database>>,
    id: String,
    rows: i64,
    cols: i64,
) -> Result<BoxView, CommandError> {
    let db = state.lock().map_err(lock_error)?;
    resize_box_service(&db, &id, rows, cols)
}
