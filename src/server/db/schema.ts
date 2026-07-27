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
  },
  // v2 — task due dates + tags
  (db) => {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN due_date TEXT;

      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#78716c'
      );

      CREATE TABLE project_tags (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (project_id, tag_id)
      );

      CREATE INDEX idx_project_tags_project ON project_tags(project_id);
      CREATE INDEX idx_project_tags_tag ON project_tags(tag_id);
    `)
  },
  // v3 — agent write surface: task bodies, archiving instead of deletion, provenance,
  // tags on individual items, and an append-only change log.
  (db) => {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN body TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN archived_at TEXT;
      ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
      ALTER TABLE tasks ADD COLUMN updated_by TEXT NOT NULL DEFAULT '';

      ALTER TABLE notes ADD COLUMN archived_at TEXT;
      ALTER TABLE notes ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
      ALTER TABLE notes ADD COLUMN updated_by TEXT NOT NULL DEFAULT '';

      ALTER TABLE ideas ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
      ALTER TABLE ideas ADD COLUMN updated_by TEXT NOT NULL DEFAULT '';

      -- Polymorphic tag links for tasks/ideas/notes. There is deliberately no foreign key
      -- on (item_type, item_id) — SQLite cannot express one — so the repo layer clears
      -- orphaned rows when an item is deleted.
      CREATE TABLE item_tags (
        item_type TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (item_type, item_id, tag_id)
      );

      CREATE INDEX idx_item_tags_item ON item_tags(item_type, item_id);
      CREATE INDEX idx_item_tags_tag ON item_tags(tag_id);

      -- Append-only trail of writes, so an agent's changes are visible and reviewable.
      CREATE TABLE changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'ui',
        actor TEXT NOT NULL DEFAULT '',
        project_id INTEGER,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        action TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX idx_changes_at ON changes(at);
      CREATE INDEX idx_changes_project ON changes(project_id);
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
