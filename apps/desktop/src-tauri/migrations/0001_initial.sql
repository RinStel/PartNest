CREATE TABLE boxes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rows INTEGER NOT NULL CHECK (rows > 0),
    cols INTEGER NOT NULL CHECK (cols > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE parts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    package TEXT,
    manufacturer TEXT,
    mpn TEXT,
    lcsc_code TEXT,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    box_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    note TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (box_id) REFERENCES boxes(id) ON DELETE RESTRICT,
    UNIQUE (box_id, slot)
);

CREATE UNIQUE INDEX parts_lcsc_code_unique
    ON parts (lcsc_code)
    WHERE lcsc_code IS NOT NULL AND trim(lcsc_code) <> '';

CREATE TABLE bom_files (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    cache_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (sha256)
);

CREATE TABLE welding_sessions (
    id TEXT PRIMARY KEY,
    bom_file_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (bom_file_id) REFERENCES bom_files(id) ON DELETE RESTRICT
);

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

CREATE TABLE inventory_movements (
    id TEXT PRIMARY KEY,
    part_id TEXT,
    session_id TEXT,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'consume', 'adjust', 'reverse')),
    quantity INTEGER NOT NULL CHECK (quantity <> 0),
    reason TEXT NOT NULL,
    reverses_movement_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE SET NULL,
    FOREIGN KEY (session_id) REFERENCES welding_sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (reverses_movement_id) REFERENCES inventory_movements(id) ON DELETE RESTRICT
);

CREATE INDEX inventory_movements_part_id ON inventory_movements (part_id);
CREATE INDEX inventory_movements_session_id ON inventory_movements (session_id);
