-- hand_players snapshots the seat→user mapping for a hand at deal time.
-- The live game_players roster changes when players leave/join, but a hand's
-- historical participants must remain attributable for the recap (#143).

CREATE TABLE hand_players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hand_number INTEGER NOT NULL,
  seat        INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  UNIQUE(game_id, hand_number, seat),
  UNIQUE(game_id, hand_number, user_id)
);

CREATE INDEX idx_hand_players_game_hand ON hand_players(game_id, hand_number);

-- Backfill: for every existing hand, copy the *current* game_players roster.
-- This is correct for games with no mid-game leaves. For games where a player
-- left pre-migration, the snapshot will show the replacement instead of the
-- original — we accept this for historical hands; post-migration hands record
-- correctly at deal time.
INSERT INTO hand_players (game_id, hand_number, seat, user_id)
SELECT h.game_id, h.hand_number, gp.seat, gp.user_id
FROM hands h
JOIN game_players gp ON gp.game_id = h.game_id;
