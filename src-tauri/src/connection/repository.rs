//! The table `connection`.

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::Connection;
use crate::error::Result;

pub async fn list(pool: &SqlitePool) -> Result<Vec<Connection>> {
    let connections = sqlx::query_as!(
        Connection,
        r#"
            select
                id as "id: Uuid",
                name,
                address,
                date_created as "date_created: DateTime<Utc>",
                date_last_used as "date_last_used: DateTime<Utc>"
            from connection
            order by name collate nocase
        "#
    )
    .fetch_all(pool)
    .await?;
    Ok(connections)
}

/// Inserts the connection, or changes name and address of the one with its id.
pub async fn upsert(pool: &SqlitePool, connection: &Connection) -> Result<()> {
    sqlx::query!(
        r#"
            insert into connection (id, name, address, date_created, date_last_used)
            values ($1, $2, $3, $4, $5)
            on conflict (id) do update set
                name = excluded.name,
                address = excluded.address
        "#,
        connection.id,
        connection.name,
        connection.address,
        connection.date_created,
        connection.date_last_used
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_last_used(
    pool: &SqlitePool,
    id: Uuid,
    date_last_used: DateTime<Utc>,
) -> Result<()> {
    sqlx::query!(
        "update connection set date_last_used = $2 where id = $1",
        id,
        date_last_used
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<()> {
    sqlx::query!("delete from connection where id = $1", id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn connection(name: &str) -> Connection {
        Connection {
            id: Uuid::new_v4(),
            name: name.to_owned(),
            address: "mongodb://localhost:27017".to_owned(),
            date_created: Utc::now(),
            date_last_used: None,
        }
    }

    #[tokio::test]
    async fn saves_changes_and_deletes() {
        let pool = db::memory_pool().await;
        let mut local = connection("local");
        upsert(&pool, &local).await.unwrap();
        upsert(&pool, &connection("Atlas")).await.unwrap();

        // Sorted by name, without regard to case.
        let names: Vec<_> = list(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, ["Atlas", "local"]);

        // Saving again changes the row and keeps when it was made and last used.
        set_last_used(&pool, local.id, Utc::now()).await.unwrap();
        local.name = "Local dev".to_owned();
        upsert(&pool, &local).await.unwrap();
        let all = list(&pool).await.unwrap();
        let saved = all.iter().find(|c| c.id == local.id).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(saved.name, "Local dev");
        assert!(saved.date_last_used.is_some());

        delete(&pool, local.id).await.unwrap();
        assert_eq!(list(&pool).await.unwrap().len(), 1);
    }
}
