-- Schemat. Idempotent: varje tabell skapas med IF NOT EXISTS och körs vid varje start.
-- Föreningens data (events) ägs av hämtaren. Våra val (overrides) ägs av oss.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  google_id     TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  roll          TEXT NOT NULL DEFAULT 'barn',
  skapad_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS feeds (
  id              TEXT PRIMARY KEY,
  child           TEXT NOT NULL,
  sport           TEXT NOT NULL,
  club            TEXT NOT NULL,
  label           TEXT NOT NULL,
  color           TEXT NOT NULL,
  url             TEXT NOT NULL,
  aktiv           INTEGER NOT NULL DEFAULT 1,
  samling_monster TEXT,
  -- Valfritt filter: bara händelser vars titel, beskrivning eller kategori matchar sparas.
  -- Behövs när flödet är hela föreningens kalender och bara en avdelning gäller.
  filter_monster  TEXT,
  etag            TEXT,
  last_modified   TEXT,
  last_fetch_at   INTEGER,
  last_status     TEXT,
  last_error      TEXT,
  fel_i_rad       INTEGER NOT NULL DEFAULT 0
);

-- Barnen. Namnet är nyckeln eftersom det är det som står i feeds.child och lag.barn.
-- Färgen hör hit och inte till flödet: ett barn kan ha flera flöden och ska ha samma färg i alla.
CREATE TABLE IF NOT EXISTS barn (
  namn      TEXT PRIMARY KEY,
  farg      TEXT NOT NULL,
  sortering INTEGER NOT NULL DEFAULT 0
);

-- Sporterna och deras färger. Färgen på kortets list betyder barnet; sporten får en egen prick,
-- så att man ser skillnad på bandy och innebandy utan att barnets färg försvinner.
CREATE TABLE IF NOT EXISTS sport (
  namn TEXT PRIMARY KEY,
  farg TEXT NOT NULL
);

-- Vilka barn ett flöde gäller. En föreningskalender kan gälla syskon i samma lag, och då är
-- `feeds.child` (reserv för händelser utan lagkod) inte nog.
CREATE TABLE IF NOT EXISTS feed_barn (
  feed_id TEXT NOT NULL,
  barn    TEXT NOT NULL,
  PRIMARY KEY (feed_id, barn)
);

-- Lagkod → barn och sport. Behövs för att föreningens kalender är gemensam: en adress ger flera
-- lag, flera barn och båda sporterna.
CREATE TABLE IF NOT EXISTS lag (
  kode      TEXT PRIMARY KEY,
  barn      TEXT NOT NULL,
  sport     TEXT NOT NULL,
  klubb     TEXT,
  monster   TEXT,
  farg      TEXT,
  kommentar TEXT
);

CREATE TABLE IF NOT EXISTS platser (
  id           INTEGER PRIMARY KEY,
  namn         TEXT NOT NULL,
  normaliserat TEXT NOT NULL UNIQUE,
  adress       TEXT,
  lat          REAL,
  lon          REAL,
  kommentar    TEXT
);

CREATE TABLE IF NOT EXISTS events (
  feed_id       TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  uid           TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,
  titel         TEXT NOT NULL,
  lag           TEXT,
  sport_titel   TEXT,
  beskrivning   TEXT,
  plats_text    TEXT,
  plats_id      INTEGER REFERENCES platser(id),
  start_ms      INTEGER NOT NULL,
  slut_ms       INTEGER NOT NULL,
  heldag        INTEGER NOT NULL DEFAULT 0,
  ics_status    TEXT NOT NULL DEFAULT 'CONFIRMED',
  samling_ms    INTEGER,
  samling_kalla TEXT,
  motstandare   TEXT,
  hemmamatch    INTEGER,
  flerdygn      INTEGER NOT NULL DEFAULT 0,
  missing_since INTEGER,
  forst_sedd    INTEGER NOT NULL,
  senast_sedd   INTEGER NOT NULL,
  PRIMARY KEY (feed_id, uid)
);

CREATE INDEX IF NOT EXISTS events_start ON events (start_ms);
CREATE INDEX IF NOT EXISTS events_fp ON events (fingerprint);

CREATE TABLE IF NOT EXISTS overrides (
  feed_id          TEXT NOT NULL,
  uid              TEXT NOT NULL,
  dold             INTEGER NOT NULL DEFAULT 0,
  ansvarig_typ     TEXT NOT NULL DEFAULT 'ingen',
  ansvarig_user_id INTEGER REFERENCES users(id),
  anteckning       TEXT,
  samling_ms       INTEGER,
  updated_by       INTEGER REFERENCES users(id),
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (feed_id, uid)
);

CREATE TABLE IF NOT EXISTS fetch_runs (
  id         INTEGER PRIMARY KEY,
  feed_id    TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ms         INTEGER NOT NULL,
  status     TEXT NOT NULL,
  antal      INTEGER,
  fel        TEXT
);
