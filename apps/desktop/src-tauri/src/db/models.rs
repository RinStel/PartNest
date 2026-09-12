//! Database-facing records and common SQLite value helpers.

use chrono::Utc;
use uuid::Uuid;

/// Part and audit IDs are stored as canonical UUIDv7 strings. Box IDs are
/// assigned by SQLite because they are local relational keys.
pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}

/// Timestamps are stored as RFC 3339 UTC strings.
pub fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoxRecord {
    pub id: i64,
    pub name: String,
    pub rows: i64,
    pub cols: i64,
}

impl BoxRecord {
    pub fn new(name: String, rows: i64, cols: i64) -> Self {
        Self {
            // Database-backed box IDs are assigned by SQLite. The constructor
            // remains useful for value-level tests and uses zero as an
            // unsaved sentinel.
            id: 0,
            name,
            rows,
            cols,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartRecord {
    pub id: String,
    pub name: String,
    pub category: Option<String>,
    pub package: Option<String>,
    pub manufacturer: Option<String>,
    pub mpn: Option<String>,
    pub lcsc_code: Option<String>,
    pub quantity: i64,
    pub box_id: Option<i64>,
    pub slot: Option<String>,
    pub note: Option<String>,
    pub version: i64,
}

impl PartRecord {
    pub fn new(name: String, box_id: Option<i64>, slot: Option<String>, quantity: i64) -> Self {
        Self {
            id: new_id(),
            name,
            category: None,
            package: None,
            manufacturer: None,
            mpn: None,
            lcsc_code: None,
            quantity,
            box_id,
            slot,
            note: None,
            version: 1,
        }
    }
}
