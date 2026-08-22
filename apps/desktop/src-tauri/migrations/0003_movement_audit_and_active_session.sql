ALTER TABLE inventory_movements ADD COLUMN before_quantity INTEGER;
ALTER TABLE inventory_movements ADD COLUMN after_quantity INTEGER;
ALTER TABLE inventory_movements ADD COLUMN movement_sequence INTEGER;
ALTER TABLE inventory_movements ADD COLUMN bom_quantity INTEGER;
ALTER TABLE inventory_movements ADD COLUMN confirmation_designators TEXT;

-- Legacy rows remain readable with nullable audit metadata. A rowid-derived
-- sequence gives them deterministic display order without pretending the
-- reconstructed quantities are authoritative.
UPDATE inventory_movements
   SET movement_sequence = rowid
 WHERE movement_sequence IS NULL;

-- Existing databases may contain several active sessions. Keep the newest
-- one current before enforcing the one-active-session invariant.
UPDATE welding_sessions
   SET status = 'cancelled',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE status = 'active'
   AND id NOT IN (
       SELECT id
         FROM welding_sessions
        WHERE status = 'active'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
   );

CREATE UNIQUE INDEX welding_sessions_one_active
    ON welding_sessions (status)
    WHERE status = 'active';
CREATE INDEX inventory_movements_sequence_order
    ON inventory_movements (movement_sequence);
