//! The table `tree_node`. "Below" a path means the path itself and every `path/…`; compared with
//! `substr`, not `like`, so names holding `%` or `_` match only themselves.

use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use super::{TreeFolder, TreeNode};
use crate::error::Result;

pub async fn list(pool: &SqlitePool, connection_id: Uuid) -> Result<Vec<TreeNode>> {
    let nodes = sqlx::query_as!(
        TreeNode,
        r#"
            select path, color, comment, readonly as "readonly?: bool", folder
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
            insert into tree_node (connection_id, path, color, comment, readonly, folder)
            values ($1, $2, $3, $4, $5, $6)
            on conflict (connection_id, path) do update
                set color = excluded.color, comment = excluded.comment, readonly = excluded.readonly,
                    folder = excluded.folder
        "#,
        connection_id,
        node.path,
        node.color,
        node.comment,
        node.readonly,
        node.folder
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

pub async fn folders(pool: &SqlitePool, connection_id: Uuid) -> Result<Vec<TreeFolder>> {
    let folders = sqlx::query_as!(
        TreeFolder,
        r#"
            select database_name as database, name
            from tree_folder
            where connection_id = $1
            order by database_name, name
        "#,
        connection_id
    )
    .fetch_all(pool)
    .await?;
    Ok(folders)
}

pub async fn insert_folder(
    pool: &SqlitePool,
    connection_id: Uuid,
    folder: &TreeFolder,
) -> Result<()> {
    sqlx::query!(
        r#"
            insert into tree_folder (connection_id, database_name, name) values ($1, $2, $3)
            on conflict do nothing
        "#,
        connection_id,
        folder.database,
        folder.name
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn rename_folder(
    connection: &mut SqliteConnection,
    connection_id: Uuid,
    folder: &TreeFolder,
    name: &str,
) -> Result<()> {
    // Folders inside it (`a/b` below `a`) and what lies in them move along.
    sqlx::query!(
        r#"
            update tree_folder set name = $4 || substr(name, length($3) + 1)
            where connection_id = $1 and database_name = $2
                and (name = $3 or substr(name, 1, length($3) + 1) = $3 || '/')
        "#,
        connection_id,
        folder.database,
        folder.name,
        name
    )
    .execute(&mut *connection)
    .await?;
    sqlx::query!(
        r#"
            update tree_node set folder = $4 || substr(folder, length($3) + 1)
            where connection_id = $1
                and (folder = $3 or substr(folder, 1, length($3) + 1) = $3 || '/')
                and case when $2 = '' then path <> '' and instr(path, '/') = 0
                    else substr(path, 1, length($2) + 1) = $2 || '/' end
        "#,
        connection_id,
        folder.database,
        folder.name,
        name
    )
    .execute(connection)
    .await?;
    Ok(())
}

/// The folder goes with the folders inside it; what lay in them moves to the folder around it (or
/// out of all folders), and rows that note nothing else go too.
pub async fn delete_folder(
    connection: &mut SqliteConnection,
    connection_id: Uuid,
    folder: &TreeFolder,
) -> Result<()> {
    let parent = folder
        .name
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_owned());
    sqlx::query!(
        r#"
            delete from tree_folder
            where connection_id = $1 and database_name = $2
                and (name = $3 or substr(name, 1, length($3) + 1) = $3 || '/')
        "#,
        connection_id,
        folder.database,
        folder.name
    )
    .execute(&mut *connection)
    .await?;
    sqlx::query!(
        r#"
            update tree_node set folder = $4
            where connection_id = $1
                and (folder = $3 or substr(folder, 1, length($3) + 1) = $3 || '/')
                and case when $2 = '' then path <> '' and instr(path, '/') = 0
                    else substr(path, 1, length($2) + 1) = $2 || '/' end
        "#,
        connection_id,
        folder.database,
        folder.name,
        parent
    )
    .execute(&mut *connection)
    .await?;
    sqlx::query!(
        r#"
            delete from tree_node
            where connection_id = $1 and color is null and comment is null and readonly is null and folder is null
        "#,
        connection_id
    )
    .execute(connection)
    .await?;
    Ok(())
}

pub async fn delete_folders(
    connection: &mut SqliteConnection,
    connection_id: Uuid,
    database: &str,
) -> Result<()> {
    sqlx::query!(
        "delete from tree_folder where connection_id = $1 and database_name = $2",
        connection_id,
        database
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

    fn node(path: &str, color: Option<&str>, readonly: Option<bool>) -> TreeNode {
        TreeNode {
            path: path.into(),
            color: color.map(Into::into),
            comment: None,
            readonly,
            folder: None,
        }
    }

    fn paths(nodes: &[TreeNode]) -> Vec<&str> {
        nodes.iter().map(|node| node.path.as_str()).collect()
    }

    #[tokio::test]
    async fn keeps_changes_and_forgets_empty_rows() {
        let pool = db::memory_pool().await;
        let id = connection(&pool).await;
        save(&pool, id, node("shop", Some("red"), None))
            .await
            .unwrap();
        save(&pool, id, node("shop", Some("blue"), Some(true)))
            .await
            .unwrap();
        assert_eq!(
            list_nodes(&pool, id).await.unwrap(),
            [node("shop", Some("blue"), Some(true))]
        );

        // Writable below a read-only row is a note of its own.
        save(&pool, id, node("shop/orders", None, Some(false)))
            .await
            .unwrap();
        assert_eq!(
            list_nodes(&pool, id).await.unwrap(),
            [
                node("shop", Some("blue"), Some(true)),
                node("shop/orders", None, Some(false))
            ]
        );
        save(&pool, id, node("shop/orders", None, None))
            .await
            .unwrap();

        // Blank text is no note; without any note the row goes.
        let mut blank = node("shop", Some("  "), None);
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
            save(&pool, id, node(path, Some("red"), None))
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

    #[tokio::test]
    async fn folders_keep_their_collections_until_they_go() {
        use super::super::{add_folder, delete_folder, folders, rename_folder};
        let pool = db::memory_pool().await;
        let id = connection(&pool).await;
        let archive = TreeFolder {
            database: "shop".into(),
            name: "archive".into(),
        };
        add_folder(&pool, id, &archive).await.unwrap();
        // Adding it again changes nothing.
        add_folder(&pool, id, &archive).await.unwrap();
        let mut old = node("shop/orders_2023", None, None);
        old.folder = Some("archive".into());
        save(&pool, id, old).await.unwrap();
        let mut marked = node("shop/orders_2022", Some("red"), None);
        marked.folder = Some("archive".into());
        save(&pool, id, marked).await.unwrap();

        rename_folder(&pool, id, &archive, "old").await.unwrap();
        assert_eq!(
            folders(&pool, id).await.unwrap(),
            [TreeFolder {
                database: "shop".into(),
                name: "old".into()
            }]
        );
        let nodes = list_nodes(&pool, id).await.unwrap();
        assert!(nodes
            .iter()
            .all(|node| node.folder.as_deref() == Some("old")));

        // Gone: its collections are back in the database; one that notes nothing else is forgotten.
        let renamed = TreeFolder {
            database: "shop".into(),
            name: "old".into(),
        };
        delete_folder(&pool, id, &renamed).await.unwrap();
        assert!(folders(&pool, id).await.unwrap().is_empty());
        assert_eq!(
            list_nodes(&pool, id).await.unwrap(),
            [node("shop/orders_2022", Some("red"), None)]
        );

        // Dropping the database takes its folders along.
        add_folder(&pool, id, &archive).await.unwrap();
        remove(&pool, id, "shop").await.unwrap();
        assert!(folders(&pool, id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn folders_inside_folders_move_and_go_together() {
        use super::super::{add_folder, delete_folder, folders, rename_folder};
        let pool = db::memory_pool().await;
        let id = connection(&pool).await;
        let folder = |name: &str| TreeFolder {
            database: "shop".into(),
            name: name.into(),
        };
        for name in ["reports", "reports/2024", "reports/2024/q1", "reportsx"] {
            add_folder(&pool, id, &folder(name)).await.unwrap();
        }
        let mut sales = node("shop/sales", None, None);
        sales.folder = Some("reports/2024/q1".into());
        save(&pool, id, sales).await.unwrap();
        let mut costs = node("shop/costs", Some("red"), None);
        costs.folder = Some("reports/2024".into());
        save(&pool, id, costs).await.unwrap();
        let mut other = node("shop/other", None, None);
        other.folder = Some("reportsx".into());
        save(&pool, id, other).await.unwrap();
        let folder_of = |nodes: &[TreeNode], path: &str| {
            nodes
                .iter()
                .find(|node| node.path == path)
                .and_then(|node| node.folder.clone())
        };

        // Moving `reports/2024` into `reportsx` takes `q1` and the collections along.
        rename_folder(&pool, id, &folder("reports/2024"), "reportsx/2024")
            .await
            .unwrap();
        let names: Vec<String> = folders(&pool, id)
            .await
            .unwrap()
            .into_iter()
            .map(|folder| folder.name)
            .collect();
        assert_eq!(
            names,
            ["reports", "reportsx", "reportsx/2024", "reportsx/2024/q1"]
        );
        let nodes = list_nodes(&pool, id).await.unwrap();
        assert_eq!(
            folder_of(&nodes, "shop/sales").as_deref(),
            Some("reportsx/2024/q1")
        );
        assert_eq!(
            folder_of(&nodes, "shop/costs").as_deref(),
            Some("reportsx/2024")
        );
        assert_eq!(folder_of(&nodes, "shop/other").as_deref(), Some("reportsx"));

        // Deleting `reportsx/2024` puts what lay in it and below into `reportsx`.
        delete_folder(&pool, id, &folder("reportsx/2024"))
            .await
            .unwrap();
        let names: Vec<String> = folders(&pool, id)
            .await
            .unwrap()
            .into_iter()
            .map(|folder| folder.name)
            .collect();
        assert_eq!(names, ["reports", "reportsx"]);
        let nodes = list_nodes(&pool, id).await.unwrap();
        for path in ["shop/sales", "shop/costs", "shop/other"] {
            assert_eq!(folder_of(&nodes, path).as_deref(), Some("reportsx"));
        }
    }

    #[tokio::test]
    async fn folders_of_the_connection_hold_databases_only() {
        use super::super::{add_folder, delete_folder, rename_folder};
        let pool = db::memory_pool().await;
        let id = connection(&pool).await;
        let top = TreeFolder {
            database: String::new(),
            name: "work".into(),
        };
        add_folder(&pool, id, &top).await.unwrap();
        let mut shop = node("shop", None, None);
        shop.folder = Some("work".into());
        save(&pool, id, shop).await.unwrap();
        // A collection in a folder of the same name inside a database is another folder.
        let mut orders = node("shop/orders", None, None);
        orders.folder = Some("work".into());
        save(&pool, id, orders).await.unwrap();

        rename_folder(&pool, id, &top, "jobs").await.unwrap();
        let folder_of = |nodes: &[TreeNode], path: &str| {
            nodes
                .iter()
                .find(|node| node.path == path)
                .and_then(|node| node.folder.clone())
        };
        let nodes = list_nodes(&pool, id).await.unwrap();
        assert_eq!(folder_of(&nodes, "shop").as_deref(), Some("jobs"));
        assert_eq!(folder_of(&nodes, "shop/orders").as_deref(), Some("work"));

        let renamed = TreeFolder {
            database: String::new(),
            name: "jobs".into(),
        };
        delete_folder(&pool, id, &renamed).await.unwrap();
        assert_eq!(
            paths(&list_nodes(&pool, id).await.unwrap()),
            ["shop/orders"]
        );
    }
}
