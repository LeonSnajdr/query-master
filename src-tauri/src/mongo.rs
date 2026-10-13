//! The MongoDB side: open clients and two ways to run a database command. Which command a shell
//! statement becomes is decided in the frontend (`src/shell/plan.ts`); here they are sent as they
//! come, so options the server knows work without this app knowing them.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    options::ClientOptions,
    Client,
};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::{
    error::{AppError, Result},
    store,
};

/// Without a timeout in the connection string a wrong address would block for 30 seconds.
const SERVER_SELECTION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Clients(Mutex<HashMap<String, Client>>);

impl Clients {
    fn get(&self, id: &str) -> Result<Client> {
        self.lock()?.get(id).cloned().ok_or_else(|| AppError::key("error.backend.notConnected"))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Client>>> {
        self.0.lock().map_err(AppError::raw)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    /// For example `8.0.4`.
    pub version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPage {
    /// Canonical extended JSON, so every BSON type arrives as what it is.
    pub documents: Vec<Value>,
    /// The cursor had more documents than asked for.
    pub has_more: bool,
}

async fn open(uri: &str) -> Result<(Client, ServerInfo)> {
    let mut options = ClientOptions::parse(uri).await?;
    options.app_name.get_or_insert_with(|| "QueryMaster".to_string());
    options.server_selection_timeout.get_or_insert(SERVER_SELECTION_TIMEOUT);
    let client = Client::with_options(options)?;
    let info = client
        .database("admin")
        .run_command(doc! { "buildInfo": 1 })
        .await?;
    let version = info.get_str("version").unwrap_or("unknown").to_string();
    Ok((client, ServerInfo { version }))
}

fn to_document(command: Value) -> Result<Document> {
    match Bson::try_from(command).map_err(|e| AppError::with_detail("error.backend.extendedJson", e))? {
        Bson::Document(document) => Ok(document),
        _ => Err(AppError::key("error.backend.commandDocument")),
    }
}

fn to_json(document: Document) -> Value {
    Bson::Document(document).into_canonical_extjson()
}

#[tauri::command]
pub async fn test_connection(uri: String) -> Result<ServerInfo> {
    let (client, info) = open(uri.trim()).await?;
    client.shutdown().await;
    Ok(info)
}

#[tauri::command]
pub async fn connect(clients: State<'_, Clients>, id: String) -> Result<ServerInfo> {
    let (client, info) = open(&store::stored_uri(&id)?).await?;
    let previous = clients.lock()?.insert(id, client);
    if let Some(previous) = previous {
        previous.shutdown().await;
    }
    Ok(info)
}

#[tauri::command]
pub async fn disconnect(clients: State<'_, Clients>, id: String) -> Result<()> {
    let client = clients.lock()?.remove(&id);
    if let Some(client) = client {
        client.shutdown().await;
    }
    Ok(())
}

/// Runs a command with a single reply document.
#[tauri::command]
pub async fn run_command(
    clients: State<'_, Clients>,
    id: String,
    database: String,
    command: Value,
) -> Result<Value> {
    let reply = clients
        .get(&id)?
        .database(&database)
        .run_command(to_document(command)?)
        .await?;
    Ok(to_json(reply))
}

/// Runs a command that opens a cursor (`find`, `aggregate`, `listIndexes` …) and reads at most
/// `limit` documents from it. The cursor is closed afterwards.
#[tauri::command]
pub async fn run_cursor_command(
    clients: State<'_, Clients>,
    id: String,
    database: String,
    command: Value,
    limit: usize,
) -> Result<CursorPage> {
    let mut cursor = clients
        .get(&id)?
        .database(&database)
        .run_cursor_command(to_document(command)?)
        .await?;
    let mut documents = Vec::new();
    let mut has_more = false;
    while let Some(document) = cursor.try_next().await? {
        if documents.len() == limit {
            has_more = true;
            break;
        }
        documents.push(to_json(document));
    }
    Ok(CursorPage { documents, has_more })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn commands_keep_key_order_and_types() {
        let command = json!({
            "find": "orders",
            "filter": { "_id": { "$oid": "64b7f0c2a1b2c3d4e5f60718" }, "at": { "$date": { "$numberLong": "0" } } },
            "sort": { "z": 1, "a": -1 }
        });
        let document = to_document(command).unwrap();
        assert_eq!(document.keys().next().map(String::as_str), Some("find"));
        let sort: Vec<_> = document.get_document("sort").unwrap().keys().cloned().collect();
        assert_eq!(sort, ["z", "a"]);
        let filter = document.get_document("filter").unwrap();
        assert!(filter.get_object_id("_id").is_ok());
        assert!(filter.get_datetime("at").is_ok());
    }

    /// Against a real server, reading only: `cargo test -- --ignored`. The server is the one in
    /// `QUERYMASTER_TEST_URI` (with credentials, if it asks for them), else localhost:27017.
    #[tokio::test]
    #[ignore]
    async fn talks_to_a_server() {
        let uri = std::env::var("QUERYMASTER_TEST_URI").unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let (client, info) = open(&uri).await.unwrap();
        assert!(!info.version.is_empty());
        println!("MongoDB {}", info.version);

        let listed = client
            .database("admin")
            .run_command(to_document(json!({ "listDatabases": 1, "nameOnly": true })).unwrap())
            .await;
        let databases = match listed {
            Ok(reply) => reply,
            // Code 13: the server wants a login, and the URI carries none. The handshake is checked.
            Err(error) if error.to_string().contains("Unauthorized") => {
                println!("not authorized: only the handshake was checked");
                return;
            }
            Err(error) => panic!("{error}"),
        };
        assert!(!databases.get_array("databases").unwrap().is_empty());

        // The way a `find` of the shell arrives: with a filter, a sort and a batch size.
        let command = json!({ "find": "startup_log", "filter": {}, "sort": { "_id": -1 }, "batchSize": 2 });
        let mut cursor = client
            .database("local")
            .run_cursor_command(to_document(command).unwrap())
            .await
            .unwrap();
        if let Some(document) = cursor.try_next().await.unwrap() {
            assert!(to_json(document).get("_id").is_some());
        }
        client.shutdown().await;
    }

    #[test]
    fn replies_are_canonical() {
        let json = to_json(doc! { "n": 3_i32, "big": 5_i64 });
        assert_eq!(json, json!({ "n": { "$numberInt": "3" }, "big": { "$numberLong": "5" } }));
    }
}
