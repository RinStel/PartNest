//! Durable project sources. Rendered HTML is disposable; these bytes are not.
use super::{cache::CacheError, projects::ProjectRecord, types::NormalizedBomDto};
use crate::db::Database;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};

pub struct ProjectAsset {
    pub source: Vec<u8>,
    pub companion: Option<NormalizedBomDto>,
}

pub fn load(db: &Database, record: &ProjectRecord) -> Result<Option<ProjectAsset>, CacheError> {
    let row: Option<(Vec<u8>, Option<String>)> = db
        .connection()
        .query_row(
            "SELECT source, companion_json FROM project_assets WHERE project_id = ?1",
            [&record.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    row.map(|(source, companion)| {
        if hex::encode(Sha256::digest(&source)) != record.sha256 {
            return Err(CacheError::TamperedCache(
                "stored source hash mismatch".into(),
            ));
        }
        let companion = companion
            .map(|json| serde_json::from_str(&json))
            .transpose()
            .map_err(|e| CacheError::TamperedCache(format!("stored companion: {e}")))?;
        Ok(ProjectAsset { source, companion })
    })
    .transpose()
}

/// Caller owns the transaction containing both the project and its source.
pub fn store(
    db: &Database,
    id: &str,
    source: &[u8],
    companion: Option<&NormalizedBomDto>,
) -> Result<(), CacheError> {
    let companion = companion
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| CacheError::TamperedCache(e.to_string()))?;
    db.connection().execute(
        "INSERT INTO project_assets (project_id, source, companion_json) VALUES (?1, ?2, ?3) ON CONFLICT(project_id) DO UPDATE SET source = excluded.source, companion_json = excluded.companion_json",
        rusqlite::params![id, source, companion],
    )?;
    Ok(())
}
