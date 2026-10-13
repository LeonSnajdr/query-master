mod error;
mod files;
mod mongo;
mod store;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(mongo::Clients::default())
        .invoke_handler(tauri::generate_handler![
            store::list_connections,
            store::connection_uri,
            store::save_connection,
            store::delete_connection,
            mongo::test_connection,
            mongo::connect,
            mongo::disconnect,
            mongo::run_command,
            mongo::run_cursor_command,
            files::read_text_file,
            files::write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running QueryMaster");
}
