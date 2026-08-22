pub mod boxes;
pub mod parts;

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

pub(crate) fn lock_error<T>(_: std::sync::PoisonError<T>) -> CommandError {
    CommandError::Database("数据库锁不可用".into())
}

pub(crate) fn optional_text(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

pub(crate) fn validate_name(name: &str, kind: &str) -> Result<String, CommandError> {
    let value = name.trim();
    if value.is_empty() {
        return Err(CommandError::Validation(format!("{kind}名称不能为空")));
    }
    Ok(value.to_string())
}

pub(crate) fn normalize_slot(slot: &str, rows: i64, cols: i64) -> Result<String, CommandError> {
    let value = slot.trim().to_ascii_uppercase();
    let mut chars = value.chars();
    let row = chars
        .next()
        .ok_or_else(|| CommandError::Validation("盒位不能为空".into()))?;
    if !row.is_ascii_uppercase() || chars.clone().next().is_none() {
        return Err(CommandError::Validation(
            "盒位必须由字母行和数字列组成".into(),
        ));
    }
    let column = chars
        .as_str()
        .parse::<i64>()
        .map_err(|_| CommandError::Validation("盒位列必须是从 0 开始的数字".into()))?;
    let row_index = i64::from(row as u8 - b'A');
    if row_index >= rows || column < 0 || column >= cols {
        return Err(CommandError::Validation(format!(
            "盒位 {value} 超出收纳盒范围"
        )));
    }
    Ok(value)
}
