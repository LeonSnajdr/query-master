//! Saved connections: name and address in the database, the connection string (it may hold a
//! password) in the keychain of the operating system.

pub mod commands;
mod keychain;
mod repository;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::ssh::{SshMethod, SshSettings};

/// A saved connection, as it lies in the table and as the frontend gets it.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: Uuid,
    pub name: String,
    /// The connection string without credentials, to show in lists.
    pub address: String,
    /// `development`, `test` or `production`; how the app asks before writing on it.
    pub environment: Option<String>,
    /// Databases shown besides those the server lists, separated by commas.
    pub visible_databases: String,
    /// The group of the connection list it lies in; empty for none.
    pub group_name: String,
    #[serde(skip)]
    pub date_created: DateTime<Utc>,
    /// For the start page's *Recent connections*, the last used first.
    pub date_last_used: Option<DateTime<Utc>>,
}

/// What the connection dialog sends.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnection {
    /// Absent for a new connection.
    pub id: Option<Uuid>,
    pub name: String,
    pub uri: String,
    #[serde(default)]
    pub environment: Option<String>,
    /// Through an SSH server; absent for a direct connection.
    #[serde(default)]
    pub ssh: Option<SshSettings>,
    #[serde(default)]
    pub visible_databases: String,
    #[serde(default)]
    pub group_name: String,
}

/// The kinds of use a connection can be marked with.
const ENVIRONMENTS: [&str; 3] = ["development", "test", "production"];

fn checked_environment(environment: Option<String>) -> Result<Option<String>> {
    match environment {
        Some(value) if !ENVIRONMENTS.contains(&value.as_str()) => Err(Error::Environment(value)),
        other => Ok(other),
    }
}

/// `mongodb://user:secret@host:27017/db?x=1` becomes `mongodb://host:27017/db`.
pub(crate) fn address_of(uri: &str) -> String {
    let (scheme, rest) = uri.split_once("://").unwrap_or(("mongodb", uri));
    let rest = rest.split('?').next().unwrap_or(rest);
    // Credentials end at the last `@` of the authority (a password may hold an encoded `/` only).
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let start = rest[..authority_end].rfind('@').map_or(0, |at| at + 1);
    format!("{scheme}://{}", rest[start..].trim_end_matches('/'))
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<Connection>> {
    repository::list(pool).await
}

/// The connection string of a saved connection.
pub fn uri(id: Uuid) -> Result<String> {
    keychain::read(id)
}

pub async fn save(pool: &SqlitePool, input: SaveConnection) -> Result<Connection> {
    let uri = input.uri.trim();
    if !uri.starts_with("mongodb://") && !uri.starts_with("mongodb+srv://") {
        return Err(Error::UriScheme);
    }
    let connection = Connection {
        id: input.id.unwrap_or_else(Uuid::new_v4),
        name: input.name.trim().to_owned(),
        address: address_of(uri),
        environment: checked_environment(input.environment)?,
        visible_databases: input.visible_databases.trim().to_owned(),
        group_name: input.group_name.trim().to_owned(),
        date_created: Utc::now(),
        date_last_used: None,
    };
    // The secret first: a row without its connection string could not be opened.
    keychain::write(connection.id, uri)?;
    repository::upsert(pool, &connection).await?;
    let ssh = input.ssh.as_ref().map(|ssh| repository::SshRow {
        host: ssh.host.trim().to_owned(),
        port: i64::from(ssh.port),
        username: ssh.username.trim().to_owned(),
        method: match ssh.method {
            SshMethod::Password => "password",
            SshMethod::Key => "key",
        }
        .to_owned(),
        key_path: ssh.key_path.trim().to_owned(),
    });
    keychain::write_ssh(
        connection.id,
        input.ssh.as_ref().map_or("", |ssh| ssh.secret.as_str()),
    )?;
    repository::set_ssh(pool, connection.id, ssh.as_ref()).await?;
    Ok(connection)
}

/// The SSH part of a saved connection with its secret; `None` for a direct connection.
pub async fn ssh(pool: &SqlitePool, id: Uuid) -> Result<Option<SshSettings>> {
    let Some(row) = repository::ssh(pool, id).await? else {
        return Ok(None);
    };
    Ok(Some(SshSettings {
        host: row.host,
        port: u16::try_from(row.port).unwrap_or(22),
        username: row.username,
        method: if row.method == "key" {
            SshMethod::Key
        } else {
            SshMethod::Password
        },
        key_path: row.key_path,
        secret: keychain::read_ssh(id)?,
    }))
}

/// Marks a connection (from its menu in the tree); `None` takes the mark away.
pub async fn set_environment(
    pool: &SqlitePool,
    id: Uuid,
    environment: Option<String>,
) -> Result<()> {
    repository::set_environment(pool, id, checked_environment(environment)?.as_deref()).await
}

/// Puts a connection into a group of the list (empty: none), as moving it there.
pub async fn set_group(pool: &SqlitePool, id: Uuid, group: &str) -> Result<()> {
    repository::set_group(pool, id, group.trim()).await
}

/// A folder path as kept: its parts trimmed, empty parts dropped, joined with `/`.
pub(crate) fn folder_path(name: &str) -> String {
    name.split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

/// The folder a folder lies in; empty at the top.
fn parent_folder(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

/// The folders of the connections, also empty ones and those only a connection names.
pub async fn folders(pool: &SqlitePool) -> Result<Vec<String>> {
    repository::folders(pool).await
}

/// Keeps a folder even while no connection lies in it; nested ones with `/`.
pub async fn add_folder(pool: &SqlitePool, name: &str) -> Result<()> {
    let path = folder_path(name);
    if path.is_empty() {
        return Err(Error::FolderName);
    }
    repository::add_folder(pool, &path).await
}

/// Renames or moves a folder (`to` is its whole new path) with all folders and connections in it.
pub async fn rename_folder(pool: &SqlitePool, from: &str, to: &str) -> Result<()> {
    let (from, to) = (folder_path(from), folder_path(to));
    if from.is_empty() || to.is_empty() {
        return Err(Error::FolderName);
    }
    if to == from || to.starts_with(&format!("{from}/")) {
        return Err(Error::FolderIntoItself);
    }
    repository::move_folder(pool, &from, &to).await
}

/// Takes a folder away; its connections and folders lie in the folder above it then.
pub async fn delete_folder(pool: &SqlitePool, name: &str) -> Result<()> {
    let path = folder_path(name);
    repository::move_folder(pool, &path, parent_folder(&path)).await
}

pub async fn mark_used(pool: &SqlitePool, id: Uuid) -> Result<()> {
    repository::set_last_used(pool, id, Utc::now()).await
}

pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<()> {
    repository::delete(pool, id).await?;
    keychain::delete_ssh(id)?;
    keychain::delete(id)
}

#[cfg(test)]
mod tests {
    use super::address_of;

    #[test]
    fn address_drops_credentials_and_options() {
        assert_eq!(
            address_of("mongodb://localhost:27017"),
            "mongodb://localhost:27017"
        );
        assert_eq!(
            address_of("mongodb://user:p%40ss@a:1,b:2/shop?replicaSet=rs0"),
            "mongodb://a:1,b:2/shop"
        );
        assert_eq!(
            address_of("mongodb+srv://me:secret@cluster0.example.net/?retryWrites=true"),
            "mongodb+srv://cluster0.example.net"
        );
    }
}
