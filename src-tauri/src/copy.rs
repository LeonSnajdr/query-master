//! Copies a collection, within a connection or from one to another: its options (capped,
//! validator, time series, view definition …), its documents in batches and its indexes. The
//! documents pass through this side as raw BSON, unchanged.

use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document, RawDocumentBuf},
    error::ErrorKind,
    Client,
};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};

use crate::{
    error::{Error, Result},
    mongo::Clients,
    runs::Runs,
};

/// Documents written with one `insert`.
const BATCH: usize = 1000;
/// The server's answer when the collection to create is there already.
pub(crate) const NAMESPACE_EXISTS: i32 = 48;

/// A collection on a connection.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub connection_id: String,
    pub database: String,
    pub collection: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyProgress {
    pub copied: u64,
    /// As the server estimates it before the copy starts.
    pub total: u64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub documents: u64,
    pub indexes: usize,
    /// The source was a view: it is created again, with no documents of its own.
    pub view: bool,
}

/// What `listCollections` says about one collection.
pub(crate) async fn describe(
    client: &Client,
    database: &str,
    collection: &str,
) -> Result<Document> {
    let mut cursor = client
        .database(database)
        .run_cursor_command(doc! { "listCollections": 1, "filter": { "name": collection } })
        .await?;
    match cursor.try_next().await? {
        Some(info) => Ok(info),
        None => Err(Error::CollectionMissing(format!("{database}.{collection}"))),
    }
}

/// The `create` command for a collection like the one described.
pub(crate) fn create_command(name: &str, info: &Document) -> Document {
    let mut command = doc! { "create": name };
    if let Ok(options) = info.get_document("options") {
        for (key, value) in options {
            let mut value = value.clone();
            // The version of the clustered index is the server's to choose.
            if let (true, Bson::Document(index)) = (key == "clusteredIndex", &mut value) {
                index.remove("v");
            }
            command.insert(key, value);
        }
    }
    command
}

/// The index specifications to create on the copy: all but the one on `_id`, without what the
/// server sets itself.
pub(crate) fn index_specs(indexes: Vec<Document>) -> Vec<Document> {
    indexes
        .into_iter()
        .filter(|index| index.get_str("name") != Ok("_id_"))
        .map(|mut index| {
            index.remove("v");
            index.remove("ns");
            index
        })
        .collect()
}

pub(crate) async fn copy(
    source: (&Client, &Place),
    target: (&Client, &Place),
    replace: bool,
    stop: &AtomicBool,
    mut progress: impl FnMut(CopyProgress),
) -> Result<CopyResult> {
    let (source_client, from) = source;
    let (target_client, to) = target;
    let info = describe(source_client, &from.database, &from.collection).await?;
    let view = info.get_str("type") == Ok("view");
    let target_database = target_client.database(&to.database);

    if replace {
        target_database
            .collection::<Document>(&to.collection)
            .drop()
            .await?;
    }
    if let Err(error) = target_database
        .run_command(create_command(&to.collection, &info))
        .await
    {
        // Without `replace` the documents go into the collection that is there.
        if !matches!(*error.kind, ErrorKind::Command(ref command) if command.code == NAMESPACE_EXISTS)
        {
            return Err(error.into());
        }
    }
    if view {
        return Ok(CopyResult {
            documents: 0,
            indexes: 0,
            view,
        });
    }

    let source_collection = source_client
        .database(&from.database)
        .collection::<RawDocumentBuf>(&from.collection);
    let target_collection = target_database.collection::<RawDocumentBuf>(&to.collection);
    let total = source_collection.estimated_document_count().await?;
    let mut copied = 0;
    progress(CopyProgress { copied, total });
    let mut cursor = source_collection
        .find(doc! {})
        .batch_size(BATCH as u32)
        .await?;
    let mut batch = Vec::with_capacity(BATCH);
    loop {
        let next = cursor.try_next().await?;
        let end = next.is_none();
        if let Some(document) = next {
            batch.push(document);
        }
        if batch.len() == BATCH || (end && !batch.is_empty()) {
            if stop.load(Ordering::Relaxed) {
                return Err(Error::CopyStopped);
            }
            target_collection.insert_many(&batch).await?;
            copied += batch.len() as u64;
            batch.clear();
            progress(CopyProgress {
                copied,
                total: total.max(copied),
            });
        }
        if end {
            break;
        }
    }

    let indexes: Vec<Document> = source_client
        .database(&from.database)
        .run_cursor_command(doc! { "listIndexes": &from.collection })
        .await?
        .try_collect()
        .await?;
    let specs = index_specs(indexes);
    let created = specs.len();
    if !specs.is_empty() {
        target_database
            .run_command(doc! { "createIndexes": &to.collection, "indexes": specs })
            .await?;
    }
    Ok(CopyResult {
        documents: copied,
        indexes: created,
        view,
    })
}

/// Copies `source` to `target`; with `replace` a collection of that name is dropped first.
/// Progress arrives on `on_progress` after every batch; `run_id` names the run for `run_stop`.
#[tauri::command]
pub async fn copy_collection(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    run_id: String,
    source: Place,
    target: Place,
    replace: bool,
    on_progress: Channel<CopyProgress>,
) -> Result<CopyResult> {
    let source_client = clients.get(&source.connection_id)?;
    let target_client = clients.get(&target.connection_id)?;
    let stop = runs.start(&run_id);
    let outcome = copy(
        (&source_client, &source),
        (&target_client, &target),
        replace,
        &stop,
        // A window that went away no longer needs to hear about progress.
        |progress| drop(on_progress.send(progress)),
    )
    .await;
    runs.finish(&run_id);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_copy_with_the_options_of_the_source() {
        let info = doc! {
            "name": "events",
            "type": "collection",
            "options": {
                "capped": true,
                "size": 4096,
                "validator": { "n": { "$type": "int" } },
                "clusteredIndex": { "v": 2, "key": { "_id": 1 }, "unique": true },
            },
            "info": { "readOnly": false },
        };
        assert_eq!(
            create_command("copy", &info),
            doc! {
                "create": "copy",
                "capped": true,
                "size": 4096,
                "validator": { "n": { "$type": "int" } },
                "clusteredIndex": { "key": { "_id": 1 }, "unique": true },
            }
        );
    }

    #[test]
    fn copies_every_index_but_the_one_on_id() {
        let specs = index_specs(vec![
            doc! { "v": 2, "key": { "_id": 1 }, "name": "_id_" },
            doc! { "v": 2, "key": { "a": 1 }, "name": "a_1", "unique": true, "ns": "x.y" },
        ]);
        assert_eq!(
            specs,
            vec![doc! { "key": { "a": 1 }, "name": "a_1", "unique": true }]
        );
    }

    /// Against a real server, writing into `querymaster_test` only: `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn copies_documents_and_indexes() {
        let uri = std::env::var("QUERYMASTER_TEST_URI")
            .unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let client = Client::with_uri_str(&uri).await.unwrap();
        let database = client.database("querymaster_test");
        let source = database.collection::<Document>("copy_source");
        source.drop().await.unwrap();
        let documents: Vec<Document> = (0..2500).map(|n| doc! { "_id": n, "n": n }).collect();
        source.insert_many(documents).await.unwrap();
        database
            .run_command(doc! { "createIndexes": "copy_source", "indexes": [{ "key": { "n": -1 }, "name": "n_-1" }] })
            .await
            .unwrap();

        let place = |collection: &str| Place {
            connection_id: String::new(),
            database: "querymaster_test".into(),
            collection: collection.into(),
        };
        let mut seen = Vec::new();
        let result = copy(
            (&client, &place("copy_source")),
            (&client, &place("copy_target")),
            true,
            &AtomicBool::new(false),
            |progress| seen.push(progress.copied),
        )
        .await
        .unwrap();
        assert_eq!(
            result,
            CopyResult {
                documents: 2500,
                indexes: 1,
                view: false
            }
        );
        assert_eq!(seen, [0, 1000, 2000, 2500]);
        let target = database.collection::<Document>("copy_target");
        assert_eq!(target.count_documents(doc! {}).await.unwrap(), 2500);

        // Stopped before the first batch is written, nothing but the empty collection is there.
        let error = copy(
            (&client, &place("copy_source")),
            (&client, &place("copy_target")),
            true,
            &AtomicBool::new(true),
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(matches!(error, Error::CopyStopped));
        assert_eq!(target.count_documents(doc! {}).await.unwrap(), 0);

        source.drop().await.unwrap();
        target.drop().await.unwrap();
        // Shut down only after every cursor is dropped: it waits for open cursors.
        client.shutdown().await;
    }
}
