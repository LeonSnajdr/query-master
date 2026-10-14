//! The table `transfer_preset`.

use sqlx::SqlitePool;

use crate::error::Result;

pub async fn get(pool: &SqlitePool, wizard: &str) -> Result<Option<String>> {
    let value = sqlx::query_scalar!(
        "select value from transfer_preset where wizard = $1",
        wizard
    )
    .fetch_optional(pool)
    .await?;
    Ok(value)
}

pub async fn upsert(pool: &SqlitePool, wizard: &str, value: &str) -> Result<()> {
    sqlx::query!(
        r#"
            insert into transfer_preset (wizard, value) values ($1, $2)
            on conflict (wizard) do update set value = excluded.value
        "#,
        wizard,
        value
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[tokio::test]
    async fn keeps_one_row_per_wizard_and_only_json() {
        let pool = db::memory_pool().await;
        assert_eq!(get(&pool, "export").await.unwrap(), None);
        upsert(&pool, "export", r#"{"format":"csv"}"#)
            .await
            .unwrap();
        upsert(&pool, "export", r#"{"format":"sql"}"#)
            .await
            .unwrap();
        upsert(&pool, "import", "{}").await.unwrap();
        assert_eq!(
            get(&pool, "export").await.unwrap().as_deref(),
            Some(r#"{"format":"sql"}"#)
        );
        assert!(upsert(&pool, "import", "not json").await.is_err());
        assert!(upsert(&pool, "other", "{}").await.is_err());
    }
}
