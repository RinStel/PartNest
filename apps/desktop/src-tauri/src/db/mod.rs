//! SQLite connection and migration layer.

mod models;

pub use models::{new_id, utc_now, BoxRecord, PartRecord};
use rusqlite::{Connection, Result, Transaction, TransactionBehavior};
use std::path::Path;

const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");

/// An opened PartNest database connection.
pub struct Database {
    connection: Connection,
}

impl Database {
    /// Open a database file, configure SQLite, and apply all pending migrations.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;",
        )?;

        let mut database = Self { connection };
        database.apply_migrations()?;
        Ok(database)
    }

    /// Borrow the underlying connection for commands and read-only queries.
    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// Start a transaction for an operation spanning multiple statements.
    pub fn transaction(&self) -> Result<Transaction<'_>> {
        self.connection.unchecked_transaction()
    }

    fn apply_migrations(&mut self) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Exclusive)?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )?;

        let applied: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 1)",
            [],
            |row| row.get(0),
        )?;
        if !applied {
            transaction.execute_batch(INITIAL_MIGRATION)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
                [models::utc_now()],
            )?;
        }
        transaction.commit()
    }
}
