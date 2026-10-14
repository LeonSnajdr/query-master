//! The export of the wizard: many collections in one run, each read with its own filter (a
//! `find` filter or a pipeline), written to a file of a folder, into one text for the clipboard,
//! or into a database of the same or another connection. A collection that fails is reported and
//! the run goes on with the next; stopping ends the run after the batch at hand.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    error::ErrorKind,
    Client, Cursor,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::csv_format::{CsvOptions, CsvWriter};
use super::json_format::{JsonWriter, Layout, Notation};
use crate::copy::{create_command, describe, index_specs, NAMESPACE_EXISTS};
use crate::error::{Error, Result};

/// Documents per batch: read, written, or sent with one command.
const BATCH: usize = 1000;
/// The clipboard takes text up to this size; more is better written to a file.
const CLIPBOARD_LIMIT: usize = 50 * 1024 * 1024;
const BOM: &[u8] = b"\xEF\xBB\xBF";

/// One row of the wizard: a collection, what it becomes, and which of its documents go.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportItem {
    pub database: String,
    pub collection: String,
    /// A file name in the folder, or the name of the collection in the target database.
    pub output: String,
    /// Extended JSON: a `find` filter (document) or a pipeline (array); none for all documents.
    #[serde(default)]
    pub filter: Option<Value>,
    /// CSV: the columns, as dotted paths; none for the fields of the first level.
    #[serde(default)]
    pub columns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InsertMode {
    /// A document with the same `_id` is replaced; the others are inserted.
    Overwrite,
    /// Every document is inserted with a new `_id`.
    NewId,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum Destination {
    Directory {
        path: PathBuf,
    },
    Clipboard,
    Database {
        connection_id: String,
        database: String,
        insert_mode: InsertMode,
        /// Creates the collection with the options of the source and copies its indexes.
        copy_indexes: bool,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum FileFormat {
    Json { notation: Notation, layout: Layout },
    Csv { options: CsvOptions },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub connection_id: String,
    pub items: Vec<ExportItem>,
    pub destination: Destination,
    /// What files and the clipboard get; unused for a database.
    pub format: FileFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemState {
    Running,
    Done,
    Failed,
    Stopped,
}

/// How far a row of the wizard got.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemProgress {
    pub item: usize,
    pub done: u64,
    pub state: ItemState,
    /// `{ key, detail }` as every error of the app.
    pub error: Option<Value>,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub documents: u64,
    pub failed: usize,
    pub stopped: bool,
    /// The text for the clipboard, when that is the destination.
    pub clipboard: Option<String>,
}

/// An output must be a plain name: it may not lead out of the chosen folder.
pub(crate) fn check_output(name: &str) -> Result<()> {
    let bad = name.trim().is_empty()
        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || name == "."
        || name == "..";
    if bad {
        Err(Error::OutputName(name.to_owned()))
    } else {
        Ok(())
    }
}

/// The documents an item stands for: all, those of a `find` filter, or those of a pipeline.
async fn read(client: &Client, item: &ExportItem) -> Result<Cursor<Document>> {
    let collection = client
        .database(&item.database)
        .collection::<Document>(&item.collection);
    let filter = match &item.filter {
        None | Some(Value::Null) => Bson::Document(Document::new()),
        Some(value) => {
            Bson::try_from(value.clone()).map_err(|e| Error::ExtendedJson(e.to_string()))?
        }
    };
    Ok(match filter {
        Bson::Document(filter) => collection.find(filter).batch_size(BATCH as u32).await?,
        Bson::Array(stages) => {
            let pipeline = stages
                .into_iter()
                .map(|stage| match stage {
                    Bson::Document(stage) => Ok(stage),
                    _ => Err(Error::CommandDocument),
                })
                .collect::<Result<Vec<_>>>()?;
            let writes = pipeline
                .last()
                .is_some_and(|stage| stage.contains_key("$out") || stage.contains_key("$merge"));
            if writes {
                return Err(Error::WritingPipeline);
            }
            collection
                .aggregate(pipeline)
                .batch_size(BATCH as u32)
                .await?
        }
        _ => return Err(Error::CommandDocument),
    })
}

/// Reads the next batch; stops first when asked to.
async fn next_batch(cursor: &mut Cursor<Document>, stop: &AtomicBool) -> Result<Vec<Document>> {
    if stop.load(Ordering::Relaxed) {
        return Err(Error::TransferStopped);
    }
    let mut batch = Vec::with_capacity(BATCH);
    while batch.len() < BATCH {
        match cursor.try_next().await? {
            Some(document) => batch.push(document),
            None => break,
        }
    }
    Ok(batch)
}

/// Where the documents of a file go: a file on disk or the text for the clipboard.
enum Sink<'a> {
    File(BufWriter<File>),
    Text(&'a mut String),
}

impl Sink<'_> {
    fn write(&mut self, text: &str) -> Result<()> {
        match self {
            Self::File(file) => file.write_all(text.as_bytes())?,
            Self::Text(buffer) => {
                if buffer.len() + text.len() > CLIPBOARD_LIMIT {
                    return Err(Error::ClipboardTooLarge);
                }
                buffer.push_str(text);
            }
        }
        Ok(())
    }
}

async fn write_json(
    cursor: &mut Cursor<Document>,
    sink: &mut Sink<'_>,
    notation: Notation,
    layout: Layout,
    stop: &AtomicBool,
    progress: &mut impl FnMut(u64),
) -> Result<u64> {
    let mut writer = JsonWriter::new(notation, layout);
    sink.write(writer.start())?;
    let mut done = 0;
    loop {
        let batch = next_batch(cursor, stop).await?;
        if batch.is_empty() {
            break;
        }
        for document in &batch {
            let text = writer.document(document);
            sink.write(&text)?;
        }
        done += batch.len() as u64;
        progress(done);
    }
    sink.write(writer.finish())?;
    Ok(done)
}

/// One item into a file of the folder or into the clipboard text.
async fn export_text(
    client: &Client,
    item: &ExportItem,
    target: Option<&PathBuf>,
    clipboard: &mut String,
    format: &FileFormat,
    stop: &AtomicBool,
    progress: &mut impl FnMut(u64),
) -> Result<u64> {
    let mut cursor = read(client, item).await?;
    match (format.clone(), target) {
        (FileFormat::Json { notation, layout }, Some(folder)) => {
            check_output(&item.output)?;
            let mut file = BufWriter::new(File::create(folder.join(&item.output))?);
            //: UTF-8 with a byte order mark.
            file.write_all(BOM)?;
            let mut sink = Sink::File(file);
            let done = write_json(&mut cursor, &mut sink, notation, layout, stop, progress).await?;
            if let Sink::File(mut file) = sink {
                file.flush()?;
            }
            Ok(done)
        }
        (FileFormat::Json { notation, layout }, None) => {
            let mut sink = Sink::Text(clipboard);
            write_json(&mut cursor, &mut sink, notation, layout, stop, progress).await
        }
        (FileFormat::Csv { options }, Some(folder)) => {
            check_output(&item.output)?;
            let file = BufWriter::new(File::create(folder.join(&item.output))?);
            let mut writer = CsvWriter::with_options(file, options, item.columns.clone());
            let done = write_csv(&mut cursor, &mut writer, stop, progress).await?;
            writer.finish()?;
            Ok(done)
        }
        (FileFormat::Csv { options }, None) => {
            let mut writer = CsvWriter::with_options(Vec::new(), options, item.columns.clone());
            let done = write_csv(&mut cursor, &mut writer, stop, progress).await?;
            let bytes = writer.into_inner()?;
            if clipboard.len() + bytes.len() > CLIPBOARD_LIMIT {
                return Err(Error::ClipboardTooLarge);
            }
            clipboard.push_str(&String::from_utf8_lossy(&bytes));
            Ok(done)
        }
    }
}

async fn write_csv<W: Write>(
    cursor: &mut Cursor<Document>,
    writer: &mut CsvWriter<W>,
    stop: &AtomicBool,
    progress: &mut impl FnMut(u64),
) -> Result<u64> {
    let mut done = 0;
    loop {
        let batch = next_batch(cursor, stop).await?;
        if batch.is_empty() {
            break;
        }
        writer.write(&batch)?;
        done += batch.len() as u64;
        progress(done);
    }
    Ok(done)
}

fn is_namespace_exists(error: &mongodb::error::Error) -> bool {
    matches!(*error.kind, ErrorKind::Command(ref command) if command.code == NAMESPACE_EXISTS)
}

/// One item into a collection of the target database.
#[allow(clippy::too_many_arguments)]
async fn export_database(
    source: &Client,
    item: &ExportItem,
    target: &Client,
    database: &str,
    insert_mode: InsertMode,
    copy_indexes: bool,
    stop: &AtomicBool,
    progress: &mut impl FnMut(u64),
) -> Result<u64> {
    let target_database = target.database(database);
    if copy_indexes {
        let info = describe(source, &item.database, &item.collection).await?;
        if let Err(error) = target_database
            .run_command(create_command(&item.output, &info))
            .await
        {
            // There already: the documents go into it as it is.
            if !is_namespace_exists(&error) {
                return Err(error.into());
            }
        }
        if info.get_str("type") == Ok("view") {
            return Ok(0);
        }
    }
    let mut cursor = read(source, item).await?;
    let collection = target_database.collection::<Document>(&item.output);
    let mut done = 0;
    loop {
        let batch = next_batch(&mut cursor, stop).await?;
        if batch.is_empty() {
            break;
        }
        match insert_mode {
            InsertMode::NewId => {
                let fresh: Vec<Document> = batch
                    .iter()
                    .map(|document| {
                        let mut document = document.clone();
                        document.remove("_id");
                        document
                    })
                    .collect();
                collection.insert_many(fresh).await?;
            }
            InsertMode::Overwrite => {
                // Replaced where the _id is there, inserted where not: one command per batch.
                let updates: Vec<Document> = batch
                    .iter()
                    .map(|document| match document.get("_id") {
                        Some(id) => doc! { "q": { "_id": id.clone() }, "u": document.clone(), "upsert": true },
                        None => doc! { "q": { "_id": mongodb::bson::oid::ObjectId::new() }, "u": document.clone(), "upsert": true },
                    })
                    .collect();
                let reply = target_database
                    .run_command(
                        doc! { "update": &item.output, "updates": updates, "ordered": false },
                    )
                    .await?;
                if let Ok(errors) = reply.get_array("writeErrors") {
                    if let Some(Bson::Document(first)) = errors.first() {
                        return Err(Error::Script(
                            first.get_str("errmsg").unwrap_or("write error").to_owned(),
                        ));
                    }
                }
            }
        }
        done += batch.len() as u64;
        progress(done);
    }
    if copy_indexes {
        let indexes: Vec<Document> = source
            .database(&item.database)
            .run_cursor_command(doc! { "listIndexes": &item.collection })
            .await?
            .try_collect()
            .await?;
        let specs = index_specs(indexes);
        if !specs.is_empty() {
            target_database
                .run_command(doc! { "createIndexes": &item.output, "indexes": specs })
                .await?;
        }
    }
    Ok(done)
}

/// Runs the job; `target` is the client of the destination database, when there is one.
pub async fn run(
    source: &Client,
    target: Option<&Client>,
    job: &ExportJob,
    stop: &AtomicBool,
    mut progress: impl FnMut(ItemProgress),
) -> Result<ExportOutcome> {
    if let Destination::Database {
        connection_id,
        database,
        ..
    } = &job.destination
    {
        let same = |item: &ExportItem| {
            connection_id == &job.connection_id
                && database == &item.database
                && item.output == item.collection
        };
        if job.items.iter().any(same) {
            return Err(Error::SameTarget);
        }
    }
    let mut outcome = ExportOutcome::default();
    let mut clipboard = String::new();
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
        let result = match &job.destination {
            Destination::Directory { path } => {
                export_text(
                    source,
                    item,
                    Some(path),
                    &mut clipboard,
                    &job.format,
                    stop,
                    &mut step,
                )
                .await
            }
            Destination::Clipboard => {
                export_text(
                    source,
                    item,
                    None,
                    &mut clipboard,
                    &job.format,
                    stop,
                    &mut step,
                )
                .await
            }
            Destination::Database {
                database,
                insert_mode,
                copy_indexes,
                ..
            } => match target {
                Some(target) => {
                    export_database(
                        source,
                        item,
                        target,
                        database,
                        *insert_mode,
                        *copy_indexes,
                        stop,
                        &mut step,
                    )
                    .await
                }
                None => Err(Error::NotConnected),
            },
        };
        match result {
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
                outcome.failed += 1;
                progress(report(
                    ItemState::Failed,
                    last,
                    serde_json::to_value(&error).ok(),
                ));
            }
        }
    }
    if matches!(job.destination, Destination::Clipboard) {
        outcome.clipboard = Some(clipboard);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_job_the_wizard_sends() {
        let job: ExportJob = serde_json::from_value(serde_json::json!({
            "connectionId": "a",
            "items": [{ "database": "shop", "collection": "orders", "output": "orders", "filter": null }],
            "destination": { "kind": "database", "connectionId": "b", "database": "backup", "insertMode": "newId", "copyIndexes": true },
            "format": { "kind": "json", "notation": "shell", "layout": "lines" }
        }))
        .unwrap();
        assert!(matches!(
            job.destination,
            Destination::Database { ref connection_id, insert_mode: InsertMode::NewId, copy_indexes: true, .. } if connection_id == "b"
        ));
    }

    #[test]
    fn an_output_is_a_plain_name() {
        assert!(check_output("shop.orders.json").is_ok());
        for bad in ["", "..", "a/b", "a\\b", "c:x", "a?"] {
            assert!(check_output(bad).is_err(), "{bad}");
        }
    }

    fn item(collection: &str, output: &str, filter: Option<Value>) -> ExportItem {
        ExportItem {
            database: "querymaster_test".into(),
            collection: collection.into(),
            output: output.into(),
            filter,
            columns: None,
        }
    }

    /// Against a real server, writing into `querymaster_test` only: `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn exports_to_a_folder_the_clipboard_and_a_database() {
        let uri = std::env::var("QUERYMASTER_TEST_URI")
            .unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let client = Client::with_uri_str(&uri).await.unwrap();
        let database = client.database("querymaster_test");
        let source = database.collection::<Document>("job_source");
        let copy = database.collection::<Document>("job_copy");
        source.drop().await.unwrap();
        copy.drop().await.unwrap();
        let documents: Vec<Document> = (0..1500).map(|n| doc! { "_id": n, "n": n }).collect();
        source.insert_many(documents).await.unwrap();
        database
            .run_command(doc! { "createIndexes": "job_source", "indexes": [{ "key": { "n": -1 }, "name": "n_-1" }] })
            .await
            .unwrap();
        let json = FileFormat::Json {
            notation: Notation::Shell,
            layout: Layout::Lines,
        };

        // A folder: one file, with BOM, one document per block; a broken row does not stop the rest.
        let folder = std::env::temp_dir().join(format!("querymaster-job-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let job = ExportJob {
            connection_id: "a".into(),
            items: vec![
                item("job_source", "../escape.json", None),
                item("job_source", "querymaster_test.job_source.json", None),
            ],
            destination: Destination::Directory {
                path: folder.clone(),
            },
            format: json.clone(),
        };
        let mut states = Vec::new();
        let outcome = run(&client, None, &job, &AtomicBool::new(false), |progress| {
            if progress.state != ItemState::Running {
                states.push(progress.state);
            }
        })
        .await
        .unwrap();
        assert_eq!(states, [ItemState::Failed, ItemState::Done]);
        assert_eq!((outcome.documents, outcome.failed), (1500, 1));
        let bytes = std::fs::read(folder.join("querymaster_test.job_source.json")).unwrap();
        assert!(bytes.starts_with(BOM));
        let text = String::from_utf8(bytes[3..].to_vec()).unwrap();
        assert_eq!(text.matches("}\r\n{").count(), 1499);
        std::fs::remove_dir_all(&folder).unwrap();

        // The clipboard, with a filter and with a pipeline; a pipeline that writes is refused.
        let clipboard = |filter| ExportJob {
            connection_id: "a".into(),
            items: vec![item("job_source", "x", Some(filter))],
            destination: Destination::Clipboard,
            format: FileFormat::Json {
                notation: Notation::Relaxed,
                layout: Layout::Array,
            },
        };
        let outcome = run(
            &client,
            None,
            &clipboard(serde_json::json!({ "n": { "$lt": 3 } })),
            &AtomicBool::new(false),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(outcome.documents, 3);
        let parsed: Vec<Value> =
            serde_json::from_str(outcome.clipboard.as_deref().unwrap()).unwrap();
        assert_eq!(parsed.len(), 3);
        let outcome = run(
            &client,
            None,
            &clipboard(serde_json::json!([{ "$match": { "n": { "$gte": 1490 } } }])),
            &AtomicBool::new(false),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(outcome.documents, 10);
        let outcome = run(
            &client,
            None,
            &clipboard(serde_json::json!([{ "$out": "elsewhere" }])),
            &AtomicBool::new(false),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(outcome.failed, 1);

        // A database: overwriting twice leaves 1500, a new _id each time doubles them.
        let to_database = |insert_mode| ExportJob {
            connection_id: "a".into(),
            items: vec![item("job_source", "job_copy", None)],
            destination: Destination::Database {
                connection_id: "b".into(),
                database: "querymaster_test".into(),
                insert_mode,
                copy_indexes: true,
            },
            format: json.clone(),
        };
        for _ in 0..2 {
            run(
                &client,
                Some(&client),
                &to_database(InsertMode::Overwrite),
                &AtomicBool::new(false),
                |_| {},
            )
            .await
            .unwrap();
        }
        assert_eq!(copy.count_documents(doc! {}).await.unwrap(), 1500);
        let indexes: Vec<String> = copy.list_index_names().await.unwrap();
        assert!(indexes.contains(&"n_-1".to_owned()));
        run(
            &client,
            Some(&client),
            &to_database(InsertMode::NewId),
            &AtomicBool::new(false),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(copy.count_documents(doc! {}).await.unwrap(), 3000);

        // Into itself is refused before anything is written.
        let mut itself = to_database(InsertMode::Overwrite);
        itself.connection_id = "b".into();
        itself.items = vec![item("job_source", "job_source", None)];
        assert!(matches!(
            run(
                &client,
                Some(&client),
                &itself,
                &AtomicBool::new(false),
                |_| {}
            )
            .await,
            Err(Error::SameTarget)
        ));

        // Stopped: the run ends and says so.
        let outcome = run(
            &client,
            Some(&client),
            &to_database(InsertMode::NewId),
            &AtomicBool::new(true),
            |_| {},
        )
        .await
        .unwrap();
        assert!(outcome.stopped);

        source.drop().await.unwrap();
        copy.drop().await.unwrap();
        client.shutdown().await;
    }
}
