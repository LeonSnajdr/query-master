//! The keyboard shortcuts the user changed: one row per command in the table `keybinding`.
//! The frontend knows the commands and their defaults; ids it does not know are kept.

pub mod commands;
mod repository;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::{Error, Result};

/// `keys: None` returns the command to its default.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingChange {
    pub command_id: String,
    pub keys: Option<Vec<String>>,
}

pub async fn list(pool: &SqlitePool) -> Result<BTreeMap<String, Vec<String>>> {
    repository::list(pool)
        .await?
        .into_iter()
        .map(|(id, keys)| {
            let keys = serde_json::from_str(&keys)
                .map_err(|error| Error::ExtendedJson(error.to_string()))?;
            Ok((id, keys))
        })
        .collect()
}

pub async fn save(pool: &SqlitePool, changes: &[KeybindingChange]) -> Result<()> {
    let rows: Vec<(&str, Option<String>)> = changes
        .iter()
        .map(|change| {
            let keys = change
                .keys
                .as_ref()
                .map(|keys| serde_json::Value::from(keys.clone()).to_string());
            (change.command_id.as_str(), keys)
        })
        .collect();
    repository::save(pool, &rows).await
}

pub async fn clear(pool: &SqlitePool) -> Result<()> {
    repository::clear(pool).await
}
