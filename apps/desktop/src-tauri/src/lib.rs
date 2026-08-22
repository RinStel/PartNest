pub mod bom;
pub mod commands;
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
        .invoke_handler(tauri::generate_handler![
            commands::boxes::list_boxes,
            commands::boxes::create_box,
            commands::boxes::resize_box,
            commands::parts::list_parts,
            commands::parts::create_part,
            commands::parts::update_part,
            commands::parts::adjust_stock,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PartNest");
}
