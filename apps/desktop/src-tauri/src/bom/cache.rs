//! Immutable source caching and active interactive BOM session metadata.

use super::{
    bridge::{constant_time_eq, validate_token_and_designators, BridgeError},
    interactive_html::{
        parse_interactive_html_text_with_companion, InteractiveHtmlError, MAX_INTERACTIVE_BOM_BYTES,
    },
    tabular::parse_tabular_bom,
    types::{BomSide, NormalizedBomDto},
};
use crate::db::{new_id, Database};
use rusqlite::OptionalExtension;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fmt, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub use super::bridge::SelectionError;

const BRIDGE_JS: &str = include_str!("../../resources/bridge-v1.js");
const COMPANION_START: &[u8] =
    b"<script data-partnest-companion=\"bom-v1\" type=\"application/json\">";
const COMPANION_END: &[u8] = b"</script>";

#[derive(Debug, Clone, Serialize)]
pub struct CachedBomSession {
    pub session_id: String,
    pub bom_file_id: String,
    pub original_name: String,
    pub display_name: String,
    pub sha256: String,
    pub cache_name: String,
    pub cache_path: PathBuf,
    pub token: String,
    pub normalized: NormalizedBomDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ResolvedSelection {
    pub session_id: String,
    pub component_key: String,
    pub side: BomSide,
    pub designators: Vec<String>,
}

#[derive(Debug)]
pub enum CacheError {
    Io(std::io::Error),
    Database(rusqlite::Error),
    Parse(InteractiveHtmlError),
    InvalidDisplayName,
    TamperedCache(String),
    AtomicReplace(String),
    Companion(String),
    MissingCache(String),
}
impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "cache I/O error: {error}"),
            Self::Database(error) => write!(f, "cache database error: {error}"),
            Self::Parse(error) => error.fmt(f),
            Self::InvalidDisplayName => f.write_str("display name cannot be empty"),
            Self::TamperedCache(reason) => write!(f, "cached BOM is invalid: {reason}"),
            Self::AtomicReplace(reason) => write!(f, "cached BOM atomic replace failed: {reason}"),
            Self::Companion(reason) => write!(f, "companion CSV error: {reason}"),
            Self::MissingCache(name) => {
                write!(f, "cached BOM file for {name:?} is not available")
            }
        }
    }
}
impl std::error::Error for CacheError {}

impl CacheError {
    /// Reader-facing text; `Display` keeps the English form for logs.
    pub fn user_message(&self) -> String {
        match self {
            Self::Parse(error) => error.user_message(),
            Self::MissingCache(_) => {
                "活动 BOM 的缓存文件已丢失，请在「BOM 分析」页重新选择该 BOM 文件".into()
            }
            Self::TamperedCache(_) => "缓存的 BOM 已损坏，请在「BOM 分析」页重新导入该 BOM".into(),
            Self::InvalidDisplayName => "BOM 备注名不能为空".into(),
            Self::Companion(reason) => format!("配套 CSV 解析失败：{reason}"),
            Self::AtomicReplace(reason) => format!("写入 BOM 缓存失败：{reason}"),
            Self::Io(error) => format!("BOM 缓存读写失败：{error}"),
            Self::Database(error) => format!("BOM 会话保存失败：{error}"),
        }
    }
}
impl From<std::io::Error> for CacheError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
impl From<rusqlite::Error> for CacheError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}
impl From<InteractiveHtmlError> for CacheError {
    fn from(error: InteractiveHtmlError) -> Self {
        Self::Parse(error)
    }
}

struct ActiveSession {
    session_id: String,
    token: String,
    designators: BTreeMap<String, DesignatorBinding>,
}

#[derive(Clone)]
struct DesignatorBinding {
    component_key: String,
    side: BomSide,
}

pub struct InteractiveBomCache<'db> {
    db: &'db Database,
    cache_dir: PathBuf,
    active: Arc<Mutex<Option<ActiveSession>>>,
}

/// Process-managed state used by Tauri commands. The database remains owned by
/// Tauri's existing `Database` state; this object keeps only cache location
/// and the in-memory token/session lookup.
pub struct InteractiveBomRuntime {
    cache_dir: PathBuf,
    active: Arc<Mutex<Option<ActiveSession>>>,
}

impl InteractiveBomRuntime {
    pub fn new(cache_dir: impl AsRef<Path>) -> Self {
        Self {
            cache_dir: cache_dir.as_ref().to_owned(),
            active: Arc::new(Mutex::new(None)),
        }
    }

    pub fn cache_interactive_bom(
        &self,
        db: &Database,
        source_path: impl AsRef<Path>,
        display_name: impl AsRef<str>,
    ) -> Result<CachedBomSession, CacheError> {
        InteractiveBomCache::with_active(db, &self.cache_dir, self.active.clone())
            .cache_interactive_bom(source_path, display_name)
    }

    pub fn cache_interactive_bom_with_companion(
        &self,
        db: &Database,
        source_path: impl AsRef<Path>,
        display_name: impl AsRef<str>,
        companion_path: Option<&Path>,
    ) -> Result<CachedBomSession, CacheError> {
        InteractiveBomCache::with_active(db, &self.cache_dir, self.active.clone())
            .cache_interactive_bom_with_companion(source_path, display_name, companion_path)
    }

    pub fn resolve_bom_selection(
        &self,
        db: &Database,
        token: &str,
        designators: &[String],
    ) -> Result<ResolvedSelection, BridgeError> {
        InteractiveBomCache::with_active(db, &self.cache_dir, self.active.clone())
            .resolve_bom_selection(token, designators)
    }

    pub fn restore_active_session(
        &self,
        db: &Database,
    ) -> Result<Option<CachedBomSession>, CacheError> {
        InteractiveBomCache::with_active(db, &self.cache_dir, self.active.clone())
            .restore_active_session()
    }

    /// Drop the in-memory bridge token and designator bindings after the
    /// backing database has been replaced by a restore operation.
    pub fn invalidate_active_session(&self) -> Result<(), CacheError> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| CacheError::Io(std::io::Error::other("session lock poisoned")))?;
        *active = None;
        Ok(())
    }

    /// Validate the ownership captured by the active BOM bridge before a
    /// welding transaction is allowed to mutate inventory.
    pub fn validate_welding_selection(
        &self,
        db: &Database,
        session_id: &str,
        component_key: &str,
        side: &BomSide,
        designators: &[String],
    ) -> Result<i64, BridgeError> {
        let active = self
            .active
            .lock()
            .map_err(|_| BridgeError::InactiveSession)?;
        let active = active.as_ref().ok_or(BridgeError::InactiveSession)?;
        if active.session_id != session_id {
            return Err(BridgeError::InactiveSession);
        }
        let still_active = db
            .connection()
            .query_row(
                "SELECT status FROM welding_sessions WHERE id = ?1",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .map(|status| status == "active")
            .unwrap_or(false);
        if !still_active {
            return Err(BridgeError::InactiveSession);
        }
        validate_token_and_designators("welding-selection", designators)?;
        let mut submitted = std::collections::HashSet::with_capacity(designators.len());
        for designator in designators {
            if !submitted.insert(designator) {
                return Err(BridgeError::DuplicateDesignator);
            }
            let binding = active
                .designators
                .get(designator)
                .ok_or(BridgeError::UnknownDesignator)?;
            if binding.component_key != component_key {
                return Err(BridgeError::CrossGroupSelection);
            }
            if &binding.side != side {
                return Err(BridgeError::MixedSideSelection);
            }
        }
        Ok(designators.len() as i64)
    }
}

impl<'db> InteractiveBomCache<'db> {
    pub fn new(db: &'db Database, cache_dir: impl AsRef<Path>) -> Self {
        Self::with_active(db, cache_dir, Arc::new(Mutex::new(None)))
    }

    fn with_active(
        db: &'db Database,
        cache_dir: impl AsRef<Path>,
        active: Arc<Mutex<Option<ActiveSession>>>,
    ) -> Self {
        Self {
            db,
            cache_dir: cache_dir.as_ref().to_owned(),
            active,
        }
    }

    pub fn cache_interactive_bom(
        &self,
        source_path: impl AsRef<Path>,
        display_name: impl AsRef<str>,
    ) -> Result<CachedBomSession, CacheError> {
        self.cache_interactive_bom_with_companion(source_path, display_name, None)
    }

    pub fn cache_interactive_bom_with_companion(
        &self,
        source_path: impl AsRef<Path>,
        display_name: impl AsRef<str>,
        companion_path: Option<&Path>,
    ) -> Result<CachedBomSession, CacheError> {
        let display_name = display_name.as_ref().trim();
        if display_name.is_empty() {
            return Err(CacheError::InvalidDisplayName);
        }
        let source_path = source_path.as_ref();
        let (bytes, original_name) = read_interactive_source(source_path)?;
        let (normalized, companion) =
            parse_interactive_source(&bytes, &original_name, companion_path)?;
        let sha256 = hex::encode(Sha256::digest(&bytes));
        let cache_name = format!("{sha256}.html");
        let token = Uuid::new_v4().to_string();
        let cache_path = validate_cache_path(&self.cache_dir, &cache_name)?;
        let designators = bindings(&normalized)?;
        self.write_cache_atomically(
            &cache_path,
            &bytes,
            &token,
            &designators,
            companion.as_ref(),
        )?;
        let (bom_file_id, session_id) = {
            let tx = self.db.transaction()?;
            let bom_file_id = tx
                .query_row(
                    "SELECT id FROM bom_files WHERE sha256 = ?1",
                    [&sha256],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .unwrap_or_else(new_id);
            tx.execute(
                "INSERT INTO bom_files (id, original_name, display_name, sha256, cache_name) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(sha256) DO UPDATE SET original_name = excluded.original_name, display_name = excluded.display_name, cache_name = excluded.cache_name",
                rusqlite::params![bom_file_id, original_name, display_name, sha256, cache_name],
            )?;
            let session_id = tx.query_row(
                "SELECT id FROM welding_sessions WHERE bom_file_id = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
                [&bom_file_id],
                |row| row.get::<_, String>(0),
            ).optional()?.unwrap_or_else(new_id);
            tx.execute(
                "UPDATE welding_sessions SET status = 'cancelled', updated_at = ?1 WHERE status = 'active' AND id <> ?2",
                rusqlite::params![crate::db::utc_now(), session_id],
            )?;
            let exists = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM welding_sessions WHERE id = ?1)",
                [&session_id],
                |row| row.get::<_, bool>(0),
            )?;
            if !exists {
                tx.execute("INSERT INTO welding_sessions (id, bom_file_id, status) VALUES (?1, ?2, 'active')", rusqlite::params![session_id, bom_file_id])?;
            } else {
                tx.execute(
                    "UPDATE welding_sessions SET status = 'active', updated_at = ?1 WHERE id = ?2",
                    rusqlite::params![crate::db::utc_now(), session_id],
                )?;
            }
            tx.commit()?;
            (bom_file_id, session_id)
        };
        *self
            .active
            .lock()
            .map_err(|_| CacheError::Io(std::io::Error::other("session lock poisoned")))? =
            Some(ActiveSession {
                session_id: session_id.clone(),
                token: token.clone(),
                designators,
            });
        Ok(CachedBomSession {
            session_id,
            bom_file_id,
            original_name,
            display_name: display_name.to_owned(),
            sha256,
            cache_name,
            cache_path,
            token,
            normalized,
        })
    }

    pub fn resolve_bom_selection(
        &self,
        token: &str,
        designators: &[String],
    ) -> Result<ResolvedSelection, BridgeError> {
        validate_token_and_designators(token, designators)?;
        let active = self
            .active
            .lock()
            .map_err(|_| BridgeError::InactiveSession)?;
        let active = active.as_ref().ok_or(BridgeError::InactiveSession)?;
        let still_active = self
            .db
            .connection()
            .query_row(
                "SELECT status FROM welding_sessions WHERE id = ?1",
                [&active.session_id],
                |row| row.get::<_, String>(0),
            )
            .map(|status| status == "active")
            .unwrap_or(false);
        if !still_active {
            return Err(BridgeError::InactiveSession);
        }
        if !constant_time_eq(&active.token, token) {
            return Err(BridgeError::InvalidToken);
        }
        let mut group = None;
        let mut side = None;
        let mut unique = std::collections::HashSet::with_capacity(designators.len());
        for designator in designators {
            if !unique.insert(designator) {
                return Err(BridgeError::DuplicateDesignator);
            }
            let binding = active
                .designators
                .get(designator)
                .ok_or(BridgeError::UnknownDesignator)?;
            if let Some(expected) = &group {
                if expected != &binding.component_key {
                    return Err(BridgeError::CrossGroupSelection);
                }
            } else {
                group = Some(binding.component_key.clone());
            }
            if let Some(expected) = &side {
                if expected != &binding.side {
                    return Err(BridgeError::MixedSideSelection);
                }
            } else {
                side = Some(binding.side.clone());
            }
        }
        Ok(ResolvedSelection {
            session_id: active.session_id.clone(),
            component_key: group.expect("nonempty checked"),
            side: side.expect("nonempty checked"),
            designators: designators.to_owned(),
        })
    }

    pub fn restore_active_session(&self) -> Result<Option<CachedBomSession>, CacheError> {
        let metadata = self
            .db
            .connection()
            .query_row(
                "SELECT s.id, f.id, f.original_name, f.display_name, f.sha256, f.cache_name FROM welding_sessions s JOIN bom_files f ON f.id = s.bom_file_id WHERE s.status = 'active' ORDER BY s.updated_at DESC LIMIT 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((session_id, bom_file_id, original_name, display_name, sha256, cache_name)) =
            metadata
        else {
            return Ok(None);
        };
        let cache_path = validate_cache_path(&self.cache_dir, &cache_name)?;
        let cached = fs::read(&cache_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CacheError::MissingCache(original_name.clone())
            } else {
                CacheError::Io(error)
            }
        })?;
        let marker = b"\n<!-- partnest bridge-v1 -->";
        let marker_index = cached
            .windows(marker.len())
            .rposition(|window| window == marker)
            .ok_or_else(|| CacheError::TamperedCache("bridge marker missing".into()))?;
        let source = &cached[..marker_index];
        let actual_sha = hex::encode(Sha256::digest(source));
        if actual_sha != sha256 {
            return Err(CacheError::TamperedCache(
                "cached source hash mismatch".into(),
            ));
        }
        let source_text = std::str::from_utf8(source)
            .map_err(|error| CacheError::TamperedCache(error.to_string()))?;
        let companion = read_cached_companion(&cached[marker_index..])?;
        let normalized = parse_interactive_html_text_with_companion(
            source_text,
            original_name.clone(),
            companion.as_ref(),
        )?;
        let token = Uuid::new_v4().to_string();
        let designators = bindings(&normalized)?;
        self.write_cache_atomically(
            &cache_path,
            source,
            &token,
            &designators,
            companion.as_ref(),
        )?;
        self.db.connection().execute(
            "UPDATE welding_sessions SET updated_at = ?1 WHERE id = ?2 AND status = 'active'",
            rusqlite::params![crate::db::utc_now(), session_id],
        )?;
        *self
            .active
            .lock()
            .map_err(|_| CacheError::Io(std::io::Error::other("session lock poisoned")))? =
            Some(ActiveSession {
                session_id: session_id.clone(),
                token: token.clone(),
                designators,
            });
        Ok(Some(CachedBomSession {
            session_id,
            bom_file_id,
            original_name,
            display_name,
            sha256,
            cache_name,
            cache_path,
            token,
            normalized,
        }))
    }

    fn write_cache_atomically(
        &self,
        target: &Path,
        source: &[u8],
        token: &str,
        designators: &BTreeMap<String, DesignatorBinding>,
        companion: Option<&NormalizedBomDto>,
    ) -> Result<(), CacheError> {
        fs::create_dir_all(&self.cache_dir)?;
        let expected = build_cached_html(source, token, designators, companion)?;
        if same_contents(target, &expected) {
            return Ok(());
        }
        let temp = self.cache_dir.join(format!(
            ".{}.{}.tmp",
            target
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("bom"),
            new_id()
        ));
        let _guard =
            prepare_temp_with(&temp, &expected, |path, contents| fs::write(path, contents))?;
        match atomic_replace(&temp, target) {
            Ok(()) => {}
            Err(_error) if same_contents(target, &expected) => {
                // Another writer completed the same replacement.
            }
            Err(error) => return Err(CacheError::AtomicReplace(error.to_string())),
        }
        Ok(())
    }
}

/// Compare a cached file with the expected bytes without reading a multi-megabyte
/// HTML copy when the size already differs.
fn same_contents(path: &Path, expected: &[u8]) -> bool {
    fs::metadata(path)
        .ok()
        .filter(|meta| meta.is_file() && meta.len() == expected.len() as u64)
        .and_then(|_| fs::read(path).ok())
        .is_some_and(|actual| actual == expected)
}

/// Parse an interactive BOM, and its optional companion CSV, without touching
/// the cache directory or the welding session tables. The BOM analysis workspace
/// uses this so that previewing a file cannot cancel an in-progress session.
pub fn preview_interactive_bom(
    source_path: &Path,
    companion_path: Option<&Path>,
) -> Result<NormalizedBomDto, CacheError> {
    let (bytes, original_name) = read_interactive_source(source_path)?;
    parse_interactive_source(&bytes, &original_name, companion_path)
        .map(|(normalized, _)| normalized)
}

/// Read a source file, rejecting oversized exports before they reach memory:
/// callers hold the database lock for the whole command.
fn read_interactive_source(source_path: &Path) -> Result<(Vec<u8>, String), CacheError> {
    let size = fs::metadata(source_path)?.len();
    if size > MAX_INTERACTIVE_BOM_BYTES as u64 {
        return Err(CacheError::Parse(InteractiveHtmlError::TooLarge(
            size as usize,
        )));
    }
    let bytes = fs::read(source_path)?;
    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned();
    Ok((bytes, original_name))
}

fn parse_interactive_source(
    bytes: &[u8],
    original_name: &str,
    companion_path: Option<&Path>,
) -> Result<(NormalizedBomDto, Option<NormalizedBomDto>), CacheError> {
    let source_text = std::str::from_utf8(bytes).map_err(|error| {
        CacheError::Parse(InteractiveHtmlError::UnsupportedInteractiveBom(
            error.to_string(),
        ))
    })?;
    let companion = companion_path
        .map(|path| {
            parse_tabular_bom(path, None).map_err(|error| CacheError::Companion(error.to_string()))
        })
        .transpose()?;
    let normalized = parse_interactive_html_text_with_companion(
        source_text,
        original_name.to_owned(),
        companion.as_ref(),
    )?;
    Ok((normalized, companion))
}

fn validate_cache_path(cache_dir: &Path, cache_name: &str) -> Result<PathBuf, CacheError> {
    let valid_name = cache_name.len() == 69
        && cache_name.ends_with(".html")
        && cache_name[..64]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && !cache_name.contains('/')
        && !cache_name.contains('\\');
    if !valid_name {
        return Err(CacheError::TamperedCache(
            "cache name must be a lowercase sha256 .html filename".into(),
        ));
    }
    fs::create_dir_all(cache_dir)?;
    let root = fs::canonicalize(cache_dir)?;
    let target = root.join(cache_name);
    if let Ok(existing) = fs::canonicalize(&target) {
        if !existing.starts_with(&root) {
            return Err(CacheError::TamperedCache(
                "cache path escapes cache directory".into(),
            ));
        }
    }
    if target.parent() != Some(root.as_path()) {
        return Err(CacheError::TamperedCache(
            "cache path escapes cache directory".into(),
        ));
    }
    Ok(target)
}

struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn prepare_temp_with<F>(temp: &Path, contents: &[u8], writer: F) -> std::io::Result<TempFileGuard>
where
    F: FnOnce(&Path, &[u8]) -> std::io::Result<()>,
{
    let guard = TempFileGuard(temp.to_owned());
    writer(temp, contents)?;
    Ok(guard)
}

#[cfg(not(windows))]
fn atomic_replace(temp: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(temp, target)
}

#[cfg(windows)]
fn atomic_replace(temp: &Path, target: &Path) -> std::io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let temp = temp
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            temp.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[derive(Serialize)]
struct BridgeBootstrap<'a> {
    token: &'a str,
    designators: Vec<&'a str>,
}

fn bindings(
    normalized: &NormalizedBomDto,
) -> Result<BTreeMap<String, DesignatorBinding>, CacheError> {
    let mut result = BTreeMap::new();
    for group in &normalized.groups {
        for placement in &group.placements {
            let Some(side) = placement.side.clone() else {
                continue;
            };
            result.insert(
                placement.designator.clone(),
                DesignatorBinding {
                    component_key: group.component_key.clone(),
                    side,
                },
            );
        }
    }
    Ok(result)
}

fn build_cached_html(
    source: &[u8],
    token: &str,
    designators: &BTreeMap<String, DesignatorBinding>,
    companion: Option<&NormalizedBomDto>,
) -> Result<Vec<u8>, CacheError> {
    let names = designators.keys().map(String::as_str).collect::<Vec<_>>();
    let bootstrap = serde_json::to_string(&BridgeBootstrap {
        token,
        designators: names,
    })
    .map_err(|error| CacheError::TamperedCache(error.to_string()))?
    .replace('<', "\\u003c")
    .replace('>', "\\u003e")
    .replace('&', "\\u0026");
    let mut cached = Vec::with_capacity(source.len() + BRIDGE_JS.len() + bootstrap.len() + 256);
    cached.extend_from_slice(source);
    cached.extend_from_slice(b"\n<!-- partnest bridge-v1 -->\n<script data-partnest-bridge=\"bridge-v1\">window.__PARTNEST_BOM_BRIDGE_V1__=");
    cached.extend_from_slice(bootstrap.as_bytes());
    cached.extend_from_slice(b";</script><script data-partnest-bridge=\"bridge-v1\">\n");
    cached.extend_from_slice(BRIDGE_JS.as_bytes());
    cached.extend_from_slice(b"\n</script>\n");
    if let Some(companion) = companion {
        let companion = serde_json::to_string(companion)
            .map_err(|error| CacheError::TamperedCache(error.to_string()))?
            .replace('<', "\\u003c")
            .replace('>', "\\u003e")
            .replace('&', "\\u0026");
        cached.extend_from_slice(COMPANION_START);
        cached.extend_from_slice(companion.as_bytes());
        cached.extend_from_slice(COMPANION_END);
        cached.extend_from_slice(b"\n");
    }
    Ok(cached)
}

fn read_cached_companion(cached_tail: &[u8]) -> Result<Option<NormalizedBomDto>, CacheError> {
    let Some(start) = cached_tail
        .windows(COMPANION_START.len())
        .position(|window| window == COMPANION_START)
    else {
        return Ok(None);
    };
    let content_start = start + COMPANION_START.len();
    let end = cached_tail[content_start..]
        .windows(COMPANION_END.len())
        .position(|window| window == COMPANION_END)
        .ok_or_else(|| CacheError::TamperedCache("companion CSV marker is incomplete".into()))?;
    serde_json::from_slice(&cached_tail[content_start..content_start + end])
        .map(Some)
        .map_err(|error| CacheError::TamperedCache(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::atomic_replace;
    use super::prepare_temp_with;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn atomic_replace_overwrites_existing_target_without_predelete() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("target.html");
        let temp = directory.path().join("target.tmp");
        fs::write(&target, "valid-old").unwrap();
        fs::write(&temp, "valid-new").unwrap();
        atomic_replace(&temp, &target).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "valid-new");
        assert!(!temp.exists());
    }

    #[test]
    fn temp_guard_removes_partial_file_when_writer_fails() {
        let directory = tempdir().unwrap();
        let temp = directory.path().join("partial.tmp");
        let result = prepare_temp_with(&temp, b"expected", |path, _| {
            fs::write(path, b"partial")?;
            Err(std::io::Error::other("injected write failure"))
        });
        assert!(result.is_err());
        assert!(!temp.exists());
    }
}
