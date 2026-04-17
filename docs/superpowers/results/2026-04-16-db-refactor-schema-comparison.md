# Schema Comparison: `main` vs `db-refactor-sonnet`

Side-by-side comparison of every table. Changes are noted inline.

Issues addressed by this refactor: [#70](https://github.com/andynumber2/sheepshead/issues/70) (action log replay), [#109](https://github.com/andynumber2/sheepshead/issues/109) (score scalability), [#111](https://github.com/andynumber2/sheepshead/issues/111) (timezone coupling), [#120](https://github.com/andynumber2/sheepshead/issues/120) (game recap data layer)

---

## `users`

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `id` | `INTEGER PK AUTOINCREMENT` | `INTEGER PK AUTOINCREMENT` |
| `username` | `TEXT NOT NULL UNIQUE` | `TEXT NOT NULL UNIQUE` |
| `password_hash` | `TEXT NOT NULL` | `TEXT NOT NULL` |
| `salt` | `TEXT NOT NULL` | `TEXT NOT NULL` |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `TEXT NOT NULL DEFAULT (datetime('now'))` |
| `is_admin` | `INTEGER NOT NULL DEFAULT 0` | `INTEGER NOT NULL DEFAULT 0` |
| `is_bot` | `INTEGER NOT NULL DEFAULT 0` | `INTEGER NOT NULL DEFAULT 0` |
| `bot_type` | `TEXT` | `TEXT` |

**No changes.**

---

## `sessions`

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `id` | `TEXT PK` | `TEXT PK` |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` |
| `expires_at` | `TEXT NOT NULL` | `TEXT NOT NULL` |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `TEXT NOT NULL DEFAULT (datetime('now'))` |

**No changes.**

---

## `games`

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `id` | `INTEGER PK AUTOINCREMENT` | `INTEGER PK AUTOINCREMENT` |
| `name` | `TEXT NOT NULL` | `TEXT NOT NULL` |
| `status` | `TEXT NOT NULL DEFAULT 'waiting'` | `TEXT NOT NULL DEFAULT 'waiting'` |
| `no_pick_variant` | `TEXT NOT NULL DEFAULT 'leasters'` | ~~removed~~ |
| `doubler_multiplier` | `INTEGER NOT NULL DEFAULT 1` | ~~removed~~ |
| `is_test_mode` | `INTEGER NOT NULL DEFAULT 0` | ~~removed~~ |
| `reveal_partner` | `INTEGER NOT NULL DEFAULT 1` | ~~removed~~ |
| `double_on_bump` | `INTEGER NOT NULL DEFAULT 1` | ~~removed~~ |
| `settings_json` | ~~did not exist~~ | **`TEXT NOT NULL DEFAULT '{}'`** |
| `created_by` | `INTEGER NOT NULL REFERENCES users(id)` | `INTEGER NOT NULL REFERENCES users(id)` |
| `current_hand` | `INTEGER NOT NULL DEFAULT 0` | `INTEGER NOT NULL DEFAULT 0` |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `TEXT NOT NULL DEFAULT (datetime('now'))` |
| `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `TEXT NOT NULL DEFAULT (datetime('now'))` |

**Changes:** Five individual settings columns (`no_pick_variant`, `doubler_multiplier`, `is_test_mode`, `reveal_partner`, `double_on_bump`) replaced by a single `settings_json` column. The motivation is extensibility: each new game setting previously required a schema migration to add a column. With `settings_json`, new settings can be added and defaulted in application code without touching the database schema.

`settings_json` stores: `{ no_pick_variant, doubler_multiplier, is_test_mode, reveal_partner, double_on_bump }`

---

## `game_players`

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `id` | `INTEGER PK AUTOINCREMENT` | `INTEGER PK AUTOINCREMENT` |
| `game_id` | `INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE` | `INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE` |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id)` | `INTEGER NOT NULL REFERENCES users(id)` |
| `seat` | `INTEGER NOT NULL` | `INTEGER NOT NULL` |
| `joined_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `TEXT NOT NULL DEFAULT (datetime('now'))` |

**No changes.**

---

## `game_state`

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `game_id` | `INTEGER PK REFERENCES games(id) ON DELETE CASCADE` | `INTEGER PK REFERENCES games(id) ON DELETE CASCADE` |
| `state_json` | `TEXT NOT NULL` | `TEXT NOT NULL` |
| `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `TEXT NOT NULL DEFAULT (datetime('now'))` |

**No changes to structure.** Behavioral change: `state_json` no longer contains a `rewindHistory` array. State is reconstructable from `hand_actions` if lost. (Supports [#70](https://github.com/andynumber2/sheepshead/issues/70))

---

## `hands` *(new table)*

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `id` | ~~did not exist~~ | `INTEGER PK AUTOINCREMENT` |
| `game_id` | ~~did not exist~~ | `INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE` |
| `hand_number` | ~~did not exist~~ | `INTEGER NOT NULL` |
| `variant` | ~~did not exist~~ | `TEXT` (`'normal'` \| `'leaster'` \| `'schwanzer'` \| `'no_pick'` \| NULL while in-progress) |
| `started_at` | ~~did not exist~~ | `TEXT NOT NULL DEFAULT (datetime('now'))` |
| `completed_at` | ~~did not exist~~ | `TEXT` (NULL until hand completes) |

**New table.** One row per hand. `UNIQUE(game_id, hand_number)`. Enables hand history display and recap without replaying the action log. (Supports [#120](https://github.com/andynumber2/sheepshead/issues/120))

---

## `hand_actions` *(new table)*

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `id` | ~~did not exist~~ | `INTEGER PK AUTOINCREMENT` |
| `game_id` | ~~did not exist~~ | `INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE` |
| `hand_number` | ~~did not exist~~ | `INTEGER NOT NULL` |
| `seq` | ~~did not exist~~ | `INTEGER NOT NULL` (0-based order within hand) |
| `type` | ~~did not exist~~ | `TEXT NOT NULL` (e.g. `'deal'`, `'pick'`, `'play_card'`, ...) |
| `user_id` | ~~did not exist~~ | `INTEGER REFERENCES users(id)` (NULL for `'deal'`) |
| `payload_json` | ~~did not exist~~ | `TEXT` (action-specific data) |
| `created_at` | ~~did not exist~~ | `TEXT NOT NULL DEFAULT (datetime('now'))` |

**New table.** Append-only action log. `UNIQUE(game_id, hand_number, seq)`. Index on `(game_id, hand_number)`. The first row of every hand is always `type='deal'` with the full dealt state in `payload_json` — this anchors replay. Used for action-log-based rewind (replaces snapshot-based rewind) and future game recap. (Supports [#70](https://github.com/andynumber2/sheepshead/issues/70), [#120](https://github.com/andynumber2/sheepshead/issues/120))

---

## `score_events`

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `id` | `INTEGER PK AUTOINCREMENT` | `INTEGER PK AUTOINCREMENT` |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id)` | `INTEGER NOT NULL REFERENCES users(id)` |
| `game_id` | `INTEGER` *(nullable — admin adjustments had NULL)* | **`INTEGER NOT NULL REFERENCES games(id)`** |
| `hand_number` | `INTEGER NOT NULL` | `INTEGER NOT NULL` |
| `delta` | `INTEGER NOT NULL` | `INTEGER NOT NULL` |
| `recorded_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `TEXT NOT NULL DEFAULT (datetime('now'))` |
| `game_date` | `TEXT` *(America/Chicago date string)* | ~~removed~~ |
| `is_adjustment` | `INTEGER NOT NULL DEFAULT 0` | ~~removed~~ |

**Changes:** Table is now a clean ledger of real hand scores only.
- `game_id` is now `NOT NULL` — previously admin adjustments used a NULL `game_id` as a sentinel to distinguish them from real hand scores. Once adjustments write directly to `user_scores` instead, there is no legitimate reason for a score event to lack a game, so the column is tightened to enforce that invariant.
- `game_date` removed — day score queries now use `recorded_at` with a UTC range derived from the configurable `score_timezone`. (Addresses [#111](https://github.com/andynumber2/sheepshead/issues/111))
- `is_adjustment` removed — admin adjustments write directly to `user_scores` instead. (Supports [#109](https://github.com/andynumber2/sheepshead/issues/109))

Indexes unchanged: `idx_score_events_user`, `idx_score_events_game`, `idx_score_events_date`.

---

## `user_scores` *(new table)*

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `user_id` | ~~did not exist~~ | `INTEGER PK REFERENCES users(id) ON DELETE CASCADE` |
| `lifetime_score` | ~~did not exist~~ | `INTEGER NOT NULL DEFAULT 0` |
| `updated_at` | ~~did not exist~~ | `TEXT NOT NULL DEFAULT (datetime('now'))` |

**New table.** Cached lifetime score totals — one row per user, updated atomically alongside every `score_events` insert. Replaces full-table `SUM(delta)` scans for lifetime scores. Admin score adjustments write directly here (no `score_events` row inserted). (Addresses [#109](https://github.com/andynumber2/sheepshead/issues/109))

---

## `config`

| Column | `main` | `db-refactor-sonnet` |
|--------|--------|----------------------|
| `key` | `TEXT PK` | `TEXT PK` |
| `value` | `TEXT NOT NULL` | `TEXT NOT NULL` |
| `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `TEXT NOT NULL DEFAULT (datetime('now'))` |

**No structural changes.** New seed row added: `score_timezone = 'America/Chicago'`. Previously only `max_active_games` was seeded. (Supports [#111](https://github.com/andynumber2/sheepshead/issues/111))

---

## Summary of changes

| Table | Status | Issues |
|-------|--------|--------|
| `users` | Unchanged | — |
| `sessions` | Unchanged | — |
| `game_players` | Unchanged | — |
| `game_state` | Unchanged (behavior: no longer stores `rewindHistory`) | [#70](https://github.com/andynumber2/sheepshead/issues/70) |
| `games` | Modified — 5 settings columns → `settings_json` | — |
| `score_events` | Modified — `game_id` now NOT NULL; `game_date` and `is_adjustment` removed | [#109](https://github.com/andynumber2/sheepshead/issues/109), [#111](https://github.com/andynumber2/sheepshead/issues/111) |
| `config` | Unchanged structure; new `score_timezone` seed row | [#111](https://github.com/andynumber2/sheepshead/issues/111) |
| `hands` | **New** | [#120](https://github.com/andynumber2/sheepshead/issues/120) |
| `hand_actions` | **New** | [#70](https://github.com/andynumber2/sheepshead/issues/70), [#120](https://github.com/andynumber2/sheepshead/issues/120) |
| `user_scores` | **New** | [#109](https://github.com/andynumber2/sheepshead/issues/109) |
