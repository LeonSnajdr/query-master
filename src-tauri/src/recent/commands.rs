use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::SqlitePool;
use tauri::State;

use crate::error::Result;

#[tauri::command]
pub async fn recent_file_list(pool: State<'_, SqlitePool>) -> Result<Vec<String>> {
    super::list(&pool).await
}

#[tauri::command]
pub async fn recent_file_add(pool: State<'_, SqlitePool>, path: String) -> Result<()> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64);
    super::add(&pool, &path, now).await
}

#[tauri::command]
pub async fn recent_file_remove(pool: State<'_, SqlitePool>, path: String) -> Result<()> {
    super::remove(&pool, &path).await
}
