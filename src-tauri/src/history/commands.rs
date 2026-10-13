use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::error::Result;

/// Statements the history menu shows at most.
const SHOWN: i64 = 50;

#[tauri::command]
pub async fn history_list(pool: State<'_, SqlitePool>, connection_id: Uuid) -> Result<Vec<String>> {
    super::list(&pool, connection_id, SHOWN).await
}

#[tauri::command]
pub async fn history_add(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
    database: String,
    statement: String,
) -> Result<()> {
    super::add(&pool, connection_id, &database, &statement).await
}

#[tauri::command]
pub async fn history_clear(pool: State<'_, SqlitePool>, connection_id: Uuid) -> Result<()> {
    super::clear(&pool, connection_id).await
}
