import type { DatabaseSync } from 'node:sqlite'

// Ordered, idempotent-at-the-version-level migrations. Each runs once; the applied
// version is stored in the `meta` table. Add new migrations to the end — never edit
// an already-shipped one.
const MIGRATIONS: Array<(db: DatabaseSync) => void> = [
  // v1 — initial schema
  (db) => {
    db.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        is_favorite INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        stack TEXT NOT NULL DEFAULT '[]',
        git_has INTEGER NOT NULL DEFAULT 0,
        git_branch TEXT,
        git_last_commit_at TEXT,
        git_last_commit_message TEXT,
        git_last_commit_hash TEXT,
        git_dirty INTEGER NOT NULL DEFAULT 0,
        git_ahead INTEGER NOT NULL DEFAULT 0,
        git_behind INTEGER NOT NULL DEFAULT 0,
        git_remote_url TEXT,
        last_scanned_at TEXT,
        last_opened_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        done_at TEXT
      );

      CREATE TABLE captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        kind TEXT NOT NULL DEFAULT 'note',
        text TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        processed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE launch_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'vscode',
        value TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
        sort INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX idx_notes_project ON notes(project_id);
      CREATE INDEX idx_ideas_project ON ideas(project_id);
      CREATE INDEX idx_tasks_project ON tasks(project_id);
      CREATE INDEX idx_captures_project ON captures(project_id);
      CREATE INDEX idx_launch_project ON launch_profiles(project_id);
    `)
  }
]

function getVersion(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined
  return row ? Number(row.value) : 0
}

function setVersion(db: DatabaseSync, version: number): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('schema_version', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(version))
}

export function runMigrations(db: DatabaseSync): void {
  const current = getVersion(db)
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    const migrate = MIGRATIONS[version - 1]
    db.exec('BEGIN')
    try {
      migrate(db)
      setVersion(db, version)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
