/**
 * Ordered, append-only PostgreSQL migrations. Never edit one that has shipped;
 * add a new one. The schema is the system of record (docs/identity.md); the
 * SQL sandboxes that grade answers stay in-memory SQLite.
 */
export const pgMigrations: readonly string[] = [
  // 1 — content and admin: what the SQLite file held until Phase 13.3
  `
  CREATE TABLE questions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug            TEXT        NOT NULL UNIQUE,
    tier            INTEGER     NOT NULL CHECK (tier BETWEEN 1 AND 5),
    title           TEXT        NOT NULL,
    enabled         BOOLEAN     NOT NULL DEFAULT true,
    current_version INTEGER     NOT NULL DEFAULT 1,
    template_json   JSONB       NOT NULL,
    updated_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
  );
  CREATE INDEX questions_tier_enabled ON questions (tier, enabled) WHERE deleted_at IS NULL;

  CREATE TABLE question_topics (
    question_id BIGINT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    topic       TEXT   NOT NULL,
    PRIMARY KEY (question_id, topic)
  );
  CREATE INDEX question_topics_topic ON question_topics (topic);

  CREATE TABLE question_versions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id   BIGINT      NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    version       INTEGER     NOT NULL,
    template_json JSONB       NOT NULL,
    created_by    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
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
    value_json JSONB NOT NULL
  );

  CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL CHECK (role IN ('admin', 'teacher')),
    disabled      BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- Emails compare without regard to case.
  CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

  CREATE TABLE sessions (
    token_hash TEXT        PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at BIGINT      NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX sessions_user ON sessions (user_id);

  CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT REFERENCES users (id) ON DELETE SET NULL,
    actor       TEXT,
    action      TEXT        NOT NULL,
    entity      TEXT        NOT NULL,
    entity_id   TEXT,
    detail_json JSONB,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);

  CREATE TABLE pools (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX pools_name_lower ON pools (lower(name));

  CREATE TABLE pool_questions (
    pool_id     BIGINT NOT NULL REFERENCES pools (id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    PRIMARY KEY (pool_id, question_id)
  );
  `,
  // 2 — players: who signs in with Google (Phase 13.4). No other personal data is stored.
  `
  CREATE TABLE players (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    google_sub     TEXT        NOT NULL UNIQUE,
    email          TEXT        NOT NULL,
    display_name   TEXT        NOT NULL,
    school_domain  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX players_email_lower ON players (lower(email));

  CREATE TABLE player_sessions (
    token_hash TEXT        PRIMARY KEY,
    player_id  BIGINT      NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    expires_at BIGINT      NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX player_sessions_player ON player_sessions (player_id);
  `,
];
