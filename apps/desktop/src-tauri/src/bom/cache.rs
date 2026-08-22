//! Immutable source caching and active interactive BOM session metadata.

use super::{
    bridge::{constant_time_eq, BridgeError},
    interactive_html::InteractiveHtmlError,
    types::NormalizedBomDto,
};
use crate::db::{new_id, Database};
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fmt, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

pub use super::bridge::SelectionError;

const BRIDGE_JS: &str = include_str!("../../resources/bridge-v1.js");

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSelection {
    pub session_id: String,
    pub component_key: String,
    pub designators: Vec<String>,
}

#[derive(Debug)]
pub enum CacheError {
    Io(std::io::Error),
    Database(rusqlite::Error),
    Parse(InteractiveHtmlError),
    InvalidDisplayName,
}
impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "cache I/O error: {error}"),
            Self::Database(error) => write!(f, "cache database error: {error}"),
            Self::Parse(error) => error.fmt(f),
            Self::InvalidDisplayName => f.write_str("display name cannot be empty"),
        }
    }
}
impl std::error::Error for CacheError {}
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
    designators: BTreeMap<String, String>,
}

pub struct InteractiveBomCache<'db> {
    db: &'db Database,
    cache_dir: PathBuf,
    active: Mutex<Option<ActiveSession>>,
}

impl<'db> InteractiveBomCache<'db> {
    pub fn new(db: &'db Database, cache_dir: impl AsRef<Path>) -> Self {
        Self {
            db,
            cache_dir: cache_dir.as_ref().to_owned(),
            active: Mutex::new(None),
        }
    }

    pub fn cache_interactive_bom(
        &self,
        source_path: impl AsRef<Path>,
        display_name: impl AsRef<str>,
    ) -> Result<CachedBomSession, CacheError> {
        let display_name = display_name.as_ref().trim();
        if display_name.is_empty() {
            return Err(CacheError::InvalidDisplayName);
        }
        let source_path = source_path.as_ref();
        let bytes = fs::read(source_path)?;
        let source_text = std::str::from_utf8(&bytes).map_err(|error| {
            CacheError::Parse(InteractiveHtmlError::UnsupportedInteractiveBom(
                error.to_string(),
            ))
        })?;
        let original_name = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_owned();
        let normalized = super::interactive_html::parse_interactive_html_text(
            source_text,
            original_name.clone(),
        )?;
        let sha256 = hex::encode(Sha256::digest(&bytes));
        let cache_name = format!("{sha256}.html");
        let cache_path = self.cache_dir.join(&cache_name);
        self.write_cache_atomically(&cache_path, &bytes)?;

        let token = Uuid::new_v4().to_string();
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
                "INSERT OR IGNORE INTO bom_files (id, original_name, display_name, sha256, cache_name) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![bom_file_id, original_name, display_name, sha256, cache_name],
            )?;
            let session_id = tx.query_row(
                "SELECT id FROM welding_sessions WHERE bom_file_id = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
                [&bom_file_id],
                |row| row.get::<_, String>(0),
            ).optional()?.unwrap_or_else(new_id);
            if session_id.len() == 36
                && !tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM welding_sessions WHERE id = ?1)",
                    [&session_id],
                    |row| row.get::<_, bool>(0),
                )?
            {
                tx.execute("INSERT INTO welding_sessions (id, bom_file_id, status) VALUES (?1, ?2, 'active')", rusqlite::params![session_id, bom_file_id])?;
            }
            tx.commit()?;
            (bom_file_id, session_id)
        };
        let designators = normalized
            .groups
            .iter()
            .flat_map(|group| {
                group
                    .designators
                    .iter()
                    .map(move |designator| (designator.clone(), group.component_key.clone()))
            })
            .collect();
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
        if designators.is_empty() {
            return Err(BridgeError::InvalidMessage(
                "designators are required".into(),
            ));
        }
        let mut group = None;
        for designator in designators {
            if designators
                .iter()
                .filter(|candidate| *candidate == designator)
                .count()
                > 1
            {
                return Err(BridgeError::DuplicateDesignator);
            }
            let component = active
                .designators
                .get(designator)
                .ok_or(BridgeError::UnknownDesignator)?;
            if let Some(expected) = &group {
                if expected != component {
                    return Err(BridgeError::CrossGroupSelection);
                }
            } else {
                group = Some(component.clone());
            }
        }
        Ok(ResolvedSelection {
            session_id: active.session_id.clone(),
            component_key: group.expect("nonempty checked"),
            designators: designators.to_owned(),
        })
    }

    fn write_cache_atomically(&self, target: &Path, source: &[u8]) -> Result<(), CacheError> {
        fs::create_dir_all(&self.cache_dir)?;
        if target.is_file() {
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
        let mut cached = Vec::with_capacity(source.len() + BRIDGE_JS.len() + 128);
        cached.extend_from_slice(source);
        cached.extend_from_slice(
            b"\n<!-- partnest bridge-v1 -->\n<script data-partnest-bridge=\"bridge-v1\">\n",
        );
        cached.extend_from_slice(BRIDGE_JS.as_bytes());
        cached.extend_from_slice(b"\n</script>\n");
        fs::write(&temp, cached)?;
        fs::rename(&temp, target)?;
        Ok(())
    }
}

pub fn random_token_is_uuid_v4(token: &str) -> bool {
    Uuid::parse_str(token)
        .map(|uuid| uuid.get_version_num() == 4)
        .unwrap_or(false)
}
