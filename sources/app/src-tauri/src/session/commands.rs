use sqlx::SqlitePool;
use tauri::State;

use super::SessionTab;
use crate::error::Result;

#[tauri::command]
pub async fn session_load(pool: State<'_, SqlitePool>) -> Result<Vec<SessionTab>> {
    super::load(&pool).await
}

#[tauri::command]
pub async fn session_save(pool: State<'_, SqlitePool>, tabs: Vec<SessionTab>) -> Result<()> {
    super::save(&pool, &tabs).await
}
