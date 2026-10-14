use tauri::State;

use super::{engine, ScriptResult};
use crate::error::{Error, Result};
use crate::mongo::Clients;
use crate::runs::Runs;

/// Runs a script on the connection of a tab. `run_id` names the run, so it can be stopped.
#[tauri::command]
pub async fn script_run(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    id: String,
    run_id: String,
    database: String,
    source: String,
    readonly: bool,
) -> Result<ScriptResult> {
    let client = clients.get(&id)?;
    let stop = runs.start(&run_id);
    // Off the async threads: the script blocks its thread while it waits for the database.
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        engine::run(&client, &database, &source, readonly, &stop)
    })
    .await;
    runs.finish(&run_id);
    outcome.map_err(|e| Error::Script(e.to_string()))?
}
