# Database Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc accumulated schema with a clean design that adds an action log for rewind/replay, a `user_scores` cache for scalable score reads, `settings_json` on games, and fixes timezone coupling in score queries.

**Architecture:** New migration drops and recreates all tables (clean slate). A new `shared/actionReplay.js` module replays `hand_actions` rows through `gameEngine.js` to reconstruct state — used by both rewind and future recap. `game_state` remains a fast-read cache, always reconstructable from `hand_actions`. Scores are cached in `user_scores` for lifetime totals; game and day scores are computed from bounded `score_events` queries.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Pages Functions, React 18, Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-db-refactor-design.md`

---

## File Map

| File | Change |
|------|--------|
| `migrations/0010_refactor.sql` | **Create** — complete schema reset |
| `shared/actionReplay.js` | **Create** — `replayActions(actions)` function |
| `shared/actionReplay.test.js` | **Create** — tests for replay |
| `shared/gameEngine.js` | **Modify** — remove `rewindHistory` field and `rewindPlay`/`rewindTrick` exports |
| `shared/gameEngine.test.js` | **Modify** — remove rewind tests, update dealHand test |
| `functions/api/_helpers.js` | **Modify** — add `getDayScoreRange(tz)`, remove `centralDate` |
| `functions/api/_botHelpers.js` | **Modify** — `finishHand`: upsert `user_scores`, insert `hands` rows, append `deal` action; `resolveNoPick`: read settings from JSON, append `deal` on doubler; `persistState`: strip `rewindHistory` |
| `functions/api/games/index.js` | **Modify** — create: write `settings_json`; list: parse `settings_json`; test-mode start: insert `hands` + `deal` action |
| `functions/api/games/[id]/index.js` | **Modify** — parse `settings_json`, nested settings response, `user_scores` for lifetime, UTC range for day score |
| `functions/api/games/[id]/action.js` | **Modify** — read settings from JSON, append `hand_actions` for every human action, rewind via replay |
| `functions/api/games/[id]/settings.js` | **Modify** — `json_set` merge into `settings_json`, return nested settings |
| `functions/api/games/[id]/join.js` | **Modify** — read settings from JSON, insert `hands` row + `deal` action on start |
| `functions/api/games/[id]/fill-with-bots.js` | **Modify** — read settings from JSON, insert `hands` row + `deal` action on start |
| `functions/api/admin/users/index.js` | **Modify** — `user_scores` for lifetime, UTC range for day score, remove `centralDate` |
| `functions/api/admin/users/[id]/index.js` | **Modify** — `user_scores` for lifetime, UTC range for day score, remove `centralDate`; `deleteUser`: delete `user_scores` row |
| `functions/api/admin/users/[id]/score-adjustment.js` | **Modify** — drop `new_day_score`, write delta directly to `user_scores` |
| `frontend/src/lib/api.js` | **Modify** — update `create` and `adjustScore` signatures |
| `frontend/src/pages/GamePage.jsx` | **Modify** — `game.settings.*` instead of flat fields |
| `frontend/src/pages/LobbyPage.jsx` | **Modify** — `game.settings.*`, update `api.games.create` call |
| `frontend/src/components/GameOptionsPanel.jsx` | **Modify** — `values.settings.*` propagation |
| `frontend/src/pages/AccountManagementPage.jsx` | **Modify** — remove day score field from adjustment UI |

---

## Task 1: Write the migration

**Files:**
- Create: `migrations/0010_refactor.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/0010_refactor.sql
-- Clean slate. Drops and recreates all tables. No data is preserved.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS score_events;
DROP TABLE IF EXISTS user_scores;
DROP TABLE IF EXISTS hand_actions;
DROP TABLE IF EXISTS hands;
DROP TABLE IF EXISTS game_state;
DROP TABLE IF EXISTS game_players;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS config;

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
UPDATE users SET is_admin = 1 WHERE lower(username) = 'andy';

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
```

- [ ] **Step 2: Apply locally**

```bash
npm run db:migrate:local
```
Expected: no errors, all tables created.

- [ ] **Step 3: Verify tables exist**

```bash
npx wrangler d1 execute sheepshead-db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```
Expected output includes: `config`, `game_players`, `game_state`, `games`, `hand_actions`, `hands`, `score_events`, `sessions`, `user_scores`, `users`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0010_refactor.sql
git commit -m "feat: add clean-slate db refactor migration"
```

---

## Task 2: Remove rewindHistory from gameEngine.js

**Files:**
- Modify: `shared/gameEngine.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Remove `rewindHistory` from `dealHand` return value**

In `shared/gameEngine.js`, find the `dealHand` return object (around line 137) and remove the `rewindHistory: []` line:

```js
// Remove this line from the dealHand return object:
rewindHistory: [],         // card play snapshots for rewinding
```

- [ ] **Step 2: Remove the snapshot capture in `playCard`**

Find the block starting around line 463 that reads:
```js
// Capture pre-play snapshot. Strip rewindHistory to prevent exponential nesting.
const snapshot = deepClone(state)
snapshot.rewindHistory = []

const newState = deepClone(state)
newState.rewindHistory = [...(state.rewindHistory ?? []), snapshot]
```
Replace it with:
```js
const newState = deepClone(state)
```

- [ ] **Step 3: Remove `rewindHistory` stripping in `getPlayerView`**

Find around line 915:
```js
view.rewindHistory = []   // strip snapshots — each contains all players' unredacted hands
```
Remove that line.

- [ ] **Step 4: Remove `rewindPlay` and `rewindTrick` functions**

Delete the entire `// ─── Rewind ───` section (approximately lines 543–587) containing `rewindPlay` and `rewindTrick`.

- [ ] **Step 5: Remove them from the export list**

Find the export block (or individual `export function` keywords) and remove `rewindPlay` and `rewindTrick` from the exported API.

- [ ] **Step 6: Update tests — remove rewind tests**

In `shared/gameEngine.test.js`, delete any test blocks that test `rewindPlay` or `rewindTrick`. Search for `rewindPlay` and `rewindTrick` and remove those describe/it blocks.

- [ ] **Step 7: Run tests**

```bash
npm test
```
Expected: all tests pass. No failures related to removed functions.

- [ ] **Step 8: Commit**

```bash
git add shared/gameEngine.js shared/gameEngine.test.js
git commit -m "refactor: remove rewindHistory from gameEngine — rewind now handled via action log replay"
```

---

## Task 3: Create actionReplay.js

**Files:**
- Create: `shared/actionReplay.js`
- Create: `shared/actionReplay.test.js`

- [ ] **Step 1: Write the failing tests first**

Create `shared/actionReplay.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { replayActions } from './actionReplay.js'
import { dealHand, pick, discard, callAce, goAlone, playCard } from './gameEngine.js'

describe('replayActions', () => {
  it('throws if no actions provided', () => {
    expect(() => replayActions([])).toThrow('no actions provided')
  })

  it('throws if first action is not deal', () => {
    expect(() => replayActions([{ type: 'pick', user_id: 1, payload_json: null }])).toThrow('first action must be type=deal')
  })

  it('returns initial state for deal-only action list', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)
    const actions = [{ type: 'deal', user_id: null, payload_json: JSON.stringify(initial) }]
    const result = replayActions(actions)
    expect(result.phase).toBe('picking')
    expect(result.handNumber).toBe(1)
    expect(result.dealerSeat).toBe(0)
  })

  it('replays a pick action', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)
    const pickerId = initial.pickOrder[0]
    const actions = [
      { type: 'deal', user_id: null, payload_json: JSON.stringify(initial) },
      { type: 'pick', user_id: Number(pickerId), payload_json: null },
    ]
    const result = replayActions(actions)
    expect(result.phase).toBe('discarding')
    expect(result.picker).toBe(pickerId)
  })

  it('produces the same state as direct engine calls through pick and discard', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)
    const pickerId = initial.pickOrder[0]

    // Direct engine path
    let direct = pick(initial, pickerId)
    const cardIdsToDiscard = direct.hands[pickerId].slice(0, 2).map(c => c.id)
    direct = discard(direct, pickerId, cardIdsToDiscard)

    // Replay path
    const actions = [
      { type: 'deal',    user_id: null,             payload_json: JSON.stringify(initial) },
      { type: 'pick',    user_id: Number(pickerId), payload_json: null },
      { type: 'discard', user_id: Number(pickerId), payload_json: JSON.stringify({ cardIds: cardIdsToDiscard }) },
    ]
    const replayed = replayActions(actions)

    expect(replayed.phase).toBe('calling')
    expect(replayed.picker).toBe(pickerId)
    expect(replayed.hands[pickerId]).toHaveLength(6)
    expect(replayed.discard).toEqual(direct.discard)
  })

  it('throws on unknown action type', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)
    const actions = [
      { type: 'deal',    user_id: null, payload_json: JSON.stringify(initial) },
      { type: 'unknown', user_id: 1,   payload_json: null },
    ]
    expect(() => replayActions(actions)).toThrow("unknown action type 'unknown'")
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test shared/actionReplay.test.js
```
Expected: FAIL — `Cannot find module './actionReplay.js'`

- [ ] **Step 3: Implement `shared/actionReplay.js`**

```js
import {
  pick, blitz, pass, discard,
  callAce, callAceUnknown, callTen, callKing, goAlone,
  playCard, crack, recrack,
  setupLeaster, awardLeasterBlind,
} from './gameEngine.js'

/**
 * Replays an ordered array of hand_actions rows to produce game state.
 * The first action must be type='deal' with payload containing the full initial state.
 * Returns the state after applying all provided actions.
 */
export function replayActions(actions) {
  if (actions.length === 0) throw new Error('replayActions: no actions provided')

  const first = actions[0]
  if (first.type !== 'deal') throw new Error('replayActions: first action must be type=deal')

  let state = JSON.parse(first.payload_json)

  for (const action of actions.slice(1)) {
    const { type, user_id, payload_json } = action
    const payload = payload_json ? JSON.parse(payload_json) : null
    const uid = user_id ? String(user_id) : null

    switch (type) {
      case 'pick':             state = pick(state, uid); break
      case 'blitz':            state = blitz(state, uid); break
      case 'pass':             state = pass(state, uid); break
      case 'setup_leaster':    state = setupLeaster(state); break
      case 'discard':          state = discard(state, uid, payload.cardIds); break
      case 'call_ace':         state = callAce(state, uid, payload.suit); break
      case 'call_ace_unknown': state = callAceUnknown(state, uid, payload.suit, payload.underCardId); break
      case 'call_ten':         state = callTen(state, uid, payload.suit); break
      case 'call_king':        state = callKing(state, uid, payload.suit); break
      case 'go_alone':         state = goAlone(state, uid); break
      case 'crack':            state = crack(state, uid); break
      case 'recrack':          state = recrack(state, uid); break
      case 'play_card': {
        state = playCard(state, uid, payload.cardId)
        if (state.isLeaster && state.leasterBlind?.length > 0 && state.tricks.length === 1) {
          state = awardLeasterBlind(state)
        }
        break
      }
      default:
        throw new Error(`replayActions: unknown action type '${type}'`)
    }
  }

  return state
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test shared/actionReplay.test.js
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add shared/actionReplay.js shared/actionReplay.test.js
git commit -m "feat: add actionReplay module for hand action log replay"
```

---

## Task 4: Update `_helpers.js`

**Files:**
- Modify: `functions/api/_helpers.js`

- [ ] **Step 1: Replace `centralDate` with `getDayScoreRange`**

In `functions/api/_helpers.js`, find the `centralDate` function (around line 89) and replace it with `getDayScoreRange`:

```js
/**
 * Returns [startISO, endISO] as UTC ISO strings bounding "today" in the given timezone.
 * Uses Intl for DST-correct boundary calculation.
 *
 * @param {string} timezone  IANA timezone name, e.g. 'America/Chicago'
 * @returns {[string, string]}
 */
export function getDayScoreRange(timezone) {
  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
  const [y, m, d] = today.split('-').map(Number)
  const start = _localMidnightUTC(y, m, d,     timezone)
  const end   = _localMidnightUTC(y, m, d + 1, timezone)
  return [start.toISOString(), end.toISOString()]
}

function _localMidnightUTC(y, m, d, timezone) {
  // Noon UTC of the given date (JS handles day-overflow in Date.UTC, e.g. day=32 → next month)
  const noonRef = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  // What local time does noon UTC correspond to in the timezone?
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(noonRef)
  const h   = parseInt(parts.find(p => p.type === 'hour').value)
  const min = parseInt(parts.find(p => p.type === 'minute').value)
  const sec = parseInt(parts.find(p => p.type === 'second').value)
  // Local midnight = noonRef minus the local time at noonRef
  return new Date(noonRef.getTime() - (h * 3600 + min * 60 + sec) * 1000)
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/_helpers.js
git commit -m "refactor: replace centralDate with getDayScoreRange in _helpers"
```

---

## Task 5: Update `_botHelpers.js`

**Files:**
- Modify: `functions/api/_botHelpers.js`

This task has four changes: (a) `finishHand` writes `user_scores`, completes the `hands` row, inserts the next `hands` row, and appends the next `deal` action; (b) `resolveNoPick` reads settings from JSON and appends a `deal` action on doublers; (c) `persistState` strips `rewindHistory`; (d) remove `centralDate` import.

- [ ] **Step 1: Update the import at the top of `_botHelpers.js`**

Replace:
```js
import { centralDate } from './_helpers.js'
```
With:
```js
import { getDayScoreRange } from './_helpers.js'
```

- [ ] **Step 2: Replace `finishHand`**

Replace the entire `finishHand` function with:

```js
export async function finishHand(DB, gameId, state) {
  let scores = state.scores

  if (state.isLeaster) {
    const { scores: leasterScores } = resolveLeaster(state)
    scores = leasterScores
    state.scores = scores
  }

  const variant = state.isLeaster ? 'leaster' : (state.picker === null ? 'schwanzer' : 'normal')

  // Get score_timezone from config
  const tzRow = await DB.prepare("SELECT value FROM config WHERE key = 'score_timezone'").first()
  const timezone = tzRow?.value ?? 'America/Chicago'

  // Insert score_events (one per player)
  const scoreStmts = Object.entries(scores).map(([userId, delta]) =>
    DB.prepare(
      'INSERT INTO score_events (user_id, game_id, hand_number, delta) VALUES (?, ?, ?, ?)'
    ).bind(Number(userId), gameId, state.handNumber, delta)
  )

  // Upsert user_scores (increment lifetime totals)
  const upsertStmts = Object.entries(scores).map(([userId, delta]) =>
    DB.prepare(`
      INSERT INTO user_scores (user_id, lifetime_score, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        lifetime_score = lifetime_score + excluded.lifetime_score,
        updated_at = datetime('now')
    `).bind(Number(userId), delta)
  )

  // Complete the current hands row
  const completeHandStmt = DB.prepare(
    "UPDATE hands SET variant = ?, completed_at = datetime('now') WHERE game_id = ? AND hand_number = ?"
  ).bind(variant, gameId, state.handNumber)

  await DB.batch([...scoreStmts, ...upsertStmts, completeHandStmt])

  // Deal the next hand
  const { results: players } = await DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
  ).bind(gameId).all()
  const playerIds = players.map(p => String(p.user_id))
  const nextDealer = (state.dealerSeat + 1) % 5
  const nextHandNumber = state.handNumber + 1
  const nextState = dealHand(playerIds, nextDealer, nextHandNumber, 1)

  const gameRow = await DB.prepare('SELECT settings_json FROM games WHERE id = ?').bind(gameId).first()
  const settings = JSON.parse(gameRow.settings_json)
  nextState.reveal_partner = settings.reveal_partner
  nextState.double_on_bump = settings.double_on_bump

  nextState.log = [...state.log, `--- Hand ${state.handNumber} complete ---`]
  nextState.lastTrick = state.lastTrick

  // Reset doubler_multiplier in settings_json
  await DB.prepare(
    "UPDATE games SET settings_json = json_set(settings_json, '$.doubler_multiplier', 1), updated_at = datetime('now') WHERE id = ?"
  ).bind(gameId).run()

  // Insert next hands row + deal action
  const nextHandStmt = DB.prepare(
    'INSERT INTO hands (game_id, hand_number) VALUES (?, ?)'
  ).bind(gameId, nextHandNumber)

  const nextSeq = await DB.prepare(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM hand_actions WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, nextHandNumber).first()

  const dealActionStmt = DB.prepare(
    'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, ?, ?, NULL, ?)'
  ).bind(gameId, nextHandNumber, nextSeq.next, 'deal', JSON.stringify(nextState))

  await DB.batch([nextHandStmt, dealActionStmt])

  return nextState
}
```

- [ ] **Step 3: Update `resolveNoPick` to read settings from JSON and handle doubler**

Replace the entire `resolveNoPick` function:

```js
async function resolveNoPick(state, game, DB, gameId) {
  const settings = JSON.parse(game.settings_json)

  if (settings.no_pick_variant === 'leasters') {
    return setupLeaster(state)
  }

  if (settings.no_pick_variant === 'schwanzers') {
    const { scores } = resolveSchwanzer(state)
    state.scores = scores
    state.phase = 'scoring'
    return finishHand(DB, gameId, state)
  }

  // Doublers: deal a new hand with doubled multiplier
  const newMultiplier = state.doublerMultiplier * 2
  const { results: players } = await DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
  ).bind(gameId).all()
  const playerIds = players.map(p => String(p.user_id))
  const nextDealer = (state.dealerSeat + 1) % 5
  const nextHandNumber = state.handNumber + 1
  const newState = dealHand(playerIds, nextDealer, nextHandNumber, newMultiplier)
  newState.doublerMultiplier = newMultiplier
  newState.reveal_partner = settings.reveal_partner
  newState.double_on_bump = settings.double_on_bump
  newState.log = [...state.log, ...newState.log, `Doubler! Stakes are now ×${newMultiplier}.`]

  // Complete current hands row (no-pick, no variant)
  await DB.prepare(
    "UPDATE hands SET variant = 'no_pick', completed_at = datetime('now') WHERE game_id = ? AND hand_number = ?"
  ).bind(gameId, state.handNumber).run()

  await DB.prepare(
    "UPDATE games SET settings_json = json_set(settings_json, '$.doubler_multiplier', ?), updated_at = datetime('now') WHERE id = ?"
  ).bind(newMultiplier, gameId).run()

  // Insert next hands row + deal action
  const nextSeq = await DB.prepare(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM hand_actions WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, nextHandNumber).first()

  await DB.batch([
    DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, ?)').bind(gameId, nextHandNumber),
    DB.prepare(
      'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, ?, ?, NULL, ?)'
    ).bind(gameId, nextHandNumber, nextSeq.next, 'deal', JSON.stringify(newState)),
  ])

  return newState
}
```

- [ ] **Step 4: Update `persistState` to strip `rewindHistory`**

Find the `persistState` function and update it:

```js
async function persistState(DB, gameId, state) {
  const { rewindHistory: _dropped, ...stateToStore } = state
  await DB.prepare(
    "UPDATE game_state SET state_json = ?, updated_at = datetime('now') WHERE game_id = ?"
  ).bind(JSON.stringify(stateToStore), gameId).run()
  await DB.prepare(
    "UPDATE games SET updated_at = datetime('now') WHERE id = ?"
  ).bind(gameId).run()
}
```

- [ ] **Step 5: Commit**

```bash
git add functions/api/_botHelpers.js
git commit -m "refactor: update _botHelpers for new schema (user_scores, hands, hand_actions, settings_json)"
```

---

## Task 6: Update `games/index.js` (list + create)

**Files:**
- Modify: `functions/api/games/index.js`

- [ ] **Step 1: Update `listGames`**

Replace the query in `listGames` to extract settings from JSON:

```js
async function listGames({ request, env }) {
  const user = await requireUser(request, env.DB)

  const { results } = await env.DB.prepare(`
    SELECT g.id, g.name, g.status, g.settings_json,
           u.username as created_by_username,
           g.created_by,
           COUNT(gp.id) as player_count,
           MAX(CASE WHEN gp.user_id = ? THEN 1 ELSE 0 END) as is_member
    FROM games g
    JOIN users u ON u.id = g.created_by
    LEFT JOIN game_players gp ON gp.game_id = g.id
    WHERE g.status IN ('waiting', 'active')
    GROUP BY g.id
    ORDER BY g.created_at DESC
    LIMIT 50
  `).bind(user.user_id).all()

  return json(results.map(g => {
    const settings = JSON.parse(g.settings_json)
    return {
      id:                   g.id,
      name:                 g.name,
      status:               g.status,
      created_by:           g.created_by,
      created_by_username:  g.created_by_username,
      player_count:         g.player_count,
      is_member:            g.is_member === 1,
      is_admin:             g.created_by === user.user_id,
      settings,
    }
  }))
}
```

- [ ] **Step 2: Update `createGame`**

Replace the `createGame` function:

```js
async function createGame({ request, env }) {
  const user = await requireUser(request, env.DB)

  let body
  try { body = await request.json() } catch { return err('Invalid JSON.') }

  // Block if user is already in a game
  const existingGame = await env.DB.prepare(`
    SELECT g.id, g.name FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = ? AND g.status IN ('waiting', 'active')
    LIMIT 1
  `).bind(user.user_id).first()
  if (existingGame) {
    return err(`You are already in a game ("${existingGame.name}"). Leave it before creating a new one.`, 409)
  }

  // Enforce active game limit (admins are exempt)
  if (!user.is_admin) {
    const limitRow = await env.DB.prepare("SELECT value FROM config WHERE key = 'max_active_games'").first()
    const limit = parseInt(limitRow?.value ?? '5', 10)
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM games WHERE status IN ('waiting', 'active')"
    ).first()
    if (countRow.count >= limit) {
      return err(`The game limit of ${limit} has been reached. Please wait for a game to finish.`, 409)
    }
  }

  const name            = body?.name?.trim() || `${user.username}'s game`
  const bodySettings    = body?.settings ?? {}
  const VALID_VARIANTS  = ['leasters', 'doublers', 'schwanzers']
  const noPickVariant   = VALID_VARIANTS.includes(bodySettings.no_pick_variant) ? bodySettings.no_pick_variant : 'doublers'
  const revealPartner   = typeof bodySettings.reveal_partner === 'boolean' ? bodySettings.reveal_partner : false
  const doubleOnBump    = typeof bodySettings.double_on_bump  === 'boolean' ? bodySettings.double_on_bump  : true
  const testMode        = !!(bodySettings.is_test_mode && user.is_admin)

  if (testMode) {
    const existingTest = await env.DB.prepare(
      "SELECT id FROM games WHERE json_extract(settings_json, '$.is_test_mode') = 1 AND status IN ('waiting', 'active') LIMIT 1"
    ).first()
    if (existingTest) return err('A test mode game is already active. Only one test game can exist at a time.', 409)
  }

  const settings = { no_pick_variant: noPickVariant, doubler_multiplier: 1, is_test_mode: testMode, reveal_partner: revealPartner, double_on_bump: doubleOnBump }

  const result = await env.DB.prepare(
    'INSERT INTO games (name, settings_json, created_by) VALUES (?, ?, ?)'
  ).bind(name, JSON.stringify(settings), user.user_id).run()

  const gameId = result.meta.last_row_id

  // Creator joins as seat 0
  await env.DB.prepare(
    'INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)'
  ).bind(gameId, user.user_id, 0).run()

  if (testMode) {
    // Auto-join test bot accounts as seats 1-4
    const { results: bots } = await env.DB.prepare(
      "SELECT id FROM users WHERE is_bot = 1 AND bot_type = 'test' ORDER BY username LIMIT 4"
    ).all()
    if (bots.length < 4) return err('Not enough test bot accounts found. Run migrations to seed test bots.', 500)

    const botStmts = bots.map((bot, i) =>
      env.DB.prepare('INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)')
        .bind(gameId, bot.id, i + 1)
    )
    await env.DB.batch(botStmts)

    // All 5 seats filled — start the game immediately
    const allPlayers = [user.user_id, ...bots.map(b => b.id)]
    const state = dealHand(allPlayers.map(String), 0, 1, 1)
    state.reveal_partner = revealPartner
    state.double_on_bump = doubleOnBump

    const { rewindHistory: _dropped, ...stateToStore } = state

    await env.DB.batch([
      env.DB.prepare("INSERT INTO game_state (game_id, state_json, updated_at) VALUES (?, ?, datetime('now'))")
        .bind(gameId, JSON.stringify(stateToStore)),
      env.DB.prepare("UPDATE games SET status = 'active', current_hand = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(gameId),
      env.DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, 1)')
        .bind(gameId),
      env.DB.prepare(
        'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, 1, 0, ?, NULL, ?)'
      ).bind(gameId, 'deal', JSON.stringify(stateToStore)),
    ])

    return json({ id: gameId, name, settings, started: true }, 201)
  }

  return json({ id: gameId, name, settings, player_count: 1 }, 201)
}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/games/index.js
git commit -m "refactor: update games list/create for settings_json schema"
```

---

## Task 7: Update `games/[id]/index.js` (game read)

**Files:**
- Modify: `functions/api/games/[id]/index.js`

- [ ] **Step 1: Replace the entire file**

```js
import { json, err, requireUser, getDayScoreRange, AuthError } from '../../_helpers.js'
import { getPlayerView } from '../../../../shared/gameEngine.js'

export async function onRequestGet({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)

    const rawSettings = JSON.parse(game.settings_json)
    // Normalize booleans: json_set may store 1/0 (SQLite integers) instead of true/false
    const settings = {
      ...rawSettings,
      is_test_mode:  !!rawSettings.is_test_mode,
      reveal_partner: !!rawSettings.reveal_partner,
      double_on_bump: !!rawSettings.double_on_bump,
    }

    const { results: players } = await env.DB.prepare(
      `SELECT gp.seat, gp.user_id, u.username, u.is_bot, u.bot_type
       FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       WHERE gp.game_id = ?
       ORDER BY gp.seat`
    ).bind(gameId).all()

    // Lifetime from user_scores cache; game score and day score from bounded score_events queries
    const tzRow = await env.DB.prepare("SELECT value FROM config WHERE key = 'score_timezone'").first()
    const timezone = tzRow?.value ?? 'America/Chicago'
    const [dayStart, dayEnd] = getDayScoreRange(timezone)

    const { results: scoreRows } = await env.DB.prepare(`
      SELECT
        user_id,
        COALESCE(SUM(CASE WHEN game_id = ? THEN delta ELSE 0 END), 0) AS game_score,
        COALESCE(SUM(CASE WHEN recorded_at >= ? AND recorded_at < ? THEN delta ELSE 0 END), 0) AS day_score
      FROM score_events
      WHERE user_id IN (SELECT user_id FROM game_players WHERE game_id = ?)
      GROUP BY user_id
    `).bind(gameId, dayStart, dayEnd, gameId).all()

    const { results: lifetimeRows } = await env.DB.prepare(`
      SELECT user_id, lifetime_score
      FROM user_scores
      WHERE user_id IN (SELECT user_id FROM game_players WHERE game_id = ?)
    `).bind(gameId).all()

    const scoreMap    = Object.fromEntries(scoreRows.map(r => [r.user_id, r]))
    const lifetimeMap = Object.fromEntries(lifetimeRows.map(r => [r.user_id, r.lifetime_score]))

    const playersWithScores = players.map(p => ({
      ...p,
      score:          scoreMap[p.user_id]?.game_score  ?? 0,
      day_score:      scoreMap[p.user_id]?.day_score    ?? 0,
      lifetime_score: lifetimeMap[p.user_id]            ?? 0,
    }))

    let stateView = null
    if (game.status === 'active') {
      const stateRow = await env.DB.prepare(
        'SELECT state_json FROM game_state WHERE game_id = ?'
      ).bind(gameId).first()

      if (stateRow) {
        const state = JSON.parse(stateRow.state_json)
        const userId = String(user.user_id)
        const isTestModeAdmin = settings.is_test_mode && user.is_admin
        stateView = isTestModeAdmin ? state : getPlayerView(state, userId)
      }
    }

    return json({
      id:       game.id,
      name:     game.name,
      status:   game.status,
      is_admin: game.created_by === user.user_id,
      settings,
      players:  playersWithScores,
      state:    stateView,
    })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/games/[id]/index.js
git commit -m "refactor: update game read endpoint for settings_json and new score sources"
```

---

## Task 8: Update `games/[id]/settings.js`

**Files:**
- Modify: `functions/api/games/[id]/settings.js`

- [ ] **Step 1: Replace the entire file**

```js
import { json, err, requireUser, AuthError } from '../../_helpers.js'

export async function onRequestPatch({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id
    const userId = user.user_id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status === 'complete') return err('Game is already complete.')
    if (game.created_by !== userId) return err('Only the game admin can change settings.', 403)

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }

    const { no_pick_variant, reveal_partner, double_on_bump } = body ?? {}

    if (no_pick_variant !== undefined && !['leasters', 'doublers', 'schwanzers'].includes(no_pick_variant)) {
      return err('no_pick_variant must be "leasters", "doublers", or "schwanzers".')
    }
    if (reveal_partner !== undefined && typeof reveal_partner !== 'boolean') {
      return err('reveal_partner must be a boolean.')
    }
    if (double_on_bump !== undefined && typeof double_on_bump !== 'boolean') {
      return err('double_on_bump must be a boolean.')
    }

    // Build json_set args for the fields that were provided
    let jsonSetExpr = 'settings_json'
    const bindings = []
    // Note: use json(?) with 'true'/'false' strings to ensure SQLite stores proper
    // JSON booleans rather than integers (D1 binds JS true as SQLite 1 otherwise).
    if (no_pick_variant !== undefined) {
      jsonSetExpr = `json_set(${jsonSetExpr}, '$.no_pick_variant', ?)`
      bindings.push(no_pick_variant)
    }
    if (reveal_partner !== undefined) {
      jsonSetExpr = `json_set(${jsonSetExpr}, '$.reveal_partner', json(?))`
      bindings.push(reveal_partner ? 'true' : 'false')
    }
    if (double_on_bump !== undefined) {
      jsonSetExpr = `json_set(${jsonSetExpr}, '$.double_on_bump', json(?))`
      bindings.push(double_on_bump ? 'true' : 'false')
    }

    if (bindings.length === 0) return err('No settings to update.')

    bindings.push(gameId)
    await env.DB.prepare(
      `UPDATE games SET settings_json = ${jsonSetExpr}, updated_at = datetime('now') WHERE id = ?`
    ).bind(...bindings).run()

    const updated = await env.DB.prepare('SELECT settings_json FROM games WHERE id = ?').bind(gameId).first()
    const settings = JSON.parse(updated.settings_json)

    return json({ ok: true, settings })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/games/[id]/settings.js
git commit -m "refactor: update settings endpoint to use json_set on settings_json"
```

---

## Task 9: Update `join.js` and `fill-with-bots.js`

**Files:**
- Modify: `functions/api/games/[id]/join.js`
- Modify: `functions/api/games/[id]/fill-with-bots.js`

- [ ] **Step 1: Replace `join.js`**

```js
import { json, err, requireUser, AuthError } from '../../_helpers.js'
import { dealHand } from '../../../../shared/gameEngine.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status !== 'waiting') return err('Game is not open for joining.')

    const existingGame = await env.DB.prepare(`
      SELECT g.id, g.name FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.user_id = ? AND g.status IN ('waiting', 'active')
      LIMIT 1
    `).bind(user.user_id).first()
    if (existingGame) {
      return err(`You are already in a game ("${existingGame.name}"). Leave it before joining another.`, 409)
    }

    const { results: players } = await env.DB.prepare(
      'SELECT seat, user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()

    if (players.length >= 5) return err('Game is full.')

    const takenSeats = new Set(players.map(p => p.seat))
    let seat = 0
    while (takenSeats.has(seat)) seat++

    await env.DB.prepare(
      'INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)'
    ).bind(gameId, user.user_id, seat).run()

    const newCount = players.length + 1

    if (newCount === 5) {
      const allPlayers = [...players, { user_id: user.user_id, seat }]
        .sort((a, b) => a.seat - b.seat)
        .map(p => String(p.user_id))

      const settings = JSON.parse(game.settings_json)
      const state = dealHand(allPlayers, 0, 1, 1)
      state.reveal_partner = settings.reveal_partner
      state.double_on_bump = settings.double_on_bump

      const { rewindHistory: _dropped, ...stateToStore } = state

      await env.DB.batch([
        env.DB.prepare("INSERT INTO game_state (game_id, state_json, updated_at) VALUES (?, ?, datetime('now'))")
          .bind(gameId, JSON.stringify(stateToStore)),
        env.DB.prepare("UPDATE games SET status = 'active', current_hand = 1, updated_at = datetime('now') WHERE id = ?")
          .bind(gameId),
        env.DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, 1)')
          .bind(gameId),
        env.DB.prepare(
          'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, 1, 0, ?, NULL, ?)'
        ).bind(gameId, 'deal', JSON.stringify(stateToStore)),
      ])

      return json({ joined: true, started: true })
    }

    return json({ joined: true, started: false, player_count: newCount })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
```

- [ ] **Step 2: Replace `fill-with-bots.js`**

```js
import { json, err, requireUser, AuthError } from '../../_helpers.js'
import { dealHand } from '../../../../shared/gameEngine.js'
import { getAvailablePlayBots, processBotTurns } from '../../_botHelpers.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status !== 'waiting') return err('Game is not open for joining.')

    const membership = await env.DB.prepare(
      'SELECT id FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, user.user_id).first()
    if (!membership) return err('You are not in this game.', 403)

    const { results: currentPlayers } = await env.DB.prepare(
      'SELECT seat, user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()

    const emptyCount = 5 - currentPlayers.length
    if (emptyCount === 0) return err('Game is already full.')

    const bots = await getAvailablePlayBots(env.DB, emptyCount)
    const takenSeats = new Set(currentPlayers.map(p => p.seat))
    const insertStmts = []
    let seatCursor = 0
    for (const bot of bots) {
      while (takenSeats.has(seatCursor)) seatCursor++
      insertStmts.push(
        env.DB.prepare('INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)')
          .bind(gameId, bot.id, seatCursor)
      )
      takenSeats.add(seatCursor)
      seatCursor++
    }
    await env.DB.batch(insertStmts)

    const { results: allPlayers } = await env.DB.prepare(
      'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()
    const playerIds = allPlayers.map(p => String(p.user_id))

    const settings = JSON.parse(game.settings_json)
    let state = dealHand(playerIds, 0, 1, 1)
    state.reveal_partner = settings.reveal_partner
    state.double_on_bump = settings.double_on_bump

    const { rewindHistory: _dropped, ...stateToStore } = state

    await env.DB.batch([
      env.DB.prepare("INSERT INTO game_state (game_id, state_json, updated_at) VALUES (?, ?, datetime('now'))")
        .bind(gameId, JSON.stringify(stateToStore)),
      env.DB.prepare("UPDATE games SET status = 'active', current_hand = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(gameId),
      env.DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, 1)')
        .bind(gameId),
      env.DB.prepare(
        'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, 1, 0, ?, NULL, ?)'
      ).bind(gameId, 'deal', JSON.stringify(stateToStore)),
    ])

    state = await processBotTurns(stateToStore, gameId, env.DB, game)

    return json({ ok: true, started: true })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    console.error(e)
    return err(e.message, 500)
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/games/[id]/join.js functions/api/games/[id]/fill-with-bots.js
git commit -m "refactor: update join and fill-with-bots for settings_json, hands table, and deal action"
```

---

## Task 10: Update `action.js` — settings reads and action logging

**Files:**
- Modify: `functions/api/games/[id]/action.js`

This task rewrites `action.js`. The key changes: (1) read settings from `settings_json`; (2) append a row to `hand_actions` for every human action; (3) strip `rewindHistory` before persisting state; (4) replace snapshot-based rewind with replay-based rewind.

- [ ] **Step 1: Replace the entire file**

```js
import { json, err, requireUser, AuthError } from '../../_helpers.js'
import {
  pick, blitz, pass, discard, callAce, callAceUnknown, callTen, callKing, goAlone, playCard,
  crack, recrack,
  setupLeaster, awardLeasterBlind, resolveLeaster,
  resolveSchwanzer,
  dealHand, currentPlayer,
} from '../../../../shared/gameEngine.js'
import { replayActions } from '../../../../shared/actionReplay.js'
import { finishHand, processBotTurns } from '../../_botHelpers.js'

// Append one action row to hand_actions. seq is auto-computed as MAX(seq)+1.
async function appendAction(DB, gameId, handNumber, type, userId, payload) {
  const row = await DB.prepare(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM hand_actions WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).first()
  await DB.prepare(
    'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(gameId, handNumber, row.next, type, userId ? Number(userId) : null, payload ? JSON.stringify(payload) : null).run()
}

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }
    const { type, payload, act_as: actAsRaw } = body ?? {}

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status !== 'active') return err('Game is not active.')

    const settings = JSON.parse(game.settings_json)

    const stateRow = await env.DB.prepare(
      'SELECT state_json FROM game_state WHERE game_id = ?'
    ).bind(gameId).first()
    if (!stateRow) return err('Game state not found.')

    let state = JSON.parse(stateRow.state_json)

    const playerRow = await env.DB.prepare(
      'SELECT seat FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, user.user_id).first()
    if (!playerRow) return err('You are not in this game.', 403)

    let userId = String(user.user_id)
    if (actAsRaw) {
      if (!settings.is_test_mode) return err('act_as is only allowed in test mode games.', 403)
      if (!user.is_admin)         return err('Only admins can use act_as.', 403)
      const targetPlayer = await env.DB.prepare(
        `SELECT gp.user_id, u.is_bot FROM game_players gp JOIN users u ON u.id = gp.user_id
         WHERE gp.game_id = ? AND gp.user_id = ?`
      ).bind(gameId, Number(actAsRaw)).first()
      if (!targetPlayer) return err('act_as player is not in this game.', 400)
      userId = String(actAsRaw)
    }

    // Apply action
    switch (type) {
      case 'pick':
        state = pick(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'pick', userId, null)
        break

      case 'blitz':
        state = blitz(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'blitz', userId, null)
        break

      case 'pass': {
        const handNumberBeforePass = state.handNumber
        state = pass(state, userId)
        await appendAction(env.DB, gameId, handNumberBeforePass, 'pass', userId, null)

        if (state.phase === 'no_pick') {
          const freshGame = await env.DB.prepare('SELECT settings_json FROM games WHERE id = ?').bind(gameId).first()
          const freshSettings = JSON.parse(freshGame.settings_json)
          if (freshSettings.no_pick_variant === 'leasters') {
            state = setupLeaster(state)
            await appendAction(env.DB, gameId, handNumberBeforePass, 'setup_leaster', null, null)
          } else if (freshSettings.no_pick_variant === 'schwanzers') {
            const { scores } = resolveSchwanzer(state)
            state.scores = scores
            state.phase = 'scoring'
            state = await finishHand(env.DB, gameId, state)
          } else {
            // Doublers — finishHand handles the new deal + action logging
            const newMultiplier = state.doublerMultiplier * 2
            const { results: players } = await env.DB.prepare(
              'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
            ).bind(gameId).all()
            const playerIds = players.map(p => String(p.user_id))
            const nextDealer = (state.dealerSeat + 1) % 5
            const nextHandNumber = state.handNumber + 1
            const newState = dealHand(playerIds, nextDealer, nextHandNumber, newMultiplier)
            newState.doublerMultiplier = newMultiplier
            newState.reveal_partner = freshSettings.reveal_partner
            newState.double_on_bump = freshSettings.double_on_bump
            newState.log = [...state.log, ...newState.log, `Doubler! Stakes are now ×${newMultiplier}.`]

            await env.DB.prepare(
              "UPDATE hands SET variant = 'no_pick', completed_at = datetime('now') WHERE game_id = ? AND hand_number = ?"
            ).bind(gameId, handNumberBeforePass).run()
            await env.DB.prepare(
              "UPDATE games SET settings_json = json_set(settings_json, '$.doubler_multiplier', ?), updated_at = datetime('now') WHERE id = ?"
            ).bind(newMultiplier, gameId).run()

            const { rewindHistory: _d, ...nextStateToStore } = newState
            await env.DB.batch([
              env.DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, ?)').bind(gameId, nextHandNumber),
              env.DB.prepare(
                'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, 0, ?, NULL, ?)'
              ).bind(gameId, nextHandNumber, 'deal', JSON.stringify(nextStateToStore)),
            ])
            state = newState
          }
        }
        break
      }

      case 'discard':
        state = discard(state, userId, payload?.cardIds)
        await appendAction(env.DB, gameId, state.handNumber, 'discard', userId, { cardIds: payload?.cardIds })
        break

      case 'call_ace':
        state = callAce(state, userId, payload?.suit)
        await appendAction(env.DB, gameId, state.handNumber, 'call_ace', userId, { suit: payload?.suit })
        break

      case 'call_ace_unknown':
        state = callAceUnknown(state, userId, payload?.suit, payload?.underCardId)
        await appendAction(env.DB, gameId, state.handNumber, 'call_ace_unknown', userId, { suit: payload?.suit, underCardId: payload?.underCardId })
        break

      case 'call_ten':
        state = callTen(state, userId, payload?.suit)
        await appendAction(env.DB, gameId, state.handNumber, 'call_ten', userId, { suit: payload?.suit })
        break

      case 'call_king':
        state = callKing(state, userId, payload?.suit)
        await appendAction(env.DB, gameId, state.handNumber, 'call_king', userId, { suit: payload?.suit })
        break

      case 'go_alone':
        state = goAlone(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'go_alone', userId, null)
        break

      case 'crack':
        state = crack(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'crack', userId, null)
        break

      case 'recrack':
        state = recrack(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'recrack', userId, null)
        break

      case 'play_card': {
        const handNumberBeforePlay = state.handNumber
        state = playCard(state, userId, payload?.cardId)
        await appendAction(env.DB, gameId, handNumberBeforePlay, 'play_card', userId, { cardId: payload?.cardId })

        if (state.isLeaster && state.leasterBlind?.length > 0 && state.tricks.length === 1) {
          state = awardLeasterBlind(state)
        }

        if (state.phase === 'scoring') {
          state = await finishHand(env.DB, gameId, state)
        }
        break
      }

      case 'bot_play': {
        if (state.phase !== 'playing') return err('Game is not in playing phase.')
        const botId = currentPlayer(state)
        if (!botId) return err('No current player.')
        const botRow = await env.DB.prepare(
          `SELECT u.bot_type FROM game_players gp
           JOIN users u ON u.id = gp.user_id
           WHERE gp.game_id = ? AND gp.user_id = ?`
        ).bind(gameId, Number(botId)).first()
        if (!botRow || botRow.bot_type !== 'play') return err('Current player is not a play bot.', 400)
        break
      }

      case 'next_hand':
        // No-op — kept for backward compatibility
        break

      case 'rewind_play': {
        if (!settings.is_test_mode) return err('rewind_play is only allowed in test mode games.', 403)
        if (!user.is_admin)         return err('Only admins can use rewind_play.', 403)

        // Delete the last action for this hand
        const lastAction = await env.DB.prepare(
          'SELECT id FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq DESC LIMIT 1'
        ).bind(gameId, state.handNumber).first()

        if (lastAction) {
          await env.DB.prepare('DELETE FROM hand_actions WHERE id = ?').bind(lastAction.id).run()
        }

        // Replay remaining actions to rebuild state
        const { results: remaining } = await env.DB.prepare(
          'SELECT type, user_id, payload_json FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq ASC'
        ).bind(gameId, state.handNumber).all()
        state = replayActions(remaining)
        break
      }

      case 'rewind_trick': {
        if (!settings.is_test_mode) return err('rewind_trick is only allowed in test mode games.', 403)
        if (!user.is_admin)         return err('Only admins can use rewind_trick.', 403)

        // Get all actions for this hand ordered newest-first
        const { results: allActions } = await env.DB.prepare(
          'SELECT id, type FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq DESC'
        ).bind(gameId, state.handNumber).all()

        // Remove all play_card actions in the current trick, or last completed trick if at trick start
        const playsToRemove = state.currentTrick.length > 0 ? state.currentTrick.length : 5
        let removed = 0
        const idsToDelete = []
        for (const action of allActions) {
          if (action.type === 'play_card') {
            idsToDelete.push(action.id)
            removed++
            if (removed === playsToRemove) break
          }
        }

        if (idsToDelete.length > 0) {
          await env.DB.batch(idsToDelete.map(id =>
            env.DB.prepare('DELETE FROM hand_actions WHERE id = ?').bind(id)
          ))
        }

        // Replay remaining actions
        const { results: remaining } = await env.DB.prepare(
          'SELECT type, user_id, payload_json FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq ASC'
        ).bind(gameId, state.handNumber).all()
        state = replayActions(remaining)
        break
      }

      default:
        return err(`Unknown action type: ${type}`)
    }

    if ((type !== 'play_card' && type !== 'rewind_play' && type !== 'rewind_trick') || state.phase !== 'playing') {
      state = await processBotTurns(state, gameId, env.DB, game, { allowTrick1Lead: type === 'bot_play' })
    }

    const { rewindHistory: _dropped, ...stateToStore } = state

    await env.DB.prepare(
      "UPDATE game_state SET state_json = ?, updated_at = datetime('now') WHERE game_id = ?"
    ).bind(JSON.stringify(stateToStore), gameId).run()

    await env.DB.prepare(
      "UPDATE games SET updated_at = datetime('now') WHERE id = ?"
    ).bind(gameId).run()

    return json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    console.error(e)
    return err(e.message, 400)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/games/[id]/action.js
git commit -m "refactor: update action handler for settings_json, hand_actions logging, and replay-based rewind"
```

---

## Task 11: Update `_botHelpers.js` — instrument bot actions

**Files:**
- Modify: `functions/api/_botHelpers.js`

Bot actions need to be logged to `hand_actions` just like human actions. Add an `appendAction` helper (same as in `action.js`) and call it from `applyBotDecision`.

- [ ] **Step 1: Add `appendAction` helper near the top of `_botHelpers.js` (after imports)**

```js
async function appendAction(DB, gameId, handNumber, type, userId, payload) {
  const row = await DB.prepare(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM hand_actions WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).first()
  await DB.prepare(
    'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(gameId, handNumber, row.next, type, userId ? Number(userId) : null, payload ? JSON.stringify(payload) : null).run()
}
```

- [ ] **Step 2: Update `processBotTurns` to log each bot action**

In `processBotTurns`, after `current = applyBotDecision(current, nextActorId, view)`, add the logging call. The action type and payload must match what `applyBotDecision` did. The cleanest approach: refactor `applyBotDecision` to return both the new state and the action that was applied.

Replace `applyBotDecision` with a version that returns `{ state, actionType, payload }`:

```js
function applyBotDecision(state, userId, view) {
  switch (state.phase) {
    case 'picking': {
      const potentialBlitz = (view.potentialBlitzes ?? []).find(b => b.userId === userId)
      if (potentialBlitz && decideBlitz(view, userId)) {
        return { state: blitz(state, userId), actionType: 'blitz', payload: null }
      }
      const shouldPick = decidePick(view, userId)
      if (shouldPick) {
        return { state: pick(state, userId), actionType: 'pick', payload: null }
      }
      return { state: pass(state, userId), actionType: 'pass', payload: null }
    }

    case 'discarding': {
      const cardIds = decideDiscard(view, userId)
      return { state: discard(state, userId, cardIds), actionType: 'discard', payload: { cardIds } }
    }

    case 'calling': {
      const decision = decideCall(view, userId)
      switch (decision.type) {
        case 'ace':
          return { state: callAce(state, userId, decision.suit), actionType: 'call_ace', payload: { suit: decision.suit } }
        case 'ace_unknown':
          return { state: callAceUnknown(state, userId, decision.suit, decision.underCardId), actionType: 'call_ace_unknown', payload: { suit: decision.suit, underCardId: decision.underCardId } }
        case 'ten':
          return { state: callTen(state, userId, decision.suit), actionType: 'call_ten', payload: { suit: decision.suit } }
        case 'king':
          return { state: callKing(state, userId, decision.suit), actionType: 'call_king', payload: { suit: decision.suit } }
        default:
          return { state: goAlone(state, userId), actionType: 'go_alone', payload: null }
      }
    }

    case 'playing': {
      const cardId = decidePlay(view, userId)
      return { state: playCard(state, userId, cardId), actionType: 'play_card', payload: { cardId } }
    }

    default:
      return { state, actionType: null, payload: null }
  }
}
```

- [ ] **Step 3: Update `processBotTurns` to use the new return value and log actions**

In the `processBotTurns` loop, replace:
```js
current = applyBotDecision(current, nextActorId, view)
```
with:
```js
const handNumberBeforeAction = current.handNumber
const { state: newState, actionType, payload } = applyBotDecision(current, nextActorId, view)
current = newState
if (actionType) {
  await appendAction(DB, gameId, handNumberBeforeAction, actionType, nextActorId, payload)
}
```

Also update the `if (current.phase === 'no_pick')` check in `processBotTurns` to log the `setup_leaster` action for the leasters variant (since `resolveNoPick` itself doesn't log it):

```js
if (current.phase === 'no_pick') {
  const noPickHandNumber = current.handNumber
  current = await resolveNoPick(current, game, DB, gameId)
  // resolveNoPick doesn't log setup_leaster — do it here
  const noPickSettings = JSON.parse(game.settings_json)
  if (noPickSettings.no_pick_variant === 'leasters') {
    await appendAction(DB, gameId, noPickHandNumber, 'setup_leaster', null, null)
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add functions/api/_botHelpers.js
git commit -m "refactor: log bot actions to hand_actions in processBotTurns"
```

---

## Task 12: Update score and user management endpoints

**Files:**
- Modify: `functions/api/auth/me.js`
- Modify: `functions/api/admin/users/index.js`
- Modify: `functions/api/admin/users/[id]/index.js`
- Modify: `functions/api/admin/users/[id]/score-adjustment.js`

- [ ] **Step 1: Replace `functions/api/auth/me.js`**

```js
import { json, err, getUser, getDayScoreRange } from '../_helpers.js'

export async function onRequestGet({ request, env }) {
  const user = await getUser(request, env.DB)
  if (!user) return err('Not authenticated.', 401)

  const tzRow = await env.DB.prepare("SELECT value FROM config WHERE key = 'score_timezone'").first()
  const timezone = tzRow?.value ?? 'America/Chicago'
  const [dayStart, dayEnd] = getDayScoreRange(timezone)

  const lifetimeRow = await env.DB.prepare(
    'SELECT lifetime_score FROM user_scores WHERE user_id = ?'
  ).bind(user.user_id).first()

  const todayRow = await env.DB.prepare(
    'SELECT COALESCE(SUM(delta), 0) as total FROM score_events WHERE user_id = ? AND recorded_at >= ? AND recorded_at < ?'
  ).bind(user.user_id, dayStart, dayEnd).first()

  return json({
    id:            user.user_id,
    username:      user.username,
    is_admin:      user.is_admin === 1,
    is_bot:        user.is_bot   === 1,
    lifetimeScore: lifetimeRow?.lifetime_score ?? 0,
    todayScore:    todayRow?.total ?? 0,
  })
}
```

- [ ] **Step 2: Replace `functions/api/admin/users/index.js`**

```js
import { json, err, requireAdmin, getDayScoreRange, AuthError } from '../../_helpers.js'

export async function onRequestGet({ request, env }) {
  try {
    const _admin = await requireAdmin(request, env.DB)

    const tzRow = await env.DB.prepare("SELECT value FROM config WHERE key = 'score_timezone'").first()
    const timezone = tzRow?.value ?? 'America/Chicago'
    const [dayStart, dayEnd] = getDayScoreRange(timezone)

    const { results } = await env.DB.prepare(
      `SELECT u.id, u.username, u.is_admin, u.is_bot, u.created_at,
         COALESCE(us.lifetime_score, 0) AS lifetime_score,
         COALESCE((
           SELECT SUM(se.delta) FROM score_events se
           WHERE se.user_id = u.id AND se.recorded_at >= ? AND se.recorded_at < ?
         ), 0) AS day_score
       FROM users u
       LEFT JOIN user_scores us ON us.user_id = u.id
       ORDER BY u.is_bot ASC, u.is_admin DESC, u.username ASC`
    ).bind(dayStart, dayEnd).all()

    return json(results)
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}
```

- [ ] **Step 3: Update `getUser` in `functions/api/admin/users/[id]/index.js`**

Replace the `getUser` function (and fix the import — remove `centralDate`):

Change the import from:
```js
import { json, err, requireAdmin, hashPassword, randomHex, AuthError, centralDate } from '../../../_helpers.js'
```
to:
```js
import { json, err, requireAdmin, hashPassword, randomHex, getDayScoreRange, AuthError } from '../../../_helpers.js'
```

Replace the `getUser` function:

```js
async function getUser({ request, env, params }) {
  const _admin = await requireAdmin(request, env.DB)
  const userId = params.id

  const user = await env.DB.prepare(
    'SELECT id, username, is_admin, is_bot, created_at FROM users WHERE id = ?'
  ).bind(userId).first()
  if (!user) return err('User not found.', 404)

  const tzRow = await env.DB.prepare("SELECT value FROM config WHERE key = 'score_timezone'").first()
  const timezone = tzRow?.value ?? 'America/Chicago'
  const [dayStart, dayEnd] = getDayScoreRange(timezone)

  const lifetimeRow = await env.DB.prepare(
    'SELECT lifetime_score FROM user_scores WHERE user_id = ?'
  ).bind(userId).first()

  const todayRow = await env.DB.prepare(
    'SELECT COALESCE(SUM(delta), 0) as total FROM score_events WHERE user_id = ? AND recorded_at >= ? AND recorded_at < ?'
  ).bind(userId, dayStart, dayEnd).first()

  return json({
    ...user,
    lifetimeScore: lifetimeRow?.lifetime_score ?? 0,
    todayScore:    todayRow?.total ?? 0,
  })
}
```

Also update `deleteUser` to remove the `user_scores` row:

```js
await env.DB.batch([
  env.DB.prepare('DELETE FROM game_players WHERE user_id = ?').bind(userId),
  env.DB.prepare('DELETE FROM score_events WHERE user_id = ?').bind(userId),
  env.DB.prepare('DELETE FROM user_scores WHERE user_id = ?').bind(userId),
  env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
])
```

- [ ] **Step 4: Replace `score-adjustment.js`**

```js
import { json, err, requireAdmin, AuthError } from '../../../_helpers.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const _admin = await requireAdmin(request, env.DB)
    const userId = Number(params.id)

    const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
    if (!target) return err('User not found.', 404)

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }

    const { new_lifetime_score } = body
    if (typeof new_lifetime_score !== 'number' || !Number.isInteger(new_lifetime_score))
      return err('new_lifetime_score must be an integer.')

    // Upsert user_scores to the target lifetime score
    await env.DB.prepare(`
      INSERT INTO user_scores (user_id, lifetime_score, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        lifetime_score = excluded.lifetime_score,
        updated_at     = datetime('now')
    `).bind(userId, new_lifetime_score).run()

    const updated = await env.DB.prepare(
      'SELECT lifetime_score FROM user_scores WHERE user_id = ?'
    ).bind(userId).first()

    return json({
      id:             userId,
      lifetime_score: updated?.lifetime_score ?? 0,
    })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add functions/api/auth/me.js functions/api/admin/users/index.js functions/api/admin/users/[id]/index.js functions/api/admin/users/[id]/score-adjustment.js
git commit -m "refactor: update score endpoints to use user_scores cache and UTC day score range"
```

---

## Task 13: Update frontend `api.js`

**Files:**
- Modify: `frontend/src/lib/api.js`

- [ ] **Step 1: Update `create` and `adjustScore` signatures**

Replace the relevant lines:

```js
// Change the create function:
create: (name, settings = {}) => request('POST', '/games', { name, settings }),

// Change the adjustScore function:
adjustScore: (id, newLifetimeScore) =>
  request('POST', `/admin/users/${id}/score-adjustment`,
    { new_lifetime_score: newLifetimeScore }),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "refactor: update api.js for new create and adjustScore signatures"
```

---

## Task 14: Update frontend settings references

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`
- Modify: `frontend/src/pages/LobbyPage.jsx`

- [ ] **Step 1: Update `GamePage.jsx`**

All references to flat `game.*` settings fields change to `game.settings.*`. Make the following replacements:

Line 153: `data.no_pick_variant` → `data.settings?.no_pick_variant`
Line 154: `data.reveal_partner` → `data.settings?.reveal_partner`
Line 155: `data.double_on_bump` → `data.settings?.double_on_bump`
Line 175: `gameData?.is_test_mode` → `gameData?.settings?.is_test_mode`
Line 231: `gameData?.is_test_mode` → `gameData?.settings?.is_test_mode`

Lines 324-326, `handleSettingsUpdate`:
```js
function handleSettingsUpdate(result) {
  const s = result.settings ?? {}
  if (s.no_pick_variant !== undefined) setCurrentVariant(s.no_pick_variant)
  if (s.reveal_partner  !== undefined) setRevealPartner(s.reveal_partner)
  if (s.double_on_bump  !== undefined) setDobEnabled(s.double_on_bump)
}
```

Lines 364-368, destructuring `gameData`:
```js
const {
  status,
  is_admin:    isGameAdmin,
  settings: {
    is_test_mode:    isTestMode,
    no_pick_variant: noPickVariant,
  } = {},
} = gameData
```

Lines 405-406, 598-599 — change `gameData.reveal_partner` → `gameData.settings?.reveal_partner` and `gameData.double_on_bump` → `gameData.settings?.double_on_bump`.

Lines 418 and 610 — change:
```js
values={{ no_pick_variant: currentVariant ?? noPickVariant, reveal_partner: revealPartner ?? gameData.settings?.reveal_partner ?? true, double_on_bump: dobEnabled ?? gameData.settings?.double_on_bump ?? true }}
```

- [ ] **Step 2: Update `LobbyPage.jsx`**

Line 203: `game.is_test_mode` → `game.settings?.is_test_mode`
Line 211: `game.no_pick_variant` → `game.settings?.no_pick_variant`

Lines 44-49, update the `api.games.create` call:
```js
const game = await api.games.create(
  gameName.trim() || `${user.username}'s game`,
  {
    no_pick_variant: gameOptions.no_pick_variant,
    is_test_mode:    user.is_admin ? testMode : false,
    reveal_partner:  gameOptions.reveal_partner,
    double_on_bump:  gameOptions.double_on_bump,
  }
)
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/GamePage.jsx frontend/src/pages/LobbyPage.jsx
git commit -m "refactor: update frontend to use game.settings.* instead of flat game fields"
```

---

## Task 15: Update admin score adjustment UI

**Files:**
- Modify: `frontend/src/pages/AccountManagementPage.jsx`

The day score field is removed. The admin can only set lifetime score.

- [ ] **Step 1: Remove `draftDay` state and day score field from `UserRow`**

In `UserRow`:
- Remove: `const [draftDay, setDraftDay] = useState(String(user.day_score ?? 0))`
- Remove the `draftDay` reset in `useEffect`
- Remove the `newDay` parse and validation in `handleSave`
- Change the score-changed check from:
  ```js
  const scoreChanged = newDay !== (user.day_score ?? 0) || newLifetime !== (user.lifetime_score ?? 0)
  if (scoreChanged) {
    const scoreResult = await api.admin.adjustScore(user.id, newDay, newLifetime)
    updated = { ...updated, day_score: scoreResult.day_score, lifetime_score: scoreResult.lifetime_score }
  }
  ```
  to:
  ```js
  const scoreChanged = newLifetime !== (user.lifetime_score ?? 0)
  if (scoreChanged) {
    const scoreResult = await api.admin.adjustScore(user.id, newLifetime)
    updated = { ...updated, lifetime_score: scoreResult.lifetime_score }
  }
  ```
- In `handleCancel`, remove: `setDraftDay(String(user.day_score ?? 0))`
- In the edit row JSX, remove the day score `<td>` with its `<input type="number" value={draftDay} ...>`
- In the non-edit row JSX, keep the day score display `<td>{user.day_score ?? 0}</td>` (it's still shown, just not editable)
- Remove the Day column width from `<colgroup>` (merge it into adjacent col or keep as-is)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/AccountManagementPage.jsx
git commit -m "refactor: remove day score adjustment from admin panel — lifetime only"
```

---

## Task 16: End-to-end smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```
Expected: Vite on :3000, Wrangler on :8788 — no startup errors.

- [ ] **Step 2: Create and play through a full test mode hand**

1. Log in as Andy (admin)
2. Create a test mode game
3. Verify the lobby shows `settings.is_test_mode` badge
4. Enter the game — verify it starts immediately (5 players seated)
5. Play through the picking phase (pick or pass)
6. If picked: discard, call, play cards through a full hand
7. Verify the hand completes and scores are updated in the player panels
8. Verify the next hand deals automatically

- [ ] **Step 3: Test rewind_play**

1. In a test mode game, play 2-3 cards
2. Use the admin rewind button
3. Verify state goes back one card play
4. Play a different card — verify game continues normally

- [ ] **Step 4: Test score persistence**

1. Complete a hand and note the scores shown
2. Refresh the page
3. Verify scores are still correct (now served from `user_scores` + bounded `score_events`)

- [ ] **Step 5: Test admin score adjustment**

1. Go to Account Management
2. Edit a user's lifetime score
3. Verify only lifetime score is editable (no day score field in edit mode)
4. Save — verify the new lifetime score appears

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: db refactor complete — smoke test passed"
```

---

## Post-implementation

After all tasks are complete and smoke tests pass, open a PR from this branch to `main`. The PR should reference issues #70, #109, #111, and #120 (data layer).
