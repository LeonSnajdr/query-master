use sqlx::SqlitePool;
use tauri::State;

use super::Setting;
use crate::error::Result;

#[tauri::command]
pub async fn setting_get(pool: State<'_, SqlitePool>) -> Result<Setting> {
    super::get(&pool).await
}

#[tauri::command]
pub async fn setting_save(pool: State<'_, SqlitePool>, setting: Setting) -> Result<()> {
    super::save(&pool, &setting).await
}
