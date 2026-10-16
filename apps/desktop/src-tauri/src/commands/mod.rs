pub mod boxes;
pub mod movements;
pub mod parts;
pub mod projects;
pub mod settings;
pub mod welding;

pub use crate::error::CommandError;

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
    let bytes = value.as_bytes();
    if !value.is_ascii() || bytes.len() < 2 {
        return Err(CommandError::Validation(
            "盒位必须由字母行和数字列组成".into(),
        ));
    }
    let row = bytes[0];
    let column_text = &value[1..];
    if !row.is_ascii_uppercase() || !column_text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CommandError::Validation(
            "盒位必须由字母行和数字列组成".into(),
        ));
    }
    if column_text.len() > 1 && column_text.starts_with('0') {
        return Err(CommandError::Validation("盒位列不能包含前导零".into()));
    }
    let column = column_text
        .parse::<i64>()
        .map_err(|_| CommandError::Validation("盒位列必须是从 0 开始的数字".into()))?;
    let row_index = i64::from(row - b'A');
    if row_index >= rows || column < 0 || column >= cols {
        return Err(CommandError::Validation(format!(
            "盒位 {value} 超出收纳盒范围"
        )));
    }
    Ok(value)
}
