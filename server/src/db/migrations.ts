/**
 * Ordered, append-only list of schema migrations. Never edit a migration that
 * has shipped — add a new one. Index + 1 is stored in PRAGMA user_version.
 */
export const migrations: readonly string[] = [
  // 1 — question store (docs/Architecture.md §6)
  `
  CREATE TABLE questions (
    id              INTEGER PRIMARY KEY,
    slug            TEXT    NOT NULL UNIQUE,
    tier            INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
    title           TEXT    NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    current_version INTEGER NOT NULL DEFAULT 1,
    template_json   TEXT    NOT NULL,
    updated_by      TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at      TEXT
  );
  CREATE INDEX questions_tier_enabled ON questions (tier, enabled) WHERE deleted_at IS NULL;

  CREATE TABLE question_topics (
    question_id INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    topic       TEXT    NOT NULL,
    PRIMARY KEY (question_id, topic)
  );
  CREATE INDEX question_topics_topic ON question_topics (topic);

  CREATE TABLE question_versions (
    id            INTEGER PRIMARY KEY,
    question_id   INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    version       INTEGER NOT NULL,
    template_json TEXT    NOT NULL,
    created_by    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (question_id, version)
  );

  CREATE TABLE reward_map (
    reward_key TEXT    PRIMARY KEY,
    tier_min   INTEGER NOT NULL CHECK (tier_min BETWEEN 1 AND 5),
    tier_max   INTEGER NOT NULL CHECK (tier_max BETWEEN 1 AND 5),
    CHECK (tier_min <= tier_max)
  );

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
];
