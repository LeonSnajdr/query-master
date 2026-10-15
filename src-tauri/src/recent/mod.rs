//! Script files the shell opened or saved lately, for the menu behind its open button. Only the
//! path is kept; the text is read from the file again when it is chosen.

pub mod commands;
mod repository;

use sqlx::SqlitePool;

use crate::error::Result;

/// Files the menu offers; older ones are forgotten.
const KEPT: i64 = 10;

/// Newest first.
pub async fn list(pool: &SqlitePool) -> Result<Vec<String>> {
    repository::list(pool).await
}

/// Puts the file at the top; the oldest beyond the limit drops out.
pub async fn add(pool: &SqlitePool, path: &str, now: i64) -> Result<()> {
    repository::add(pool, path, now, KEPT).await
}

pub async fn remove(pool: &SqlitePool, path: &str) -> Result<()> {
    repository::remove(pool, path).await
}
