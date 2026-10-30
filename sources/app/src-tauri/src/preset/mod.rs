//! What the export and the import wizard were set to last: one row per wizard in the table
//! `transfer_preset`, its value the JSON the frontend sends (formats, options, the folder).

pub mod commands;
mod repository;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Wizard {
    Export,
    Import,
}

impl Wizard {
    fn name(self) -> &'static str {
        match self {
            Self::Export => "export",
            Self::Import => "import",
        }
    }
}

pub async fn get(pool: &SqlitePool, wizard: Wizard) -> Result<Option<Value>> {
    repository::get(pool, wizard.name())
        .await?
        .map(|text| {
            serde_json::from_str(&text).map_err(|error| Error::ExtendedJson(error.to_string()))
        })
        .transpose()
}

pub async fn save(pool: &SqlitePool, wizard: Wizard, value: &Value) -> Result<()> {
    repository::upsert(pool, wizard.name(), &value.to_string()).await
}
