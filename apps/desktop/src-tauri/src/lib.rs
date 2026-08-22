pub mod db;

use db::Database;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database = Database::open_app_data_dir(app.path().app_data_dir()?)?;
            app.manage(Mutex::new(database));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PartNest");
}
