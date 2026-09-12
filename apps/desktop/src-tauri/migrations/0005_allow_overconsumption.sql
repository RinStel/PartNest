-- Keep the original BOM requirement independent from actual consumed stock.
-- Existing databases must rebuild the table because SQLite cannot drop the
-- old CHECK (taken_quantity <= required_quantity) constraint in place.
ALTER TABLE welding_progress RENAME TO welding_progress_legacy;

CREATE TABLE welding_progress (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    component_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('top', 'bottom')),
    part_id TEXT,
    required_quantity INTEGER NOT NULL CHECK (required_quantity >= 0),
    taken_quantity INTEGER NOT NULL CHECK (taken_quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (session_id) REFERENCES welding_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE SET NULL,
    UNIQUE (session_id, component_key, side)
);

INSERT INTO welding_progress (
    id, session_id, component_key, side, part_id,
    required_quantity, taken_quantity, updated_at
)
SELECT id, session_id, component_key, side, part_id,
       required_quantity, taken_quantity, updated_at
  FROM welding_progress_legacy;

DROP TABLE welding_progress_legacy;
