use crate::{
    bom::{
        bridge::{validate_selection_message, BomSelectionMessage, BridgeError},
        cache::{
            preview_interactive_bom, CachedBomSession, InteractiveBomRuntime, ResolvedSelection,
        },
        tabular::inspect_tabular_bom as inspect_tabular_bom_file,
        types::{FieldMapping, ImportPreview},
    },
    db::Database,
};
use std::sync::Mutex;
use tauri::State;

#[tauri::command(rename = "inspect_tabular_bom")]
pub fn inspect_tabular_bom(
    source_path: String,
    mapping: Option<FieldMapping>,
) -> Result<ImportPreview, String> {
    inspect_tabular_bom_file(source_path, mapping.as_ref()).map_err(|error| error.to_string())
}

/// Analyze an interactive BOM without caching it or switching the active
/// welding session.
#[tauri::command(rename = "preview_interactive_bom")]
pub fn preview_interactive_bom_command(
    source_path: String,
    companion_csv_path: Option<String>,
) -> Result<ImportPreview, String> {
    let companion_path = companion_csv_path.as_deref().map(std::path::Path::new);
    preview_interactive_bom(std::path::Path::new(&source_path), companion_path)
        .map(ImportPreview::Ready)
        .map_err(|error| error.user_message())
}

#[tauri::command(rename = "cache_interactive_bom")]
pub fn cache_interactive_bom(
    source_path: String,
    display_name: String,
    companion_csv_path: Option<String>,
    database: State<'_, Mutex<Database>>,
    runtime: State<'_, Mutex<InteractiveBomRuntime>>,
) -> Result<CachedBomSession, String> {
    let database = database.lock().map_err(|_| "数据库锁不可用".to_owned())?;
    let runtime = runtime
        .lock()
        .map_err(|_| "BOM 缓存状态锁不可用".to_owned())?;
    let companion_path = companion_csv_path.as_deref().map(std::path::Path::new);
    runtime
        .cache_interactive_bom_with_companion(&database, source_path, display_name, companion_path)
        .map_err(|error| error.user_message())
}

#[tauri::command(rename = "resolve_bom_selection")]
pub fn resolve_bom_selection(
    message: BomSelectionMessage,
    database: State<'_, Mutex<Database>>,
    runtime: State<'_, Mutex<InteractiveBomRuntime>>,
) -> Result<ResolvedSelection, String> {
    // The bridge contract is enforced here rather than trusting the webview
    // pre-validation: an unknown `type`, oversized payload, or duplicate
    // designator never reaches the session table.
    validate_selection_message(&message).map_err(|error| error.user_message())?;
    let database = database.lock().map_err(|_| "数据库锁不可用".to_owned())?;
    let runtime = runtime
        .lock()
        .map_err(|_| "BOM 缓存状态锁不可用".to_owned())?;
    runtime
        .resolve_bom_selection(&database, &message.token, &message.designators)
        .map_err(|error: BridgeError| error.user_message())
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
        .map_err(|error| error.user_message())
}
