//! What the frontend can call. The commands only hand over; the work is in the module above.

use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use super::{Connection, SaveConnection};
use crate::error::Result;

#[tauri::command]
pub async fn connection_list(pool: State<'_, SqlitePool>) -> Result<Vec<Connection>> {
    super::list(&pool).await
}

#[tauri::command]
pub fn connection_uri(id: Uuid) -> Result<String> {
    super::uri(id)
}

#[tauri::command]
pub async fn connection_save(
    pool: State<'_, SqlitePool>,
    input: SaveConnection,
) -> Result<Connection> {
    super::save(&pool, input).await
}

#[tauri::command]
pub async fn connection_set_environment(
    pool: State<'_, SqlitePool>,
    id: Uuid,
    environment: Option<String>,
) -> Result<()> {
    super::set_environment(&pool, id, environment).await
}

#[tauri::command]
pub async fn connection_delete(pool: State<'_, SqlitePool>, id: Uuid) -> Result<()> {
    super::delete(&pool, id).await
}

/// The SSH part of a saved connection, for the dialog; `null` for a direct connection.
#[tauri::command]
pub async fn connection_ssh(
    pool: State<'_, SqlitePool>,
    id: Uuid,
) -> Result<Option<crate::ssh::SshSettings>> {
    super::ssh(&pool, id).await
}
