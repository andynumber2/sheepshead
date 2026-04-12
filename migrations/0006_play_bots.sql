-- Add bot_type column to distinguish test bots from play bots
ALTER TABLE users ADD COLUMN bot_type TEXT;

-- Tag existing test bots
UPDATE users SET bot_type = 'test' WHERE is_bot = 1;

-- Seed play bot accounts (cannot log in; allocated to games on demand)
INSERT OR IGNORE INTO users (username, password_hash, salt, is_bot, bot_type)
VALUES
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
