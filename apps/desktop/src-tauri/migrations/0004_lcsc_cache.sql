CREATE TABLE lcsc_cache (
    lcsc_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    package TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    mpn TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
