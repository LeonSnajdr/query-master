//! The import of the wizard: many files in one run, each into a collection of its own. JSON in
//! any notation the export writes, CSV with the settings and columns of the wizard's pages. A file
//! that fails is reported and the run goes on with the next; stopping ends the run after the batch
//! at hand.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use mongodb::{bson::Document, Client};
use serde::{Deserialize, Serialize};

use super::csv_import::{CsvReadOptions, CsvSource, ImportColumn};
use super::job::{ItemProgress, ItemState};
use super::shell_reader::{ReadPosition, ShellReader};
use crate::error::{Error, Result};

/// Documents per `insert`.
const BATCH: usize = 1000;

/// One row of the wizard: a file and the collection it goes into.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub path: PathBuf,
    pub database: String,
    pub collection: String,
    /// CSV: the columns of the schema page; none for the names of the first row, typed as they come.
    #[serde(default)]
    pub columns: Option<Vec<ImportColumn>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum ImportFormat {
    Json,
    Csv { options: CsvReadOptions },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub connection_id: String,
    pub items: Vec<ImportItem>,
    pub format: ImportFormat,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub documents: u64,
    pub failed: usize,
    pub stopped: bool,
}

/// The documents of a file, batch by batch.
enum Source {
    Json {
        text: String,
        position: ReadPosition,
    },
    Csv(Box<CsvSource>),
}

impl Source {
    fn open(item: &ImportItem, format: &ImportFormat) -> Result<Self> {
        Ok(match format {
            ImportFormat::Json => Self::Json {
                text: std::fs::read_to_string(&item.path)?,
                position: ReadPosition::default(),
            },
            ImportFormat::Csv { options } => Self::Csv(Box::new(CsvSource::open(
                &item.path,
                options.clone(),
                item.columns.clone(),
            )?)),
        })
    }

    fn next_batch(&mut self) -> Result<Vec<Document>> {
        match self {
            Self::Json { text, position } => {
                let mut reader = ShellReader::resume(text, *position);
                let mut batch = Vec::new();
                while batch.len() < BATCH {
                    match reader.next_document()? {
                        Some(document) => batch.push(document),
                        None => break,
                    }
                }
                *position = reader.position();
                Ok(batch)
            }
            Self::Csv(source) => source.next_batch(BATCH),
        }
    }
}

async fn import_item(
    client: &Client,
    item: &ImportItem,
    format: &ImportFormat,
    stop: &AtomicBool,
    progress: &mut impl FnMut(u64),
) -> Result<u64> {
    let mut source = Source::open(item, format)?;
    let target = client
        .database(&item.database)
        .collection::<Document>(&item.collection);
    let mut done = 0;
    loop {
        if stop.load(Ordering::Relaxed) {
            return Err(Error::TransferStopped);
        }
        let batch = source.next_batch()?;
        if batch.is_empty() {
            break;
        }
        target.insert_many(&batch).await?;
        done += batch.len() as u64;
        progress(done);
    }
    Ok(done)
}

pub async fn run(
    client: &Client,
    job: &ImportJob,
    stop: &AtomicBool,
    mut progress: impl FnMut(ItemProgress),
) -> Result<ImportOutcome> {
    let mut outcome = ImportOutcome::default();
    for (index, item) in job.items.iter().enumerate() {
        let report = |state, done, error| ItemProgress {
            item: index,
            done,
            state,
            error,
        };
        progress(report(ItemState::Running, 0, None));
        let mut last = 0;
        let mut step = |done: u64| {
            last = done;
            progress(ItemProgress {
                item: index,
                done,
                state: ItemState::Running,
                error: None,
            });
        };
        match import_item(client, item, &job.format, stop, &mut step).await {
            Ok(done) => {
                outcome.documents += done;
                progress(report(ItemState::Done, done, None));
            }
            Err(Error::TransferStopped) => {
                outcome.stopped = true;
                progress(report(ItemState::Stopped, last, None));
                break;
            }
            Err(error) => {
                // What went in before the failure stays in the collection and counts.
                outcome.documents += last;
                outcome.failed += 1;
                progress(report(
                    ItemState::Failed,
                    last,
                    serde_json::to_value(&error).ok(),
                ));
            }
        }
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn reads_the_job_the_wizard_sends() {
        let job: ImportJob = serde_json::from_value(serde_json::json!({
            "connectionId": "a",
            "items": [{
                "path": "C:\\in\\shop.orders.csv", "database": "shop", "collection": "orders",
                "columns": [{ "name": "n", "type": "int", "include": true }]
            }],
            "format": { "kind": "csv", "options": {
                "delimiter": ";", "quote": "\"", "skipRows": 0, "empty": "omit", "header": true, "unescape": false
            } }
        }))
        .unwrap();
        assert!(
            matches!(job.format, ImportFormat::Csv { ref options } if options.delimiter == ';')
        );
        assert_eq!(job.items[0].columns.as_ref().unwrap()[0].name, "n");
        let json: ImportFormat =
            serde_json::from_value(serde_json::json!({ "kind": "json" })).unwrap();
        assert!(matches!(json, ImportFormat::Json));
    }

    /// Against a real server, writing into `querymaster_test` only: `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn imports_files_of_every_kind_and_goes_on_after_a_broken_one() {
        let uri = std::env::var("QUERYMASTER_TEST_URI")
            .unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let client = Client::with_uri_str(&uri).await.unwrap();
        let database = client.database("querymaster_test");
        let target = database.collection::<Document>("import_job_target");
        target.drop().await.unwrap();

        let folder = std::env::temp_dir();
        let file = |name: &str, text: &str| {
            let path = folder.join(format!("querymaster-{}-{name}", std::process::id()));
            std::fs::write(&path, text).unwrap();
            path
        };
        let shell: String = (0..2500)
            .map(|n| format!("{{\r\n\t\"_id\": NumberLong({n}),\r\n\t\"n\": {n}\r\n}}\r\n"))
            .collect();
        let item = |path: &PathBuf| ImportItem {
            path: path.clone(),
            database: "querymaster_test".into(),
            collection: "import_job_target".into(),
            columns: None,
        };
        let good = file("good.json", &format!("\u{feff}{shell}"));
        let broken = file(
            "broken.json",
            "{ \"_id\": 9000 }\r\n{ \"_id\": ObjectId(\"no\") }",
        );
        let missing = folder.join("querymaster-missing.json");
        let job = ImportJob {
            connection_id: "a".into(),
            items: vec![item(&broken), item(&missing), item(&good)],
            format: ImportFormat::Json,
        };
        let mut seen = Vec::new();
        let outcome = run(&client, &job, &AtomicBool::new(false), |progress| {
            seen.push((progress.item, progress.done, progress.state));
        })
        .await
        .unwrap();
        assert_eq!(
            outcome,
            ImportOutcome {
                documents: 2500,
                failed: 2,
                stopped: false
            }
        );
        assert!(seen.contains(&(2, 1000, ItemState::Running)));
        assert!(seen.contains(&(2, 2500, ItemState::Done)));
        assert_eq!(target.count_documents(doc! {}).await.unwrap(), 2500);
        assert_eq!(
            target.find_one(doc! { "_id": 2499_i64 }).await.unwrap(),
            Some(doc! { "_id": 2499_i64, "n": 2499 })
        );

        // Stopped before the first batch.
        let outcome = run(&client, &job, &AtomicBool::new(true), |_| {})
            .await
            .unwrap();
        assert!(outcome.stopped);

        for path in [good, broken] {
            std::fs::remove_file(path).unwrap();
        }
        target.drop().await.unwrap();
        client.shutdown().await;
    }
}
