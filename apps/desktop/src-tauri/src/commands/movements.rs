use super::{lock_error, CommandError};
use crate::db::Database;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MovementView {
    pub id: String,
    pub part_id: Option<String>,
    pub part_name: Option<String>,
    pub component: Option<String>,
    pub component_key: Option<String>,
    pub movement_type: String,
    pub delta: i64,
    pub quantity: i64,
    pub before_quantity: Option<i64>,
    pub after_quantity: Option<i64>,
    pub reason: String,
    pub bom_display_name: Option<String>,
    pub session_id: Option<String>,
    pub created_at: String,
    pub reverses_movement_id: Option<String>,
    pub can_reverse: bool,
}

struct RawMovement {
    id: String,
    part_id: Option<String>,
    part_name: Option<String>,
    movement_type: String,
    quantity: i64,
    reason: String,
    bom_display_name: Option<String>,
    session_id: Option<String>,
    component_key: Option<String>,
    created_at: String,
    reverses_movement_id: Option<String>,
    has_reversal: bool,
}

pub fn list_movements_service(db: &Database) -> Result<Vec<MovementView>, CommandError> {
    let mut stock = db
        .connection()
        .prepare("SELECT id, quantity FROM parts")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?;

    let mut statement = db.connection().prepare(
        "SELECT m.id, m.part_id, p.name, m.movement_type, m.quantity, m.reason,
                bf.display_name, m.session_id, m.component_key, m.created_at,
                m.reverses_movement_id,
                EXISTS(SELECT 1 FROM inventory_movements reversal
                       WHERE reversal.reverses_movement_id = m.id)
           FROM inventory_movements m
           LEFT JOIN parts p ON p.id = m.part_id
           LEFT JOIN welding_sessions ws ON ws.id = m.session_id
           LEFT JOIN bom_files bf ON bf.id = ws.bom_file_id
          ORDER BY m.created_at DESC, m.id DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(RawMovement {
            id: row.get(0)?,
            part_id: row.get(1)?,
            part_name: row.get(2)?,
            movement_type: row.get(3)?,
            quantity: row.get(4)?,
            reason: row.get(5)?,
            bom_display_name: row.get(6)?,
            session_id: row.get(7)?,
            component_key: row.get(8)?,
            created_at: row.get(9)?,
            reverses_movement_id: row.get(10)?,
            has_reversal: row.get(11)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        let movement = row?;
        let (before_quantity, after_quantity) = if let Some(part_id) = &movement.part_id {
            let after = stock
                .get(part_id)
                .copied()
                .ok_or_else(|| CommandError::Database("流水关联的器件不存在".into()))?;
            let before = after
                .checked_sub(movement.quantity)
                .ok_or_else(|| CommandError::Database("流水库存数量超出范围".into()))?;
            stock.insert(part_id.clone(), before);
            (Some(before), Some(after))
        } else {
            (None, None)
        };
        let can_reverse = movement.movement_type == "consume"
            && movement.quantity < 0
            && movement.reverses_movement_id.is_none()
            && !movement.has_reversal;
        result.push(MovementView {
            id: movement.id,
            part_id: movement.part_id,
            component: movement
                .part_name
                .clone()
                .or_else(|| movement.component_key.clone()),
            part_name: movement.part_name,
            component_key: movement.component_key,
            movement_type: movement.movement_type,
            delta: movement.quantity,
            quantity: movement.quantity,
            before_quantity,
            after_quantity,
            reason: movement.reason,
            bom_display_name: movement.bom_display_name,
            session_id: movement.session_id,
            created_at: movement.created_at,
            reverses_movement_id: movement.reverses_movement_id,
            can_reverse,
        });
    }
    Ok(result)
}

#[tauri::command(rename = "list_movements")]
pub fn list_movements(
    state: State<'_, Mutex<Database>>,
) -> Result<Vec<MovementView>, CommandError> {
    let database = state.lock().map_err(lock_error)?;
    list_movements_service(&database)
}
