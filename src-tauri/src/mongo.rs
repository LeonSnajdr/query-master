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
    connection,
    error::{Error, Result},
};

/// Without a timeout in the connection string a wrong address would block for 30 seconds.
const SERVER_SELECTION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Clients(Mutex<HashMap<String, Client>>);

impl Clients {
    pub(crate) fn get(&self, id: &str) -> Result<Client> {
        self.lock().get(id).cloned().ok_or(Error::NotConnected)
    }

    // The map stays usable after a panic elsewhere: an entry is inserted or removed whole.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Client>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
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
    options
        .app_name
        .get_or_insert_with(|| "QueryMaster".to_string());
    options
        .server_selection_timeout
        .get_or_insert(SERVER_SELECTION_TIMEOUT);
    let client = Client::with_options(options)?;
    let info = client
        .database("admin")
        .run_command(doc! { "buildInfo": 1 })
        .await?;
    let version = info.get_str("version").unwrap_or("unknown").to_string();
    Ok((client, ServerInfo { version }))
}

pub(crate) fn to_document(command: Value) -> Result<Document> {
    match Bson::try_from(command).map_err(|e| Error::ExtendedJson(e.to_string()))? {
        Bson::Document(document) => Ok(document),
        _ => Err(Error::CommandDocument),
    }
}

pub(crate) fn to_json(document: Document) -> Value {
    Bson::Document(document).into_canonical_extjson()
}

#[tauri::command]
pub async fn test_connection(uri: String) -> Result<ServerInfo> {
    let (client, info) = open(uri.trim()).await?;
    client.shutdown().await;
    Ok(info)
}

#[tauri::command]
pub async fn connect(
    clients: State<'_, Clients>,
    pool: State<'_, sqlx::SqlitePool>,
    id: uuid::Uuid,
) -> Result<ServerInfo> {
    let (client, info) = open(&connection::uri(id)?).await?;
    connection::mark_used(&pool, id).await?;
    let id = id.to_string();
    let previous = clients.lock().insert(id, client);
    if let Some(previous) = previous {
        // Immediate: without it the call would wait for queries still running on the old client.
        previous.shutdown().immediate(true).await;
    }
    Ok(info)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UriConnection {
    pub version: String,
    /// The connection string without credentials and options, to show.
    pub address: String,
}

/// Connects with a connection string that is not saved ("Connect from URI"). The session lives
/// under `id`, which the frontend chooses, until `disconnect`; nothing is written anywhere.
#[tauri::command]
pub async fn connect_uri(
    clients: State<'_, Clients>,
    id: String,
    uri: String,
) -> Result<UriConnection> {
    let uri = uri.trim();
    if !(uri.starts_with("mongodb://") || uri.starts_with("mongodb+srv://")) {
        return Err(Error::UriScheme);
    }
    let (client, info) = open(uri).await?;
    let previous = clients.lock().insert(id, client);
    if let Some(previous) = previous {
        previous.shutdown().immediate(true).await;
    }
    Ok(UriConnection {
        version: info.version,
        address: connection::address_of(uri),
    })
}

#[tauri::command]
pub async fn disconnect(clients: State<'_, Clients>, id: String) -> Result<()> {
    let client = clients.lock().remove(&id);
    if let Some(client) = client {
        // Immediate: disconnecting must not wait for a query that is still running.
        client.shutdown().immediate(true).await;
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
    Ok(CursorPage {
        documents,
        has_more,
    })
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
        let sort: Vec<_> = document
            .get_document("sort")
            .unwrap()
            .keys()
            .cloned()
            .collect();
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
        let uri = std::env::var("QUERYMASTER_TEST_URI")
            .unwrap_or_else(|_| "mongodb://localhost:27017".into());
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
        let command =
            json!({ "find": "startup_log", "filter": {}, "sort": { "_id": -1 }, "batchSize": 2 });
        let mut cursor = client
            .database("local")
            .run_cursor_command(to_document(command).unwrap())
            .await
            .unwrap();
        if let Some(document) = cursor.try_next().await.unwrap() {
            assert!(to_json(document).get("_id").is_some());
        }
        // `shutdown` waits for every cursor to be gone: an open one would make it wait forever.
        drop(cursor);
        client.shutdown().await;
    }

    /// Writes, as the frontend sends them: into a collection of its own in `querymaster_test`,
    /// which is dropped again. Needs `QUERYMASTER_TEST_URI` with the right to write there.
    #[tokio::test]
    #[ignore]
    async fn writes_and_reads_back_every_type() {
        let Ok(uri) = std::env::var("QUERYMASTER_TEST_URI") else {
            println!("QUERYMASTER_TEST_URI is not set: skipped");
            return;
        };
        let (client, _) = open(&uri).await.unwrap();
        let database = client.database("querymaster_test");
        let collection = format!("roundtrip_{}", std::process::id());
        let run = |command: Value| {
            let database = database.clone();
            async move {
                to_json(
                    database
                        .run_command(to_document(command).unwrap())
                        .await
                        .unwrap(),
                )
            }
        };

        let id = json!({ "$oid": "64b7f0c2a1b2c3d4e5f60718" });
        let document = json!({
            "_id": id,
            "text": "open",
            "int": 5,
            "long": { "$numberLong": "9007199254740993" },
            "double": { "$numberDouble": "2.5" },
            "decimal": { "$numberDecimal": "9.99" },
            "flag": true,
            "nothing": null,
            "at": { "$date": { "$numberLong": "1714521600000" } },
            "uuid": { "$binary": { "base64": "ABEiM0RVZneImaq7zN3u/w==", "subType": "04" } },
            "pattern": { "$regularExpression": { "pattern": "^a", "options": "i" } },
            "stamp": { "$timestamp": { "t": 7, "i": 1 } },
            "nested": { "list": [1, { "deep": "x" }] }
        });

        let inserted = run(json!({ "insert": collection, "documents": [document] })).await;
        assert_eq!(inserted["n"], json!({ "$numberInt": "1" }));

        // What comes back is canonical: a plain 5 was stored as Int32.
        let find = json!({ "find": collection, "filter": { "_id": id }, "batchSize": 2 });
        let mut cursor = database
            .run_cursor_command(to_document(find.clone()).unwrap())
            .await
            .unwrap();
        let read = to_json(cursor.try_next().await.unwrap().unwrap());
        drop(cursor);
        assert_eq!(read["int"], json!({ "$numberInt": "5" }));
        assert_eq!(read["nested"]["list"][0], json!({ "$numberInt": "1" }));
        for key in [
            "_id", "text", "long", "double", "decimal", "flag", "nothing", "at", "uuid", "pattern",
            "stamp",
        ] {
            assert_eq!(read[key], document[key], "{key}");
        }

        // Editing a value in place, replacing the document, removing a field.
        let set = json!({ "update": collection, "updates": [{ "q": { "_id": id }, "u": { "$set": { "nested.list.1.deep": "y" } }, "multi": false }] });
        assert_eq!(run(set).await["nModified"], json!({ "$numberInt": "1" }));
        let replace = json!({ "update": collection, "updates": [{ "q": { "_id": id }, "u": { "_id": id, "text": "paid", "extra": 1 }, "multi": false }] });
        assert_eq!(
            run(replace).await["nModified"],
            json!({ "$numberInt": "1" })
        );
        let unset = json!({ "update": collection, "updates": [{ "q": { "_id": id }, "u": { "$unset": { "extra": "" } }, "multi": false }] });
        assert_eq!(run(unset).await["nModified"], json!({ "$numberInt": "1" }));
        let mut cursor = database
            .run_cursor_command(to_document(find).unwrap())
            .await
            .unwrap();
        let replaced = to_json(cursor.try_next().await.unwrap().unwrap());
        drop(cursor);
        assert_eq!(replaced, json!({ "_id": id, "text": "paid" }));

        // A second insert of the same _id is refused inside a reply that is otherwise fine.
        let duplicate = run(json!({ "insert": collection, "documents": [{ "_id": id }] })).await;
        assert!(duplicate["writeErrors"][0]["errmsg"]
            .as_str()
            .unwrap()
            .contains("E11000"));

        // The structure commands of the tree.
        let index = json!({ "createIndexes": collection, "indexes": [{ "key": { "text": 1 }, "name": "text_1" }] });
        assert_eq!(run(index).await["ok"], json!({ "$numberDouble": "1.0" }));
        let renamed = format!("{collection}_renamed");
        let rename = json!({ "renameCollection": format!("querymaster_test.{collection}"), "to": format!("querymaster_test.{renamed}") });
        client
            .database("admin")
            .run_command(to_document(rename).unwrap())
            .await
            .unwrap();
        let removed = run(json!({ "delete": renamed, "deletes": [{ "q": { "_id": { "$in": [id] } }, "limit": 0 }] })).await;
        assert_eq!(removed["n"], json!({ "$numberInt": "1" }));
        run(json!({ "drop": renamed })).await;
        client.shutdown().await;
    }

    #[test]
    fn replies_are_canonical() {
        let json = to_json(doc! { "n": 3_i32, "big": 5_i64 });
        assert_eq!(
            json,
            json!({ "n": { "$numberInt": "3" }, "big": { "$numberLong": "5" } })
        );
    }
}
