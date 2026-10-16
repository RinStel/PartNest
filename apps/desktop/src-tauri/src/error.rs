//! Shared application errors, serialized by the command boundary.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "code", content = "message")]
pub enum CommandError {
    Validation(String),
    NotFound(String),
    Conflict,
    Constraint(String),
    Database(String),
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation(message)
            | Self::NotFound(message)
            | Self::Constraint(message)
            | Self::Database(message) => formatter.write_str(message),
            Self::Conflict => formatter.write_str("数据已被其他操作修改，请刷新后重试"),
        }
    }
}

impl std::error::Error for CommandError {}

impl From<rusqlite::Error> for CommandError {
    fn from(error: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(failure, _) = &error {
            if failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
                || failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
            {
                return Self::Constraint("记录已存在".into());
            }
        }
        Self::Database(error.to_string())
    }
}

impl From<crate::backup::BackupError> for CommandError {
    fn from(error: crate::backup::BackupError) -> Self {
        match error {
            crate::backup::BackupError::Invalid(message) => Self::Validation(message),
            error @ crate::backup::BackupError::SchemaTooNew { .. } => {
                Self::Validation(error.to_string())
            }
            error @ crate::backup::BackupError::FatalRecovery { .. } => {
                Self::Database(error.to_string())
            }
            crate::backup::BackupError::Io(error) => Self::Database(error.to_string()),
            crate::backup::BackupError::Sqlite(error) => Self::Database(error.to_string()),
        }
    }
}
