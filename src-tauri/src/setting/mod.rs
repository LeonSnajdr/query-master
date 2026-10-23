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
    /// Documents per page in new tabs.
    pub page_size: Option<i64>,
    /// `tree`, `table` or `json`: the view new tabs start with.
    pub result_view: Option<String>,
    /// Pixels.
    pub editor_font_size: Option<i64>,
    /// `ask`, `restore` or `empty`: the tabs of the last session at the start.
    pub startup: Option<String>,
    /// What a double click on a collection opens: `browse`, `shell`, `aggregate`, `sql`.
    pub default_tab: Option<String>,
    /// Dates in `local` time or `utc`.
    pub time_zone: Option<String>,
    /// `local`, `iso`, `dmy` or `mdy`.
    pub date_format: Option<String>,
    /// How binary subtype 3 shows: `raw`, or as the UUID of `dotnet`, `java`, `python`.
    pub legacy_uuid: Option<String>,
    /// Documents of a result unfolded at first: `none`, `first`, `all`.
    pub auto_expand: Option<String>,
    /// The view Json: `shell`, `relaxed` or `canonical` Extended JSON.
    pub json_view: Option<String>,
    /// Numbers with thousands separators.
    pub number_grouping: Option<bool>,
    /// Values coloured by type.
    pub type_colors: Option<bool>,
    /// Spaces of a tab in the editor.
    pub tab_width: Option<i64>,
    /// The editor closes brackets and quotes.
    pub auto_close: Option<bool>,
}

pub async fn get(pool: &SqlitePool) -> Result<Setting> {
    Ok(repository::get(pool).await?.unwrap_or_default())
}

pub async fn save(pool: &SqlitePool, setting: &Setting) -> Result<()> {
    repository::upsert(pool, setting).await
}
