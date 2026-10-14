use std::collections::BTreeMap;

use sqlx::SqlitePool;
use tauri::State;

use super::KeybindingChange;
use crate::error::Result;

#[tauri::command]
pub async fn keybinding_list(pool: State<'_, SqlitePool>) -> Result<BTreeMap<String, Vec<String>>> {
    super::list(&pool).await
}

#[tauri::command]
pub async fn keybinding_save(
    pool: State<'_, SqlitePool>,
    changes: Vec<KeybindingChange>,
) -> Result<()> {
    super::save(&pool, &changes).await
}

#[tauri::command]
pub async fn keybinding_clear(pool: State<'_, SqlitePool>) -> Result<()> {
    super::clear(&pool).await
}
