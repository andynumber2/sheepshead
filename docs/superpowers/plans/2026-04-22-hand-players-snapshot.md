# hand_players Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix #143 — when a human player leaves a mid-game, they disappear from the recap for hands they participated in. Source recap player identity from a historical per-hand snapshot instead of the live `game_players` roster.

**Architecture:** Add a new `hand_players` table keyed by `(game_id, hand_number, seat)` that snapshots the seat→user mapping at deal time. Every code path that writes a `deal` action also writes 5 `hand_players` rows atomically in the same D1 batch (via `INSERT INTO hand_players SELECT ... FROM game_players` — one statement, no race). The recap endpoint reads the player list from `hand_players JOIN users` instead of `game_players JOIN users`, so former players remain visible for hands they actually played.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Pages Functions, Vitest.

---

## File Structure

- **Create:** `migrations/0002_hand_players.sql` — new table + backfill from existing `game_players`
- **Modify:** `functions/api/games/index.js` — add hand_players insert to test-mode start batch
- **Modify:** `functions/api/games/[id]/action.js` — add hand_players insert to next-hand batch
- **Modify:** `functions/api/games/[id]/join.js` — add hand_players insert to game-start batch
- **Modify:** `functions/api/games/[id]/fill-with-bots.js` — add hand_players insert to game-start batch
- **Modify:** `functions/api/_botHelpers.js` — add hand_players insert to both deal-insert sites
- **Modify:** `functions/api/recap/[gameId]/[handNumber].js` — source players from `hand_players` instead of `game_players`

Each `deal`-insert site gets exactly one additional D1 statement added to its existing batch. The INSERT uses a `SELECT ... FROM game_players` subquery so it captures the current roster atomically — no extra round-trip, no race window.

---

## Task 1: Migration — create `hand_players` and backfill

**Files:**
- Create: `migrations/0002_hand_players.sql`

- [ ] **Step 1: Write the migration**

Create `migrations/0002_hand_players.sql`:

```sql
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
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run db:migrate:local`
Expected: migration applies without error.

Verify the table exists and backfill populated it:

```bash
npx wrangler d1 execute sheepshead-db --local --command "SELECT COUNT(*) AS n FROM hand_players;"
npx wrangler d1 execute sheepshead-db --local --command "PRAGMA table_info(hand_players);"
```

Expected: count is `5 * (number of existing completed/in-progress hands)` or zero if no hands exist locally; schema matches.

- [ ] **Step 3: Commit**

```bash
git add migrations/0002_hand_players.sql
git commit -m "feat(db): add hand_players snapshot table with backfill"
```

---

## Task 2: Add hand_players insert at each deal-insert site

**Files:**
- Modify: `functions/api/games/index.js:128-138`
- Modify: `functions/api/games/[id]/action.js:~110`
- Modify: `functions/api/games/[id]/join.js:~57-61`
- Modify: `functions/api/games/[id]/fill-with-bots.js:~59-63`
- Modify: `functions/api/_botHelpers.js:~90-95` and `~340-346`

The same one-line statement gets added to every existing batch that inserts a `deal` action. Snapshot syntax (the statement is identical everywhere):

```js
env.DB.prepare(
  `INSERT INTO hand_players (game_id, hand_number, seat, user_id)
   SELECT ?, ?, seat, user_id FROM game_players WHERE game_id = ?`
).bind(gameId, HAND_NUMBER, gameId),
```

`HAND_NUMBER` is whatever hand number that call site is about to deal — `1` for game-start sites, `nextHandNumber` for next-hand sites. Match the literal/variable already used by that site's `INSERT INTO hand_actions` line.

- [ ] **Step 1: Update `functions/api/games/index.js`**

Locate the batch at `functions/api/games/index.js:128-138` (test-mode game start). Add the new statement into the `env.DB.batch([...])` array, after the `INSERT INTO hand_actions` line. Use `1` for the hand number (game-start dealing hand 1).

After edit, the batch contains (in order): `game_state`, `games UPDATE`, `hands INSERT`, `hand_actions INSERT`, **`hand_players INSERT` (new)**.

- [ ] **Step 2: Update `functions/api/games/[id]/action.js`**

Locate the batch around `functions/api/games/[id]/action.js:110` that writes the next hand's `deal` action (look for `'deal'` inside an `env.DB.batch([...])`). Add the new statement using `nextHandNumber` for the hand number. Preserve existing order; append the new statement after the `INSERT INTO hand_actions` line.

- [ ] **Step 3: Update `functions/api/games/[id]/join.js`**

Locate the batch at `functions/api/games/[id]/join.js:~57-61`. Add the new statement with hand number `1`.

- [ ] **Step 4: Update `functions/api/games/[id]/fill-with-bots.js`**

Locate the batch at `functions/api/games/[id]/fill-with-bots.js:~59-63`. Add the new statement with hand number `1`.

- [ ] **Step 5: Update `functions/api/_botHelpers.js` (both sites)**

Both sites in this file use the local variable name `DB` (not `env.DB`), and both are already part of a `DB.batch([...])` call.

Site A — around line 88-96: `dealActionStmt` is appended into the batch on line 96. Add a new `nextHandPlayersStmt`:

```js
const nextHandPlayersStmt = DB.prepare(
  `INSERT INTO hand_players (game_id, hand_number, seat, user_id)
   SELECT ?, ?, seat, user_id FROM game_players WHERE game_id = ?`
).bind(gameId, nextHandNumber, gameId)
```

…and add it to the `DB.batch([...])` call on line 96 after `dealActionStmt`.

Site B — around line 340-346: the existing batch is constructed inline as an array literal. Add this entry after the existing `INSERT INTO hand_actions` entry:

```js
DB.prepare(
  `INSERT INTO hand_players (game_id, hand_number, seat, user_id)
   SELECT ?, ?, seat, user_id FROM game_players WHERE game_id = ?`
).bind(gameId, nextHandNumber, gameId),
```

- [ ] **Step 6: Sanity-check with grep**

Run: `grep -rn "INSERT INTO hand_players" functions/`
Expected: exactly 6 matches — one per site listed above (index.js, action.js, join.js, fill-with-bots.js, _botHelpers.js × 2).

Run: `grep -rn "'deal'" functions/`
Expected: same 6 sites are still present (deal-action inserts untouched).

- [ ] **Step 7: Smoke-test locally**

Start dev server: `npm run dev`
Create a new game, auto-fill with bots, play at least one hand to completion, then start hand 2.

Verify hand_players rows exist for both hands:

```bash
npx wrangler d1 execute sheepshead-db --local --command "SELECT game_id, hand_number, seat, user_id FROM hand_players ORDER BY game_id DESC, hand_number, seat LIMIT 20;"
```

Expected: 5 rows per hand, seats 0-4, user_ids matching the seated players.

- [ ] **Step 8: Commit**

```bash
git add functions/
git commit -m "feat(api): snapshot hand_players at deal time"
```

---

## Task 3: Source recap players from `hand_players`

**Files:**
- Modify: `functions/api/recap/[gameId]/[handNumber].js:22-26`

- [ ] **Step 1: Replace the players query**

In `functions/api/recap/[gameId]/[handNumber].js`, replace the query at lines 22-26:

```js
const { results: playerRows } = await env.DB.prepare(
  `SELECT gp.user_id, gp.seat, u.username, u.is_bot
   FROM game_players gp JOIN users u ON u.id = gp.user_id
   WHERE gp.game_id = ? ORDER BY gp.seat ASC`
).bind(gameId).all()
```

with:

```js
const { results: playerRows } = await env.DB.prepare(
  `SELECT hp.user_id, hp.seat, u.username, u.is_bot
   FROM hand_players hp JOIN users u ON u.id = hp.user_id
   WHERE hp.game_id = ? AND hp.hand_number = ? ORDER BY hp.seat ASC`
).bind(gameId, handNumber).all()
```

Nothing else in the file changes — the `players.map(...)` shape stays identical.

- [ ] **Step 2: Smoke-test: recap still renders for a normal hand**

With dev server running, open a completed hand's recap in the browser. Expected: all 5 seats render with correct usernames and seats, same as before.

- [ ] **Step 3: Smoke-test: recap survives a leave**

In the app, start a new game with bots, play one hand to completion, then have the human leave the game (or use a second browser/user). Open the recap for hand 1.

Expected: the human who left is still present in the recap with correct seat and username — the bug from #143 is fixed.

If easier to test via SQL, simulate by deleting a row from `game_players` for a completed hand's user, then hit the recap API:

```bash
npx wrangler d1 execute sheepshead-db --local --command "DELETE FROM game_players WHERE game_id = <ID> AND seat = 0;"
curl -s http://localhost:8788/api/recap/<ID>/1 | jq '.players'
```

Expected: `players` still contains 5 entries including the deleted seat's user.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: 222 passing (baseline) — no regressions. The recap endpoint isn't covered by existing unit tests (tests live in `shared/`), but any digest/engine tests must still pass.

- [ ] **Step 5: Commit**

```bash
git add functions/api/recap/
git commit -m "fix(recap): source players from hand_players snapshot (#143)"
```

---

## Task 4: Final verification

- [ ] **Step 1: Re-run full test suite**

Run: `npm test`
Expected: 222 passing.

- [ ] **Step 2: Verify migration ordering**

Run: `ls migrations/`
Expected: `0001_init.sql`, `0002_hand_players.sql` — new migration is the next number.

- [ ] **Step 3: Confirm no stray references to `game_players` remain in the recap path**

Run: `grep -rn "game_players" functions/api/recap/`
Expected: no matches.

---

## Out of Scope / Deferred

- **Mid-hand leave/replacement:** the snapshot is a point-in-time mapping at deal. Hypothetical future feature where a player leaves mid-hand and is replaced by a bot is deferred. If/when added, the snapshot shape extends to an occupant timeline per seat, and score/role attribution needs to be re-keyed by seat rather than user_id (separate, larger project).
- **Backfill accuracy for pre-migration games with leaves:** backfill copies current `game_players`, so historical hands in games where someone left pre-migration will show the replacement, not the original. Accepted tradeoff.
- **API integration tests:** the codebase has no D1 integration test harness today. Verification for this change is manual via the dev server + direct SQL. Adding a harness is out of scope.
