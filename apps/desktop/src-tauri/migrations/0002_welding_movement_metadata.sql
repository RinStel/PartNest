ALTER TABLE inventory_movements ADD COLUMN component_key TEXT;
ALTER TABLE inventory_movements ADD COLUMN side TEXT CHECK (side IS NULL OR side IN ('top', 'bottom'));
CREATE INDEX inventory_movements_welding_scope
    ON inventory_movements (session_id, component_key, side);
