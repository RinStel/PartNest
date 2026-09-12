-- Migrate legacy UUID box IDs to SQLite integer IDs while keeping the human
-- readable slot label (A0, B3, ...) in parts.slot. SQLite cannot alter a
-- referenced column's declared type in place, so rebuild the dependent tables
-- inside the migration transaction and carry every legacy foreign key across.

-- Dropping the legacy inventory_movements table deletes its rows first, and a
-- reversal row pointing at its own table's take row would then trip the
-- "REFERENCES inventory_movements(id) ON DELETE RESTRICT" clause and abort the whole
-- upgrade. Deferring foreign key checks until the migration transaction commits lets
-- the swap finish, and the rebuilt tables are still validated at COMMIT.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE boxes_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rows INTEGER NOT NULL CHECK (rows > 0),
    cols INTEGER NOT NULL CHECK (cols > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    legacy_id TEXT NOT NULL UNIQUE
);

INSERT INTO boxes_new (name, rows, cols, created_at, updated_at, legacy_id)
SELECT name, rows, cols, created_at, updated_at, id
  FROM boxes
 ORDER BY rowid;

CREATE TABLE boxes_final (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rows INTEGER NOT NULL CHECK (rows > 0),
    cols INTEGER NOT NULL CHECK (cols > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO boxes_final (id, name, rows, cols, created_at, updated_at)
SELECT id, name, rows, cols, created_at, updated_at
  FROM boxes_new;

CREATE TABLE parts_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    package TEXT,
    manufacturer TEXT,
    mpn TEXT,
    lcsc_code TEXT,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    box_id INTEGER,
    slot TEXT,
    note TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (box_id) REFERENCES boxes_final(id) ON DELETE RESTRICT,
    CHECK ((box_id IS NULL) = (slot IS NULL)),
    UNIQUE (box_id, slot)
);

INSERT INTO parts_new (
    id, name, category, package, manufacturer, mpn, lcsc_code, quantity,
    box_id, slot, note, version, created_at, updated_at
)
SELECT p.id, p.name, p.category, p.package, p.manufacturer, p.mpn,
       p.lcsc_code, p.quantity,
       CASE WHEN p.quantity = 0 THEN NULL ELSE b.id END,
       CASE WHEN p.quantity = 0 THEN NULL ELSE p.slot END,
       p.note, p.version, p.created_at, p.updated_at
  FROM parts AS p
  LEFT JOIN boxes_new AS b ON b.legacy_id = p.box_id;

CREATE TABLE welding_progress_new (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    component_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('top', 'bottom')),
    part_id TEXT,
    required_quantity INTEGER NOT NULL CHECK (required_quantity >= 0),
    taken_quantity INTEGER NOT NULL CHECK (taken_quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (session_id) REFERENCES welding_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (part_id) REFERENCES parts_new(id) ON DELETE SET NULL,
    UNIQUE (session_id, component_key, side)
);

INSERT INTO welding_progress_new (
    id, session_id, component_key, side, part_id,
    required_quantity, taken_quantity, updated_at
)
SELECT id, session_id, component_key, side, part_id,
       required_quantity, taken_quantity, updated_at
  FROM welding_progress;

CREATE TABLE inventory_movements_new (
    id TEXT PRIMARY KEY,
    part_id TEXT,
    session_id TEXT,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'consume', 'adjust', 'reverse')),
    quantity INTEGER NOT NULL CHECK (quantity <> 0),
    reason TEXT NOT NULL,
    reverses_movement_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    component_key TEXT,
    side TEXT CHECK (side IS NULL OR side IN ('top', 'bottom')),
    before_quantity INTEGER,
    after_quantity INTEGER,
    movement_sequence INTEGER,
    bom_quantity INTEGER,
    confirmation_designators TEXT,
    FOREIGN KEY (part_id) REFERENCES parts_new(id) ON DELETE SET NULL,
    FOREIGN KEY (session_id) REFERENCES welding_sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (reverses_movement_id) REFERENCES inventory_movements_new(id) ON DELETE RESTRICT
);

INSERT INTO inventory_movements_new (
    id, part_id, session_id, movement_type, quantity, reason,
    reverses_movement_id, created_at, component_key, side, before_quantity,
    after_quantity, movement_sequence, bom_quantity, confirmation_designators
)
SELECT id, part_id, session_id, movement_type, quantity, reason,
       reverses_movement_id, created_at, component_key, side, before_quantity,
       after_quantity, movement_sequence, bom_quantity, confirmation_designators
  FROM inventory_movements;

DROP TABLE inventory_movements;
DROP TABLE welding_progress;
DROP TABLE parts;
DROP TABLE boxes;
DROP TABLE boxes_new;

ALTER TABLE boxes_final RENAME TO boxes;
ALTER TABLE parts_new RENAME TO parts;
ALTER TABLE welding_progress_new RENAME TO welding_progress;
ALTER TABLE inventory_movements_new RENAME TO inventory_movements;

CREATE UNIQUE INDEX parts_lcsc_code_unique
    ON parts (lcsc_code)
    WHERE lcsc_code IS NOT NULL AND trim(lcsc_code) <> '';
CREATE INDEX inventory_movements_part_id ON inventory_movements (part_id);
CREATE INDEX inventory_movements_session_id ON inventory_movements (session_id);
CREATE INDEX inventory_movements_welding_scope
    ON inventory_movements (session_id, component_key, side);
CREATE INDEX inventory_movements_sequence_order
    ON inventory_movements (movement_sequence);
