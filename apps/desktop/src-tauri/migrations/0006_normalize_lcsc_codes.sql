-- Canonicalize legacy values before enforcing case-insensitive uniqueness.
-- If two legacy rows normalize to the same code, the unique index creation
-- fails and the migration transaction rolls back without changing data.
DROP INDEX parts_lcsc_code_unique;

UPDATE parts
   SET lcsc_code = upper(trim(lcsc_code))
 WHERE lcsc_code IS NOT NULL AND trim(lcsc_code) <> '';

CREATE UNIQUE INDEX parts_lcsc_code_unique
    ON parts (lcsc_code COLLATE NOCASE)
    WHERE lcsc_code IS NOT NULL AND trim(lcsc_code) <> '';
