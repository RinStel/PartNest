//! Consistent SQLite backups and destructive restore support.

use crate::db::{new_id, Database};
use rusqlite::{Connection, OpenFlags, MAIN_DB};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tempfile::Builder;

pub const CURRENT_SCHEMA_VERSION: i64 = 2;
pub const MAX_BACKUPS: usize = 10;
pub const STARTUP_BACKUP_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug)]
pub enum BackupError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    Invalid(String),
    SchemaTooNew { found: i64, current: i64 },
}

impl fmt::Display for BackupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "备份文件操作失败: {error}"),
            Self::Sqlite(error) => write!(formatter, "SQLite 备份失败: {error}"),
            Self::Invalid(message) => formatter.write_str(message),
            Self::SchemaTooNew { found, current } => write!(
                formatter,
                "备份数据库版本 {found} 高于当前应用支持的版本 {current}"
            ),
        }
    }
}

impl std::error::Error for BackupError {}

impl From<std::io::Error> for BackupError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for BackupError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupMetadata {
    pub schema_version: i64,
}

pub fn backup_dir(app_data_dir: impl AsRef<Path>) -> PathBuf {
    app_data_dir.as_ref().join("backups")
}

/// Validate a backup without opening it for writing or applying migrations.
pub fn validate_backup(path: impl AsRef<Path>) -> Result<BackupMetadata, BackupError> {
    let path = path.as_ref();
    if !path.is_file() {
        return Err(BackupError::Invalid("备份文件不存在".into()));
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )?;
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(BackupError::Invalid(format!(
            "备份完整性检查失败: {integrity}"
        )));
    }
    let has_schema_migrations: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations')",
        [],
        |row| row.get(0),
    )?;
    if !has_schema_migrations {
        return Err(BackupError::Invalid("备份缺少 schema_migrations".into()));
    }
    let schema_version: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if schema_version > CURRENT_SCHEMA_VERSION {
        return Err(BackupError::SchemaTooNew {
            found: schema_version,
            current: CURRENT_SCHEMA_VERSION,
        });
    }
    Ok(BackupMetadata { schema_version })
}

fn backup_filename() -> String {
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    format!("partnest-{timestamp}-{}.db", new_id())
}

fn is_managed_backup(path: &Path) -> bool {
    path.is_file()
        && path.extension().is_some_and(|extension| extension == "db")
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("partnest-") && name.ends_with(".db"))
}

fn modified_time(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(UNIX_EPOCH)
}

fn valid_backups(dir: &Path) -> Result<Vec<(PathBuf, SystemTime)>, BackupError> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if is_managed_backup(&path) && validate_backup(&path).is_ok() {
            paths.push((path.clone(), modified_time(&path)));
        }
    }
    paths.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| right.0.cmp(&left.0)));
    Ok(paths)
}

fn rotate_backups(dir: &Path) -> Result<(), BackupError> {
    let paths = valid_backups(dir)?;
    for (path, _) in paths.into_iter().skip(MAX_BACKUPS) {
        // Only files that passed validate_backup above are ever removed. Invalid
        // files are intentionally left in place for forensic inspection.
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Create a WAL-consistent backup in `backup_directory` and retain ten valid files.
pub fn create_backup(
    database: &Database,
    backup_directory: impl AsRef<Path>,
) -> Result<PathBuf, BackupError> {
    let backup_directory = backup_directory.as_ref();
    fs::create_dir_all(backup_directory)?;
    let temporary = Builder::new()
        .prefix(".partnest-backup-")
        .suffix(".tmp")
        .tempfile_in(backup_directory)?
        .into_temp_path();

    database
        .connection()
        .backup(MAIN_DB, &temporary, None)
        .map_err(BackupError::Sqlite)?;
    validate_backup(&temporary)?;

    let destination = backup_directory.join(backup_filename());
    fs::rename(&temporary, &destination)?;
    rotate_backups(backup_directory)?;
    Ok(destination)
}

fn latest_valid_backup(dir: &Path) -> Result<Option<(PathBuf, SystemTime)>, BackupError> {
    Ok(valid_backups(dir)?.into_iter().next())
}

/// Create a startup backup only when no valid backup exists or the latest one is old.
pub fn maybe_create_startup_backup(
    database: &Database,
    app_data_directory: impl AsRef<Path>,
) -> Result<Option<PathBuf>, BackupError> {
    let directory = backup_dir(app_data_directory);
    let now = SystemTime::now();
    let needs_backup = latest_valid_backup(&directory)?.is_none_or(|(_, modified)| {
        now.duration_since(modified)
            .map_or(true, |age| age >= STARTUP_BACKUP_AGE)
    });
    needs_backup
        .then(|| create_backup(database, directory))
        .transpose()
}

fn copy_database(source: &Path, destination: &Path) -> Result<(), BackupError> {
    let source_connection = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )?;
    source_connection.backup(MAIN_DB, destination, None)?;
    Ok(())
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|value| value.to_os_string())
        .unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

fn move_if_exists(source: &Path, destination: &Path) -> Result<bool, BackupError> {
    if source.exists() {
        fs::rename(source, destination)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn reopen_database(database: &mut Database, live_path: &Path) -> Result<(), BackupError> {
    let reopened = Database::open(live_path).map_err(BackupError::Sqlite)?;
    let old_placeholder = database.replace_connection(reopened.into_connection());
    drop(old_placeholder);
    Ok(())
}

struct RestorePaths {
    live_path: PathBuf,
    previous_path: PathBuf,
    live_wal: PathBuf,
    previous_wal: PathBuf,
    live_shm: PathBuf,
    previous_shm: PathBuf,
}

impl RestorePaths {
    fn rollback(&self, moved_live: bool, moved_wal: bool, moved_shm: bool) {
        let _ = fs::remove_file(&self.live_path);
        if moved_live {
            let _ = fs::rename(&self.previous_path, &self.live_path);
        }
        if moved_wal {
            let _ = fs::rename(&self.previous_wal, &self.live_wal);
        }
        if moved_shm {
            let _ = fs::rename(&self.previous_shm, &self.live_shm);
        }
    }
}

/// Replace an open live database after validating a selected backup.
pub fn restore_database_file(
    database: &mut Database,
    selected_backup: impl AsRef<Path>,
) -> Result<(), BackupError> {
    let selected_backup = selected_backup.as_ref();
    let selected_canonical = fs::canonicalize(selected_backup)
        .map_err(|_| BackupError::Invalid("备份文件不存在".into()))?;
    let live_path = database.path().to_path_buf();
    if live_path.exists() && fs::canonicalize(&live_path).ok().as_ref() == Some(&selected_canonical)
    {
        return Err(BackupError::Invalid("不能从当前数据库文件恢复".into()));
    }
    validate_backup(&selected_canonical)?;

    let parent = live_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = Builder::new()
        .prefix(".partnest-restore-")
        .suffix(".tmp")
        .tempfile_in(parent)?
        .into_temp_path();
    copy_database(&selected_canonical, &temporary)?;
    validate_backup(&temporary)?;

    database
        .connection()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    let placeholder = Connection::open_in_memory()?;
    let old_connection = database.replace_connection(placeholder);
    drop(old_connection);

    let previous_path = parent.join(format!(".partnest-previous-{}.db", new_id()));
    let previous_wal = sidecar(&previous_path, "-wal");
    let previous_shm = sidecar(&previous_path, "-shm");
    let live_wal = sidecar(&live_path, "-wal");
    let live_shm = sidecar(&live_path, "-shm");
    let restore_paths = RestorePaths {
        live_path: live_path.clone(),
        previous_path: previous_path.clone(),
        live_wal: live_wal.clone(),
        previous_wal: previous_wal.clone(),
        live_shm: live_shm.clone(),
        previous_shm: previous_shm.clone(),
    };
    let moved_live = match move_if_exists(&live_path, &previous_path) {
        Ok(moved) => moved,
        Err(error) => {
            reopen_database(database, &live_path)?;
            return Err(error);
        }
    };
    let moved_wal = match move_if_exists(&live_wal, &previous_wal) {
        Ok(moved) => moved,
        Err(error) => {
            restore_paths.rollback(moved_live, false, false);
            reopen_database(database, &live_path)?;
            return Err(error);
        }
    };
    let moved_shm = match move_if_exists(&live_shm, &previous_shm) {
        Ok(moved) => moved,
        Err(error) => {
            restore_paths.rollback(moved_live, moved_wal, false);
            reopen_database(database, &live_path)?;
            return Err(error);
        }
    };

    let replacement_result = fs::rename(&temporary, &live_path)
        .map_err(BackupError::Io)
        .and_then(|_| Database::open(&live_path).map_err(BackupError::Sqlite));
    match replacement_result {
        Ok(restored) => {
            let old_placeholder = database.replace_connection(restored.into_connection());
            drop(old_placeholder);
            let _ = fs::remove_file(&previous_path);
            if moved_wal {
                let _ = fs::remove_file(&previous_wal);
            }
            if moved_shm {
                let _ = fs::remove_file(&previous_shm);
            }
            Ok(())
        }
        Err(error) => {
            restore_paths.rollback(moved_live, moved_wal, moved_shm);
            reopen_database(database, &live_path)?;
            Err(error)
        }
    }
}
