//! What the app keeps on this machine lies in one SQLite file. The pool is opened once at start
//! and handed to commands as Tauri state (`State<'_, SqlitePool>`); tables come from the files in
//! `migrations`, and queries are checked against them at compile time (`.sqlx`).

use std::fs::create_dir_all;
use std::path::PathBuf;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, Runtime};

/// A desktop app has one user: a few connections are plenty, and SQLite has one writer anyway.
const MAX_CONNECTIONS: u32 = 4;
/// How long a write waits for another one to finish before it fails.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// While developing, the database the queries are compiled against (`DATABASE_URL` in `.env`);
/// otherwise `querymaster.db` in the app's data folder.
fn database_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        // Absolute, so it does not depend on the folder the app was started from.
        return Ok(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/dev.db"
        )));
    }
    let directory = app.path().app_data_dir()?;
    create_dir_all(&directory)?;
    Ok(directory.join("querymaster.db"))
}

fn options() -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .create_if_missing(true)
        // SQLite does not enforce foreign keys unless asked to, per connection.
        .foreign_keys(true)
        // Readers do not block the writer and the other way round.
        .journal_mode(SqliteJournalMode::Wal)
        // Safe with WAL, and spares a sync per transaction.
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(BUSY_TIMEOUT)
}

/// Opens the database and brings its tables up to date.
pub async fn open<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let pool = SqlitePoolOptions::new()
        .max_connections(MAX_CONNECTIONS)
        .connect_with(options().filename(database_path(app)?))
        .await?;
    // Embedded at compile time: the app carries its migrations and applies those not yet run.
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}

/// For tests: a database in memory with all migrations applied.
#[cfg(test)]
pub async fn memory_pool() -> SqlitePool {
    // One connection: every connection to `:memory:` would be a database of its own.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .in_memory(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    pool
}
