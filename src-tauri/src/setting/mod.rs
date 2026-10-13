//! The settings of this installation: one row in the table `setting`.

pub mod commands;
mod repository;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::Result;

/// `None` means not chosen: the frontend then follows the system.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub language: Option<String>,
    pub theme: Option<String>,
}

pub async fn get(pool: &SqlitePool) -> Result<Setting> {
    Ok(repository::get(pool).await?.unwrap_or_default())
}

pub async fn save(pool: &SqlitePool, setting: &Setting) -> Result<()> {
    repository::upsert(pool, setting).await
}
