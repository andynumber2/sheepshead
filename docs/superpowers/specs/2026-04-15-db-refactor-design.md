# Database Refactor Design

**Date:** 2026-04-15
**Issues addressed:** #70 (action log replay), #109 (score scalability), #111 (timezone coupling), #120 (game recap)
**Approach:** Clean slate — existing data is not migrated.

---

## Overview

The current schema has accumulated technical debt: a monolithic `game_state` JSON blob that stores rewind snapshots, unbounded `score_events` aggregation on every read, timezone coupling baked into `score_events`, and game settings scattered as ALTER TABLE additions on `games`. Several planned features (recap, action-log rewind, scalable scores) are blocked by or made awkward by the current structure.

This refactor replaces the schema with a clean design built around three principles:

1. **Action log as source of truth for hand history** — every player action is an append-only row. Rewind, replay, and recap all derive from this log.
2. **game_state as a performance cache** — the current hand state is always readable instantly; it can always be reconstructed from the action log.
3. **Materialized score totals** — lifetime scores are cached in `user_scores`; game and day scores are computed from bounded, indexed queries.

---

## Schema

### `users`
Unchanged. Bots remain in this table, distinguished by `is_bot` and `bot_type`.

```sql
CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    NOT NULL UNIQUE,
  password_hash TEXT   NOT NULL,
  salt         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  is_admin     INTEGER NOT NULL DEFAULT 0,
  is_bot       INTEGER NOT NULL DEFAULT 0,
  bot_type     TEXT    -- 'test' | 'play' | NULL for humans
);
```

### `sessions`
Unchanged.

```sql
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `games`
Settings columns removed. All game configuration lives in `settings_json`. Adding a new setting never requires a migration.

```sql
CREATE TABLE games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'waiting',
  created_by   INTEGER NOT NULL REFERENCES users(id),
  current_hand INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT   NOT NULL DEFAULT '{}',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

`settings_json` contains:
- `no_pick_variant` — `'leasters'` | `'schwanzer'`
- `doubler_multiplier` — integer
- `is_test_mode` — boolean
- `reveal_partner` — boolean
- `double_on_bump` — boolean

### `game_players`
Unchanged.

```sql
CREATE TABLE game_players (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  seat      INTEGER NOT NULL,
  joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, user_id),
  UNIQUE(game_id, seat)
);
```

### `game_state`
Pure current-state cache. `state_json` never contains `rewindHistory`. If lost, can be reconstructed by replaying `hand_actions`.

```sql
CREATE TABLE game_state (
  game_id    INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  state_json TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `hands`
One row per hand. Created when a hand starts, updated when it completes. Stores the variant so history displays and recap don't require replaying the action log.

```sql
CREATE TABLE hands (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hand_number  INTEGER NOT NULL,
  variant      TEXT,   -- 'normal' | 'leaster' | 'schwanzer' | NULL while in-progress
  started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE(game_id, hand_number)
);
```

### `hand_actions`
The action log. Append-only during a hand; frozen at hand completion. The first row of every hand is always `type='deal'` and contains the full dealt state (hands, blind, dealer seat) in `payload_json` — this anchors replay since the shuffle is non-deterministic.

During an active hand, rewind deletes the last action row(s) and replays the remaining sequence to rebuild `game_state`. Once a hand completes, no deletions occur.

```sql
CREATE TABLE hand_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hand_number INTEGER NOT NULL,
  seq         INTEGER NOT NULL,  -- order within the hand, 0-based
  type        TEXT    NOT NULL,  -- 'deal' | 'pick' | 'pass' | 'discard' | 'call_ace' |
                                 -- 'call_ten' | 'call_king' | 'go_alone' | 'play_card' |
                                 -- 'crack' | 'recrack' | 'blitz' | 'schwanzer_score' | etc.
  user_id     INTEGER REFERENCES users(id),  -- NULL for 'deal'
  payload_json TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, hand_number, seq)
);

CREATE INDEX idx_hand_actions_game_hand ON hand_actions(game_id, hand_number);
```

### `score_events`
Clean ledger — real hand scores only. No `game_date`, no `is_adjustment`, no nullable `game_id`. All timestamps are UTC.

```sql
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
```

### `user_scores`
Cached lifetime score totals. Updated atomically alongside every `score_events` insert. Admin score adjustments write here directly — no phantom events in `score_events`.

```sql
CREATE TABLE user_scores (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lifetime_score INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

Game score and day score are still computed from `score_events` directly — both are bounded queries (one game's rows, or one day's rows) that stay fast with existing indexes.

### `config`
Unchanged in structure. Gains `score_timezone`.

```sql
CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO config (key, value) VALUES ('max_active_games', '5');
INSERT INTO config (key, value) VALUES ('score_timezone', 'America/Chicago');
```

---

## How features map to the new schema

### Rewind (#37 / #70)
During an active hand: delete the last `hand_actions` row(s), replay remaining rows through `gameEngine.js` to rebuild `game_state`. The completed hand log always reflects what actually happened — no tombstones or flags.

### Game recap (#120)
Fetch all `hand_actions` for a completed hand. The `deal` action provides the initial dealt state; subsequent actions step through the hand. The frontend can replay these to show the hand trick-by-trick.

### Score scalability (#109)
Lifetime scores read from `user_scores` (single-row lookup). Game scores and day scores are bounded `score_events` queries. No full-table scans.

### Timezone fix (#111)
`score_events` stores only `recorded_at` (UTC). Day score queries read `score_timezone` from `config`, compute the UTC start/end of "today" in that timezone using `Intl`, and filter with `recorded_at BETWEEN ? AND ?`.

---

## What's not in this refactor

- Game recap UI (#120) — the data layer is laid here; the frontend step-through UI is separate scope.
- Admin UI for `score_timezone` — the config key is seeded; a settings UI can be added later.
- Bot table separation — bots remain in `users` with `is_bot` / `bot_type` flags. The allocator already works well with this structure.
