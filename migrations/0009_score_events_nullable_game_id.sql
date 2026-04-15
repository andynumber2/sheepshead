-- Make game_id nullable on score_events so that admin adjustment events
-- (which have no associated game) can be inserted with game_id = NULL.

PRAGMA foreign_keys=OFF;

CREATE TABLE score_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  game_id INTEGER,
  hand_number INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  game_date TEXT,
  is_adjustment INTEGER NOT NULL DEFAULT 0
);

INSERT INTO score_events_new (id, user_id, game_id, hand_number, delta, recorded_at, game_date, is_adjustment)
  SELECT id, user_id, game_id, hand_number, delta, recorded_at, game_date, is_adjustment
  FROM score_events;

DROP TABLE score_events;

ALTER TABLE score_events_new RENAME TO score_events;

CREATE INDEX idx_score_events_user ON score_events(user_id);
CREATE INDEX idx_score_events_game ON score_events(game_id);
CREATE INDEX idx_score_events_date ON score_events(recorded_at);

PRAGMA foreign_keys=ON;
