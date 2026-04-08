ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_bot   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN is_test_mode INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO users (username, password_hash, salt, is_bot, is_admin)
VALUES
  ('Andy',
   '2f3e5a700d5c568561c5bb1db688c20e70b04ac2c4c30d63b61e963dcaf1d146',
   'd4c672acd04728977b0d24e409b46321',
   0,
   1
  );

-- Create bot accounts (cannot log in; used only for test mode games)
INSERT OR IGNORE INTO users (username, password_hash, salt, is_bot)
VALUES
  ('Bot01', 'bot-no-login', 'bot-salt-01', 1),
  ('Bot02', 'bot-no-login', 'bot-salt-02', 1),
  ('Bot03', 'bot-no-login', 'bot-salt-03', 1),
  ('Bot04', 'bot-no-login', 'bot-salt-04', 1);

-- Grant admin to Andy (case-insensitive; no-op if account doesn't exist yet)
-- To grant admin manually: wrangler d1 execute sheepshead-db --local --command "UPDATE users SET is_admin=1 WHERE lower(username)='andy'"
UPDATE users SET is_admin = 1 WHERE lower(username) = 'andy';
