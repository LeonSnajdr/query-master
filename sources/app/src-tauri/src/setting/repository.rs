//! The table `setting`.

use sqlx::SqlitePool;

use super::Setting;
use crate::error::Result;

pub async fn get(pool: &SqlitePool) -> Result<Option<Setting>> {
    let setting = sqlx::query_as!(
        Setting,
        r#"
            select language, theme, page_size, result_view, editor_font_size, startup, default_tab, time_zone,
                date_format, legacy_uuid, auto_expand, json_view,
                number_grouping as "number_grouping: bool", type_colors as "type_colors: bool",
                tab_width, auto_close as "auto_close: bool"
            from setting where id = 1
        "#
    )
    .fetch_optional(pool)
    .await?;
    Ok(setting)
}

pub async fn upsert(pool: &SqlitePool, setting: &Setting) -> Result<()> {
    sqlx::query!(
        r#"
            insert into setting (id, language, theme, page_size, result_view, editor_font_size, startup, default_tab, time_zone,
                date_format, legacy_uuid, auto_expand, json_view, number_grouping, type_colors, tab_width, auto_close)
            values (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            on conflict (id) do update set
                language = excluded.language,
                theme = excluded.theme,
                page_size = excluded.page_size,
                result_view = excluded.result_view,
                editor_font_size = excluded.editor_font_size,
                startup = excluded.startup,
                default_tab = excluded.default_tab,
                time_zone = excluded.time_zone,
                date_format = excluded.date_format,
                legacy_uuid = excluded.legacy_uuid,
                auto_expand = excluded.auto_expand,
                json_view = excluded.json_view,
                number_grouping = excluded.number_grouping,
                type_colors = excluded.type_colors,
                tab_width = excluded.tab_width,
                auto_close = excluded.auto_close
        "#,
        setting.language,
        setting.theme,
        setting.page_size,
        setting.result_view,
        setting.editor_font_size,
        setting.startup,
        setting.default_tab,
        setting.time_zone,
        setting.date_format,
        setting.legacy_uuid,
        setting.auto_expand,
        setting.json_view,
        setting.number_grouping,
        setting.type_colors,
        setting.tab_width,
        setting.auto_close
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
            ..Setting::default()
        };
        upsert(&pool, &setting).await.unwrap();
        setting.theme = Some("one-light".to_owned());
        setting.page_size = Some(50);
        setting.result_view = Some("table".to_owned());
        setting.date_format = Some("dmy".to_owned());
        setting.type_colors = Some(false);
        setting.tab_width = Some(2);
        setting.editor_font_size = Some(15);
        upsert(&pool, &setting).await.unwrap();

        assert_eq!(get(&pool).await.unwrap(), Some(setting));
        let rows = sqlx::query_scalar!("select count(*) from setting")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[tokio::test]
    async fn refuses_values_the_app_can_not_use() {
        let pool = db::memory_pool().await;
        let setting = Setting {
            result_view: Some("chart".to_owned()),
            ..Setting::default()
        };
        assert!(upsert(&pool, &setting).await.is_err());
    }
}
