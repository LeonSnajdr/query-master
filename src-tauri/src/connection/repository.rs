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
                visible_databases,
                group_name,
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
            insert into connection (id, name, address, environment, visible_databases, group_name, date_created, date_last_used)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict (id) do update set
                name = excluded.name,
                address = excluded.address,
                environment = excluded.environment,
                visible_databases = excluded.visible_databases,
                group_name = excluded.group_name
        "#,
        connection.id,
        connection.name,
        connection.address,
        connection.environment,
        connection.visible_databases,
        connection.group_name,
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

pub async fn set_group(pool: &SqlitePool, id: Uuid, group: &str) -> Result<()> {
    sqlx::query!(
        "update connection set group_name = $2 where id = $1",
        id,
        group
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Every folder of the connections: those kept in `connection_folder` and those connections name.
pub async fn folders(pool: &SqlitePool) -> Result<Vec<String>> {
    let names = sqlx::query_scalar!(
        r#"
            select name as "name!" from connection_folder
            union
            select group_name as "name!" from connection where group_name <> ''
            order by 1
        "#
    )
    .fetch_all(pool)
    .await?;
    Ok(names)
}

pub async fn add_folder(pool: &SqlitePool, name: &str) -> Result<()> {
    sqlx::query!(
        "insert or ignore into connection_folder (name) values ($1)",
        name
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Gives the folder `from` and all folders in it the path `to` instead, with their connections.
/// `to` empty takes the folder away: what lay in it lies one level up then.
pub async fn move_folder(pool: &SqlitePool, from: &str, to: &str) -> Result<()> {
    let mut transaction = pool.begin().await?;
    // `from/x` becomes `to/x`, or `x` when the folder goes; `from` itself becomes `to`.
    sqlx::query!(
        r#"
            update connection
            set group_name = case
                when group_name = $1 then $2
                when $2 = '' then substr(group_name, length($1) + 2)
                else $2 || substr(group_name, length($1) + 1)
            end
            where group_name = $1 or substr(group_name, 1, length($1) + 1) = $1 || '/'
        "#,
        from,
        to
    )
    .execute(&mut *transaction)
    .await?;
    let inside = sqlx::query_scalar!(
        r#"
            select name as "name!" from connection_folder
            where name = $1 or substr(name, 1, length($1) + 1) = $1 || '/'
        "#,
        from
    )
    .fetch_all(&mut *transaction)
    .await?;
    for name in inside {
        sqlx::query!("delete from connection_folder where name = $1", name)
            .execute(&mut *transaction)
            .await?;
        let moved = if name == from {
            to.to_string()
        } else if to.is_empty() {
            name[from.len() + 1..].to_string()
        } else {
            format!("{to}{}", &name[from.len()..])
        };
        if !moved.is_empty() {
            sqlx::query!(
                "insert or ignore into connection_folder (name) values ($1)",
                moved
            )
            .execute(&mut *transaction)
            .await?;
        }
    }
    transaction.commit().await?;
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
            visible_databases: String::new(),
            group_name: String::new(),
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
    async fn keeps_the_group_until_moved() {
        let pool = db::memory_pool().await;
        let atlas = connection("Atlas");
        upsert(&pool, &atlas).await.unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].group_name, "");
        set_group(&pool, atlas.id, "Kunden").await.unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].group_name, "Kunden");
        // Saving the connection again keeps what the dialog sends.
        upsert(
            &pool,
            &Connection {
                group_name: "Intern".into(),
                ..atlas.clone()
            },
        )
        .await
        .unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].group_name, "Intern");
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

    /// The folder of each connection, by name, sorted.
    async fn groups(pool: &SqlitePool) -> Vec<(String, String)> {
        let mut pairs: Vec<_> = list(pool)
            .await
            .unwrap()
            .into_iter()
            .map(|connection| (connection.name, connection.group_name))
            .collect();
        pairs.sort();
        pairs
    }

    #[tokio::test]
    async fn keeps_empty_and_nested_folders_and_moves_their_connections() {
        use crate::connection::{add_folder, delete_folder, folders as all, rename_folder};
        let pool = db::memory_pool().await;
        let prod = Connection {
            group_name: "Kunden/Produktion".into(),
            ..connection("Prod")
        };
        let test = Connection {
            group_name: "Kunden".into(),
            ..connection("Test")
        };
        upsert(&pool, &prod).await.unwrap();
        upsert(&pool, &test).await.unwrap();
        // Parts are trimmed; an empty folder stays; a connection's folder needs no row.
        add_folder(&pool, " Intern / ").await.unwrap();
        assert!(add_folder(&pool, " / ").await.is_err());
        assert_eq!(all(&pool).await.unwrap(), ["Intern", "Kunden", "Kunden/Produktion"]);

        // Renaming takes the folders and connections inside along.
        rename_folder(&pool, "Kunden", "Partner").await.unwrap();
        assert_eq!(
            groups(&pool).await,
            [("Prod".into(), "Partner/Produktion".into()), ("Test".into(), "Partner".into())]
        );
        assert!(rename_folder(&pool, "Partner", "Partner/Neu").await.is_err());
        // Moving a folder into another is renaming it with the whole path.
        rename_folder(&pool, "Partner/Produktion", "Intern/Produktion").await.unwrap();
        assert_eq!(groups(&pool).await[0], ("Prod".into(), "Intern/Produktion".into()));

        // Deleting puts what lay in it one level up; nothing is lost.
        delete_folder(&pool, "Intern/Produktion").await.unwrap();
        assert_eq!(groups(&pool).await[0], ("Prod".into(), "Intern".into()));
        delete_folder(&pool, "Intern").await.unwrap();
        assert_eq!(
            groups(&pool).await,
            [("Prod".into(), String::new()), ("Test".into(), "Partner".into())]
        );
        assert_eq!(all(&pool).await.unwrap(), ["Partner"]);
    }
}
