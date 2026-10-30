//! The table `saved_query`.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::SqlitePool;
use uuid::Uuid;

use super::SavedQuery;
use crate::error::{Error, Result};

fn content_of(text: &str) -> Result<Value> {
    serde_json::from_str(text).map_err(|error| Error::ExtendedJson(error.to_string()))
}

pub async fn list(pool: &SqlitePool, connection_id: Uuid) -> Result<Vec<SavedQuery>> {
    let rows = sqlx::query!(
        r#"
            select
                id as "id!: i64",
                connection_id as "connection_id: Uuid",
                database_name,
                scope_collection,
                kind,
                name,
                folder,
                content,
                date_created as "date_created: DateTime<Utc>",
                date_used as "date_used: DateTime<Utc>"
            from saved_query
            where connection_id = $1
            order by folder is not null, folder collate nocase, name collate nocase
        "#,
        connection_id
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(SavedQuery {
                id: Some(row.id),
                connection_id: row.connection_id,
                database: row.database_name,
                collection: row.scope_collection,
                kind: row.kind,
                name: row.name,
                folder: row.folder,
                content: content_of(&row.content)?,
                date_created: Some(row.date_created),
                date_used: row.date_used,
            })
        })
        .collect()
}

pub async fn insert(pool: &SqlitePool, query: &SavedQuery) -> Result<i64> {
    let content = query.content.to_string();
    let created = query.date_created.unwrap_or_else(Utc::now);
    let id = sqlx::query_scalar!(
        r#"
            insert into saved_query
                (connection_id, database_name, scope_collection, kind, name, folder, content, date_created)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            returning id as "id!: i64"
        "#,
        query.connection_id,
        query.database,
        query.collection,
        query.kind,
        query.name,
        query.folder,
        content,
        created
    )
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Name, folder, what it is for and the query itself; when it was made stays.
pub async fn update(pool: &SqlitePool, query: &SavedQuery) -> Result<()> {
    let content = query.content.to_string();
    sqlx::query!(
        r#"
            update saved_query set
                database_name = $2, scope_collection = $3, kind = $4, name = $5, folder = $6, content = $7
            where id = $1
        "#,
        query.id,
        query.database,
        query.collection,
        query.kind,
        query.name,
        query.folder,
        content
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query!("delete from saved_query where id = $1", id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn used(pool: &SqlitePool, id: i64, at: DateTime<Utc>) -> Result<()> {
    sqlx::query!(
        "update saved_query set date_used = $2 where id = $1",
        id,
        at
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{list as list_queries, remove as remove_query, save, used as mark_used};
    use super::*;
    use crate::db;
    use serde_json::json;

    async fn connection(pool: &SqlitePool) -> Uuid {
        let id = Uuid::new_v4();
        let now = Utc::now();
        sqlx::query!(
            "insert into connection (id, name, address, date_created) values ($1, 'c', 'a', $2)",
            id,
            now
        )
        .execute(pool)
        .await
        .unwrap();
        id
    }

    fn query(connection_id: Uuid, name: &str, folder: Option<&str>) -> SavedQuery {
        SavedQuery {
            id: None,
            connection_id,
            database: "shop".into(),
            collection: Some("orders".into()),
            kind: "browse".into(),
            name: name.into(),
            folder: folder.map(str::to_owned),
            content: json!({ "stages": [{ "name": "filter", "text": "{ status: 'open' }", "enabled": true }] }),
            date_created: None,
            date_used: None,
        }
    }

    #[tokio::test]
    async fn saves_lists_changes_and_removes() {
        let pool = db::memory_pool().await;
        let id = connection(&pool).await;
        let open = save(&pool, query(id, " open orders ", None)).await.unwrap();
        assert_eq!(open.name, "open orders");
        let mut late = save(&pool, query(id, "late", Some("checks")))
            .await
            .unwrap();
        // Of a whole database: no collection.
        let mut shell = query(id, "count all", Some(" "));
        shell.collection = None;
        shell.kind = "shell".into();
        shell.content = json!({ "text": "db.orders.countDocuments({})" });
        let shell = save(&pool, shell).await.unwrap();
        assert_eq!(shell.folder, None);

        // Without folder first, then by folder and name.
        let names: Vec<_> = list_queries(&pool, id)
            .await
            .unwrap()
            .into_iter()
            .map(|query| query.name)
            .collect();
        assert_eq!(names, ["count all", "open orders", "late"]);

        late.name = "late orders".into();
        late.folder = Some("checks/2024".into());
        save(&pool, late.clone()).await.unwrap();
        mark_used(&pool, late.id.unwrap()).await.unwrap();
        let all = list_queries(&pool, id).await.unwrap();
        let changed = all.iter().find(|query| query.id == late.id).unwrap();
        assert_eq!(changed.name, "late orders");
        assert_eq!(changed.folder.as_deref(), Some("checks/2024"));
        assert!(changed.date_used.is_some());
        assert_eq!(changed.content, late.content);

        remove_query(&pool, open.id.unwrap()).await.unwrap();
        assert_eq!(list_queries(&pool, id).await.unwrap().len(), 2);
        assert!(save(&pool, query(id, "  ", None)).await.is_err());

        // They go with their connection.
        sqlx::query!("delete from connection where id = $1", id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(list_queries(&pool, id).await.unwrap().is_empty());
    }
}
