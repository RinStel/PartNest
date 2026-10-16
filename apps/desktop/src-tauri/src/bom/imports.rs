//! Import use cases: file preparation is independent of the database lock.
use super::{
    assets,
    cache::{parse_interactive_source, read_source, CacheError, ImportedProject},
    interactive_html::parse_interactive_html_text_with_companion,
    projects::{self, ProjectKind, ProjectRecord},
    tabular::inspect_tabular_bom,
    types::{FieldMapping, ImportPreview, NormalizedBomDto},
};
use crate::db::Database;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub struct PreparedImport {
    source_path: PathBuf,
    bytes: Vec<u8>,
    sha256: String,
    kind: ProjectKind,
    normalized: NormalizedBomDto,
    companion: Option<NormalizedBomDto>,
}

pub fn prepare_import(
    path: &Path,
    mapping: Option<&FieldMapping>,
    companion_path: Option<&Path>,
) -> Result<PreparedImport, CacheError> {
    let kind = ProjectKind::from_source_path(path)?;
    let (bytes, original_name) = read_source(path, kind)?;
    let (normalized, companion) = match kind {
        ProjectKind::Interactive => {
            parse_interactive_source(&bytes, &original_name, companion_path)?
        }
        ProjectKind::Tabular => (table(path, mapping)?, None),
    };
    Ok(PreparedImport {
        source_path: path.to_owned(),
        sha256: hex::encode(Sha256::digest(&bytes)),
        bytes,
        kind,
        normalized,
        companion,
    })
}

pub fn commit_import(
    db: &Database,
    prepared: PreparedImport,
    name: Option<&str>,
) -> Result<ImportedProject, CacheError> {
    let tx = db.transaction()?;
    let record = projects::record_project_with_digest(
        db,
        &prepared.source_path,
        &prepared.sha256,
        name,
        prepared.kind,
        prepared.companion.is_some(),
        &prepared.normalized,
    )?;
    if prepared.kind == ProjectKind::Interactive {
        assets::store(db, &record.id, &prepared.bytes, prepared.companion.as_ref())?;
    }
    tx.commit()?;
    Ok(imported(record, prepared.normalized))
}

pub struct PreparedSupplement {
    expected: ProjectRecord,
    bytes: Vec<u8>,
    sha256: String,
    normalized: NormalizedBomDto,
    companion: NormalizedBomDto,
}

pub fn prepare_supplement(
    record: ProjectRecord,
    source: Option<Vec<u8>>,
    path: &Path,
    mapping: Option<&FieldMapping>,
) -> Result<PreparedSupplement, CacheError> {
    let supplied = ProjectKind::from_source_path(path)?;
    if record.missing_source() != Some(supplied) {
        return Err(
            projects::ProjectError::SuppliesWrongSource(match record.missing_source() {
                Some(ProjectKind::Tabular) => "需要器件表格（CSV / XLS / XLSX）".into(),
                Some(ProjectKind::Interactive) => "需要可交互式 BOM（HTML）".into(),
                None => return Err(projects::ProjectError::AlreadyComplete.into()),
            })
            .into(),
        );
    }
    let (bytes, original_name, companion) = match supplied {
        ProjectKind::Tabular => (
            source.ok_or_else(|| CacheError::MissingCache(record.original_name.clone()))?,
            record.original_name.clone(),
            table(path, mapping)?,
        ),
        ProjectKind::Interactive => {
            let (bytes, name) = read_source(path, supplied)?;
            (bytes, name, record.snapshot()?)
        }
    };
    let normalized = parse_interactive_html_text_with_companion(
        std::str::from_utf8(&bytes).map_err(|e| CacheError::TamperedCache(e.to_string()))?,
        original_name,
        Some(&companion),
    )?;
    Ok(PreparedSupplement {
        expected: record,
        sha256: hex::encode(Sha256::digest(&bytes)),
        bytes,
        normalized,
        companion,
    })
}

pub fn commit_supplement(
    db: &Database,
    prepared: PreparedSupplement,
) -> Result<ImportedProject, CacheError> {
    let tx = db.transaction()?;
    let current = projects::ensure_supplementable(db, &prepared.expected.id)?;
    if current != prepared.expected {
        return Err(
            projects::ProjectError::InvalidSnapshot("项目已被修改，请重新导入".into()).into(),
        );
    }
    let record = projects::apply_supplement(
        db,
        &current.id,
        ProjectKind::Interactive,
        &prepared.sha256,
        &format!("{}.html", prepared.sha256),
        &prepared.normalized,
    )?;
    assets::store(db, &record.id, &prepared.bytes, Some(&prepared.companion))?;
    tx.commit()?;
    Ok(imported(record, prepared.normalized))
}

fn table(path: &Path, mapping: Option<&FieldMapping>) -> Result<NormalizedBomDto, CacheError> {
    match inspect_tabular_bom(path, mapping)? {
        ImportPreview::Ready(bom) => Ok(bom),
        ImportPreview::NeedsMapping { .. } => Err(CacheError::NeedsMapping),
    }
}

fn imported(record: ProjectRecord, normalized: NormalizedBomDto) -> ImportedProject {
    ImportedProject {
        project_id: record.id,
        name: record.name,
        original_name: record.original_name,
        cache_name: record.cache_name,
        kind: record.kind,
        has_table: record.has_table,
        normalized,
    }
}
