use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use super::SavedQuery;
use crate::error::Result;

#[tauri::command]
pub async fn saved_query_list(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
) -> Result<Vec<SavedQuery>> {
    super::list(&pool, connection_id).await
}

#[tauri::command]
pub async fn saved_query_save(
    pool: State<'_, SqlitePool>,
    query: SavedQuery,
) -> Result<SavedQuery> {
    super::save(&pool, query).await
}

#[tauri::command]
pub async fn saved_query_remove(pool: State<'_, SqlitePool>, id: i64) -> Result<()> {
    super::remove(&pool, id).await
}

#[tauri::command]
pub async fn saved_query_used(pool: State<'_, SqlitePool>, id: i64) -> Result<()> {
    super::used(&pool, id).await
}
