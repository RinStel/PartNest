use crate::{
    bom::{
        bridge::BridgeError,
        cache::{CachedBomSession, InteractiveBomRuntime, ResolvedSelection},
    },
    db::Database,
};
use std::sync::Mutex;
use tauri::State;

#[tauri::command(rename = "cache_interactive_bom")]
pub fn cache_interactive_bom(
    source_path: String,
    display_name: String,
    database: State<'_, Mutex<Database>>,
    runtime: State<'_, Mutex<InteractiveBomRuntime>>,
) -> Result<CachedBomSession, String> {
    let database = database.lock().map_err(|_| "数据库锁不可用".to_owned())?;
    let runtime = runtime
        .lock()
        .map_err(|_| "BOM 缓存状态锁不可用".to_owned())?;
    runtime
        .cache_interactive_bom(&database, source_path, display_name)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename = "resolve_bom_selection")]
pub fn resolve_bom_selection(
    token: String,
    designators: Vec<String>,
    database: State<'_, Mutex<Database>>,
    runtime: State<'_, Mutex<InteractiveBomRuntime>>,
) -> Result<ResolvedSelection, String> {
    let database = database.lock().map_err(|_| "数据库锁不可用".to_owned())?;
    let runtime = runtime
        .lock()
        .map_err(|_| "BOM 缓存状态锁不可用".to_owned())?;
    runtime
        .resolve_bom_selection(&database, &token, &designators)
        .map_err(|error: BridgeError| error.to_string())
}

#[tauri::command(rename = "restore_active_interactive_bom")]
pub fn restore_active_interactive_bom(
    database: State<'_, Mutex<Database>>,
    runtime: State<'_, Mutex<InteractiveBomRuntime>>,
) -> Result<Option<CachedBomSession>, String> {
    let database = database.lock().map_err(|_| "数据库锁不可用".to_owned())?;
    let runtime = runtime
        .lock()
        .map_err(|_| "BOM 缓存状态锁不可用".to_owned())?;
    runtime
        .restore_active_session(&database)
        .map_err(|error| error.to_string())
}
