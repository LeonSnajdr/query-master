//! Queries the user saved with a name (stage 20): of a collection (document browser, aggregation)
//! or of a database (shell, SQL), per connection, in folders.

pub mod commands;
mod repository;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    /// Absent for a query not saved yet.
    pub id: Option<i64>,
    pub connection_id: Uuid,
    pub database: String,
    /// The collection it is for; absent for a query of the whole database.
    pub collection: Option<String>,
    /// `browse`, `aggregate`, `shell` or `sql`.
    pub kind: String,
    pub name: String,
    pub folder: Option<String>,
    /// What the tab needs to run it again: query rows, stages, or the text.
    pub content: Value,
    #[serde(default)]
    pub date_created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub date_used: Option<DateTime<Utc>>,
}

pub async fn list(pool: &SqlitePool, connection_id: Uuid) -> Result<Vec<SavedQuery>> {
    repository::list(pool, connection_id).await
}

/// Saves a new query, or changes the one with its id; the saved query comes back with its id.
pub async fn save(pool: &SqlitePool, mut query: SavedQuery) -> Result<SavedQuery> {
    query.name = query.name.trim().to_owned();
    query.folder = query
        .folder
        .map(|folder| folder.trim().to_owned())
        .filter(|folder| !folder.is_empty());
    if query.name.is_empty() {
        return Err(Error::QueryName);
    }
    match query.id {
        Some(_) => repository::update(pool, &query).await?,
        None => {
            query.date_created = Some(Utc::now());
            query.id = Some(repository::insert(pool, &query).await?);
        }
    }
    Ok(query)
}

pub async fn remove(pool: &SqlitePool, id: i64) -> Result<()> {
    repository::remove(pool, id).await
}

/// Notes that the query ran now (the menu shows when it last did).
pub async fn used(pool: &SqlitePool, id: i64) -> Result<()> {
    repository::used(pool, id, Utc::now()).await
}
