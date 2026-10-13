//! The table `setting`.

use sqlx::SqlitePool;

use super::Setting;
use crate::error::Result;

pub async fn get(pool: &SqlitePool) -> Result<Option<Setting>> {
    let setting = sqlx::query_as!(Setting, "select language, theme from setting where id = 1")
        .fetch_optional(pool)
        .await?;
    Ok(setting)
}

pub async fn upsert(pool: &SqlitePool, setting: &Setting) -> Result<()> {
    sqlx::query!(
        r#"
            insert into setting (id, language, theme)
            values (1, $1, $2)
            on conflict (id) do update set
                language = excluded.language,
                theme = excluded.theme
        "#,
        setting.language,
        setting.theme
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
    async fn keeps_one_row() {
        let pool = db::memory_pool().await;
        assert_eq!(get(&pool).await.unwrap(), None);

        let mut setting = Setting {
            language: Some("de".to_owned()),
            theme: None,
        };
        upsert(&pool, &setting).await.unwrap();
        setting.theme = Some("one-light".to_owned());
        upsert(&pool, &setting).await.unwrap();

        assert_eq!(get(&pool).await.unwrap(), Some(setting));
        let rows = sqlx::query_scalar!("select count(*) from setting")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 1);
    }
}
