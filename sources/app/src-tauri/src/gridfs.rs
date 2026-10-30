//! Files in GridFS buckets: uploaded from and downloaded to the disk in pieces, with progress and
//! a way to stop. Listing, renaming and deleting are plain commands on `<bucket>.files` and run
//! from the frontend like any other.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::io::{AsyncReadExt as _, AsyncWriteExt as _};
use mongodb::{bson::Bson, options::GridFsBucketOptions, Client};
use serde::Serialize;
use serde_json::Value;
use tauri::{ipc::Channel, State};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

use crate::error::{Error, Result};
use crate::mongo::{to_json, Clients};
use crate::runs::Runs;

/// Bytes read or written in one step.
const PIECE: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProgress {
    pub done: u64,
    pub total: u64,
}

fn bucket(client: &Client, database: &str, name: &str) -> mongodb::gridfs::GridFsBucket {
    client.database(database).gridfs_bucket(
        GridFsBucketOptions::builder()
            .bucket_name(name.to_owned())
            .build(),
    )
}

/// Stores the file at `path` in the bucket under its file name; gives the new file's `_id`.
pub async fn upload(
    client: &Client,
    database: &str,
    bucket_name: &str,
    path: &Path,
    stop: &AtomicBool,
    mut progress: impl FnMut(FileProgress),
) -> Result<Bson> {
    let mut file = tokio::fs::File::open(path).await?;
    let total = file.metadata().await?.len();
    let filename = path.file_name().map_or_else(
        || "file".to_owned(),
        |name| name.to_string_lossy().into_owned(),
    );
    let mut stream = bucket(client, database, bucket_name)
        .open_upload_stream(filename)
        .await?;
    let mut buffer = vec![0; PIECE];
    let mut done = 0;
    loop {
        if stop.load(Ordering::Relaxed) {
            // Takes the chunks written so far away again.
            stream.abort().await?;
            return Err(Error::TransferStopped);
        }
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        stream.write_all(&buffer[..read]).await?;
        done += read as u64;
        progress(FileProgress { done, total });
    }
    stream.close().await?;
    Ok(stream.id().clone())
}

/// Writes the file with the `_id` from the bucket to `path`; a stopped download leaves no file.
#[allow(clippy::too_many_arguments)]
pub async fn download(
    client: &Client,
    database: &str,
    bucket_name: &str,
    id: Bson,
    path: &Path,
    total: u64,
    stop: &AtomicBool,
    mut progress: impl FnMut(FileProgress),
) -> Result<()> {
    let mut stream = bucket(client, database, bucket_name)
        .open_download_stream(id)
        .await?;
    let mut file = tokio::fs::File::create(path).await?;
    let mut buffer = vec![0; PIECE];
    let mut done = 0;
    loop {
        if stop.load(Ordering::Relaxed) {
            drop(file);
            tokio::fs::remove_file(path).await?;
            return Err(Error::TransferStopped);
        }
        let read = stream.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).await?;
        done += read as u64;
        progress(FileProgress { done, total });
    }
    file.flush().await?;
    Ok(())
}

/// Uploads the file at `path` into the bucket; gives the new file's `_id` as Extended JSON.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn gridfs_upload(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    run_id: String,
    id: String,
    database: String,
    bucket: String,
    path: PathBuf,
    on_progress: Channel<FileProgress>,
) -> Result<Value> {
    let client = clients.get(&id)?;
    let stop = runs.start(&run_id);
    let outcome = upload(&client, &database, &bucket, &path, &stop, |progress| {
        drop(on_progress.send(progress));
    })
    .await;
    runs.finish(&run_id);
    let file_id = outcome?;
    Ok(to_json(mongodb::bson::doc! { "id": file_id })["id"].clone())
}

/// Downloads the file with `file_id` (Extended JSON) from the bucket to `path`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn gridfs_download(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    run_id: String,
    id: String,
    database: String,
    bucket: String,
    file_id: Value,
    length: u64,
    path: PathBuf,
    on_progress: Channel<FileProgress>,
) -> Result<()> {
    let client = clients.get(&id)?;
    let file_id = Bson::try_from(file_id).map_err(|e| Error::ExtendedJson(e.to_string()))?;
    let stop = runs.start(&run_id);
    let outcome = download(
        &client,
        &database,
        &bucket,
        file_id,
        &path,
        length,
        &stop,
        |progress| drop(on_progress.send(progress)),
    )
    .await;
    runs.finish(&run_id);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, Document};

    /// Against a real server, writing into `querymaster_test` only: `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn uploads_and_downloads_the_same_bytes() {
        let uri = std::env::var("QUERYMASTER_TEST_URI")
            .unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let client = Client::with_uri_str(&uri).await.unwrap();
        let directory = std::env::temp_dir();
        let source = directory.join(format!("querymaster-{}-upload.bin", std::process::id()));
        let target = directory.join(format!("querymaster-{}-download.bin", std::process::id()));
        // A bit more than two pieces, with every byte value.
        let bytes: Vec<u8> = (0..(2 * PIECE + 1234)).map(|n| (n % 251) as u8).collect();
        std::fs::write(&source, &bytes).unwrap();

        let mut seen = Vec::new();
        let id = upload(
            &client,
            "querymaster_test",
            "testfiles",
            &source,
            &AtomicBool::new(false),
            |progress| seen.push(progress.done),
        )
        .await
        .unwrap();
        assert_eq!(seen.last(), Some(&(bytes.len() as u64)));
        let files = client
            .database("querymaster_test")
            .collection::<Document>("testfiles.files");
        let info = files.find_one(doc! { "_id": &id }).await.unwrap().unwrap();
        assert_eq!(
            info.get_str("filename").unwrap(),
            source.file_name().unwrap().to_str().unwrap()
        );

        download(
            &client,
            "querymaster_test",
            "testfiles",
            id.clone(),
            &target,
            bytes.len() as u64,
            &AtomicBool::new(false),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), bytes);

        // Stopped right away: the upload takes back what it wrote, the download leaves no file.
        let stopped = upload(
            &client,
            "querymaster_test",
            "testfiles",
            &source,
            &AtomicBool::new(true),
            |_| {},
        )
        .await;
        assert!(matches!(stopped, Err(Error::TransferStopped)));
        assert_eq!(files.count_documents(doc! {}).await.unwrap(), 1);
        std::fs::remove_file(&target).unwrap();
        let stopped = download(
            &client,
            "querymaster_test",
            "testfiles",
            id,
            &target,
            0,
            &AtomicBool::new(true),
            |_| {},
        )
        .await;
        assert!(matches!(stopped, Err(Error::TransferStopped)));
        assert!(!target.exists());

        let database = client.database("querymaster_test");
        for name in ["testfiles.files", "testfiles.chunks"] {
            database.collection::<Document>(name).drop().await.unwrap();
        }
        std::fs::remove_file(source).unwrap();
        client.shutdown().await;
    }
}
