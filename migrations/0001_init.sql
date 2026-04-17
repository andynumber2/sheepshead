-- migrations/0001_init.sql
-- Full schema. Creates all tables and seeds initial data.

PRAGMA foreign_keys = OFF;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_bot        INTEGER NOT NULL DEFAULT 0,
  bot_type      TEXT
);

CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'waiting',
  created_by    INTEGER NOT NULL REFERENCES users(id),
  current_hand  INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT    NOT NULL DEFAULT '{}',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE game_players (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  seat      INTEGER NOT NULL,
  joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, user_id),
  UNIQUE(game_id, seat)
);

CREATE TABLE game_state (
  game_id    INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  state_json TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE hands (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hand_number  INTEGER NOT NULL,
  variant      TEXT,
  started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE(game_id, hand_number)
);

CREATE TABLE hand_actions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hand_number  INTEGER NOT NULL,
  seq          INTEGER NOT NULL,
  type         TEXT    NOT NULL,
  user_id      INTEGER REFERENCES users(id),
  payload_json TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, hand_number, seq)
);

CREATE INDEX idx_hand_actions_game_hand ON hand_actions(game_id, hand_number);

CREATE TABLE score_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  game_id     INTEGER NOT NULL REFERENCES games(id),
  hand_number INTEGER NOT NULL,
  delta       INTEGER NOT NULL,
  recorded_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_score_events_user ON score_events(user_id);
CREATE INDEX idx_score_events_game ON score_events(game_id);
CREATE INDEX idx_score_events_date ON score_events(recorded_at);

CREATE TABLE user_scores (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lifetime_score INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

PRAGMA foreign_keys = ON;

-- Seed users
INSERT INTO users (username, password_hash, salt, is_bot, is_admin)
VALUES ('Andy', '2f3e5a700d5c568561c5bb1db688c20e70b04ac2c4c30d63b61e963dcaf1d146', 'd4c672acd04728977b0d24e409b46321', 0, 1);

INSERT OR IGNORE INTO users (username, password_hash, salt, is_bot, bot_type) VALUES
  ('Bot01', 'bot-no-login', 'bot-salt-01', 1, 'test'),
  ('Bot02', 'bot-no-login', 'bot-salt-02', 1, 'test'),
  ('Bot03', 'bot-no-login', 'bot-salt-03', 1, 'test'),
  ('Bot04', 'bot-no-login', 'bot-salt-04', 1, 'test');

INSERT OR IGNORE INTO users (username, password_hash, salt, is_bot, bot_type) VALUES
  ('Oliver',    'bot-no-login', 'play-salt-01', 1, 'play'),
  ('Emma',      'bot-no-login', 'play-salt-02', 1, 'play'),
  ('William',   'bot-no-login', 'play-salt-03', 1, 'play'),
  ('Sophia',    'bot-no-login', 'play-salt-04', 1, 'play'),
  ('James',     'bot-no-login', 'play-salt-05', 1, 'play'),
  ('Ava',       'bot-no-login', 'play-salt-06', 1, 'play'),
  ('Henry',     'bot-no-login', 'play-salt-07', 1, 'play'),
  ('Isabella',  'bot-no-login', 'play-salt-08', 1, 'play'),
  ('Michael',   'bot-no-login', 'play-salt-09', 1, 'play'),
  ('Charlotte', 'bot-no-login', 'play-salt-10', 1, 'play'),
  ('Alexander', 'bot-no-login', 'play-salt-11', 1, 'play'),
  ('Amelia',    'bot-no-login', 'play-salt-12', 1, 'play'),
  ('Daniel',    'bot-no-login', 'play-salt-13', 1, 'play'),
  ('Evelyn',    'bot-no-login', 'play-salt-14', 1, 'play'),
  ('Benjamin',  'bot-no-login', 'play-salt-15', 1, 'play'),
  ('Abigail',   'bot-no-login', 'play-salt-16', 1, 'play'),
  ('Joseph',    'bot-no-login', 'play-salt-17', 1, 'play'),
  ('Emily',     'bot-no-login', 'play-salt-18', 1, 'play'),
  ('Samuel',    'bot-no-login', 'play-salt-19', 1, 'play'),
  ('Ella',      'bot-no-login', 'play-salt-20', 1, 'play');

-- Seed config
INSERT INTO config (key, value) VALUES ('max_active_games', '5');
INSERT INTO config (key, value) VALUES ('score_timezone', 'America/Chicago');
