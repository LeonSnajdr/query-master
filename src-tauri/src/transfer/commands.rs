use std::path::PathBuf;

use serde_json::Value;
use tauri::{ipc::Channel, State};

use super::job::{Destination, ExportJob, ExportOutcome, ItemProgress};
use super::{Format, Progress, TransferResult};
use crate::error::Result;
use crate::mongo::{to_document, Clients};
use crate::runs::Runs;

/// Writes every document the cursor command gives into the file at `path`. Progress arrives on
/// `on_progress` after every batch; `run_id` names the run for `run_stop`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_documents(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    run_id: String,
    id: String,
    database: String,
    command: Value,
    path: PathBuf,
    format: Format,
    on_progress: Channel<Progress>,
) -> Result<TransferResult> {
    let client = clients.get(&id)?;
    let command = to_document(command)?;
    let stop = runs.start(&run_id);
    let outcome = super::export(
        &client,
        &database,
        command,
        &path,
        format,
        &stop,
        |progress| {
            // A window that went away no longer needs to hear about progress.
            drop(on_progress.send(progress));
        },
    )
    .await;
    runs.finish(&run_id);
    outcome
}

/// The export of the wizard: many collections to a folder, the clipboard or a database (also of
/// another connection). Progress of each row arrives on `on_progress`; `run_id` names the run.
#[tauri::command]
pub async fn export_run(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    run_id: String,
    job: ExportJob,
    on_progress: Channel<ItemProgress>,
) -> Result<ExportOutcome> {
    let source = clients.get(&job.connection_id)?;
    let target = match &job.destination {
        Destination::Database { connection_id, .. } => Some(clients.get(connection_id)?),
        _ => None,
    };
    let stop = runs.start(&run_id);
    let outcome = super::job::run(&source, target.as_ref(), &job, &stop, |progress| {
        drop(on_progress.send(progress));
    })
    .await;
    runs.finish(&run_id);
    outcome
}

/// Inserts the documents of the file at `path` into the collection, in batches.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn import_documents(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    run_id: String,
    id: String,
    database: String,
    collection: String,
    path: PathBuf,
    format: Format,
    on_progress: Channel<Progress>,
) -> Result<TransferResult> {
    let client = clients.get(&id)?;
    let stop = runs.start(&run_id);
    let outcome = super::import(
        &client,
        &database,
        &collection,
        &path,
        format,
        &stop,
        |progress| {
            drop(on_progress.send(progress));
        },
    )
    .await;
    runs.finish(&run_id);
    outcome
}
