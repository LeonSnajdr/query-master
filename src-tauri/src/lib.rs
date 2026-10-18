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
mod recent;
mod runs;
mod saved_query;
mod script;
mod session;
mod setting;
mod ssh;
mod transfer;
mod tree;

use sqlx::SqlitePool;
use tauri::{Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            connection::commands::connection_ssh,
            connection::commands::connection_set_group,
            connection::commands::connection_save,
            connection::commands::connection_delete,
            connection::commands::connection_set_environment,
            setting::commands::setting_get,
            setting::commands::setting_save,
            keybinding::commands::keybinding_list,
            keybinding::commands::keybinding_save,
            keybinding::commands::keybinding_clear,
            recent::commands::recent_file_list,
            recent::commands::recent_file_add,
            recent::commands::recent_file_remove,
            preset::commands::preset_get,
            preset::commands::preset_save,
            history::commands::history_list,
            history::commands::history_add,
            history::commands::history_clear,
            saved_query::commands::saved_query_list,
            saved_query::commands::saved_query_save,
            saved_query::commands::saved_query_remove,
            saved_query::commands::saved_query_used,
            session::commands::session_load,
            session::commands::session_save,
            tree::commands::tree_node_list,
            tree::commands::tree_node_save,
            tree::commands::tree_node_rename,
            tree::commands::tree_node_remove,
            tree::commands::tree_folder_list,
            tree::commands::tree_folder_add,
            tree::commands::tree_folder_rename,
            tree::commands::tree_folder_delete,
            mongo::test_connection,
            mongo::discover_members,
            mongo::connect,
            mongo::connect_uri,
            mongo::disconnect,
            mongo::run_command,
            mongo::run_cursor_command,
            script::commands::script_run,
            runs::run_stop,
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
