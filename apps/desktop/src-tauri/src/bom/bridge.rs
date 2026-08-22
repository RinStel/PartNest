//! Versioned, narrow message contract between the cached BOM iframe and Rust.

use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fmt};

pub const MAX_SELECTION_JSON_BYTES: usize = 64 * 1024;
pub const MAX_DESIGNATORS: usize = 512;
pub const MAX_DESIGNATOR_CHARS: usize = 64;

pub const BRIDGE_VERSION: &str = "bridge-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BomSelectionMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub token: String,
    pub designators: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeError {
    InvalidToken,
    InactiveSession,
    InvalidMessage(String),
    DuplicateDesignator,
    UnknownDesignator,
    CrossGroupSelection,
    MixedSideSelection,
    TooManyDesignators,
    DesignatorTooLong,
    MessageTooLarge,
}
impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidToken => f.write_str("invalid BOM bridge token"),
            Self::InactiveSession => f.write_str("BOM session is not active"),
            Self::InvalidMessage(reason) => write!(f, "invalid BOM bridge message: {reason}"),
            Self::DuplicateDesignator => f.write_str("duplicate designator"),
            Self::UnknownDesignator => f.write_str("unknown designator"),
            Self::CrossGroupSelection => f.write_str("designators belong to different BOM groups"),
            Self::MixedSideSelection => f.write_str("designators belong to different board sides"),
            Self::TooManyDesignators => f.write_str("too many selected designators"),
            Self::DesignatorTooLong => f.write_str("designator is too long"),
            Self::MessageTooLarge => f.write_str("BOM bridge message is too large"),
        }
    }
}

/// Selection validation errors are also bridge errors so command handlers can
/// expose one narrow rejection contract.
pub type SelectionError = BridgeError;
impl std::error::Error for BridgeError {}

pub fn decode_selection_message(json: &str) -> Result<BomSelectionMessage, BridgeError> {
    if json.len() > MAX_SELECTION_JSON_BYTES {
        return Err(BridgeError::MessageTooLarge);
    }
    let message: BomSelectionMessage = serde_json::from_str(json)
        .map_err(|error| BridgeError::InvalidMessage(error.to_string()))?;
    if message.message_type != "partnest:bom-selection" {
        return Err(BridgeError::InvalidMessage(
            "unexpected message type".into(),
        ));
    }
    if message.token.is_empty() || message.designators.is_empty() {
        return Err(BridgeError::InvalidMessage(
            "token and designators are required".into(),
        ));
    }
    if message.designators.len() > MAX_DESIGNATORS {
        return Err(BridgeError::TooManyDesignators);
    }
    if message
        .designators
        .iter()
        .any(|designator| designator.trim() != designator || designator.is_empty())
    {
        return Err(BridgeError::InvalidMessage(
            "designators must be non-empty and trimmed".into(),
        ));
    }
    if message
        .designators
        .iter()
        .any(|designator| designator.chars().count() > MAX_DESIGNATOR_CHARS)
    {
        return Err(BridgeError::DesignatorTooLong);
    }
    let unique = message.designators.iter().collect::<HashSet<_>>();
    if unique.len() != message.designators.len() {
        return Err(BridgeError::InvalidMessage("duplicate designator".into()));
    }
    Ok(message)
}

pub(crate) fn constant_time_eq(left: &str, right: &str) -> bool {
    let mut difference = left.len() ^ right.len();
    let max = left.len().max(right.len());
    for index in 0..max {
        difference |= usize::from(
            left.as_bytes().get(index).copied().unwrap_or(0)
                ^ right.as_bytes().get(index).copied().unwrap_or(0),
        );
    }
    difference == 0
}
