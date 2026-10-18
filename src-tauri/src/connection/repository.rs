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
                environment,
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
            insert into connection (id, name, address, environment, date_created, date_last_used)
            values ($1, $2, $3, $4, $5, $6)
            on conflict (id) do update set
                name = excluded.name,
                address = excluded.address,
                environment = excluded.environment
        "#,
        connection.id,
        connection.name,
        connection.address,
        connection.environment,
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

pub async fn set_environment(pool: &SqlitePool, id: Uuid, environment: Option<&str>) -> Result<()> {
    sqlx::query!(
        "update connection set environment = $2 where id = $1",
        id,
        environment
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

/// The SSH part of a connection, without its secret.
pub struct SshRow {
    pub host: String,
    pub port: i64,
    pub username: String,
    pub method: String,
    pub key_path: String,
}

pub async fn ssh(pool: &SqlitePool, id: Uuid) -> Result<Option<SshRow>> {
    let row = sqlx::query_as!(
        SshRow,
        "select host, port, username, method, key_path from connection_ssh where connection_id = $1",
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Stores the SSH part of a connection, or with `None` takes it away.
pub async fn set_ssh(pool: &SqlitePool, id: Uuid, ssh: Option<&SshRow>) -> Result<()> {
    match ssh {
        Some(row) => {
            sqlx::query!(
                r#"
                    insert into connection_ssh (connection_id, host, port, username, method, key_path)
                    values ($1, $2, $3, $4, $5, $6)
                    on conflict (connection_id) do update set
                        host = excluded.host,
                        port = excluded.port,
                        username = excluded.username,
                        method = excluded.method,
                        key_path = excluded.key_path
                "#,
                id,
                row.host,
                row.port,
                row.username,
                row.method,
                row.key_path
            )
            .execute(pool)
            .await?;
        }
        None => {
            sqlx::query!("delete from connection_ssh where connection_id = $1", id)
                .execute(pool)
                .await?;
        }
    }
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
            environment: None,
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

    #[tokio::test]
    async fn keeps_the_environment_and_refuses_unknown_ones() {
        let pool = db::memory_pool().await;
        let atlas = connection("Atlas");
        upsert(&pool, &atlas).await.unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].environment, None);

        set_environment(&pool, atlas.id, Some("production"))
            .await
            .unwrap();
        assert_eq!(
            list(&pool).await.unwrap()[0].environment.as_deref(),
            Some("production")
        );
        // The table takes only the three kinds.
        assert!(set_environment(&pool, atlas.id, Some("staging"))
            .await
            .is_err());
        set_environment(&pool, atlas.id, None).await.unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].environment, None);
    }

    #[tokio::test]
    async fn keeps_the_ssh_part_until_taken_away_or_deleted() {
        let pool = db::memory_pool().await;
        let atlas = connection("Atlas");
        upsert(&pool, &atlas).await.unwrap();
        assert!(ssh(&pool, atlas.id).await.unwrap().is_none());

        let mut row = SshRow {
            host: "jump.example.net".to_owned(),
            port: 22,
            username: "me".to_owned(),
            method: "password".to_owned(),
            key_path: String::new(),
        };
        set_ssh(&pool, atlas.id, Some(&row)).await.unwrap();
        row.method = "key".to_owned();
        row.key_path = "C:\\keys\\id_ed25519".to_owned();
        set_ssh(&pool, atlas.id, Some(&row)).await.unwrap();
        let saved = ssh(&pool, atlas.id).await.unwrap().unwrap();
        assert_eq!(
            (saved.method.as_str(), saved.key_path.as_str()),
            ("key", "C:\\keys\\id_ed25519")
        );

        // Only the two methods and real ports.
        row.method = "agent".to_owned();
        assert!(set_ssh(&pool, atlas.id, Some(&row)).await.is_err());

        set_ssh(&pool, atlas.id, None).await.unwrap();
        assert!(ssh(&pool, atlas.id).await.unwrap().is_none());
        // Deleting the connection takes its SSH part along.
        row.method = "password".to_owned();
        set_ssh(&pool, atlas.id, Some(&row)).await.unwrap();
        delete(&pool, atlas.id).await.unwrap();
        assert!(ssh(&pool, atlas.id).await.unwrap().is_none());
    }
}
