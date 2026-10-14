use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use super::{TreeFolder, TreeNode};
use crate::error::Result;

#[tauri::command]
pub async fn tree_node_list(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
) -> Result<Vec<TreeNode>> {
    super::list(&pool, connection_id).await
}

#[tauri::command]
pub async fn tree_node_save(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
    node: TreeNode,
) -> Result<()> {
    super::save(&pool, connection_id, node).await
}

#[tauri::command]
pub async fn tree_node_rename(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
    from: String,
    to: String,
) -> Result<()> {
    super::rename(&pool, connection_id, &from, &to).await
}

#[tauri::command]
pub async fn tree_node_remove(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
    path: String,
) -> Result<()> {
    super::remove(&pool, connection_id, &path).await
}

#[tauri::command]
pub async fn tree_folder_list(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
) -> Result<Vec<TreeFolder>> {
    super::folders(&pool, connection_id).await
}

#[tauri::command]
pub async fn tree_folder_add(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
    folder: TreeFolder,
) -> Result<()> {
    super::add_folder(&pool, connection_id, &folder).await
}

#[tauri::command]
pub async fn tree_folder_rename(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
    folder: TreeFolder,
    name: String,
) -> Result<()> {
    super::rename_folder(&pool, connection_id, &folder, &name).await
}

#[tauri::command]
pub async fn tree_folder_delete(
    pool: State<'_, SqlitePool>,
    connection_id: Uuid,
    folder: TreeFolder,
) -> Result<()> {
    super::delete_folder(&pool, connection_id, &folder).await
}
