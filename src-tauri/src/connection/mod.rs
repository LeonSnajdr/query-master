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

/// A saved connection, as it lies in the table and as the frontend gets it.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: Uuid,
    pub name: String,
    /// The connection string without credentials, to show in lists.
    pub address: String,
    #[serde(skip)]
    pub date_created: DateTime<Utc>,
    #[serde(skip)]
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
        date_created: Utc::now(),
        date_last_used: None,
    };
    // The secret first: a row without its connection string could not be opened.
    keychain::write(connection.id, uri)?;
    repository::upsert(pool, &connection).await?;
    Ok(connection)
}

pub async fn mark_used(pool: &SqlitePool, id: Uuid) -> Result<()> {
    repository::set_last_used(pool, id, Utc::now()).await
}

pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<()> {
    repository::delete(pool, id).await?;
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
