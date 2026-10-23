//! The MongoDB side: open clients and two ways to run a database command. Which command a shell
//! statement becomes is decided in the frontend (`src/shell/plan.ts`); here they are sent as they
//! come, so options the server knows work without this app knowing them.

use std::{
    collections::HashMap,
    sync::{atomic::Ordering, Mutex},
    time::Duration,
};

use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    options::{ClientOptions, ServerAddress},
    Client,
};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::{
    connection,
    error::{Error, Result},
    runs::Runs,
    ssh::{SshSettings, Tunnel},
};

/// Without a timeout in the connection string a wrong address would block for 30 seconds.
const SERVER_SELECTION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Clients(Mutex<HashMap<String, Session>>);

/// An open connection; through an SSH server its tunnel lives as long as it does.
struct Session {
    client: Client,
    _tunnel: Option<Tunnel>,
}

impl Clients {
    pub(crate) fn get(&self, id: &str) -> Result<Client> {
        self.lock()
            .get(id)
            .map(|session| session.client.clone())
            .ok_or(Error::NotConnected)
    }

    /// Puts a connection under `id`; the one there before is closed, at once: waiting would wait
    /// for queries still running on it.
    async fn replace(&self, id: String, client: Client, tunnel: Option<Tunnel>) {
        let previous = self.lock().insert(
            id,
            Session {
                client,
                _tunnel: tunnel,
            },
        );
        if let Some(previous) = previous {
            previous.client.shutdown().immediate(true).await;
        }
    }

    // The map stays usable after a panic elsewhere: an entry is inserted or removed whole.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
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
    let (client, info, _) = open_through(uri, None).await?;
    Ok((client, info))
}

/// Opens a client, through an SSH server when there is one: the driver then talks to the local
/// end of the tunnel, directly (a replica set behind it would name hosts it cannot reach), and
/// the tunnel goes to the first host of the string as the SSH server sees it.
async fn open_through(
    uri: &str,
    ssh: Option<&SshSettings>,
) -> Result<(Client, ServerInfo, Option<Tunnel>)> {
    open_options(ClientOptions::parse(uri).await?, ssh).await
}

/// As `open_through`, with options read already.
async fn open_options(
    mut options: ClientOptions,
    ssh: Option<&SshSettings>,
) -> Result<(Client, ServerInfo, Option<Tunnel>)> {
    options
        .app_name
        .get_or_insert_with(|| "QueryMaster".to_string());
    options
        .server_selection_timeout
        .get_or_insert(SERVER_SELECTION_TIMEOUT);
    let tunnel = match ssh {
        Some(settings) => {
            let (host, port) = match options.hosts.first() {
                Some(ServerAddress::Tcp { host, port }) => (host.clone(), port.unwrap_or(27017)),
                _ => ("localhost".to_owned(), 27017),
            };
            let tunnel = crate::ssh::open(settings, &host, port).await?;
            options.hosts = vec![ServerAddress::Tcp {
                host: "127.0.0.1".to_owned(),
                port: Some(tunnel.local_port),
            }];
            options.direct_connection = Some(true);
            options.repl_set_name = None;
            Some(tunnel)
        }
        None => None,
    };
    let client = Client::with_options(options)?;
    let info = client
        .database("admin")
        .run_command(doc! { "buildInfo": 1 })
        .await?;
    let version = info.get_str("version").unwrap_or("unknown").to_string();
    Ok((client, ServerInfo { version }, tunnel))
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

/// The members of a replica set as one of them names them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaMembers {
    /// The name of the set; empty when the server is no member of one.
    pub set_name: String,
    /// `host:port` of every member that holds data (hosts and passives), as the set knows them.
    pub hosts: Vec<String>,
}

/// *Discover replica set members*: asks the first host of the string (directly)
/// which members its set has.
#[tauri::command]
pub async fn discover_members(uri: String, ssh: Option<SshSettings>) -> Result<ReplicaMembers> {
    let mut options = ClientOptions::parse(uri.trim()).await?;
    options.hosts.truncate(1);
    options.direct_connection = Some(true);
    options.repl_set_name = None;
    let (client, _, _tunnel) = open_options(options, ssh.as_ref()).await?;
    let hello = client
        .database("admin")
        .run_command(doc! { "hello": 1 })
        .await;
    client.shutdown().immediate(true).await;
    let hello = hello?;
    let names = |key: &str| -> Vec<String> {
        hello
            .get_array(key)
            .map(|list| {
                list.iter()
                    .filter_map(|host| host.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut hosts = names("hosts");
    hosts.extend(names("passives"));
    Ok(ReplicaMembers {
        set_name: hello.get_str("setName").unwrap_or_default().to_owned(),
        hosts,
    })
}

/// Tries a connection from the dialog, through its SSH server when it has one.
#[tauri::command]
pub async fn test_connection(uri: String, ssh: Option<SshSettings>) -> Result<ServerInfo> {
    let (client, info, _tunnel) = open_through(uri.trim(), ssh.as_ref()).await?;
    client.shutdown().await;
    Ok(info)
}

#[tauri::command]
pub async fn connect(
    clients: State<'_, Clients>,
    pool: State<'_, sqlx::SqlitePool>,
    id: uuid::Uuid,
) -> Result<ServerInfo> {
    let ssh = connection::ssh(&pool, id).await?;
    let (client, info, tunnel) = open_through(&connection::uri(id)?, ssh.as_ref()).await?;
    connection::mark_used(&pool, id).await?;
    clients.replace(id.to_string(), client, tunnel).await;
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
    clients.replace(id, client, None).await;
    Ok(UriConnection {
        version: info.version,
        address: connection::address_of(uri),
    })
}

#[tauri::command]
pub async fn disconnect(clients: State<'_, Clients>, id: String) -> Result<()> {
    let session = clients.lock().remove(&id);
    if let Some(session) = session {
        // Immediate: disconnecting must not wait for a query that is still running. The tunnel
        // closes after the client, when the session goes.
        session.client.shutdown().immediate(true).await;
    }
    Ok(())
}

/// Runs a command with a single reply document. With `run_id` it can be stopped (`run_stop`).
#[tauri::command]
pub async fn run_command(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    id: String,
    database: String,
    command: Value,
    run_id: Option<String>,
) -> Result<Value> {
    let client = clients.get(&id)?;
    let command = to_document(command)?;
    let work = async {
        Ok(to_json(
            client.database(&database).run_command(command).await?,
        ))
    };
    stoppable(&client, &runs, run_id.as_deref(), work).await
}

/// Runs a command that opens a cursor (`find`, `aggregate`, `listIndexes` …) and reads at most
/// `limit` documents from it. The cursor is closed afterwards. With `run_id` it can be stopped.
#[tauri::command]
pub async fn run_cursor_command(
    clients: State<'_, Clients>,
    runs: State<'_, Runs>,
    id: String,
    database: String,
    command: Value,
    limit: usize,
    run_id: Option<String>,
) -> Result<CursorPage> {
    let client = clients.get(&id)?;
    let command = to_document(command)?;
    let work = read_cursor(&client, &database, command, limit);
    stoppable(&client, &runs, run_id.as_deref(), work).await
}

/// How often a stoppable command looks whether it was asked to stop.
const STOP_POLL: Duration = Duration::from_millis(100);

/// Runs `work`; with a run id it ends early when the run is stopped. The client stops waiting at
/// once, and the server is asked to end the operation too: `find` and `aggregate` carry the run id
/// as their `comment` (the frontend sets it), by which `currentOp` finds them for `killOp`.
async fn stoppable<T>(
    client: &Client,
    runs: &Runs,
    run_id: Option<&str>,
    work: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    let Some(run_id) = run_id else {
        return work.await;
    };
    let stop = runs.start(run_id);
    tokio::pin!(work);
    let outcome = loop {
        tokio::select! {
            outcome = &mut work => break outcome,
            () = tokio::time::sleep(STOP_POLL) => {
                if stop.load(Ordering::Relaxed) {
                    kill_by_comment(client, run_id).await;
                    break Err(Error::QueryStopped);
                }
            }
        }
    };
    runs.finish(run_id);
    outcome
}

/// Ends the server's operations whose command carries `comment`; best effort: without the right
/// to see or end them, nothing happens.
async fn kill_by_comment(client: &Client, comment: &str) {
    let admin = client.database("admin");
    let Ok(reply) = admin
        .run_command(doc! { "currentOp": true, "command.comment": comment })
        .await
    else {
        return;
    };
    for operation in reply.get_array("inprog").into_iter().flatten() {
        if let Some(opid) = operation.as_document().and_then(|op| op.get("opid")) {
            let _ = admin
                .run_command(doc! { "killOp": 1, "op": opid.clone() })
                .await;
        }
    }
}

/// Reads at most `limit` documents of the cursor a command opens.
async fn read_cursor(
    client: &Client,
    database: &str,
    command: Document,
    limit: usize,
) -> Result<CursorPage> {
    let mut cursor = client
        .database(database)
        .run_cursor_command(command)
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

    /// An SSH server for the tests: takes the password `secret` and forwards `direct-tcpip`.
    struct ForwardingServer;

    impl russh::server::Handler for ForwardingServer {
        type Error = russh::Error;

        async fn auth_password(
            &mut self,
            _user: &str,
            password: &str,
        ) -> std::result::Result<russh::server::Auth, Self::Error> {
            Ok(if password == "secret" {
                russh::server::Auth::Accept
            } else {
                russh::server::Auth::reject()
            })
        }

        async fn channel_open_direct_tcpip(
            &mut self,
            channel: russh::Channel<russh::server::Msg>,
            host: &str,
            port: u32,
            _originator_address: &str,
            _originator_port: u32,
            reply: russh::server::ChannelOpenHandle,
            _session: &mut russh::server::Session,
        ) -> std::result::Result<(), Self::Error> {
            let target = format!("{host}:{port}");
            reply.accept().await;
            tokio::spawn(async move {
                if let Ok(mut socket) = tokio::net::TcpStream::connect(target).await {
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                }
            });
            Ok(())
        }
    }

    /// Starts the test SSH server on a free local port.
    async fn forwarding_server() -> u16 {
        let key = russh::keys::ssh_key::private::Ed25519Keypair::from_seed(&[7; 32]);
        let config = std::sync::Arc::new(russh::server::Config {
            keys: vec![russh::keys::PrivateKey::from(key)],
            ..Default::default()
        });
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                let config = config.clone();
                tokio::spawn(async move {
                    if let Ok(session) =
                        russh::server::run_stream(config, socket, ForwardingServer).await
                    {
                        let _ = session.await;
                    }
                });
            }
        });
        port
    }

    /// Against a real server through an SSH server in the test: the tunnel carries the
    /// connection, and a wrong password is refused.
    #[tokio::test]
    #[ignore]
    async fn connects_through_an_ssh_server() {
        let uri = std::env::var("QUERYMASTER_TEST_URI")
            .unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let port = forwarding_server().await;
        let mut settings = SshSettings {
            host: "127.0.0.1".into(),
            port,
            username: "tester".into(),
            method: crate::ssh::SshMethod::Password,
            key_path: String::new(),
            secret: "secret".into(),
        };
        let (client, info, tunnel) = open_through(&uri, Some(&settings)).await.unwrap();
        assert!(!info.version.is_empty());
        assert!(tunnel.is_some());
        let names = client.list_database_names().await.unwrap();
        assert!(names.iter().any(|name| name == "admin"));
        client.shutdown().immediate(true).await;

        settings.secret = "wrong".into();
        assert!(matches!(
            open_through(&uri, Some(&settings)).await,
            Err(Error::SshAuthentication)
        ));
    }

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

    /// Against a real server, reading `querymaster_test` only: a slow query ends when its run is
    /// stopped, and the server's operation is ended too.
    #[tokio::test]
    #[ignore]
    async fn a_stopped_query_ends_on_both_sides() {
        let uri = std::env::var("QUERYMASTER_TEST_URI")
            .unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let (client, _) = open(&uri).await.unwrap();
        let database = client.database("querymaster_test");
        let slow = database.collection::<Document>("stop_slow");
        slow.drop().await.unwrap();
        slow.insert_many((0..20).map(|n| doc! { "n": n }))
            .await
            .unwrap();
        let runs = Runs::default();
        // Each document waits half a second on the server: ten seconds unless stopped.
        let command = doc! {
            "find": "stop_slow",
            "filter": { "$where": "sleep(500) || true" },
            "comment": "stop-test",
        };
        let started = std::time::Instant::now();
        let (outcome, ()) = tokio::join!(
            stoppable(
                &client,
                &runs,
                Some("stop-test"),
                read_cursor(&client, "querymaster_test", command, 100)
            ),
            async {
                tokio::time::sleep(Duration::from_millis(700)).await;
                runs.stop("stop-test");
            }
        );
        assert!(matches!(outcome, Err(Error::QueryStopped)));
        assert!(started.elapsed() < Duration::from_secs(3));
        tokio::time::sleep(Duration::from_millis(300)).await;
        let left = client
            .database("admin")
            .run_command(doc! { "currentOp": true, "command.comment": "stop-test" })
            .await
            .unwrap();
        assert!(left.get_array("inprog").unwrap().is_empty());
        slow.drop().await.unwrap();
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
