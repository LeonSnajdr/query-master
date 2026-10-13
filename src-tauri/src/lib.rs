mod connection;
mod db;
mod error;
mod files;
mod mongo;

use sqlx::SqlitePool;
use tauri::{Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(mongo::Clients::default())
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
            mongo::test_connection,
            mongo::connect,
            mongo::disconnect,
            mongo::run_command,
            mongo::run_cursor_command,
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
