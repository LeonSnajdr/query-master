//! The tabs that were open, kept so the next start can offer them again (stage 20). Only what a tab
//! needs to be opened again (kind, connection, text, query rows …), no results.

pub mod commands;
mod repository;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub active: bool,
    /// Absent for the start page; a tab of a deleted connection goes with it.
    pub connection_id: Option<Uuid>,
    pub content: Value,
}

pub async fn load(pool: &SqlitePool) -> Result<Vec<SessionTab>> {
    repository::load(pool).await
}

/// Replaces the kept tabs with these, in their order.
pub async fn save(pool: &SqlitePool, tabs: &[SessionTab]) -> Result<()> {
    repository::replace(pool, tabs).await
}
