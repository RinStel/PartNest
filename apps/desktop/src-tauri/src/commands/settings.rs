use super::{lock_error, CommandError};
use crate::{backup, db::Database};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

fn app_data_directory(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_data_dir()
        .map_err(|error| CommandError::Database(format!("无法定位应用数据目录: {error}")))
}

#[tauri::command(rename = "create_backup")]
pub fn create_backup(
    app: AppHandle,
    state: State<'_, Mutex<Database>>,
) -> Result<String, CommandError> {
    let app_data_directory = app_data_directory(&app)?;
    let database = state.lock().map_err(lock_error)?;
    let path = backup::create_backup(&database, backup::backup_dir(app_data_directory))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command(rename = "restore_backup")]
pub fn restore_backup(
    app: AppHandle,
    backup_path: String,
    state: State<'_, Mutex<Database>>,
) -> Result<(), CommandError> {
    if backup_path.trim().is_empty() {
        return Err(CommandError::Validation("请选择备份文件".into()));
    }
    let app_data_directory = app_data_directory(&app)?;
    let selected = PathBuf::from(backup_path);
    let live_path = app_data_directory.join("partnest.db");
    if selected == live_path {
        return Err(CommandError::Validation("不能从当前数据库文件恢复".into()));
    }
    let mut database = state.lock().map_err(lock_error)?;
    backup::restore_database_file(&mut database, selected)?;
    Ok(())
}
