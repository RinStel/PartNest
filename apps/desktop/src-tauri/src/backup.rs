//! Consistent SQLite backups and failure-safe destructive restore support.

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
    FatalRecovery { primary: String, recovery: String },
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
            Self::FatalRecovery { primary, recovery } => write!(
                formatter,
                "数据库恢复失败，原始文件已保留但需要人工处理。原始错误: {primary}；回滚错误: {recovery}"
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

fn normalized_sql(sql: &str) -> String {
    sql.to_ascii_lowercase()
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .collect()
}

fn table_columns(
    connection: &Connection,
    table: &str,
) -> Result<std::collections::HashSet<String>, BackupError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info('{table}')"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<std::collections::HashSet<_>>>()?;
    Ok(columns)
}

fn require_table(
    connection: &Connection,
    table: &str,
    columns: &[&str],
) -> Result<String, BackupError> {
    let sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get(0),
        )
        .map_err(|_| BackupError::Invalid(format!("备份缺少表 {table}")))?;
    let actual = table_columns(connection, table)?;
    for column in columns {
        if !actual.contains(*column) {
            return Err(BackupError::Invalid(format!(
                "备份表 {table} 缺少字段 {column}"
            )));
        }
    }
    Ok(normalized_sql(&sql))
}

fn require_index(connection: &Connection, table: &str, expected: &str) -> Result<(), BackupError> {
    let mut statement = connection.prepare(&format!("PRAGMA index_list('{table}')"))?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if names.iter().any(|name| name == expected) {
        Ok(())
    } else {
        Err(BackupError::Invalid(format!(
            "备份表 {table} 缺少索引 {expected}"
        )))
    }
}

fn validate_schema(connection: &Connection) -> Result<i64, BackupError> {
    let migrations_sql =
        require_table(connection, "schema_migrations", &["version", "applied_at"])?;
    if !migrations_sql.contains("primarykey") {
        return Err(BackupError::Invalid(
            "schema_migrations.version 必须是主键".into(),
        ));
    }
    let versions = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")?
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if versions.is_empty() {
        return Err(BackupError::Invalid("schema_migrations 不能为空".into()));
    }
    let schema_version = *versions.last().unwrap();
    if schema_version > CURRENT_SCHEMA_VERSION {
        return Err(BackupError::SchemaTooNew {
            found: schema_version,
            current: CURRENT_SCHEMA_VERSION,
        });
    }
    let expected_versions = (1..=schema_version).collect::<Vec<_>>();
    if versions != expected_versions {
        return Err(BackupError::Invalid(
            "schema_migrations 必须包含连续且已识别的迁移版本".into(),
        ));
    }
    if schema_version != CURRENT_SCHEMA_VERSION {
        return Err(BackupError::Invalid(
            "备份 schema 不是当前应用可直接使用的完整版本".into(),
        ));
    }

    let boxes_sql = require_table(
        connection,
        "boxes",
        &["id", "name", "rows", "cols", "created_at", "updated_at"],
    )?;
    if !boxes_sql.contains("primarykey")
        || !boxes_sql.contains("check(rows>0)")
        || !boxes_sql.contains("check(cols>0)")
    {
        return Err(BackupError::Invalid("boxes 约束不完整".into()));
    }
    let parts_sql = require_table(
        connection,
        "parts",
        &[
            "id",
            "name",
            "category",
            "package",
            "manufacturer",
            "mpn",
            "lcsc_code",
            "quantity",
            "box_id",
            "slot",
            "note",
            "version",
            "created_at",
            "updated_at",
        ],
    )?;
    if !parts_sql.contains("primarykey")
        || !parts_sql.contains("check(quantity>=0)")
        || !parts_sql.contains("unique(box_id,slot)")
        || !parts_sql.contains("foreignkey(box_id)referencesboxes(id)")
    {
        return Err(BackupError::Invalid("parts 约束不完整".into()));
    }
    require_index(connection, "parts", "parts_lcsc_code_unique")?;

    require_table(
        connection,
        "bom_files",
        &[
            "id",
            "original_name",
            "display_name",
            "sha256",
            "cache_name",
            "created_at",
        ],
    )?;
    require_table(
        connection,
        "welding_sessions",
        &["id", "bom_file_id", "status", "created_at", "updated_at"],
    )?;
    let progress_sql = require_table(
        connection,
        "welding_progress",
        &[
            "id",
            "session_id",
            "component_key",
            "side",
            "part_id",
            "required_quantity",
            "taken_quantity",
            "updated_at",
        ],
    )?;
    if !progress_sql.contains("check(sidein('top','bottom'))")
        || !progress_sql.contains("check(required_quantity>=0)")
        || !progress_sql.contains("check(taken_quantity>=0andtaken_quantity<=required_quantity)")
        || !progress_sql.contains("unique(session_id,component_key,side)")
    {
        return Err(BackupError::Invalid("welding_progress 约束不完整".into()));
    }
    let movements_sql = require_table(
        connection,
        "inventory_movements",
        &[
            "id",
            "part_id",
            "session_id",
            "movement_type",
            "quantity",
            "reason",
            "reverses_movement_id",
            "created_at",
            "component_key",
            "side",
        ],
    )?;
    if !movements_sql.contains("check(movement_typein('in','consume','adjust','reverse'))")
        || !movements_sql.contains("check(quantity<>0)")
    {
        return Err(BackupError::Invalid(
            "inventory_movements 约束不完整".into(),
        ));
    }
    for index in [
        "inventory_movements_part_id",
        "inventory_movements_session_id",
        "inventory_movements_welding_scope",
    ] {
        require_index(connection, "inventory_movements", index)?;
    }
    Ok(schema_version)
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
    let schema_version = validate_schema(&connection)?;
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
        if let Err(error) = fs::remove_file(&path) {
            eprintln!(
                "PartNest backup rotation skipped {}: {error}",
                path.display()
            );
        }
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

    database.connection().backup(MAIN_DB, &temporary, None)?;
    validate_backup(&temporary)?;

    let destination = backup_directory.join(backup_filename());
    fs::rename(&temporary, &destination)?;
    if let Err(error) = rotate_backups(backup_directory) {
        eprintln!("PartNest backup rotation skipped: {error}");
    }
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

fn remove_if_exists(path: &Path) -> Result<bool, BackupError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(BackupError::Io(error)),
    }
}

fn move_if_exists(source: &Path, destination: &Path) -> Result<bool, BackupError> {
    if source.is_file() {
        fs::rename(source, destination)?;
        Ok(true)
    } else if source.exists() {
        Err(BackupError::Invalid(format!(
            "数据库伴随文件不是普通文件: {}",
            source.display()
        )))
    } else {
        Ok(false)
    }
}

fn reopen_database(database: &mut Database, live_path: &Path) -> Result<(), BackupError> {
    if !live_path.is_file() {
        return Err(BackupError::Invalid(format!(
            "原始数据库文件不存在: {}",
            live_path.display()
        )));
    }
    validate_backup(live_path)?;
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

struct RestoreState {
    moved_live: bool,
    moved_wal: bool,
    moved_shm: bool,
    replacement_installed: bool,
}

impl RestorePaths {
    fn rollback(&self, state: &RestoreState) -> Result<(), BackupError> {
        if state.replacement_installed {
            remove_if_exists(&self.live_path)?;
            remove_if_exists(&self.live_wal)?;
            remove_if_exists(&self.live_shm)?;
        }
        if state.moved_shm {
            fs::rename(&self.previous_shm, &self.live_shm)?;
        }
        if state.moved_wal {
            fs::rename(&self.previous_wal, &self.live_wal)?;
        }
        if state.moved_live {
            fs::rename(&self.previous_path, &self.live_path)?;
        }
        if !self.live_path.is_file() {
            return Err(BackupError::Invalid("回滚后原始数据库文件不存在".into()));
        }
        validate_backup(&self.live_path)?;
        Ok(())
    }
}

#[cfg(unix)]
fn file_identity(path: &Path) -> Result<(u64, u64), BackupError> {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::metadata(path)?;
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn file_identity(path: &Path) -> Result<(u64, u64), BackupError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let file = fs::File::open(path)?;
    let mut information = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
    // SAFETY: `file` owns a valid Windows file handle for the duration of this
    // call, and `information` points to writable storage of the expected type.
    let result = unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut information) };
    if result == 0 {
        return Err(BackupError::Io(std::io::Error::last_os_error()));
    }
    let index =
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow);
    Ok((u64::from(information.dwVolumeSerialNumber), index))
}

#[cfg(not(any(unix, windows)))]
fn file_identity(path: &Path) -> Result<(u64, u64), BackupError> {
    let metadata = fs::metadata(path)?;
    Ok((
        metadata.len(),
        modified_time(path)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64,
    ))
}

fn recover_after_failure(
    database: &mut Database,
    paths: &RestorePaths,
    state: &RestoreState,
    primary: BackupError,
) -> BackupError {
    match paths
        .rollback(state)
        .and_then(|_| reopen_database(database, &paths.live_path))
    {
        Ok(()) => primary,
        Err(recovery) => BackupError::FatalRecovery {
            primary: primary.to_string(),
            recovery: recovery.to_string(),
        },
    }
}

fn restore_database_file_inner(
    database: &mut Database,
    selected_backup: impl AsRef<Path>,
    fail_after_swap: bool,
) -> Result<(), BackupError> {
    let selected_backup = selected_backup.as_ref();
    let selected_canonical = fs::canonicalize(selected_backup)
        .map_err(|_| BackupError::Invalid("备份文件不存在".into()))?;
    let live_path = database.path().to_path_buf();
    if !live_path.is_file() {
        return Err(BackupError::Invalid("当前数据库文件不存在".into()));
    }
    if file_identity(&live_path)? == file_identity(&selected_canonical)? {
        return Err(BackupError::Invalid(
            "不能从当前数据库文件或其硬链接恢复".into(),
        ));
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
    let paths = RestorePaths {
        live_path: live_path.clone(),
        previous_path: previous_path.clone(),
        live_wal: live_wal.clone(),
        previous_wal: previous_wal.clone(),
        live_shm: live_shm.clone(),
        previous_shm: previous_shm.clone(),
    };
    let mut state = RestoreState {
        moved_live: false,
        moved_wal: false,
        moved_shm: false,
        replacement_installed: false,
    };

    state.moved_live = match move_if_exists(&live_path, &previous_path) {
        Ok(moved) => moved,
        Err(error) => return Err(recover_after_failure(database, &paths, &state, error)),
    };
    state.moved_wal = match move_if_exists(&live_wal, &previous_wal) {
        Ok(moved) => moved,
        Err(error) => return Err(recover_after_failure(database, &paths, &state, error)),
    };
    state.moved_shm = match move_if_exists(&live_shm, &previous_shm) {
        Ok(moved) => moved,
        Err(error) => return Err(recover_after_failure(database, &paths, &state, error)),
    };

    if let Err(error) = fs::rename(&temporary, &live_path) {
        return Err(recover_after_failure(
            database,
            &paths,
            &state,
            BackupError::Io(error),
        ));
    }
    state.replacement_installed = true;
    if fail_after_swap {
        return Err(recover_after_failure(
            database,
            &paths,
            &state,
            BackupError::Invalid("测试注入的替换后打开失败".into()),
        ));
    }

    let restored = match Database::open(&live_path) {
        Ok(restored) => restored,
        Err(error) => {
            return Err(recover_after_failure(
                database,
                &paths,
                &state,
                BackupError::Sqlite(error),
            ))
        }
    };
    if let Err(error) = validate_backup(&live_path) {
        return Err(recover_after_failure(database, &paths, &state, error));
    }
    let old_placeholder = database.replace_connection(restored.into_connection());
    drop(old_placeholder);

    let _ = remove_if_exists(&previous_path);
    if state.moved_wal {
        let _ = remove_if_exists(&previous_wal);
    }
    if state.moved_shm {
        let _ = remove_if_exists(&previous_shm);
    }
    Ok(())
}

/// Replace an open live database after validating a selected backup.
pub fn restore_database_file(
    database: &mut Database,
    selected_backup: impl AsRef<Path>,
) -> Result<(), BackupError> {
    restore_database_file_inner(database, selected_backup, false)
}

/// Deterministic failure seam used by integration tests to exercise post-swap rollback.
pub fn restore_database_file_with_injected_failure(
    database: &mut Database,
    selected_backup: impl AsRef<Path>,
) -> Result<(), BackupError> {
    restore_database_file_inner(database, selected_backup, true)
}
