ALTER TABLE score_events ADD COLUMN game_date TEXT;
ALTER TABLE score_events ADD COLUMN is_adjustment INTEGER NOT NULL DEFAULT 0;
