//! Documents to and from files: the result of a query streamed from its cursor into a file, and
//! a file read into a collection in batches. Neither passes through the web view, so their size is
//! limited by the disk, not by the window.

pub mod commands;
mod csv_format;

use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::TryStreamExt;
use mongodb::{
    bson::{Bson, Document},
    Client,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};
use crate::mongo::to_json;

/// Documents per batch: written to the file, or sent with one `insert`.
const BATCH: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    /// One array of documents, in canonical extended JSON (every BSON type is kept).
    Json,
    /// One document per line, canonical extended JSON.
    JsonLines,
    /// Fields of the first level as columns; nested values as JSON text.
    Csv,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: u64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub documents: u64,
    /// CSV: fields that appeared only after the columns were fixed and are missing in the file.
    pub skipped_fields: Vec<String>,
}

fn stop_requested(stop: &AtomicBool) -> Result<()> {
    if stop.load(Ordering::Relaxed) {
        Err(Error::TransferStopped)
    } else {
        Ok(())
    }
}

/// Runs a cursor command and writes every document it gives into the file at `path`.
pub async fn export(
    client: &Client,
    database: &str,
    command: Document,
    path: &Path,
    format: Format,
    stop: &AtomicBool,
    mut progress: impl FnMut(Progress),
) -> Result<TransferResult> {
    let mut cursor = client
        .database(database)
        .run_cursor_command(command)
        .await?;
    let mut writer = Writer::create(path, format)?;
    let mut batch = Vec::with_capacity(BATCH);
    let mut done = 0;
    loop {
        let next = cursor.try_next().await?;
        let end = next.is_none();
        if let Some(document) = next {
            batch.push(document);
        }
        if batch.len() == BATCH || (end && !batch.is_empty()) {
            stop_requested(stop)?;
            writer.write(&batch)?;
            done += batch.len() as u64;
            batch.clear();
            progress(Progress { done });
        }
        if end {
            break;
        }
    }
    let skipped_fields = writer.finish()?;
    Ok(TransferResult {
        documents: done,
        skipped_fields,
    })
}

/// Writes documents in one of the formats, batch after batch.
enum Writer {
    Json { file: BufWriter<File>, first: bool },
    JsonLines(BufWriter<File>),
    // Boxed: the CSV writer carries a large buffer of its own.
    Csv(Box<csv_format::CsvWriter>),
}

impl Writer {
    fn create(path: &Path, format: Format) -> Result<Self> {
        let file = BufWriter::new(File::create(path)?);
        Ok(match format {
            Format::Json => Self::Json { file, first: true },
            Format::JsonLines => Self::JsonLines(file),
            Format::Csv => Self::Csv(Box::new(csv_format::CsvWriter::new(file))),
        })
    }

    fn write(&mut self, documents: &[Document]) -> Result<()> {
        match self {
            Self::Json { file, first } => {
                for document in documents {
                    file.write_all(if *first { b"[\n  " } else { b",\n  " })?;
                    *first = false;
                    serde_json::to_writer(&mut *file, &to_json(document.clone()))
                        .map_err(std::io::Error::from)?;
                }
            }
            Self::JsonLines(file) => {
                for document in documents {
                    serde_json::to_writer(&mut *file, &to_json(document.clone()))
                        .map_err(std::io::Error::from)?;
                    file.write_all(b"\n")?;
                }
            }
            Self::Csv(writer) => writer.write(documents)?,
        }
        Ok(())
    }

    fn finish(self) -> Result<Vec<String>> {
        match self {
            Self::Json { mut file, first } => {
                file.write_all(if first { b"[]\n" } else { b"\n]\n" })?;
                file.flush()?;
                Ok(Vec::new())
            }
            Self::JsonLines(mut file) => {
                file.flush()?;
                Ok(Vec::new())
            }
            Self::Csv(writer) => writer.finish(),
        }
    }
}

/// The documents of a JSON file: an array, one document, or one document per line. Extended JSON
/// (canonical or relaxed) gives the BSON types back.
pub fn read_json(path: &Path) -> Result<Vec<Document>> {
    let text = std::fs::read_to_string(path)?;
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Array(items)) => items.into_iter().map(document_of).collect(),
        Ok(value @ Value::Object(_)) => Ok(vec![document_of(value)?]),
        Ok(_) => Err(Error::ImportShape),
        // Not one JSON value: one per line.
        Err(_) => BufReader::new(text.as_bytes())
            .lines()
            .filter(|line| line.as_ref().map_or(true, |line| !line.trim().is_empty()))
            .map(|line| {
                let value =
                    serde_json::from_str(&line?).map_err(|e| Error::ExtendedJson(e.to_string()))?;
                document_of(value)
            })
            .collect(),
    }
}

fn document_of(value: Value) -> Result<Document> {
    match Bson::try_from(value).map_err(|e| Error::ExtendedJson(e.to_string()))? {
        Bson::Document(document) => Ok(document),
        _ => Err(Error::ImportShape),
    }
}

/// Reads the file and inserts its documents into the collection, in batches.
pub async fn import(
    client: &Client,
    database: &str,
    collection: &str,
    path: &Path,
    format: Format,
    stop: &AtomicBool,
    mut progress: impl FnMut(Progress),
) -> Result<TransferResult> {
    let documents = match format {
        Format::Json | Format::JsonLines => read_json(path)?,
        Format::Csv => csv_format::read(path)?,
    };
    let target = client.database(database).collection::<Document>(collection);
    let mut done = 0;
    for batch in documents.chunks(BATCH) {
        stop_requested(stop)?;
        target.insert_many(batch).await?;
        done += batch.len() as u64;
        progress(Progress { done });
    }
    Ok(TransferResult {
        documents: done,
        skipped_fields: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    fn temporary(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("querymaster-{}-{name}", std::process::id()))
    }

    #[test]
    fn reads_an_array_a_document_and_lines() {
        let path = temporary("read.json");
        std::fs::write(
            &path,
            r#"[{"_id": {"$oid": "64b7f0c2a1b2c3d4e5f60718"}, "n": {"$numberLong": "5"}}, {"a": 1}]"#,
        )
        .unwrap();
        let documents = read_json(&path).unwrap();
        assert!(documents[0].get_object_id("_id").is_ok());
        assert_eq!(documents[0].get_i64("n"), Ok(5));

        std::fs::write(&path, "{\"a\": 1}\n\n{\"a\": 2}\n").unwrap();
        assert_eq!(
            read_json(&path).unwrap(),
            [doc! { "a": 1 }, doc! { "a": 2 }]
        );

        std::fs::write(&path, "[1, 2]").unwrap();
        assert!(matches!(read_json(&path), Err(Error::ImportShape)));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn writes_json_that_reads_back_the_same() {
        let documents = vec![
            doc! { "_id": 1, "at": mongodb::bson::DateTime::from_millis(0), "big": 9_007_199_254_740_993_i64 },
            doc! { "_id": 2, "nested": { "list": [1, "two"] } },
        ];
        for format in [Format::Json, Format::JsonLines] {
            let path = temporary(&format!("{format:?}.json"));
            let mut writer = Writer::create(&path, format).unwrap();
            writer.write(&documents[..1]).unwrap();
            writer.write(&documents[1..]).unwrap();
            writer.finish().unwrap();
            assert_eq!(read_json(&path).unwrap(), documents);
            std::fs::remove_file(path).unwrap();
        }
        let path = temporary("empty.json");
        Writer::create(&path, Format::Json)
            .unwrap()
            .finish()
            .unwrap();
        assert!(read_json(&path).unwrap().is_empty());
        std::fs::remove_file(path).unwrap();
    }

    /// Against a real server, writing into `querymaster_test` only: `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn exports_and_imports_through_files() {
        let uri = std::env::var("QUERYMASTER_TEST_URI")
            .unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let client = Client::with_uri_str(&uri).await.unwrap();
        let database = client.database("querymaster_test");
        let source = database.collection::<Document>("transfer_source");
        let target = database.collection::<Document>("transfer_target");
        source.drop().await.unwrap();
        target.drop().await.unwrap();
        let documents: Vec<Document> = (0..2500).map(|n| doc! { "_id": n, "n": n }).collect();
        source.insert_many(documents).await.unwrap();

        for format in [Format::Json, Format::JsonLines, Format::Csv] {
            let path = temporary(&format!("export-{format:?}"));
            let mut seen = Vec::new();
            let exported = export(
                &client,
                "querymaster_test",
                doc! { "find": "transfer_source", "sort": { "_id": 1 } },
                &path,
                format,
                &AtomicBool::new(false),
                |progress| seen.push(progress.done),
            )
            .await
            .unwrap();
            assert_eq!(exported.documents, 2500);
            assert_eq!(seen, [1000, 2000, 2500]);

            target.drop().await.unwrap();
            let imported = import(
                &client,
                "querymaster_test",
                "transfer_target",
                &path,
                format,
                &AtomicBool::new(false),
                |_| {},
            )
            .await
            .unwrap();
            assert_eq!(imported.documents, 2500);
            assert_eq!(
                target
                    .find_one(doc! { "_id": 2499 })
                    .await
                    .unwrap()
                    .unwrap(),
                doc! { "_id": 2499, "n": 2499 }
            );
            std::fs::remove_file(path).unwrap();
        }

        // Stopped before the first batch: the file holds nothing that counts.
        let path = temporary("stopped.json");
        let error = export(
            &client,
            "querymaster_test",
            doc! { "find": "transfer_source" },
            &path,
            Format::Json,
            &AtomicBool::new(true),
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(matches!(error, Error::TransferStopped));
        std::fs::remove_file(path).unwrap();

        source.drop().await.unwrap();
        target.drop().await.unwrap();
        // Shut down only after every cursor is dropped: it waits for open cursors.
        client.shutdown().await;
    }
}
