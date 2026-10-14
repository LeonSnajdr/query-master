mod connection;
mod copy;
mod db;
mod error;
mod files;
mod gridfs;
mod history;
mod keybinding;
mod mongo;
mod preset;
mod runs;
mod script;
mod setting;
mod transfer;
mod tree;

use sqlx::SqlitePool;
use tauri::{Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(mongo::Clients::default())
        .manage(runs::Runs::default())
        .setup(|app| {
            // Before the window asks for anything: commands take the pool as state.
            let pool = tauri::async_runtime::block_on(db::open(app.handle()))?;
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connection::commands::connection_list,
            connection::commands::connection_uri,
            connection::commands::connection_save,
            connection::commands::connection_delete,
            setting::commands::setting_get,
            setting::commands::setting_save,
            keybinding::commands::keybinding_list,
            keybinding::commands::keybinding_save,
            keybinding::commands::keybinding_clear,
            preset::commands::preset_get,
            preset::commands::preset_save,
            history::commands::history_list,
            history::commands::history_add,
            history::commands::history_clear,
            tree::commands::tree_node_list,
            tree::commands::tree_node_save,
            tree::commands::tree_node_rename,
            tree::commands::tree_node_remove,
            tree::commands::tree_folder_list,
            tree::commands::tree_folder_add,
            tree::commands::tree_folder_rename,
            tree::commands::tree_folder_delete,
            mongo::test_connection,
            mongo::connect,
            mongo::connect_uri,
            mongo::disconnect,
            mongo::run_command,
            mongo::run_cursor_command,
            script::commands::script_run,
            runs::run_stop,
            copy::copy_collection,
            transfer::commands::export_run,
            transfer::commands::import_run,
            transfer::commands::import_preview,
            gridfs::gridfs_upload,
            gridfs::gridfs_download,
            files::read_text_file,
            files::write_text_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building QueryMaster")
        .run(|app, event| {
            // Lets SQLite fold its write-ahead log back into the file.
            if let RunEvent::Exit = event {
                if let Some(pool) = app.try_state::<SqlitePool>() {
                    tauri::async_runtime::block_on(pool.close());
                }
            }
        });
}
