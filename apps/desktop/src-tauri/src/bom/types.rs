use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Maps a normalized field name (for example `mpn`) to the source header.
pub type FieldMapping = BTreeMap<String, String>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BomSide {
    Top,
    Bottom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BomPlacementDto {
    pub designator: String,
    /// Tabular BOMs often have no board-side column. `None` is intentional;
    /// callers must not turn it into an invented top or bottom placement.
    pub side: Option<BomSide>,
    pub component_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BomGroupDto {
    pub component_key: String,
    pub name: String,
    pub value: String,
    pub package: String,
    pub manufacturer: String,
    pub mpn: String,
    pub lcsc_code: String,
    pub quantity: i64,
    pub placements: Vec<BomPlacementDto>,
    pub extra_fields: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedBomDto {
    pub source_name: String,
    pub groups: Vec<BomGroupDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImportPreview {
    Ready(NormalizedBomDto),
    NeedsMapping {
        headers: Vec<String>,
        suggestions: FieldMapping,
    },
}
