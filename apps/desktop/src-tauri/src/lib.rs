pub mod bom;
pub mod commands;
pub mod db;

use bom::cache::InteractiveBomRuntime;
use db::Database;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let database = Database::open_app_data_dir(&app_data_dir)?;
            app.manage(Mutex::new(database));
            app.manage(Mutex::new(InteractiveBomRuntime::new(
                app_data_dir.join("interactive-bom-cache"),
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bom::inspect_tabular_bom,
            commands::bom::cache_interactive_bom,
            commands::bom::resolve_bom_selection,
            commands::bom::restore_active_interactive_bom,
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
