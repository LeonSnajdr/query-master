use std::rc::Rc;

use tauri::{ipc::Channel, State};

use super::{engine, ScriptResult};
use crate::error::{Error, Result};
use crate::mongo::Clients;
use crate::runs::Runs;

/// Runs a script on the connection of a tab. `run_id` names the run, so it can be stopped; what the
/// script prints arrives on `on_output` while it runs.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn script_run(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    id: String,
    run_id: String,
    database: String,
    source: String,
    readonly: bool,
    on_output: Channel<String>,
) -> Result<ScriptResult> {
    let client = clients.get(&id)?;
    let stop = runs.start(&run_id);
    // Off the async threads: the script blocks its thread while it waits for the database.
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let output: engine::Output = Rc::new(move |text| {
            // A closed window does not stop the script; its text is still in the result.
            let _ = on_output.send(text);
        });
        engine::run(&client, &database, &source, readonly, &stop, output)
    })
    .await;
    runs.finish(&run_id);
    outcome.map_err(|e| Error::Script(e.to_string()))?
}
