//! Notes on rows of the connection tree: a color, a comment, read-only, the folder a database or
//! collection sits in; and the folders of the connection and of each database. They belong to the app, not to the database, and
//! go with their connection.

pub mod commands;
mod repository;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// Empty for the connection, `database`, or `database/collection`.
    pub path: String,
    pub color: Option<String>,
    pub comment: Option<String>,
    /// `None` takes what the row above has; `Some(false)` is writable even below a read-only row.
    pub readonly: Option<bool>,
    /// The folder a database (of the connection) or a collection (of its database) is shown in.
    #[serde(default)]
    pub folder: Option<String>,
}

impl TreeNode {
    fn is_empty(&self) -> bool {
        self.color.is_none()
            && self.comment.is_none()
            && self.readonly.is_none()
            && self.folder.is_none()
    }
}

/// A folder in the tree: of a database for its collections, or with an empty `database` for the
/// databases of the connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TreeFolder {
    pub database: String,
    pub name: String,
}

/// Blank text counts as none.
fn normalized(mut node: TreeNode) -> TreeNode {
    node.color = node.color.filter(|color| !color.trim().is_empty());
    node.comment = node.comment.filter(|comment| !comment.trim().is_empty());
    node.folder = node.folder.filter(|folder| !folder.trim().is_empty());
    node
}

pub async fn list(pool: &SqlitePool, connection_id: Uuid) -> Result<Vec<TreeNode>> {
    repository::list(pool, connection_id).await
}

/// Keeps the notes of a row; a row left without any is forgotten.
pub async fn save(pool: &SqlitePool, connection_id: Uuid, node: TreeNode) -> Result<()> {
    let node = normalized(node);
    if node.is_empty() {
        repository::delete(pool, connection_id, &node.path).await
    } else {
        repository::upsert(pool, connection_id, &node).await
    }
}

/// A database or collection got another name: its notes, and those of what lies below, go along.
pub async fn rename(pool: &SqlitePool, connection_id: Uuid, from: &str, to: &str) -> Result<()> {
    let mut transaction = pool.begin().await?;
    // What the new name had before is replaced, as the server replaced it.
    repository::delete_below(&mut transaction, connection_id, to).await?;
    repository::rename_below(&mut transaction, connection_id, from, to).await?;
    transaction.commit().await?;
    Ok(())
}

/// A database or collection was dropped: its notes, and those of what lay below, go too; a
/// database takes its folders along.
pub async fn remove(pool: &SqlitePool, connection_id: Uuid, path: &str) -> Result<()> {
    let mut transaction = pool.begin().await?;
    repository::delete_below(&mut transaction, connection_id, path).await?;
    if !path.contains('/') {
        repository::delete_folders(&mut transaction, connection_id, path).await?;
    }
    transaction.commit().await?;
    Ok(())
}

pub async fn folders(pool: &SqlitePool, connection_id: Uuid) -> Result<Vec<TreeFolder>> {
    repository::folders(pool, connection_id).await
}

pub async fn add_folder(pool: &SqlitePool, connection_id: Uuid, folder: &TreeFolder) -> Result<()> {
    repository::insert_folder(pool, connection_id, folder).await
}

/// The folder gets another name; the collections in it stay in it.
pub async fn rename_folder(
    pool: &SqlitePool,
    connection_id: Uuid,
    folder: &TreeFolder,
    name: &str,
) -> Result<()> {
    let mut transaction = pool.begin().await?;
    repository::rename_folder(&mut transaction, connection_id, folder, name).await?;
    transaction.commit().await?;
    Ok(())
}

/// The folder goes; its collections show in the database again, keeping their other notes.
pub async fn delete_folder(
    pool: &SqlitePool,
    connection_id: Uuid,
    folder: &TreeFolder,
) -> Result<()> {
    let mut transaction = pool.begin().await?;
    repository::delete_folder(&mut transaction, connection_id, folder).await?;
    transaction.commit().await?;
    Ok(())
}
