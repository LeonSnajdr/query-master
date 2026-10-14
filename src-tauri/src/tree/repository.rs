//! The table `tree_node`. "Below" a path means the path itself and every `path/…`; compared with
//! `substr`, not `like`, so names holding `%` or `_` match only themselves.

use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use super::TreeNode;
use crate::error::Result;

pub async fn list(pool: &SqlitePool, connection_id: Uuid) -> Result<Vec<TreeNode>> {
    let nodes = sqlx::query_as!(
        TreeNode,
        r#"
            select path, color, comment, readonly as "readonly: bool"
            from tree_node
            where connection_id = $1
            order by path
        "#,
        connection_id
    )
    .fetch_all(pool)
    .await?;
    Ok(nodes)
}

pub async fn upsert(pool: &SqlitePool, connection_id: Uuid, node: &TreeNode) -> Result<()> {
    sqlx::query!(
        r#"
            insert into tree_node (connection_id, path, color, comment, readonly)
            values ($1, $2, $3, $4, $5)
            on conflict (connection_id, path) do update
                set color = excluded.color, comment = excluded.comment, readonly = excluded.readonly
        "#,
        connection_id,
        node.path,
        node.color,
        node.comment,
        node.readonly
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, connection_id: Uuid, path: &str) -> Result<()> {
    sqlx::query!(
        "delete from tree_node where connection_id = $1 and path = $2",
        connection_id,
        path
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_below(
    connection: &mut SqliteConnection,
    connection_id: Uuid,
    path: &str,
) -> Result<()> {
    sqlx::query!(
        r#"
            delete from tree_node
            where connection_id = $1
              and (path = $2 or substr(path, 1, length($2) + 1) = $2 || '/')
        "#,
        connection_id,
        path
    )
    .execute(connection)
    .await?;
    Ok(())
}

pub async fn rename_below(
    connection: &mut SqliteConnection,
    connection_id: Uuid,
    from: &str,
    to: &str,
) -> Result<()> {
    sqlx::query!(
        r#"
            update tree_node
            set path = $3 || substr(path, length($2) + 1)
            where connection_id = $1
              and (path = $2 or substr(path, 1, length($2) + 1) = $2 || '/')
        "#,
        connection_id,
        from,
        to
    )
    .execute(connection)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{list as list_nodes, remove, rename, save};
    use super::*;
    use crate::db;
    use chrono::Utc;

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

    fn node(path: &str, color: Option<&str>, readonly: bool) -> TreeNode {
        TreeNode {
            path: path.into(),
            color: color.map(Into::into),
            comment: None,
            readonly,
        }
    }

    fn paths(nodes: &[TreeNode]) -> Vec<&str> {
        nodes.iter().map(|node| node.path.as_str()).collect()
    }

    #[tokio::test]
    async fn keeps_changes_and_forgets_empty_rows() {
        let pool = db::memory_pool().await;
        let id = connection(&pool).await;
        save(&pool, id, node("shop", Some("red"), false))
            .await
            .unwrap();
        save(&pool, id, node("shop", Some("blue"), true))
            .await
            .unwrap();
        assert_eq!(
            list_nodes(&pool, id).await.unwrap(),
            [node("shop", Some("blue"), true)]
        );

        // Blank text is no note; without any note the row goes.
        let mut blank = node("shop", Some("  "), false);
        blank.comment = Some(String::new());
        save(&pool, id, blank).await.unwrap();
        assert!(list_nodes(&pool, id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn renaming_and_dropping_take_what_lies_below() {
        let pool = db::memory_pool().await;
        let id = connection(&pool).await;
        for path in [
            "shop",
            "shop/orders",
            "shop/orders/2024",
            "shopping/x",
            "sh_p",
        ] {
            save(&pool, id, node(path, Some("red"), false))
                .await
                .unwrap();
        }
        rename(&pool, id, "shop/orders", "shop/sales")
            .await
            .unwrap();
        assert_eq!(
            paths(&list_nodes(&pool, id).await.unwrap()),
            [
                "sh_p",
                "shop",
                "shop/sales",
                "shop/sales/2024",
                "shopping/x"
            ]
        );

        // `shop` takes its collections, not `shopping`; `_` is no wildcard.
        remove(&pool, id, "shop").await.unwrap();
        assert_eq!(
            paths(&list_nodes(&pool, id).await.unwrap()),
            ["sh_p", "shopping/x"]
        );

        sqlx::query!("delete from connection where id = $1", id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(list_nodes(&pool, id).await.unwrap().is_empty());
    }
}
