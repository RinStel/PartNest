CREATE TABLE project_assets (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    source BLOB NOT NULL,
    companion_json TEXT
);
