use super::CommandError;
use crate::{
    bom::cache::InteractiveBomRuntime,
    db::{welding_repository, Database},
};
use std::sync::Mutex;
use tauri::State;

pub use welding_repository::{ConfirmTakeInput, TakeResult, WeldingProgress};

pub fn confirm_take_service(
    db: &Database,
    input: ConfirmTakeInput,
) -> Result<TakeResult, CommandError> {
    welding_repository::confirm_take(db, input)
}

pub fn reverse_take_service(db: &Database, movement_id: &str) -> Result<TakeResult, CommandError> {
    welding_repository::reverse_take(db, movement_id)
}

pub fn get_welding_progress_service(
    db: &Database,
    session_id: &str,
) -> Result<Vec<WeldingProgress>, CommandError> {
    welding_repository::get_welding_progress(db, session_id)
}

fn validate_selection(
    db: &Database,
    runtime: &InteractiveBomRuntime,
    input: &ConfirmTakeInput,
) -> Result<(), CommandError> {
    runtime
        .validate_welding_selection(
            db,
            &input.session_id,
            &input.component_key,
            &input.side,
            &input.designators,
        )
        .map_err(|error| CommandError::Validation(error.to_string()))
}

#[tauri::command(rename = "confirm_take")]
pub fn confirm_take(
    input: ConfirmTakeInput,
    database: State<'_, Mutex<Database>>,
    runtime: State<'_, Mutex<InteractiveBomRuntime>>,
) -> Result<TakeResult, CommandError> {
    let database = database.lock().map_err(super::lock_error)?;
    let runtime = runtime.lock().map_err(super::lock_error)?;
    validate_selection(&database, &runtime, &input)?;
    confirm_take_service(&database, input)
}

#[tauri::command(rename = "reverse_take")]
pub fn reverse_take(
    movement_id: String,
    database: State<'_, Mutex<Database>>,
) -> Result<TakeResult, CommandError> {
    let database = database.lock().map_err(super::lock_error)?;
    reverse_take_service(&database, &movement_id)
}

#[tauri::command(rename = "get_welding_progress")]
pub fn get_welding_progress(
    session_id: String,
    database: State<'_, Mutex<Database>>,
) -> Result<Vec<WeldingProgress>, CommandError> {
    let database = database.lock().map_err(super::lock_error)?;
    get_welding_progress_service(&database, &session_id)
}
