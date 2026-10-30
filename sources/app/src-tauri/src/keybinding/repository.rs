//! The table `keybinding`.

use sqlx::SqlitePool;

use crate::error::Result;

/// Command id and its keys as JSON text.
pub async fn list(pool: &SqlitePool) -> Result<Vec<(String, String)>> {
    let rows = sqlx::query!("select command_id, keys from keybinding order by command_id")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.command_id, row.keys))
        .collect())
}

/// Several commands at once (an assignment that takes a key from another, an import): all or none.
/// `None` deletes the row, so the command has its default again.
pub async fn save(pool: &SqlitePool, rows: &[(&str, Option<String>)]) -> Result<()> {
    let mut transaction = pool.begin().await?;
    for (command_id, keys) in rows {
        match keys {
            Some(keys) => {
                sqlx::query!(
                    r#"
                        insert into keybinding (command_id, keys) values ($1, $2)
                        on conflict (command_id) do update set keys = excluded.keys
                    "#,
                    command_id,
                    keys
                )
                .execute(&mut *transaction)
                .await?;
            }
            None => {
                sqlx::query!("delete from keybinding where command_id = $1", command_id)
                    .execute(&mut *transaction)
                    .await?;
            }
        }
    }
    transaction.commit().await?;
    Ok(())
}

pub async fn clear(pool: &SqlitePool) -> Result<()> {
    sqlx::query!("delete from keybinding").execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn pair(id: &str, keys: &str) -> (String, String) {
        (id.to_owned(), keys.to_owned())
    }

    #[tokio::test]
    async fn keeps_what_differs_and_forgets_the_rest() {
        let pool = db::memory_pool().await;
        assert!(list(&pool).await.unwrap().is_empty());

        save(
            &pool,
            &[
                ("tab.browse", Some(r#"["ctrl+b"]"#.to_owned())),
                ("tab.sql", Some("[]".to_owned())),
            ],
        )
        .await
        .unwrap();
        save(
            &pool,
            &[
                ("tab.browse", Some(r#"["ctrl+b","f9"]"#.to_owned())),
                ("tab.sql", None),
            ],
        )
        .await
        .unwrap();
        assert_eq!(
            list(&pool).await.unwrap(),
            vec![pair("tab.browse", r#"["ctrl+b","f9"]"#)]
        );

        clear(&pool).await.unwrap();
        assert!(list(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn writes_all_or_nothing_and_only_short_arrays() {
        let pool = db::memory_pool().await;
        let too_many = Some(r#"["a","b","c"]"#.to_owned());
        assert!(save(
            &pool,
            &[("tab.browse", Some("[]".to_owned())), ("tab.sql", too_many)]
        )
        .await
        .is_err());
        assert!(list(&pool).await.unwrap().is_empty());
        assert!(save(&pool, &[("tab.sql", Some(r#"{"a":1}"#.to_owned()))])
            .await
            .is_err());
        assert!(save(&pool, &[("tab.sql", Some("not json".to_owned()))])
            .await
            .is_err());
    }
}
