//! The table `recent_file`.

use sqlx::SqlitePool;

use crate::error::Result;

pub async fn list(pool: &SqlitePool) -> Result<Vec<String>> {
    let rows = sqlx::query!("select path from recent_file order by used_at desc, rowid desc")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|row| row.path).collect())
}

pub async fn add(pool: &SqlitePool, path: &str, now: i64, kept: i64) -> Result<()> {
    let mut transaction = pool.begin().await?;
    sqlx::query!(
        r#"
            insert into recent_file (path, used_at) values ($1, $2)
            on conflict (path) do update set used_at = excluded.used_at
        "#,
        path,
        now
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query!(
        r#"
            delete from recent_file where path not in (
                select path from recent_file order by used_at desc, rowid desc limit $1
            )
        "#,
        kept
    )
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

pub async fn remove(pool: &SqlitePool, path: &str) -> Result<()> {
    sqlx::query!("delete from recent_file where path = $1", path)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[tokio::test]
    async fn keeps_the_newest_files_once() {
        let pool = db::memory_pool().await;
        add(&pool, "a.js", 1, 3).await.unwrap();
        add(&pool, "b.js", 2, 3).await.unwrap();
        add(&pool, "c.js", 3, 3).await.unwrap();
        add(&pool, "a.js", 4, 3).await.unwrap();
        assert_eq!(list(&pool).await.unwrap(), ["a.js", "c.js", "b.js"]);

        add(&pool, "d.js", 5, 3).await.unwrap();
        assert_eq!(list(&pool).await.unwrap(), ["d.js", "a.js", "c.js"]);

        remove(&pool, "a.js").await.unwrap();
        assert_eq!(list(&pool).await.unwrap(), ["d.js", "c.js"]);
    }
}
