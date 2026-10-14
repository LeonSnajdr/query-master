use serde_json::Value;
use sqlx::SqlitePool;
use tauri::State;

use super::Wizard;
use crate::error::Result;

#[tauri::command]
pub async fn preset_get(pool: State<'_, SqlitePool>, wizard: Wizard) -> Result<Option<Value>> {
    super::get(&pool, wizard).await
}

#[tauri::command]
pub async fn preset_save(pool: State<'_, SqlitePool>, wizard: Wizard, value: Value) -> Result<()> {
    super::save(&pool, wizard, &value).await
}
