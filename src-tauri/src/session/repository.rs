//! The table `session_tab`.

use sqlx::SqlitePool;
use uuid::Uuid;

use super::SessionTab;
use crate::error::{Error, Result};

pub async fn load(pool: &SqlitePool) -> Result<Vec<SessionTab>> {
    let rows = sqlx::query!(
        r#"
            select active as "active!: bool", connection_id as "connection_id: Uuid", content
            from session_tab
            order by position
        "#
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(SessionTab {
                active: row.active,
                connection_id: row.connection_id,
                content: serde_json::from_str(&row.content)
                    .map_err(|error| Error::ExtendedJson(error.to_string()))?,
            })
        })
        .collect()
}

/// All or nothing: a session is never half the old one and half the new.
pub async fn replace(pool: &SqlitePool, tabs: &[SessionTab]) -> Result<()> {
    let mut transaction = pool.begin().await?;
    sqlx::query!("delete from session_tab")
        .execute(&mut *transaction)
        .await?;
    for (position, tab) in tabs.iter().enumerate() {
        let position = position as i64;
        let content = tab.content.to_string();
        sqlx::query!(
            "insert into session_tab (position, active, connection_id, content) values ($1, $2, $3, $4)",
            position,
            tab.active,
            tab.connection_id,
            content
        )
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::Utc;
    use serde_json::json;

    #[tokio::test]
    async fn replaces_the_whole_session_and_drops_tabs_of_deleted_connections() {
        let pool = db::memory_pool().await;
        let id = Uuid::new_v4();
        let now = Utc::now();
        sqlx::query!(
            "insert into connection (id, name, address, date_created) values ($1, 'c', 'a', $2)",
            id,
            now
        )
        .execute(&pool)
        .await
        .unwrap();
        let shell = SessionTab {
            active: true,
            connection_id: Some(id),
            content: json!({ "kind": "shell", "text": "db.orders.find({})" }),
        };
        let start = SessionTab {
            active: false,
            connection_id: None,
            content: json!({ "kind": "start" }),
        };
        replace(&pool, &[start.clone(), shell.clone()])
            .await
            .unwrap();
        assert_eq!(load(&pool).await.unwrap(), [start.clone(), shell.clone()]);

        replace(&pool, std::slice::from_ref(&shell)).await.unwrap();
        assert_eq!(load(&pool).await.unwrap(), [shell]);

        sqlx::query!("delete from connection where id = $1", id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(load(&pool).await.unwrap().is_empty());
    }
}
