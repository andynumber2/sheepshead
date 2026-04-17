# Hand Recap Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-hand recap feature — a "simple recap" landing page plus a "detailed replay" page — reachable by clicking the "Hand N" text in the play history.

**Architecture:** The backend exposes two public endpoints: a digest endpoint that parses `hand_actions` server-side into a flat summary, and a raw actions endpoint. The frontend renders the simple recap from the digest and the detailed replay from the raw actions (using the existing `replayActions` utility to reconstruct state at each step). Hash routing (no react-router) matches the rest of the app.

**Tech Stack:** React 18, Cloudflare Pages Functions, D1 (SQLite), vitest, hash routing via `window.location.hash`.

**Spec:** `docs/superpowers/specs/2026-04-16-hand-recap-screen-design.md`

**Follow-up issue (deferred):** https://github.com/andynumber2/sheepshead/issues/125 — bot inference snapshots for the right-side panel in detailed replay.

---

## File Structure

### New files (backend)
- `shared/recapDigest.js` — pure function `buildHandDigest(actions, players, scoreEventsByUser)` → digest object
- `shared/recapDigest.test.js` — unit tests covering Normal, Leaster, Schwanzer
- `functions/api/recap/[gameId]/[handNumber].js` — digest endpoint
- `functions/api/recap/[gameId]/[handNumber]/actions.js` — raw-actions endpoint

### New files (frontend)
- `frontend/src/pages/RecapPage.jsx` — simple recap
- `frontend/src/pages/DetailedReplayPage.jsx` — step-through replay
- `frontend/src/components/recap/MetaStrip.jsx` — variant/picker/partner/called row
- `frontend/src/components/recap/BlindStrip.jsx` — blind + discards
- `frontend/src/components/recap/ScoresList.jsx` — final scores list
- `frontend/src/components/recap/TrickTable.jsx` — 6-row × 5-player card grid
- `frontend/src/components/recap/ReplaySeat.jsx` — seat with face-up hand for detailed replay
- `frontend/src/components/recap/ReplayTrickZone.jsx` — center trick zone for detailed replay
- `frontend/src/components/recap/ReplayControls.jsx` — step/auto-play buttons + scrubber
- `frontend/src/components/recap/recap.css` — recap-specific styles (imported by both pages)

### Modified files (frontend)
- `frontend/src/lib/api.js` — add `recap.getDigest()` and `recap.getActions()`
- `frontend/src/App.jsx` — add `recap` and `recap-replay` routes to `parseRoute`, wire pages
- `frontend/src/components/GameLog.jsx` — wrap "Hand N" text in link; accept `gameId` prop
- `frontend/src/pages/GamePage.jsx` — pass `gameId` to `<GameLog />`

---

## Task 1: Shared digest builder — Normal variant

**Files:**
- Create: `shared/recapDigest.js`
- Create: `shared/recapDigest.test.js`

This task builds the pure digest function for the Normal variant. Leaster and Schwanzer are added in Tasks 2 and 3.

### What `buildHandDigest` does

Inputs:
- `actions` — array of `hand_actions` rows ordered by `seq` (with `type`, `user_id`, `payload_json`, `seq`)
- `players` — array of `{ userId, username, seat, isBot }` for all 5 seats
- `scoreEventsByUser` — object keyed by `userId` → `scoreDelta` number

Output: a `Digest` object matching the API contract in the spec.

The function uses `replayActions(actions)` from `shared/actionReplay.js` to reconstruct final state, then reads from that state + the raw action list to fill the digest.

- [ ] **Step 1.1: Write failing tests for Normal variant digest**

Create `shared/recapDigest.test.js` with this content:

```js
import { describe, it, expect } from 'vitest'
import { buildHandDigest } from './recapDigest.js'
import { dealHand } from './gameEngine.js'

function dealAction(state) {
  return { type: 'deal', user_id: null, payload_json: JSON.stringify(state), seq: 0 }
}

function action(type, userId, payload, seq) {
  return {
    type,
    user_id: userId ? Number(userId) : null,
    payload_json: payload ? JSON.stringify(payload) : null,
    seq,
  }
}

// Helper to deterministically place a given card into a given player's hand
// by swapping with whoever currently has it. Used to build controlled fixtures.
function forceCardInHand(state, targetUserId, cardId) {
  const currentOwner = Object.keys(state.hands).find(uid =>
    state.hands[uid].some(c => c.id === cardId)
  )
  if (currentOwner === targetUserId) return state
  // Swap first card of targetUserId with the cardId in currentOwner's hand
  const swapFrom = state.hands[targetUserId][0]
  state.hands[currentOwner] = state.hands[currentOwner].map(c =>
    c.id === cardId ? swapFrom : c
  )
  state.hands[targetUserId] = state.hands[targetUserId].map(c =>
    c.id === swapFrom.id ? { ...swapFrom, id: cardId } : c
  )
  return state
}

const PLAYERS = [
  { userId: '1', username: 'Andy', seat: 0, isBot: false },
  { userId: '2', username: 'Bot-Lou', seat: 1, isBot: true },
  { userId: '3', username: 'Bot-Mary', seat: 2, isBot: true },
  { userId: '4', username: 'Bot-Tom', seat: 3, isBot: true },
  { userId: '5', username: 'Bot-Pat', seat: 4, isBot: true },
]

describe('buildHandDigest — Normal variant', () => {
  it('returns metadata and dealt hands from a deal-only action list', () => {
    const initial = dealHand(['1', '2', '3', '4', '5'], 0, 1, 1)
    const actions = [dealAction(initial)]
    const digest = buildHandDigest(actions, PLAYERS, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })

    expect(digest.variant).toBe('normal')
    expect(digest.handNumber).toBe(1)
    expect(digest.picker).toBeNull()
    expect(digest.partner).toBeNull()
    expect(digest.blind).toHaveLength(2)
    expect(digest.blind.every(id => typeof id === 'string')).toBe(true)
    expect(digest.dealt['1']).toHaveLength(6)
    expect(digest.tricks).toEqual([])
    expect(digest.players).toEqual(PLAYERS)
  })

  it('populates picker, partner, calledCard and discards for a completed normal hand', () => {
    const initial = dealHand(['1', '2', '3', '4', '5'], 0, 1, 1)
    // pickOrder[0] picks (user 2); discards two non-required cards; calls AC → partner is whoever holds AC
    const pickerId = initial.pickOrder[0]
    const actions = [
      dealAction(initial),
      action('pick', pickerId, null, 1),
    ]
    // Keep this small — we just verify picker/partner wiring, not full trick play
    const digest = buildHandDigest(actions, PLAYERS, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
    expect(digest.picker).toEqual({ userId: pickerId })
  })

  it('flattens all 6 tricks with winners and card points into the digest', () => {
    // Integration-style: build a known full hand via direct engine calls, then
    // serialize those calls as actions and feed them to buildHandDigest.
    // This is involved; use actionReplay.test.js as a reference for how to construct.
    // (Detailed card-level fixture omitted here; test covers that tricks array has 6 entries
    // with winner/plays/cardPoints populated when state.tricks is populated.)
    const { replayActions } = require('./actionReplay.js')
    // Construct a synthetic state where state.tricks has been populated directly
    const initial = dealHand(['1', '2', '3', '4', '5'], 0, 1, 1)
    initial.picker = '1'
    initial.partner = '2'
    initial.calledAce = { suit: 'C', aceId: 'AC' }
    initial.callMode = 'ace'
    initial.discard = [{ id: 'X1', suit: 'C', rank: '7', points: 0 }, { id: 'X2', suit: 'D', rank: '8', points: 0 }]
    initial.tricks = Array.from({ length: 6 }, (_, i) => ({
      leader: '1',
      plays: [
        { userId: '1', card: { id: 'T1', suit: 'C', rank: '9', points: 0 } },
        { userId: '2', card: { id: 'T2', suit: 'C', rank: '10', points: 10 } },
        { userId: '3', card: { id: 'T3', suit: 'C', rank: 'K', points: 4 } },
        { userId: '4', card: { id: 'T4', suit: 'C', rank: '8', points: 0 } },
        { userId: '5', card: { id: 'T5', suit: 'C', rank: 'A', points: 11 } },
      ],
      winner: '5',
    }))
    initial.phase = 'complete'
    const actions = [dealAction(initial)]
    const digest = buildHandDigest(actions, PLAYERS, { 1: -2, 2: -1, 3: 1, 4: 1, 5: 1 })

    expect(digest.tricks).toHaveLength(6)
    expect(digest.tricks[0].plays).toHaveLength(5)
    expect(digest.tricks[0].winnerUserId).toBe('5')
    expect(digest.tricks[0].cardPoints).toBe(25)
    expect(digest.picker.userId).toBe('1')
    expect(digest.partner.userId).toBe('2')
    expect(digest.calledCard).toBe('AC')
    expect(digest.pickerDiscards).toEqual(['X1', 'X2'])
    expect(digest.scores).toContainEqual({ userId: '1', cardPoints: expect.any(Number), scoreDelta: -2 })
  })
})
```

- [ ] **Step 1.2: Run tests — verify they fail with "module not found"**

Run: `npx vitest run shared/recapDigest.test.js`
Expected: FAIL — `Cannot find module './recapDigest.js'`

- [ ] **Step 1.3: Implement `buildHandDigest` for Normal variant**

Create `shared/recapDigest.js`:

```js
import { replayActions } from './actionReplay.js'
import { cardPoints } from './gameEngine.js'

/**
 * Builds a recap digest for a single hand from its action log.
 *
 * @param {Array} actions - hand_actions rows ordered by seq, first row must be type='deal'
 * @param {Array} players - [{ userId, username, seat, isBot }] all 5 seats
 * @param {Object} scoreEventsByUser - { [userId]: scoreDelta }
 * @returns {Object} digest - see spec for shape
 */
export function buildHandDigest(actions, players, scoreEventsByUser) {
  if (actions.length === 0) throw new Error('buildHandDigest: no actions')
  const finalState = replayActions(actions)

  // Dealt hands and blind come from the very first deal action payload
  const dealPayload = JSON.parse(actions[0].payload_json)
  const dealt = {}
  for (const [uid, hand] of Object.entries(dealPayload.hands)) {
    dealt[uid] = hand.map(c => c.id)
  }
  const initialBlind = dealPayload.blind.map(c => c.id)

  const variant = detectVariant(actions, finalState)

  // Find the discard action to capture picker's discards as card ids
  const discardAction = actions.find(a => a.type === 'discard')
  const pickerDiscards = discardAction
    ? JSON.parse(discardAction.payload_json).cardIds
    : []

  // Called card id (ace, ten, or king)
  const calledCard =
    finalState.calledAce?.aceId ??
    finalState.calledTen?.tenId ??
    finalState.calledKing?.kingId ??
    null

  // Partner reveal trick (the trick in which the partner played the called card)
  let partnerRevealedOnTrick = null
  if (finalState.partner && calledCard) {
    for (let i = 0; i < finalState.tricks.length; i++) {
      const played = finalState.tricks[i].plays.find(
        p => p.userId === finalState.partner && p.card.id === calledCard
      )
      if (played) { partnerRevealedOnTrick = i + 1; break }
    }
  }

  // Walk tricks to compute plays with seq values; match plays against play_card actions
  const playActions = actions.filter(a => a.type === 'play_card')
  const tricks = finalState.tricks.map((t, idx) => {
    const plays = t.plays.map(p => {
      const match = playActions.find(a => {
        const pa = JSON.parse(a.payload_json)
        return String(a.user_id) === p.userId && pa.cardId === p.card.id
      })
      return {
        userId: p.userId,
        card: p.card.id,
        seq: match ? match.seq : null,
      }
    })
    return {
      trickNumber: idx + 1,
      leaderUserId: t.leader,
      plays,
      winnerUserId: t.winner,
      cardPoints: t.plays.reduce((s, p) => s + cardPoints(p.card), 0),
    }
  })

  // Card points per player (for scores block)
  const cardPointsByUser = {}
  for (const p of players) cardPointsByUser[p.userId] = 0
  for (const t of finalState.tricks) {
    const pts = t.plays.reduce((s, p) => s + cardPoints(p.card), 0)
    cardPointsByUser[t.winner] = (cardPointsByUser[t.winner] ?? 0) + pts
  }
  // Buried discards count to picker
  if (finalState.picker && finalState.discard) {
    for (const c of finalState.discard) {
      cardPointsByUser[finalState.picker] += cardPoints(c)
    }
  }

  const scores = players.map(p => ({
    userId: p.userId,
    cardPoints: cardPointsByUser[p.userId] ?? 0,
    scoreDelta: scoreEventsByUser[p.userId] ?? 0,
  }))

  return {
    gameId: null,    // filled in by the endpoint
    handNumber: dealPayload.handNumber,
    variant,
    callMode: finalState.callMode ?? null,
    startedAt: null, // filled in by the endpoint
    completedAt: null, // filled in by the endpoint
    players,
    dealt,
    blind: variant === 'normal' ? initialBlind : null,
    picker: finalState.picker ? { userId: finalState.picker } : null,
    partner: finalState.partner
      ? { userId: finalState.partner, revealedOnTrick: partnerRevealedOnTrick }
      : null,
    calledCard,
    pickerDiscards: variant === 'normal' ? pickerDiscards : null,
    tricks,
    scores,
  }
}

function detectVariant(actions, finalState) {
  if (actions.some(a => a.type === 'schwanzer_score')) return 'schwanzer'
  if (finalState.isLeaster) return 'leaster'
  return 'normal'
}
```

- [ ] **Step 1.4: Run tests — verify they pass**

Run: `npx vitest run shared/recapDigest.test.js`
Expected: PASS — all three Normal-variant tests green

- [ ] **Step 1.5: Commit**

```bash
git add shared/recapDigest.js shared/recapDigest.test.js
git commit -m "feat: add recap digest builder for normal variant"
```

---

## Task 2: Digest builder — Leaster variant

**Files:**
- Modify: `shared/recapDigest.test.js`
- Modify: `shared/recapDigest.js` (small tweak if needed — most leaster logic is covered by the normal branch since tricks and card plays are the same)

Leaster reuses the Normal trick structure. The digest must:
- Set `variant: 'leaster'`
- Return `picker: null`, `partner: null`, `calledCard: null`, `callMode: null`
- Return `blind: null`, `pickerDiscards: null` (blind is awarded in-play, not stored on the hand)
- Still return 6 tricks

- [ ] **Step 2.1: Add failing Leaster test**

Append to `shared/recapDigest.test.js`:

```js
describe('buildHandDigest — Leaster variant', () => {
  it('sets variant to leaster and nulls picker/partner/blind', () => {
    const initial = dealHand(['1', '2', '3', '4', '5'], 0, 1, 1)
    initial.isLeaster = true
    initial.phase = 'playing'
    initial.tricks = []  // no tricks yet

    const actions = [
      { type: 'deal', user_id: null, payload_json: JSON.stringify(initial), seq: 0 },
      { type: 'pass', user_id: 1, payload_json: null, seq: 1 },
      { type: 'pass', user_id: 2, payload_json: null, seq: 2 },
      { type: 'pass', user_id: 3, payload_json: null, seq: 3 },
      { type: 'pass', user_id: 4, payload_json: null, seq: 4 },
      { type: 'pass', user_id: 5, payload_json: null, seq: 5 },
      { type: 'setup_leaster', user_id: null, payload_json: null, seq: 6 },
    ]
    const digest = buildHandDigest(actions, PLAYERS, { 1: -1, 2: -1, 3: -1, 4: -1, 5: 4 })

    expect(digest.variant).toBe('leaster')
    expect(digest.picker).toBeNull()
    expect(digest.partner).toBeNull()
    expect(digest.calledCard).toBeNull()
    expect(digest.blind).toBeNull()
    expect(digest.pickerDiscards).toBeNull()
  })
})
```

- [ ] **Step 2.2: Run tests — verify pass**

Run: `npx vitest run shared/recapDigest.test.js`
Expected: PASS — the variant-detect logic from Task 1 already handles `finalState.isLeaster`, and normal-branch null-guards already cover the blind/discards cases. If anything fails, add narrow guards in `recapDigest.js` where the test identifies the gap.

- [ ] **Step 2.3: Commit**

```bash
git add shared/recapDigest.test.js shared/recapDigest.js
git commit -m "test: verify recap digest handles leaster variant"
```

---

## Task 3: Digest builder — Schwanzer variant

**Files:**
- Modify: `shared/recapDigest.test.js`
- Modify: `shared/recapDigest.js`

Schwanzer has no tricks (no cards played). The digest must:
- Set `variant: 'schwanzer'`
- Return `tricks: []`
- Return `picker: null`, `partner: null`, `blind: null`, `pickerDiscards: null`
- `dealt` and `scores` remain meaningful

The variant detection already keys off `schwanzer_score` actions. The existing branches correctly return empty `tricks`. Verify with a test.

- [ ] **Step 3.1: Add failing Schwanzer test**

Append to `shared/recapDigest.test.js`:

```js
describe('buildHandDigest — Schwanzer variant', () => {
  it('sets variant to schwanzer and returns empty tricks', () => {
    const initial = dealHand(['1', '2', '3', '4', '5'], 0, 1, 1)
    initial.phase = 'no_pick'

    const actions = [
      { type: 'deal', user_id: null, payload_json: JSON.stringify(initial), seq: 0 },
      { type: 'pass', user_id: 1, payload_json: null, seq: 1 },
      { type: 'pass', user_id: 2, payload_json: null, seq: 2 },
      { type: 'pass', user_id: 3, payload_json: null, seq: 3 },
      { type: 'pass', user_id: 4, payload_json: null, seq: 4 },
      { type: 'pass', user_id: 5, payload_json: null, seq: 5 },
      { type: 'schwanzer_score', user_id: null, payload_json: null, seq: 6 },
    ]
    const digest = buildHandDigest(actions, PLAYERS, { 1: 1, 2: 1, 3: 1, 4: -4, 5: 1 })

    expect(digest.variant).toBe('schwanzer')
    expect(digest.tricks).toEqual([])
    expect(digest.picker).toBeNull()
    expect(digest.blind).toBeNull()
    expect(digest.pickerDiscards).toBeNull()
    expect(digest.dealt['1']).toHaveLength(6)
    expect(digest.scores.find(s => s.userId === '4').scoreDelta).toBe(-4)
  })
})
```

- [ ] **Step 3.2: Run tests — verify pass**

Run: `npx vitest run shared/recapDigest.test.js`
Expected: PASS. If `replayActions` throws on a schwanzer action sequence, adjust the digest builder to short-circuit before calling `replayActions` when `detectVariant` already confirms schwanzer, using the deal state directly. Minimal patch in `recapDigest.js`:

```js
// Near the top of buildHandDigest, BEFORE calling replayActions:
const isSchwanzer = actions.some(a => a.type === 'schwanzer_score')
const finalState = isSchwanzer
  ? JSON.parse(actions[0].payload_json)  // deal state is sufficient for schwanzer digest
  : replayActions(actions)
```

(Apply only if the test fails due to replay throwing.)

- [ ] **Step 3.3: Commit**

```bash
git add shared/recapDigest.test.js shared/recapDigest.js
git commit -m "feat: recap digest handles schwanzer variant"
```

---

## Task 4: Digest API endpoint

**Files:**
- Create: `functions/api/recap/[gameId]/[handNumber].js`

Cloudflare Pages Functions map file paths directly to routes. The file at `functions/api/recap/[gameId]/[handNumber].js` handles `GET /api/recap/:gameId/:handNumber`.

- [ ] **Step 4.1: Create the endpoint**

```js
import { json, err } from '../../../_helpers.js'
import { buildHandDigest } from '../../../../shared/recapDigest.js'

export async function onRequestGet({ env, params }) {
  const gameId = Number(params.gameId)
  const handNumber = Number(params.handNumber)
  if (!Number.isFinite(gameId) || !Number.isFinite(handNumber)) {
    return err('Invalid gameId or handNumber.', 400)
  }

  const hand = await env.DB.prepare(
    'SELECT * FROM hands WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).first()

  // Anti-cheat: refuse if hand is missing OR still in progress
  if (!hand || !hand.completed_at) return err('Not found.', 404)

  const { results: actions } = await env.DB.prepare(
    'SELECT seq, type, user_id, payload_json FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq ASC'
  ).bind(gameId, handNumber).all()

  const { results: playerRows } = await env.DB.prepare(
    `SELECT gp.user_id, gp.seat, u.username, u.is_bot
     FROM game_players gp JOIN users u ON u.id = gp.user_id
     WHERE gp.game_id = ? ORDER BY gp.seat ASC`
  ).bind(gameId).all()
  const players = playerRows.map(r => ({
    userId: String(r.user_id),
    username: r.username,
    seat: r.seat,
    isBot: !!r.is_bot,
  }))

  const { results: scoreRows } = await env.DB.prepare(
    'SELECT user_id, delta FROM score_events WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).all()
  const scoreEventsByUser = {}
  for (const r of scoreRows) scoreEventsByUser[String(r.user_id)] = r.delta

  const digest = buildHandDigest(actions, players, scoreEventsByUser)
  digest.gameId = gameId
  digest.startedAt = hand.started_at
  digest.completedAt = hand.completed_at

  return json(digest)
}
```

- [ ] **Step 4.2: Manually test the endpoint**

Start dev server: `npm run dev` (in one terminal)

In another terminal, find an existing game + hand number from the local DB:

```bash
npx wrangler d1 execute sheepshead-db --local --command "SELECT game_id, hand_number, completed_at FROM hands WHERE completed_at IS NOT NULL LIMIT 3;"
```

Then:
```bash
curl -s "http://localhost:8788/api/recap/<gameId>/<handNumber>" | head -40
```

Expected: JSON with `variant`, `picker`, `tricks`, `scores`, etc.

Also verify anti-cheat: pick a hand with `completed_at IS NULL` (if any) and confirm 404.

- [ ] **Step 4.3: Commit**

```bash
git add functions/api/recap/
git commit -m "feat: add recap digest endpoint"
```

---

## Task 5: Raw actions API endpoint

**Files:**
- Create: `functions/api/recap/[gameId]/[handNumber]/actions.js`

- [ ] **Step 5.1: Create the endpoint**

```js
import { json, err } from '../../../../_helpers.js'

export async function onRequestGet({ env, params }) {
  const gameId = Number(params.gameId)
  const handNumber = Number(params.handNumber)
  if (!Number.isFinite(gameId) || !Number.isFinite(handNumber)) {
    return err('Invalid gameId or handNumber.', 400)
  }

  const hand = await env.DB.prepare(
    'SELECT completed_at FROM hands WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).first()
  if (!hand || !hand.completed_at) return err('Not found.', 404)

  const { results } = await env.DB.prepare(
    'SELECT seq, type, user_id, payload_json, created_at FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq ASC'
  ).bind(gameId, handNumber).all()

  const actions = results.map(r => ({
    seq: r.seq,
    type: r.type,
    userId: r.user_id != null ? String(r.user_id) : null,
    payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    createdAt: r.created_at,
  }))

  return json({ actions })
}
```

- [ ] **Step 5.2: Manually test**

```bash
curl -s "http://localhost:8788/api/recap/<gameId>/<handNumber>/actions" | head -30
```

Expected: `{ "actions": [ { seq, type, userId, payload, createdAt }, ... ] }`

- [ ] **Step 5.3: Commit**

```bash
git add functions/api/recap/
git commit -m "feat: add raw actions endpoint for detailed replay"
```

---

## Task 6: Frontend — API client methods and route registration

**Files:**
- Modify: `frontend/src/lib/api.js`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 6.1: Add recap methods to the API client**

In `frontend/src/lib/api.js`, inside the `export const api = {` object, add a new `recap` section after the `admin` block:

```js
  recap: {
    getDigest:  (gameId, handNumber) => request('GET', `/recap/${gameId}/${handNumber}`),
    getActions: (gameId, handNumber) => request('GET', `/recap/${gameId}/${handNumber}/actions`),
  },
```

- [ ] **Step 6.2: Add recap routes to `App.jsx`**

In `frontend/src/App.jsx`:

1. Add imports at the top (after the other page imports):

```js
import RecapPage from './pages/RecapPage.jsx'
import DetailedReplayPage from './pages/DetailedReplayPage.jsx'
```

2. Replace `parseRoute` with a version that also matches recap routes. Change:

```js
function parseRoute(route) {
  const gameMatch = route.match(/^\/game\/(\d+)$/)
  if (gameMatch) return { page: 'game', gameId: gameMatch[1] }
  if (route === '/register')           return { page: 'register' }
  if (route === '/lobby')              return { page: 'lobby' }
  if (route === '/admin')              return { page: 'admin' }
  if (route === '/account-management') return { page: 'account-management' }
  return { page: 'login' }
}
```

to:

```js
function parseRoute(route) {
  const replayMatch = route.match(/^\/recap\/(\d+)\/(\d+)\/replay(?:\?seq=(\d+))?$/)
  if (replayMatch) return { page: 'recap-replay', gameId: replayMatch[1], handNumber: replayMatch[2], seq: replayMatch[3] ? Number(replayMatch[3]) : null }
  const recapMatch = route.match(/^\/recap\/(\d+)\/(\d+)$/)
  if (recapMatch) return { page: 'recap', gameId: recapMatch[1], handNumber: recapMatch[2] }
  const gameMatch = route.match(/^\/game\/(\d+)$/)
  if (gameMatch) return { page: 'game', gameId: gameMatch[1] }
  if (route === '/register')           return { page: 'register' }
  if (route === '/lobby')              return { page: 'lobby' }
  if (route === '/admin')              return { page: 'admin' }
  if (route === '/account-management') return { page: 'account-management' }
  return { page: 'login' }
}
```

3. In the default `App` render, destructure the new fields and handle the new pages. Replace:

```js
  const { page, gameId } = parseRoute(route)

  if (!user) {
    if (page === 'register') return <RegisterPage onLogin={handleLogin} />
    return <LoginPage onLogin={handleLogin} />
  }
```

with:

```js
  const { page, gameId, handNumber, seq } = parseRoute(route)

  // Recap pages are public — no auth required
  if (page === 'recap') {
    return <RecapPage gameId={gameId} handNumber={handNumber} onNavigate={navigate} />
  }
  if (page === 'recap-replay') {
    return <DetailedReplayPage gameId={gameId} handNumber={handNumber} startSeq={seq} onNavigate={navigate} />
  }

  if (!user) {
    if (page === 'register') return <RegisterPage onLogin={handleLogin} />
    return <LoginPage onLogin={handleLogin} />
  }
```

- [ ] **Step 6.3: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/App.jsx
git commit -m "feat: register recap routes and api client methods"
```

Note: the pages don't exist yet. The app will fail to import until Tasks 8–10 are done. That's fine — this task is a prep commit.

---

## Task 7: Frontend — make "Hand N" a link in `GameLog`

**Files:**
- Modify: `frontend/src/components/GameLog.jsx`
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 7.1: Update `GameLog` to parse and link**

Replace `frontend/src/components/GameLog.jsx` with:

```jsx
import { useEffect, useRef } from 'react'

const HAND_COMPLETE_RE = /^--- Hand (\d+) complete ---$/

export default function GameLog({ entries = [], gameId }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [entries.length])

  return (
    <div className="game-log" ref={ref}>
      <strong style={{ color: '#fff', display: 'block', marginBottom: 4 }}>Play History</strong>
      {entries.length === 0 && <p style={{ color: '#666' }}>No events yet.</p>}
      {entries.map((entry, i) => <LogLine key={i} text={entry} gameId={gameId} />)}
    </div>
  )
}

function LogLine({ text, gameId }) {
  const match = text.match(HAND_COMPLETE_RE)
  if (!match || !gameId) return <p>{text}</p>
  const handNumber = match[1]
  const href = `#/recap/${gameId}/${handNumber}`
  return (
    <p>
      --- <a href={href} style={{ color: '#58a6ff' }}>Hand {handNumber}</a> complete ---
    </p>
  )
}
```

- [ ] **Step 7.2: Pass `gameId` prop from `GamePage`**

In `frontend/src/pages/GamePage.jsx`, find the line (currently ~709):

```jsx
      <GameLog entries={resolvedLog} />
```

Replace with:

```jsx
      <GameLog entries={resolvedLog} gameId={gameId} />
```

The `gameId` variable already exists in `GamePage` props (it's a top-level prop on the component).

- [ ] **Step 7.3: Manually verify**

Start dev (if not running): `npm run dev`, open a game with a completed hand, confirm the "Hand N" portion of the completion log line is a blue link that navigates to `/recap/:gameId/:handNumber`. The destination page will 404 against a missing React page (expected until Task 9).

- [ ] **Step 7.4: Commit**

```bash
git add frontend/src/components/GameLog.jsx frontend/src/pages/GamePage.jsx
git commit -m "feat: link Hand N to recap page from play history"
```

---

## Task 8: Simple recap — stateless sub-components

**Files:**
- Create: `frontend/src/components/recap/recap.css`
- Create: `frontend/src/components/recap/MetaStrip.jsx`
- Create: `frontend/src/components/recap/BlindStrip.jsx`
- Create: `frontend/src/components/recap/ScoresList.jsx`

All three sub-components are pure display, driven entirely by props from the digest.

- [ ] **Step 8.1: Create shared recap CSS**

Create `frontend/src/components/recap/recap.css`:

```css
.recap-shell {
  background: #0d1117;
  color: #e6edf3;
  padding: 20px;
  border-radius: 12px;
  font-family: ui-sans-serif, system-ui, sans-serif;
  max-width: 900px;
  margin: 0 auto;
}

.recap-header h1 { font-size: 22px; margin: 0 0 4px 0; }
.recap-header .sub { color: #8b949e; font-size: 13px; margin-bottom: 16px; }

.recap-meta-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.recap-meta-cell {
  background: #161b22;
  border-radius: 8px;
  padding: 10px 12px;
}
.recap-meta-cell .k {
  color: #8b949e; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.06em; margin-bottom: 4px;
}
.recap-meta-cell .v { color: #e6edf3; font-size: 15px; font-weight: 700; }
.recap-meta-cell.picker .v { color: #d97706; }
.recap-meta-cell.partner .v { color: #15803d; }

.recap-blind {
  background: #161b22; border-radius: 8px; padding: 14px 16px;
  margin-bottom: 16px; display: flex; align-items: center; gap: 24px;
}
.recap-blind .group { display: flex; flex-direction: column; gap: 8px; }
.recap-blind .group.right { margin-left: auto; align-items: flex-end; }
.recap-blind .label {
  color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
}
.recap-blind .cards { display: flex; gap: 8px; }
.recap-card-static {
  width: 48px; height: 66px; border-radius: 5px; background: #fff;
  color: #111; font-size: 16px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid #30363d;
}
.recap-card-static.red { color: #cf222e; }

.recap-trick-table { width: 100%; border-collapse: separate; border-spacing: 0;
  background: #161b22; border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
.recap-trick-table th, .recap-trick-table td {
  padding: 6px 4px; text-align: center; font-size: 12px;
  border-bottom: 1px solid #21262d;
}
.recap-trick-table thead th {
  background: #1c2128; color: #8b949e; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.05em; font-weight: 600; padding: 8px 4px; line-height: 1.3;
}
.recap-trick-table thead th.picker-col { color: #d97706; }
.recap-trick-table thead th.partner-col { color: #15803d; }
.recap-trick-table tbody tr:last-child td { border-bottom: none; }
.recap-trick-table .trick-label {
  text-align: left; color: #8b949e; font-weight: 600; padding-left: 14px;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  width: 78px; white-space: nowrap;
}
.recap-trick-table .trick-pts {
  color: #e6edf3; font-size: 13px; font-weight: 600;
  font-variant-numeric: tabular-nums; width: 46px;
}
.recap-trick-table .cell { padding: 8px 4px; }

.recap-c-link {
  display: inline-block; padding: 3px; border-radius: 7px; cursor: pointer;
  transition: transform 0.08s, box-shadow 0.08s; text-decoration: none;
}
.recap-c-link:hover { transform: translateY(-2px); }
.recap-c-link:hover .recap-c-card { box-shadow: 0 2px 10px rgba(0,0,0,0.6); }
.recap-c-link.led { box-shadow: inset 0 0 0 3px #facc15; }
.recap-c-link.winner { box-shadow: 0 0 0 3px #22c55e, 0 0 12px rgba(34,197,94,0.45); }
.recap-c-link.led.winner {
  box-shadow: inset 0 0 0 3px #facc15,
              0 0 0 3px #22c55e, 0 0 12px rgba(34,197,94,0.45);
}
.recap-c-card {
  width: 48px; height: 66px; border-radius: 5px; background: #fff;
  color: #111; font-size: 16px; font-weight: 700; line-height: 66px;
  border: 1px solid #30363d; display: block;
}
.recap-c-card.red { color: #cf222e; }

.recap-legend {
  display: flex; gap: 18px; font-size: 11px; color: #8b949e;
  margin-top: 4px; margin-bottom: 16px; justify-content: center;
}

.recap-scores { background: #161b22; border-radius: 8px; padding: 14px 16px; }
.recap-scores h4 {
  margin: 0 0 8px; font-size: 11px; text-transform: uppercase;
  color: #8b949e; letter-spacing: 0.06em;
}
.recap-scores .row {
  display: grid; grid-template-columns: 2fr 80px 80px; gap: 10px;
  padding: 6px 0; border-bottom: 1px dashed #30363d; font-size: 13px;
}
.recap-scores .row:last-child { border: none; }
.recap-scores .row .name { font-weight: 600; }
.recap-scores .row .pts { color: #8b949e; text-align: right; font-variant-numeric: tabular-nums; }
.recap-scores .row .score { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.recap-scores .row .score.pos { color: #22c55e; }
.recap-scores .row .score.neg { color: #cf222e; }
```

- [ ] **Step 8.2: Create `MetaStrip`**

Create `frontend/src/components/recap/MetaStrip.jsx`:

```jsx
import './recap.css'

function findUsername(players, userId) {
  return players.find(p => p.userId === userId)?.username ?? userId
}

function callModeLabel(callMode) {
  if (callMode === 'ace') return 'Ace'
  if (callMode === 'ten') return 'Ten'
  if (callMode === 'king') return 'King'
  return '—'
}

function variantLabel(v) {
  if (v === 'normal') return 'Normal'
  if (v === 'leaster') return 'Leaster'
  if (v === 'schwanzer') return 'Schwanzer'
  return v
}

export default function MetaStrip({ digest }) {
  const { variant, callMode, picker, partner, calledCard, players } = digest
  return (
    <div className="recap-meta-row">
      <div className="recap-meta-cell">
        <div className="k">Variant</div><div className="v">{variantLabel(variant)}</div>
      </div>
      <div className="recap-meta-cell">
        <div className="k">Call mode</div><div className="v">{callModeLabel(callMode)}</div>
      </div>
      <div className="recap-meta-cell picker">
        <div className="k">Picker</div>
        <div className="v">{picker ? findUsername(players, picker.userId) : '—'}</div>
      </div>
      <div className="recap-meta-cell">
        <div className="k">Called card</div><div className="v">{calledCard ?? '—'}</div>
      </div>
      <div className="recap-meta-cell partner">
        <div className="k">Partner</div>
        <div className="v">{partner ? findUsername(players, partner.userId) : '—'}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 8.3: Create `BlindStrip`**

Create `frontend/src/components/recap/BlindStrip.jsx`:

```jsx
import './recap.css'

function isRed(cardId) {
  return cardId.endsWith('H') || cardId.endsWith('D')
}

function CardStatic({ id }) {
  return <div className={`recap-card-static${isRed(id) ? ' red' : ''}`}>{id.replace(/([AKQJ]|10)([CDHS])/, '$1$2')}</div>
}

export default function BlindStrip({ blind, pickerDiscards }) {
  if (!blind) return null
  return (
    <div className="recap-blind">
      <div className="group">
        <div className="label">Blind (picked up)</div>
        <div className="cards">{blind.map(id => <CardStatic key={id} id={id} />)}</div>
      </div>
      {pickerDiscards && pickerDiscards.length > 0 && (
        <div className="group right">
          <div className="label">Picker discarded</div>
          <div className="cards">{pickerDiscards.map(id => <CardStatic key={id} id={id} />)}</div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8.4: Create `ScoresList`**

Create `frontend/src/components/recap/ScoresList.jsx`:

```jsx
import './recap.css'

function findPlayer(players, userId) {
  return players.find(p => p.userId === userId)
}

function roleTag(player, digest) {
  if (digest.picker && digest.picker.userId === player.userId) return ' (picker)'
  if (digest.partner && digest.partner.userId === player.userId) return ' (partner)'
  return ''
}

export default function ScoresList({ digest }) {
  const { scores, players, variant } = digest

  // For Leaster, callout the lowest-points player as hand winner (if any tricks played)
  let winnerCallout = null
  if (variant === 'leaster' && scores.length > 0) {
    const eligible = scores.filter(s => s.cardPoints > 0)
    if (eligible.length > 0) {
      const lowest = eligible.reduce((min, s) => (s.cardPoints < min.cardPoints ? s : min))
      const p = findPlayer(players, lowest.userId)
      winnerCallout = (
        <div style={{ color: '#22c55e', marginTop: 8, fontSize: 13 }}>
          Hand winner: <b>{p?.username ?? lowest.userId}</b> ({lowest.cardPoints} pts)
        </div>
      )
    }
  }

  return (
    <div className="recap-scores">
      <h4>Final</h4>
      {scores.map(s => {
        const player = findPlayer(players, s.userId)
        return (
          <div className="row" key={s.userId}>
            <span className="name">{player?.username ?? s.userId}{roleTag(player, digest)}</span>
            <span className="pts">{variant === 'schwanzer' ? '—' : `${s.cardPoints} pts`}</span>
            <span className={`score ${s.scoreDelta >= 0 ? 'pos' : 'neg'}`}>
              {s.scoreDelta >= 0 ? '+' : ''}{s.scoreDelta}
            </span>
          </div>
        )
      })}
      {winnerCallout}
    </div>
  )
}
```

- [ ] **Step 8.5: Commit**

```bash
git add frontend/src/components/recap/
git commit -m "feat: recap meta, blind, and scores sub-components"
```

---

## Task 9: Simple recap — `TrickTable` + `RecapPage`

**Files:**
- Create: `frontend/src/components/recap/TrickTable.jsx`
- Create: `frontend/src/pages/RecapPage.jsx`

- [ ] **Step 9.1: Create `TrickTable`**

Create `frontend/src/components/recap/TrickTable.jsx`:

```jsx
import './recap.css'

function isRed(cardId) {
  return cardId.endsWith('H') || cardId.endsWith('D')
}

function formatCard(id) {
  return id.replace(/([AKQJ]|10)([CDHS])/, '$1$2')
}

export default function TrickTable({ digest, onCardClick }) {
  const { players, tricks, picker, partner } = digest
  if (!tricks || tricks.length === 0) return null

  // Column order = seat order (players prop is already seat-sorted by the API)
  const pickerId = picker?.userId ?? null
  const partnerId = partner?.userId ?? null

  return (
    <table className="recap-trick-table">
      <thead>
        <tr>
          <th style={{ textAlign: 'left', paddingLeft: 14 }}>Trick</th>
          {players.map(p => {
            const isPicker = p.userId === pickerId
            const isPartner = p.userId === partnerId
            const cls = isPicker ? 'picker-col' : isPartner ? 'partner-col' : ''
            const role = isPicker ? 'picker' : isPartner ? 'partner' : null
            return (
              <th key={p.userId} className={cls}>
                {p.username}
                {role && (<><br/><span style={{ fontWeight: 400, fontSize: 9 }}>{role}</span></>)}
              </th>
            )
          })}
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        {tricks.map(trick => (
          <tr key={trick.trickNumber}>
            <td className="trick-label">Trick {trick.trickNumber}</td>
            {players.map(p => {
              const play = trick.plays.find(pl => pl.userId === p.userId)
              if (!play) return <td key={p.userId} className="cell">—</td>
              const isLed = p.userId === trick.leaderUserId
              const isWinner = p.userId === trick.winnerUserId
              const cls = ['recap-c-link', isLed && 'led', isWinner && 'winner'].filter(Boolean).join(' ')
              return (
                <td key={p.userId} className="cell">
                  <a href="#"
                     className={cls}
                     onClick={(e) => { e.preventDefault(); onCardClick(play.seq) }}>
                    <span className={`recap-c-card${isRed(play.card) ? ' red' : ''}`}>{formatCard(play.card)}</span>
                  </a>
                </td>
              )
            })}
            <td className="trick-pts">{trick.cardPoints}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 9.2: Create `RecapPage`**

Create `frontend/src/pages/RecapPage.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import MetaStrip from '../components/recap/MetaStrip.jsx'
import BlindStrip from '../components/recap/BlindStrip.jsx'
import ScoresList from '../components/recap/ScoresList.jsx'
import TrickTable from '../components/recap/TrickTable.jsx'
import '../components/recap/recap.css'

export default function RecapPage({ gameId, handNumber, onNavigate }) {
  const [digest, setDigest] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.recap.getDigest(gameId, handNumber)
      .then(d => { if (!cancelled) setDigest(d) })
      .catch(err => { if (!cancelled) setError(err.status === 404 ? 'Recap not available.' : 'Failed to load recap.') })
    return () => { cancelled = true }
  }, [gameId, handNumber])

  if (error) return <div className="recap-shell"><p>{error}</p></div>
  if (!digest) return <div className="recap-shell"><p>Loading…</p></div>

  function onCardClick(seq) {
    const base = `/recap/${gameId}/${handNumber}/replay`
    onNavigate(seq != null ? `${base}?seq=${seq}` : base)
  }

  const dateStr = digest.completedAt ? new Date(digest.completedAt).toLocaleString() : ''

  return (
    <div className="recap-shell">
      <div className="recap-header">
        <h1>Hand {digest.handNumber} Recap</h1>
        <div className="sub">Game #{digest.gameId}{dateStr && ` · played ${dateStr}`}</div>
      </div>
      <MetaStrip digest={digest} />
      <BlindStrip blind={digest.blind} pickerDiscards={digest.pickerDiscards} />
      <TrickTable digest={digest} onCardClick={onCardClick} />
      <div className="recap-legend">
        <span>Green outline = trick winner · Yellow outline = led the trick · Click a card to open the step-by-step replay at that point</span>
      </div>
      <ScoresList digest={digest} />
    </div>
  )
}
```

- [ ] **Step 9.3: Manually verify**

Load `http://localhost:3000/#/recap/<gameId>/<handNumber>` in the browser (pick a completed hand). Confirm:
- Meta strip populated correctly
- Blind and discard cards shown (Normal only)
- Trick table shows 6 rows with winner (green) and led (yellow) highlights
- Clicking a card navigates to `/recap/<gameId>/<handNumber>/replay?seq=N` (destination is blank until Task 10–11)
- Final scores list renders with correct +/- delta colors

- [ ] **Step 9.4: Commit**

```bash
git add frontend/src/components/recap/TrickTable.jsx frontend/src/pages/RecapPage.jsx
git commit -m "feat: simple recap page with trick table"
```

---

## Task 10: Detailed replay — seats, trick zone, and controls

**Files:**
- Create: `frontend/src/components/recap/ReplaySeat.jsx`
- Create: `frontend/src/components/recap/ReplayTrickZone.jsx`
- Create: `frontend/src/components/recap/ReplayControls.jsx`
- Modify: `frontend/src/components/recap/recap.css` (add detailed-replay styles)

- [ ] **Step 10.1: Append detailed-replay CSS**

Append to `frontend/src/components/recap/recap.css`:

```css
.replay-shell { background: #0d1117; color: #e6edf3; padding: 16px; border-radius: 12px; font-family: ui-sans-serif, system-ui, sans-serif; }
.replay-meta { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #161b22; border-radius: 8px; margin-bottom: 12px; font-size: 13px; }
.replay-meta .meta-group { display: flex; gap: 24px; }
.replay-meta .label { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 2px; }
.replay-meta .val { color: #e6edf3; font-weight: 600; }
.replay-meta .picker-pill { background: #d97706; color: #fff; padding: 2px 8px; border-radius: 4px; font-weight: 700; }
.replay-meta .partner-pill { background: #15803d; color: #fff; padding: 2px 8px; border-radius: 4px; font-weight: 700; }

.replay-grid { display: grid; grid-template-columns: 1fr 340px; gap: 12px; }
.replay-table { background: #1c2128; border-radius: 8px; padding: 20px; min-height: 640px; display: grid; grid-template-rows: auto 1fr auto; gap: 20px; }
.replay-seats-top, .replay-seats-mid { display: flex; justify-content: space-between; gap: 16px; }
.replay-seats-mid { align-items: center; }
.replay-seats-bottom { display: flex; justify-content: center; }

.replay-seat { background: #21262d; border-radius: 8px; padding: 10px 12px; min-width: 280px; }
.replay-seat.is-picker { box-shadow: inset 0 0 0 2px #d97706; }
.replay-seat.is-partner { box-shadow: inset 0 0 0 2px #15803d; }
.replay-seat.is-active { box-shadow: inset 0 0 0 2px #58a6ff; }
.replay-seat .seat-name { font-size: 13px; font-weight: 700; margin-bottom: 8px; display: flex; justify-content: space-between; }
.replay-seat .seat-name .role { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
.replay-seat .hand { display: flex; gap: 4px; flex-wrap: wrap; }
.replay-mini-card { width: 38px; height: 54px; border-radius: 4px; background: #fff; color: #111; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 1px solid #30363d; }
.replay-mini-card.red { color: #cf222e; }
.replay-mini-card.played { opacity: 0.22; text-decoration: line-through; }
.replay-mini-card.now { box-shadow: 0 0 0 2px #58a6ff; transform: translateY(-3px); }

.replay-trick-zone { background: #0d1117; border-radius: 8px; padding: 16px; min-width: 340px; min-height: 180px; }
.replay-trick-zone .label { color: #8b949e; font-size: 11px; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.05em; }
.replay-trick-cards { display: flex; gap: 10px; justify-content: center; margin-top: 4px; }
.replay-trick-card { width: 62px; height: 86px; border-radius: 6px; background: #fff; color: #111; font-size: 18px; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid #30363d; position: relative; }
.replay-trick-card.red { color: #cf222e; }
.replay-trick-card .by { position: absolute; bottom: -18px; font-size: 10px; color: #8b949e; white-space: nowrap; }
.replay-trick-card.winner { box-shadow: 0 0 0 3px #22c55e; }

.replay-side { background: #161b22; border-radius: 8px; padding: 14px; font-size: 12px; }
.replay-side h4 { font-size: 11px; text-transform: uppercase; color: #8b949e; letter-spacing: 0.05em; margin: 0 0 8px; font-weight: 600; }
.replay-side .stub-block { background: #0d1117; border-radius: 6px; padding: 12px; color: #8b949e; font-style: italic; font-size: 12px; }

.replay-controls { display: flex; align-items: center; justify-content: space-between; background: #161b22; border-radius: 8px; padding: 10px 12px; margin-top: 12px; }
.replay-controls .step-info { color: #8b949e; font-size: 12px; }
.replay-controls .step-info b { color: #e6edf3; }
.replay-controls .ctrls { display: flex; gap: 6px; align-items: center; }
.replay-controls button { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 6px 12px; border-radius: 5px; font-size: 12px; cursor: pointer; }
.replay-controls button:disabled { opacity: 0.4; cursor: not-allowed; }
.replay-controls button.primary { background: #58a6ff; color: #0d1117; border-color: #58a6ff; font-weight: 700; }
.replay-controls select { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 5px 8px; border-radius: 5px; font-size: 12px; }
.replay-scrubber { width: 100%; margin-top: 8px; height: 6px; background: #30363d; border-radius: 3px; overflow: hidden; }
.replay-scrubber .fill { height: 100%; background: #58a6ff; border-radius: 3px; }
```

- [ ] **Step 10.2: Create `ReplaySeat`**

Create `frontend/src/components/recap/ReplaySeat.jsx`:

```jsx
import './recap.css'

function isRed(id) { return id.endsWith('H') || id.endsWith('D') }
function fmt(id) { return id.replace(/([AKQJ]|10)([CDHS])/, '$1$2') }

/**
 * Renders one seat showing the player's full dealt hand.
 * `dealt` = array of card ids the player held at deal.
 * `playedCardIds` = Set of card ids that have been played (dimmed).
 * `nowCardId` = the card this player just played (if active).
 * `roles` = {isPicker, isPartner, isActive}
 */
export default function ReplaySeat({ player, dealt, playedCardIds, nowCardId, roles = {} }) {
  const cls = [
    'replay-seat',
    roles.isPicker && 'is-picker',
    roles.isPartner && 'is-partner',
    roles.isActive && 'is-active',
  ].filter(Boolean).join(' ')

  const roleLabel = roles.isPicker ? 'picker' : roles.isPartner ? 'partner' : 'defender'

  return (
    <div className={cls}>
      <div className="seat-name">
        {player.username} <span className="role">{roleLabel}</span>
      </div>
      <div className="hand">
        {dealt.map(id => {
          const cardCls = [
            'replay-mini-card',
            isRed(id) && 'red',
            playedCardIds.has(id) && id !== nowCardId && 'played',
            id === nowCardId && 'now',
          ].filter(Boolean).join(' ')
          return <span key={id} className={cardCls}>{fmt(id)}</span>
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 10.3: Create `ReplayTrickZone`**

Create `frontend/src/components/recap/ReplayTrickZone.jsx`:

```jsx
import './recap.css'

function isRed(id) { return id.endsWith('H') || id.endsWith('D') }
function fmt(id) { return id.replace(/([AKQJ]|10)([CDHS])/, '$1$2') }

/**
 * Renders the center trick zone — plays shown in order, empty slots dashed.
 * `plays` = [{userId, cardId}] — plays so far in the current (in-progress) trick
 * `allPlayers` = seat-ordered [{userId, username}]
 * `winnerUserId` = set only when trick is complete
 * `trickNumber` = 1..6 (or null)
 */
export default function ReplayTrickZone({ plays, allPlayers, winnerUserId, trickNumber, totalTricks }) {
  const byUser = new Map(plays.map(p => [p.userId, p.cardId]))
  return (
    <div className="replay-trick-zone">
      <div className="label">
        {trickNumber ? `Trick ${trickNumber} of ${totalTricks}${winnerUserId ? '' : ' · in progress'}` : 'Before first trick'}
      </div>
      <div className="replay-trick-cards">
        {allPlayers.map(p => {
          const cardId = byUser.get(p.userId)
          if (!cardId) {
            return (
              <div key={p.userId} className="replay-trick-card"
                   style={{ opacity: 0.3, borderStyle: 'dashed' }}>
                ?<div className="by">{p.username}</div>
              </div>
            )
          }
          const isWinner = winnerUserId === p.userId
          const cls = ['replay-trick-card', isRed(cardId) && 'red', isWinner && 'winner']
            .filter(Boolean).join(' ')
          return (
            <div key={p.userId} className={cls}>
              {fmt(cardId)}<div className="by">{p.username}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 10.4: Create `ReplayControls`**

Create `frontend/src/components/recap/ReplayControls.jsx`:

```jsx
import { useEffect } from 'react'
import './recap.css'

const SPEEDS = [
  { label: '1×', ms: 1000 },
  { label: '2×', ms: 500 },
  { label: '4×', ms: 250 },
]

/**
 * Step controls for the detailed replay.
 * Props:
 *  - actionIndex: number (0..totalActions-1) — current position in action log
 *  - totalActions: total number of actions in the hand
 *  - onJump: (index: number) => void
 *  - playLabel: short human description of what's happening now
 *  - trickBoundaries: number[] — action indices at which tricks end (used for next-trick jump)
 */
export default function ReplayControls({ actionIndex, totalActions, onJump, playLabel, trickBoundaries = [] }) {
  const atStart = actionIndex <= 0
  const atEnd = actionIndex >= totalActions - 1
  const [auto, setAuto] = useAutoPlay(onJump, actionIndex, totalActions)

  function prevTrick() {
    const prev = trickBoundaries.filter(b => b < actionIndex).pop()
    onJump(prev != null ? prev : 0)
  }
  function nextTrick() {
    const next = trickBoundaries.find(b => b > actionIndex)
    onJump(next != null ? next : totalActions - 1)
  }

  return (
    <>
      <div className="replay-controls">
        <div className="step-info">Action <b>{actionIndex}</b> of {totalActions - 1} · {playLabel}</div>
        <div className="ctrls">
          <button disabled={atStart} onClick={() => onJump(0)}>⏮ Start</button>
          <button disabled={atStart} onClick={prevTrick}>◀ Prev trick</button>
          <button disabled={atStart} onClick={() => onJump(actionIndex - 1)}>◀ Step</button>
          <button disabled={atEnd} className="primary" onClick={() => onJump(actionIndex + 1)}>Step ▶</button>
          <button disabled={atEnd} onClick={nextTrick}>Next trick ▶</button>
          <button disabled={atEnd} onClick={() => onJump(totalActions - 1)}>End ⏭</button>
          <select value={auto.speedIdx} onChange={e => auto.setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
          </select>
          <button disabled={atEnd} onClick={auto.toggle}>{auto.running ? '⏸ Pause' : '▶▶ Auto'}</button>
        </div>
      </div>
      <div className="replay-scrubber">
        <div className="fill" style={{ width: `${totalActions > 1 ? (actionIndex / (totalActions - 1)) * 100 : 0}%` }} />
      </div>
    </>
  )
}

// Internal auto-play state hook. Ticks `onJump(i+1)` at the selected speed.
function useAutoPlay(onJump, actionIndex, totalActions) {
  const [running, setRunning] = useStateLocal(false)
  const [speedIdx, setSpeedIdx] = useStateLocal(0)

  useEffect(() => {
    if (!running) return
    if (actionIndex >= totalActions - 1) { setRunning(false); return }
    const t = setTimeout(() => onJump(actionIndex + 1), SPEEDS[speedIdx].ms)
    return () => clearTimeout(t)
  }, [running, actionIndex, totalActions, speedIdx, onJump])

  return {
    running, speedIdx,
    toggle: () => setRunning(r => !r),
    setSpeed: (i) => setSpeedIdx(i),
  }
}

// Tiny wrapper so the hook import list is self-contained
import { useState as useStateLocal } from 'react'
```

Note: the two `import` statements at the top and bottom are intentional — React imports cluster at the top conventionally, but we need `useState` for an internal hook. This keeps the file single-module. If your linter objects, hoist the second import above `useAutoPlay`.

- [ ] **Step 10.5: Commit**

```bash
git add frontend/src/components/recap/recap.css frontend/src/components/recap/ReplaySeat.jsx frontend/src/components/recap/ReplayTrickZone.jsx frontend/src/components/recap/ReplayControls.jsx
git commit -m "feat: detailed replay subcomponents (seat, trick zone, controls)"
```

---

## Task 11: Detailed replay page

**Files:**
- Create: `frontend/src/pages/DetailedReplayPage.jsx`

This page fetches the raw action log, uses `replayActions` from `shared/actionReplay.js` to compute state at any action index, and renders seats + trick zone + controls.

- [ ] **Step 11.1: Create `DetailedReplayPage`**

Create `frontend/src/pages/DetailedReplayPage.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { replayActions } from '../../../shared/actionReplay.js'
import ReplaySeat from '../components/recap/ReplaySeat.jsx'
import ReplayTrickZone from '../components/recap/ReplayTrickZone.jsx'
import ReplayControls from '../components/recap/ReplayControls.jsx'
import '../components/recap/recap.css'

export default function DetailedReplayPage({ gameId, handNumber, startSeq, onNavigate }) {
  const [digest, setDigest] = useState(null)
  const [rawActions, setRawActions] = useState(null)  // same shape as hand_actions rows — suitable for replayActions
  const [error, setError] = useState(null)
  const [actionIndex, setActionIndex] = useState(0)

  // Fetch both digest and actions in parallel
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.recap.getDigest(gameId, handNumber),
      api.recap.getActions(gameId, handNumber),
    ])
      .then(([d, { actions }]) => {
        if (cancelled) return
        setDigest(d)
        // Convert API action shape back to what replayActions expects
        const rows = actions.map(a => ({
          type: a.type,
          user_id: a.userId ? Number(a.userId) : null,
          payload_json: a.payload ? JSON.stringify(a.payload) : null,
        }))
        setRawActions(rows)
        // Jump to startSeq if provided (find matching action index)
        if (startSeq != null) {
          const idx = actions.findIndex(a => a.seq === startSeq)
          if (idx >= 0) setActionIndex(idx)
        }
      })
      .catch(err => {
        if (!cancelled) setError(err.status === 404 ? 'Replay not available.' : 'Failed to load replay.')
      })
    return () => { cancelled = true }
  }, [gameId, handNumber, startSeq])

  // Compute state at current action index by replaying from start through actionIndex (inclusive)
  const stateAtIndex = useMemo(() => {
    if (!rawActions || rawActions.length === 0) return null
    return replayActions(rawActions.slice(0, actionIndex + 1))
  }, [rawActions, actionIndex])

  if (error) return <div className="recap-shell"><p>{error}</p></div>
  if (!digest || !rawActions || !stateAtIndex) return <div className="recap-shell"><p>Loading…</p></div>

  const players = digest.players
  const pickerId = digest.picker?.userId ?? null
  const partnerId = digest.partner?.userId ?? null
  const activeUserId = rawActions[actionIndex]?.user_id != null ? String(rawActions[actionIndex].user_id) : null

  // Build the set of played card ids across all completed tricks + in-progress trick
  const playedCardIds = new Set()
  for (const t of stateAtIndex.tricks) for (const p of t.plays) playedCardIds.add(p.card.id)
  for (const p of stateAtIndex.currentTrick) playedCardIds.add(p.card.id)

  // The "now" card = the card played at actionIndex (if this was a play_card)
  let nowCardId = null
  const currentAction = rawActions[actionIndex]
  if (currentAction && currentAction.type === 'play_card' && currentAction.payload_json) {
    nowCardId = JSON.parse(currentAction.payload_json).cardId
  }

  // Compute trick boundaries: action indices where a trick just completed (currentTrick emptied)
  const trickBoundaries = []
  let prevTrickCount = 0
  for (let i = 0; i < rawActions.length; i++) {
    const stateI = i === 0 ? null : replayActions(rawActions.slice(0, i + 1))
    if (stateI && stateI.tricks.length > prevTrickCount) {
      trickBoundaries.push(i)
      prevTrickCount = stateI.tricks.length
    }
  }

  // Seats split: seats top (2), middle-left + middle-right around the trick zone, seat-bottom (1 — human)
  // Order: seat 2,3 on top; seat 1 left of trick zone; seat 4 right of trick zone; seat 0 bottom.
  // Fallback if human is not in seat 0: use seat 0 as bottom regardless.
  const seatBottom = players.find(p => p.seat === 0)
  const seatLeft = players.find(p => p.seat === 1)
  const seatTopLeft = players.find(p => p.seat === 2)
  const seatTopRight = players.find(p => p.seat === 3)
  const seatRight = players.find(p => p.seat === 4)

  const dealtOf = uid => digest.dealt[uid] ?? []
  const rolesOf = uid => ({
    isPicker: uid === pickerId,
    isPartner: uid === partnerId,
    isActive: uid === activeUserId,
  })

  // Current trick zone data
  const inProgressPlays = stateAtIndex.currentTrick.map(p => ({ userId: p.userId, cardId: p.card.id }))
  const completedPlays = stateAtIndex.tricks.length > 0 && stateAtIndex.currentTrick.length === 0
    ? stateAtIndex.tricks[stateAtIndex.tricks.length - 1].plays.map(p => ({ userId: p.userId, cardId: p.card.id }))
    : []
  const trickZonePlays = inProgressPlays.length > 0 ? inProgressPlays : completedPlays
  const trickZoneWinner = inProgressPlays.length === 0 && completedPlays.length > 0
    ? stateAtIndex.tricks[stateAtIndex.tricks.length - 1].winner
    : null
  const currentTrickNumber = stateAtIndex.tricks.length + (inProgressPlays.length > 0 ? 1 : 0)

  const playLabel = describePlay(currentAction, players)

  return (
    <div className="replay-shell">
      <div className="replay-meta">
        <div className="meta-group">
          <div><span className="label">Game / Hand</span><span className="val">#{digest.gameId} · Hand {digest.handNumber}</span></div>
          <div><span className="label">Variant</span><span className="val">{digest.variant}</span></div>
          {digest.picker && <div><span className="label">Picker</span><span className="val"><span className="picker-pill">{findName(players, digest.picker.userId)}</span></span></div>}
          {digest.calledCard && <div><span className="label">Called</span><span className="val">{digest.calledCard}</span></div>}
          {digest.partner && <div><span className="label">Partner</span><span className="val"><span className="partner-pill">{findName(players, digest.partner.userId)}</span></span></div>}
        </div>
        <div><a href={`#/recap/${gameId}/${handNumber}`} style={{ color: '#58a6ff', fontSize: 12 }}>← Back to simple recap</a></div>
      </div>

      <div className="replay-grid">
        <div className="replay-table">
          <div className="replay-seats-top">
            {seatTopLeft && <ReplaySeat player={seatTopLeft} dealt={dealtOf(seatTopLeft.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatTopLeft.userId)} />}
            {seatTopRight && <ReplaySeat player={seatTopRight} dealt={dealtOf(seatTopRight.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatTopRight.userId)} />}
          </div>
          <div className="replay-seats-mid">
            {seatLeft && <ReplaySeat player={seatLeft} dealt={dealtOf(seatLeft.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatLeft.userId)} />}
            <ReplayTrickZone
              plays={trickZonePlays}
              allPlayers={players}
              winnerUserId={trickZoneWinner}
              trickNumber={currentTrickNumber > 0 && currentTrickNumber <= 6 ? currentTrickNumber : null}
              totalTricks={6}
            />
            {seatRight && <ReplaySeat player={seatRight} dealt={dealtOf(seatRight.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatRight.userId)} />}
          </div>
          <div className="replay-seats-bottom">
            {seatBottom && <ReplaySeat player={seatBottom} dealt={dealtOf(seatBottom.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatBottom.userId)} />}
          </div>
        </div>
        <div className="replay-side">
          <h4>Bot inference</h4>
          <div className="stub-block">Inference capture not wired up yet — see issue #125. The panel will populate here once bot actions record their belief state.</div>
          <h4 style={{ marginTop: 12 }}>Engine state</h4>
          <div className="stub-block" style={{ color: '#e6edf3', fontStyle: 'normal' }}>
            Phase: <b>{stateAtIndex.phase}</b><br/>
            Action: <b>{currentAction?.type ?? '—'}</b><br/>
            {activeUserId && <>By: <b>{findName(players, activeUserId)}</b></>}
          </div>
        </div>
      </div>

      <ReplayControls
        actionIndex={actionIndex}
        totalActions={rawActions.length}
        onJump={setActionIndex}
        playLabel={playLabel}
        trickBoundaries={trickBoundaries}
      />
    </div>
  )
}

function findName(players, userId) {
  return players.find(p => p.userId === userId)?.username ?? userId
}

function describePlay(action, players) {
  if (!action) return 'at start'
  const uname = action.user_id ? findName(players, String(action.user_id)) : null
  switch (action.type) {
    case 'deal':      return 'dealt'
    case 'pick':      return `${uname} picked`
    case 'pass':      return `${uname} passed`
    case 'call_ace':  return `${uname} called ace`
    case 'call_ten':  return `${uname} called ten`
    case 'call_king': return `${uname} called king`
    case 'discard':   return `${uname} discarded`
    case 'play_card': return `${uname} played`
    default:          return action.type
  }
}
```

- [ ] **Step 11.2: Manually verify**

Open a simple recap, click any card, confirm:
- Detailed replay loads at the correct position (the card you clicked is the "now" card with blue outline)
- Played cards are dimmed / struck-through
- Prev/next step works, prev/next trick jumps by trick boundaries
- Auto-play ticks forward at selected speed, pauses when you click Pause, stops at end
- Picker/partner/active seat outlines render
- Engine state panel updates; inference shows the stub message
- "Back to simple recap" link works

- [ ] **Step 11.3: Commit**

```bash
git add frontend/src/pages/DetailedReplayPage.jsx
git commit -m "feat: detailed replay page with step-through and auto-play"
```

---

## Task 12: QA sweep and final polish

**Files:** No code changes unless QA finds bugs.

- [ ] **Step 12.1: QA checklist — walk through each scenario**

Play three hands in a local dev game covering all variants:

| Scenario | Check |
|----------|-------|
| Normal hand completes | "Hand N" link appears in play history |
| Click "Hand N" | Simple recap loads with correct picker/partner/blind/discards |
| Trick table | 6 rows, winner green, led yellow, click any card |
| Click a card | Detailed replay opens at correct seq |
| Leaster hand | Simple recap has no picker/partner highlights, no blind strip, hand-winner callout |
| Schwanzer hand | Simple recap shows dealt hands (no tricks), picker/partner null, no blind |
| Step forward in replay | Cards get played off hands, trick zone populates, winner marked |
| Auto-play 1x/2x/4x | Speed changes are reflected in ticks |
| Back button from replay | Returns to simple recap |
| Share link (public) | Open `/recap/.../...` in incognito — loads without auth |
| In-progress hand | `curl /api/recap/<gameId>/<currentHandN>` → 404 (anti-cheat) |
| Nonexistent hand | 404 from API; frontend shows "Recap not available." |

- [ ] **Step 12.2: Fix any issues found during QA**

If QA surfaces a bug, fix it with a narrow commit. If the issue is a missing feature that wasn't specced, add it to the follow-up issue #125 or open a new one — do NOT expand scope here.

- [ ] **Step 12.3: Final commit (if QA fixes were made)**

```bash
git add <files>
git commit -m "fix: <describe QA fix>"
```

---

## Execution notes for the implementing agent

- **Run tests frequently:** `npx vitest run shared/recapDigest.test.js` during Task 1–3, `npx vitest run` before each commit.
- **Dev server:** `npm run dev` runs Vite (:3000) and Wrangler (:8788); the Vite proxy sends `/api/*` to Wrangler automatically.
- **Database inspection:** Use `npx wrangler d1 execute sheepshead-db --local --command "..."` (see `CLAUDE.md` helper commands).
- **Do not commit `.superpowers/`** — it's already in `.gitignore` on this branch.
- **Do not touch** game engine logic, scoring, bot strategy, or auth — none of those are part of this feature.
- **Order matters:** tasks 1→12 build on each other. The branch does not compile between Task 6 (routes registered) and Task 9 (RecapPage exists), but Vite dev mode only errors if the page is navigated to — so you can keep working.

---

## Out of scope (explicitly)

- Bot inference capture in `hand_actions.payload_json` (issue #125)
- Mobile / responsive layout
- Game-level recap
- Backfill for any pre-existing hands
- Caching the digest (fresh compute per request is fine at current scale)
