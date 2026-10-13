//! The statements that ran, per connection, newest first.

pub mod commands;
mod repository;

use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::Result;

/// Statements kept per connection; older ones go when a new one is added.
const KEPT: i64 = 500;

pub async fn list(pool: &SqlitePool, connection_id: Uuid, limit: i64) -> Result<Vec<String>> {
    repository::list(pool, connection_id, limit).await
}

/// Puts the statement at the top; one that ran before moves up instead of appearing twice.
pub async fn add(
    pool: &SqlitePool,
    connection_id: Uuid,
    database_name: &str,
    statement: &str,
) -> Result<()> {
    // One transaction: no reader sees the statement gone but not yet added again.
    let mut transaction = pool.begin().await?;
    repository::delete_statement(&mut transaction, connection_id, statement).await?;
    repository::insert(
        &mut transaction,
        connection_id,
        database_name,
        statement,
        Utc::now(),
    )
    .await?;
    repository::trim(&mut transaction, connection_id, KEPT).await?;
    transaction.commit().await?;
    Ok(())
}

pub async fn clear(pool: &SqlitePool, connection_id: Uuid) -> Result<()> {
    repository::clear(pool, connection_id).await
}
