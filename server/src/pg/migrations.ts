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
  // 3 — classes: a teacher's room, its question set and who joined (Phase 14)
  `
  CREATE TABLE classes (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           TEXT        NOT NULL UNIQUE,
    name           TEXT        NOT NULL,
    owner_user_id  BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    city_seed      TEXT,
    banks_open     JSONB       NOT NULL DEFAULT '[1,2,3,4,5]',
    round_minutes  NUMERIC,
    player_cap     INTEGER     NOT NULL DEFAULT 100 CHECK (player_cap BETWEEN 60 AND 200),
    locked         BOOLEAN     NOT NULL DEFAULT false,
    archived       BOOLEAN     NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX classes_owner ON classes (owner_user_id);

  CREATE TABLE class_questions (
    class_id    BIGINT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    usage       TEXT   NOT NULL CHECK (usage IN ('vault', 'heal', 'gun', 'ammo')),
    PRIMARY KEY (class_id, question_id, usage)
  );

  CREATE TABLE class_members (
    class_id  BIGINT      NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    player_id BIGINT      NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (class_id, player_id)
  );
  CREATE INDEX class_members_player ON class_members (player_id);
  `,
  // 4 — what happened in a class's rounds (Phase 14.9)
  `
  CREATE TABLE class_rounds (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    class_id   BIGINT      NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    number     INTEGER     NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at   TIMESTAMPTZ NOT NULL,
    awards     JSONB       NOT NULL DEFAULT '[]'
  );
  CREATE INDEX class_rounds_class ON class_rounds (class_id, ended_at DESC);

  CREATE TABLE class_results (
    round_id   BIGINT  NOT NULL REFERENCES class_rounds (id) ON DELETE CASCADE,
    rank       INTEGER NOT NULL,
    player_id  BIGINT  REFERENCES players (id) ON DELETE SET NULL,
    name       TEXT    NOT NULL,
    banked     BIGINT  NOT NULL,
    kills      INTEGER NOT NULL,
    deaths     INTEGER NOT NULL,
    PRIMARY KEY (round_id, rank)
  );
  CREATE INDEX class_results_player ON class_results (player_id);
  `,
  // 5 — the learning record: every attempt, and live profile totals (Phase 15)
  `
  CREATE TABLE attempt_events (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at           TIMESTAMPTZ NOT NULL,
    player_id    BIGINT REFERENCES players (id) ON DELETE SET NULL,
    class_id     BIGINT REFERENCES classes (id) ON DELETE SET NULL,
    challenge_id TEXT        NOT NULL,
    question_id  BIGINT      NOT NULL,
    reward_key   TEXT        NOT NULL,
    kind         TEXT        NOT NULL,
    detail       JSONB
  );
  CREATE INDEX attempt_events_player ON attempt_events (player_id, at);
  CREATE INDEX attempt_events_class ON attempt_events (class_id, at);

  CREATE TABLE attempt_items (
    challenge_id     TEXT        PRIMARY KEY,
    player_id        BIGINT REFERENCES players (id) ON DELETE SET NULL,
    class_id         BIGINT REFERENCES classes (id) ON DELETE SET NULL,
    round            INTEGER,
    question_id      BIGINT      NOT NULL,
    question_version INTEGER     NOT NULL,
    reward_key       TEXT        NOT NULL,
    tier             INTEGER     NOT NULL,
    rcsbe            TEXT        NOT NULL,
    bloom            TEXT        NOT NULL,
    marks            INTEGER     NOT NULL,
    topics           JSONB       NOT NULL DEFAULT '[]',
    outcome          TEXT        NOT NULL,
    runs             INTEGER     NOT NULL,
    submits          INTEGER     NOT NULL,
    wrong_submits    INTEGER     NOT NULL,
    hints_paid       INTEGER     NOT NULL,
    seconds_open     NUMERIC     NOT NULL,
    tutorial         BOOLEAN     NOT NULL,
    counted          BOOLEAN     NOT NULL,
    available        NUMERIC     NOT NULL,
    earned           NUMERIC     NOT NULL,
    issued_at        TIMESTAMPTZ NOT NULL,
    finished_at      TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX attempt_items_player ON attempt_items (player_id, finished_at);
  CREATE INDEX attempt_items_class ON attempt_items (class_id, finished_at);
  CREATE INDEX attempt_items_question ON attempt_items (question_id);

  CREATE TABLE profile_totals (
    player_id BIGINT  NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    scope     TEXT    NOT NULL CHECK (scope IN ('all', 'class', 'round')),
    class_id  BIGINT  NOT NULL DEFAULT 0,
    round     INTEGER NOT NULL DEFAULT 0,
    lens      TEXT    NOT NULL CHECK (lens IN ('rcsbe', 'bloom')),
    dimension TEXT    NOT NULL,
    earned    NUMERIC NOT NULL DEFAULT 0,
    available NUMERIC NOT NULL DEFAULT 0,
    items     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, scope, class_id, round, lens, dimension)
  );
  CREATE INDEX profile_totals_class ON profile_totals (class_id, scope);
  `,
  // 6 — concept cards (Phase 16.1)
  `
  CREATE TABLE concept_cards (
    topic      TEXT PRIMARY KEY,
    title      TEXT        NOT NULL,
    nudge      TEXT        NOT NULL,
    body_md    TEXT        NOT NULL,
    version    INTEGER     NOT NULL DEFAULT 1,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE concept_card_versions (
    topic      TEXT        NOT NULL,
    version    INTEGER     NOT NULL,
    title      TEXT        NOT NULL,
    nudge      TEXT        NOT NULL,
    body_md    TEXT        NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (topic, version)
  );
  `,
  // 7 — pre/post assessments of a class (Phase 16.10)
  `
  CREATE TABLE assessments (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    class_id     BIGINT      NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    kind         TEXT        NOT NULL CHECK (kind IN ('pre', 'post')),
    question_ids JSONB       NOT NULL DEFAULT '[]',
    open         BOOLEAN     NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (class_id, kind)
  );

  ALTER TABLE attempt_items ADD COLUMN assessment TEXT CHECK (assessment IN ('pre', 'post'));
  CREATE INDEX attempt_items_assessment ON attempt_items (class_id, assessment) WHERE assessment IS NOT NULL;

  ALTER TABLE profile_totals DROP CONSTRAINT profile_totals_scope_check;
  ALTER TABLE profile_totals ADD CONSTRAINT profile_totals_scope_check
    CHECK (scope IN ('all', 'class', 'round', 'pre', 'post'));
  `,
  // 8 — open briefs handed in between rounds, and their marking (Phase 17.10–17.11)
  `
  CREATE TABLE brief_submissions (
    challenge_id     TEXT        PRIMARY KEY,
    player_id        BIGINT      REFERENCES players (id) ON DELETE CASCADE,
    class_id         BIGINT      REFERENCES classes (id) ON DELETE SET NULL,
    round            INTEGER,
    question_id      BIGINT      NOT NULL,
    question_version INTEGER     NOT NULL,
    title            TEXT        NOT NULL,
    story            TEXT        NOT NULL,
    rcsbe            TEXT        NOT NULL,
    bloom            TEXT        NOT NULL,
    item_marks       NUMERIC     NOT NULL,
    topics           JSONB       NOT NULL DEFAULT '[]',
    rubric           JSONB       NOT NULL,
    text             TEXT        NOT NULL,
    sql              TEXT        NOT NULL,
    submitted_at     TIMESTAMPTZ NOT NULL,
    marks            JSONB,
    feedback         TEXT,
    marked_by        TEXT,
    marked_at        TIMESTAMPTZ
  );
  CREATE INDEX brief_submissions_queue ON brief_submissions (class_id, marked_at, submitted_at);
  `,
  // 9 — a class's dialect pack (Phase 17.14)
  `
  ALTER TABLE classes ADD COLUMN dialect TEXT NOT NULL DEFAULT 'sqlite';
  `,
  // 10 — a question keeps its key order. JSONB sorts object keys, which scrambled the order of a
  // question's tables (a foreign key must point at an earlier table) and broke 106 of 268 questions.
  // JSON stores the text as written. Rows saved under JSONB keep the order JSONB gave them.
  `
  ALTER TABLE questions ALTER COLUMN template_json TYPE JSON USING template_json::json;
  ALTER TABLE question_versions ALTER COLUMN template_json TYPE JSON USING template_json::json;
  `,
  // 11 — privacy (Phase 21): the school's consent for a class, when it was archived, and the
  // verdict of a student's age declaration (never the birth year).
  `
  ALTER TABLE classes ADD COLUMN consent_version INTEGER;
  ALTER TABLE classes ADD COLUMN consent_user_id BIGINT REFERENCES users (id) ON DELETE SET NULL;
  ALTER TABLE classes ADD COLUMN consent_at TIMESTAMPTZ;
  ALTER TABLE classes ADD COLUMN archived_at TIMESTAMPTZ;
  UPDATE classes SET archived_at = updated_at WHERE archived;
  ALTER TABLE players ADD COLUMN age_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (age_status IN ('unknown', 'ok', 'too_young'));
  `,
  // 12 — a player's own settings (Phase 22.1): keys, sensitivity, volumes, accessibility
  `
  CREATE TABLE player_settings (
    player_id  BIGINT      PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
    settings   JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
  // 13 — XP and ranks (Phase 26.1): what a student has earned by learning and by playing
  `
  CREATE TABLE player_progress (
    player_id   BIGINT      PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
    learning_xp BIGINT      NOT NULL DEFAULT 0 CHECK (learning_xp >= 0),
    play_xp     BIGINT      NOT NULL DEFAULT 0 CHECK (play_xp >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
  // 14 — what a student wears (Phase 26.3)
  `
  CREATE TABLE player_loadout (
    player_id  BIGINT      PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
    choice     JSON        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
  // 15 — daily contracts and the day streak (Phase 26.5)
  `
  CREATE TABLE player_contracts (
    player_id BIGINT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    day       DATE   NOT NULL,
    state     JSON   NOT NULL,
    PRIMARY KEY (player_id, day)
  );
  CREATE TABLE player_streaks (
    player_id  BIGINT      PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
    days       INTEGER     NOT NULL DEFAULT 0 CHECK (days >= 0),
    last_day   DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
  // 16 — season XP (Phase 26.7): XP earned while a season ran, kept per season
  `
  CREATE TABLE player_season_xp (
    player_id BIGINT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    season    TEXT   NOT NULL,
    xp        BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
    PRIMARY KEY (player_id, season)
  );
  `,
  // 17 — squads inside a class (Phase 27): how they are formed, and who is in which
  `
  ALTER TABLE classes ADD COLUMN squad_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (squad_mode IN ('off', 'teacher', 'self', 'auto'));
  ALTER TABLE classes ADD COLUMN squad_size INTEGER NOT NULL DEFAULT 4
    CHECK (squad_size BETWEEN 3 AND 4);
  CREATE TABLE class_squads (
    class_id  BIGINT  NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    player_id BIGINT  NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    squad     INTEGER NOT NULL CHECK (squad >= 1),
    PRIMARY KEY (class_id, player_id)
  );
  `,
  // 18 — the game mode a class plays (Phase 28)
  `
  ALTER TABLE classes ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic';
  `,
  // 19 — data chips a student has found (Phase 30.3)
  `
  CREATE TABLE player_collectibles (
    player_id   BIGINT      NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    chip        TEXT        NOT NULL,
    found_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, chip)
  );
  `,
  // 20 — safehouse upgrades a student owns (Phase 30.4)
  `
  CREATE TABLE player_upgrades (
    player_id BIGINT  NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    upgrade   TEXT    NOT NULL,
    level     INTEGER NOT NULL CHECK (level >= 0),
    PRIMARY KEY (player_id, upgrade)
  );
  `,
  // 21 — how far a student is through each story chain (Phase 32.2)
  `
  CREATE TABLE player_story (
    player_id BIGINT  NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    chain     TEXT    NOT NULL,
    step      INTEGER NOT NULL CHECK (step >= 0),
    PRIMARY KEY (player_id, chain)
  );
  `,
  // 22 — the leanest correct query of each student, per question (Phase 34.4)
  `
  CREATE TABLE query_records (
    question_id BIGINT      NOT NULL,
    player_id   BIGINT      NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    class_id    BIGINT,
    scanned     INTEGER     NOT NULL CHECK (scanned >= 0),
    length      INTEGER     NOT NULL CHECK (length >= 0),
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (question_id, player_id)
  );
  CREATE INDEX query_records_class ON query_records (class_id, question_id);
  `,
  // 23 — a teacher's own heists, shareable by code (Phase 34.5)
  `
  CREATE TABLE custom_heists (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id BIGINT,
    name          TEXT        NOT NULL,
    spec          JSON        NOT NULL,
    share_code    TEXT        NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX custom_heists_owner ON custom_heists (owner_user_id);
  `,
  // 24 — each student's fastest heist on each bank, kept as a ghost (Phase 34.6)
  `
  CREATE TABLE ghost_heists (
    bank        TEXT        NOT NULL,
    player_id   BIGINT      NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    seconds     INTEGER     NOT NULL CHECK (seconds >= 0),
    take        BIGINT      NOT NULL CHECK (take >= 0),
    trace       JSON        NOT NULL,
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (bank, player_id)
  );
  `,
  // 25 — a recording of each round for the teacher to replay (Phase 35.2); only the newest are kept
  `
  ALTER TABLE class_rounds ADD COLUMN replay JSONB;
  `,
];
