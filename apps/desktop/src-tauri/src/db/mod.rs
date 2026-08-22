//! SQLite connection and migration layer.

mod models;
pub mod welding_repository;

pub use models::{new_id, utc_now, BoxRecord, PartRecord};
use rusqlite::{Connection, Result, Transaction, TransactionBehavior};
use std::path::{Path, PathBuf};

const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");
const WELDING_MOVEMENT_METADATA_MIGRATION: &str =
    include_str!("../../migrations/0002_welding_movement_metadata.sql");

/// A versioned SQL migration. Migrations are applied in one exclusive transaction.
#[derive(Debug, Clone, Copy)]
pub struct Migration<'a> {
    pub version: i64,
    pub sql: &'a str,
}

/// An opened PartNest database connection.
pub struct Database {
    connection: Connection,
    path: PathBuf,
}

impl Database {
    /// Open a database file, configure SQLite, and apply all pending migrations.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let connection = Connection::open(&path)?;
        let mut database = Self { connection, path };
        database.configure()?;
        database.apply_migrations(&[
            Migration {
                version: 1,
                sql: INITIAL_MIGRATION,
            },
            Migration {
                version: 2,
                sql: WELDING_MOVEMENT_METADATA_MIGRATION,
            },
        ])?;
        Ok(database)
    }

    /// Open `partnest.db` below an application data directory, creating it when needed.
    pub fn open_app_data_dir(app_data_dir: impl AsRef<Path>) -> Result<Self> {
        std::fs::create_dir_all(app_data_dir.as_ref())
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        Self::open(app_data_dir.as_ref().join("partnest.db"))
    }

    /// Open a database with an explicit migration list for deterministic migration tests.
    pub fn open_with_migrations(
        path: impl AsRef<Path>,
        migrations: &[Migration<'_>],
    ) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let connection = Connection::open(&path)?;
        let mut database = Self { connection, path };
        database.configure()?;
        database.apply_migrations(migrations)?;
        Ok(database)
    }

    /// Borrow the underlying connection for commands and read-only queries.
    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// Return the database file path used by this connection.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Replace the connection and path together when recovery moves the
    /// database to a preserved path.
    pub(crate) fn replace_database(&mut self, database: Database) -> Database {
        std::mem::replace(self, database)
    }

    /// Start a transaction for an operation spanning multiple statements.
    pub fn transaction(&self) -> Result<Transaction<'_>> {
        self.connection.unchecked_transaction()
    }

    fn configure(&self) -> Result<()> {
        self.connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;",
        )
    }

    fn apply_migrations(&mut self, migrations: &[Migration<'_>]) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Exclusive)?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )?;

        for migration in migrations {
            let applied: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                [migration.version],
                |row| row.get(0),
            )?;
            if !applied {
                transaction.execute_batch(migration.sql)?;
                transaction.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                    (migration.version, models::utc_now()),
                )?;
            }
        }
        transaction.commit()
    }
}
