//! The table `history`.

use chrono::{DateTime, Utc};
use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use crate::error::Result;

pub async fn list(pool: &SqlitePool, connection_id: Uuid, limit: i64) -> Result<Vec<String>> {
    let statements = sqlx::query_scalar!(
        "select statement from history where connection_id = $1 order by id desc limit $2",
        connection_id,
        limit
    )
    .fetch_all(pool)
    .await?;
    Ok(statements)
}

pub async fn insert(
    connection: &mut SqliteConnection,
    connection_id: Uuid,
    database_name: &str,
    statement: &str,
    date_executed: DateTime<Utc>,
) -> Result<()> {
    sqlx::query!(
        r#"
            insert into history (connection_id, database_name, statement, date_executed)
            values ($1, $2, $3, $4)
        "#,
        connection_id,
        database_name,
        statement,
        date_executed
    )
    .execute(connection)
    .await?;
    Ok(())
}

pub async fn delete_statement(
    connection: &mut SqliteConnection,
    connection_id: Uuid,
    statement: &str,
) -> Result<()> {
    sqlx::query!(
        "delete from history where connection_id = $1 and statement = $2",
        connection_id,
        statement
    )
    .execute(connection)
    .await?;
    Ok(())
}

/// Deletes all but the newest `kept` statements of the connection.
pub async fn trim(connection: &mut SqliteConnection, connection_id: Uuid, kept: i64) -> Result<()> {
    sqlx::query!(
        r#"
            delete from history
            where connection_id = $1
              and id not in (
                  select id from history where connection_id = $1 order by id desc limit $2
              )
        "#,
        connection_id,
        kept
    )
    .execute(connection)
    .await?;
    Ok(())
}

pub async fn clear(pool: &SqlitePool, connection_id: Uuid) -> Result<()> {
    sqlx::query!(
        "delete from history where connection_id = $1",
        connection_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::add;
    use super::*;
    use crate::db;

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

    #[tokio::test]
    async fn newest_first_without_repeats_per_connection() {
        let pool = db::memory_pool().await;
        let (first, second) = (connection(&pool).await, connection(&pool).await);
        for statement in ["a", "b", "a"] {
            add(&pool, first, "shop", statement).await.unwrap();
        }
        add(&pool, second, "shop", "z").await.unwrap();

        assert_eq!(list(&pool, first, 10).await.unwrap(), ["a", "b"]);
        assert_eq!(list(&pool, first, 1).await.unwrap(), ["a"]);
        assert_eq!(list(&pool, second, 10).await.unwrap(), ["z"]);
    }

    #[tokio::test]
    async fn trims_and_goes_with_its_connection() {
        let pool = db::memory_pool().await;
        let id = connection(&pool).await;
        let mut transaction = pool.begin().await.unwrap();
        for statement in ["a", "b", "c"] {
            insert(&mut transaction, id, "shop", statement, Utc::now())
                .await
                .unwrap();
        }
        trim(&mut transaction, id, 2).await.unwrap();
        transaction.commit().await.unwrap();
        assert_eq!(list(&pool, id, 10).await.unwrap(), ["c", "b"]);

        // Foreign key with cascade: deleting the connection takes its history along.
        sqlx::query!("delete from connection where id = $1", id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(list(&pool, id, 10).await.unwrap().is_empty());
    }
}
