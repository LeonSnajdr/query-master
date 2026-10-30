use std::path::PathBuf;

use tauri::{ipc::Channel, State};

use super::csv_import::{CsvPreview, CsvReadOptions};
use super::import_job::{ImportJob, ImportOutcome};
use super::job::{Destination, ExportJob, ExportOutcome, ItemProgress};
use crate::error::Result;
use crate::mongo::Clients;
use crate::runs::Runs;

/// The export of the wizard: many collections to a folder, the clipboard or a database (also of
/// another connection). Progress of each row arrives on `on_progress`; `run_id` names the run for
/// `run_stop`.
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
        // A window that went away no longer needs to hear about progress.
        drop(on_progress.send(progress));
    })
    .await;
    runs.finish(&run_id);
    outcome
}

/// The import of the wizard: many files, each into its collection. Progress of each row arrives
/// on `on_progress`; `run_id` names the run.
#[tauri::command]
pub async fn import_run(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    run_id: String,
    job: ImportJob,
    on_progress: Channel<ItemProgress>,
) -> Result<ImportOutcome> {
    let client = clients.get(&job.connection_id)?;
    let stop = runs.start(&run_id);
    let outcome = super::import_job::run(&client, &job, &stop, |progress| {
        drop(on_progress.send(progress));
    })
    .await;
    runs.finish(&run_id);
    outcome
}

/// The columns of a CSV file with guessed types, and its first rows, for the schema page.
#[tauri::command]
pub async fn import_preview(path: PathBuf, options: CsvReadOptions) -> Result<CsvPreview> {
    super::csv_import::preview(&path, &options)
}
