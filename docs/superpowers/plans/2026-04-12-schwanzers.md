# Schwanzers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Schwanzers as a third no-pick variant — when all five players pass, each player's hand is scored using a trump-based point scheme (Q=3, J=2, diamond pip=1), the player with the most points loses 4, all others gain 1, and the next hand is dealt immediately.

**Architecture:** Immediate resolution within the `pass` action handler — no new game phase, no trick-playing, no UI overlay. `resolveSchwanzer` in the game engine computes scores from dealt hands, `finishHand` (unchanged) writes score events and deals the next hand. The frontend exposes the variant in the admin settings radio group; the game log communicates the result.

**Tech Stack:** Vanilla JS ES modules (game engine), Cloudflare Pages Functions (API), React 18 / Vite (frontend), Vitest (test runner)

---

## File Map

| Action | File |
|--------|------|
| Create | `shared/gameEngine.test.js` |
| Modify | `shared/gameEngine.js` |
| Modify | `functions/api/games/[id]/settings.js` |
| Modify | `functions/api/games/[id]/action.js` |
| Modify | `frontend/src/pages/GamePage.jsx` |
| Modify | `README.md` |
| Modify | `package.json` (root) |

---

## Task 1: Set up Vitest

The project has no test runner. Vitest integrates naturally with the ES module codebase.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install vitest at the root workspace**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Add test script to root `package.json`**

Open `package.json`. Add `"test": "vitest run"` to the `scripts` block:

```json
"scripts": {
  "dev": "concurrently -n frontend,wrangler -c cyan,yellow \"npm run dev:frontend\" \"npm run dev:wrangler\"",
  "dev:frontend": "npm run dev -w frontend",
  "dev:wrangler": "wrangler pages dev --port 8788",
  "build": "npm run build -w frontend",
  "deploy": "npm run build && wrangler pages deploy frontend/dist",
  "db:migrate:local": "wrangler d1 migrations apply sheepshead-db --local",
  "db:migrate": "wrangler d1 migrations apply sheepshead-db --remote",
  "test": "vitest run",
  "postinstall": "git config core.hooksPath .githooks"
},
```

- [ ] **Step 3: Verify vitest runs (no tests yet)**

```bash
npm test
```

Expected output: `No test files found` or similar — exit 0 is fine. If it errors, check that `vitest` appears in `node_modules/.bin/`.

- [ ] **Step 4: Commit**

```bash
git checkout -b feature/schwanzers
git add package.json package-lock.json
git commit -m "chore: add vitest test runner"
```

---

## Task 2: Test and implement `schwanzerCardPoints`

A pure helper with no dependencies on state.

**Files:**
- Create: `shared/gameEngine.test.js`
- Modify: `shared/gameEngine.js`

- [ ] **Step 1: Write the failing tests**

Create `shared/gameEngine.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { schwanzerCardPoints } from './gameEngine.js'

const c = (rank, suit) => ({ id: `${rank}${suit}`, rank, suit })

describe('schwanzerCardPoints', () => {
  it('returns 3 for any queen', () => {
    expect(schwanzerCardPoints(c('Q', 'C'))).toBe(3)
    expect(schwanzerCardPoints(c('Q', 'S'))).toBe(3)
    expect(schwanzerCardPoints(c('Q', 'H'))).toBe(3)
    expect(schwanzerCardPoints(c('Q', 'D'))).toBe(3)  // QD is a queen, not a diamond pip
  })

  it('returns 2 for any jack', () => {
    expect(schwanzerCardPoints(c('J', 'C'))).toBe(2)
    expect(schwanzerCardPoints(c('J', 'S'))).toBe(2)
    expect(schwanzerCardPoints(c('J', 'H'))).toBe(2)
    expect(schwanzerCardPoints(c('J', 'D'))).toBe(2)  // JD is a jack, not a diamond pip
  })

  it('returns 1 for diamond pip cards (non-Q, non-J diamonds)', () => {
    expect(schwanzerCardPoints(c('A',  'D'))).toBe(1)
    expect(schwanzerCardPoints(c('10', 'D'))).toBe(1)
    expect(schwanzerCardPoints(c('K',  'D'))).toBe(1)
    expect(schwanzerCardPoints(c('9',  'D'))).toBe(1)
    expect(schwanzerCardPoints(c('8',  'D'))).toBe(1)
    expect(schwanzerCardPoints(c('7',  'D'))).toBe(1)
  })

  it('returns 0 for non-trump fail cards', () => {
    expect(schwanzerCardPoints(c('A',  'C'))).toBe(0)
    expect(schwanzerCardPoints(c('10', 'H'))).toBe(0)
    expect(schwanzerCardPoints(c('K',  'S'))).toBe(0)
    expect(schwanzerCardPoints(c('9',  'C'))).toBe(0)
    expect(schwanzerCardPoints(c('8',  'H'))).toBe(0)
    expect(schwanzerCardPoints(c('7',  'S'))).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: `schwanzerCardPoints is not a function` or similar import error.

- [ ] **Step 3: Add `schwanzerCardPoints` to `shared/gameEngine.js`**

Open `shared/gameEngine.js`. Find the existing `cardPoints` function (around line 43):

```js
// Point value of a card
const POINT_VALUES = { A: 11, '10': 10, K: 4, Q: 3, J: 2 }
export function cardPoints(card) {
  return POINT_VALUES[card.rank] ?? 0
}
```

Add immediately after it:

```js
// Schwanzer point value — used only when scoring a Schwanzer no-pick hand
// Queens=3, Jacks=2, diamond pips (non-Q, non-J, suit=D)=1, all else=0
export function schwanzerCardPoints(card) {
  if (card.rank === 'Q') return 3
  if (card.rank === 'J') return 2
  if (card.suit === 'D') return 1
  return 0
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```

Expected: all `schwanzerCardPoints` tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/gameEngine.js shared/gameEngine.test.js
git commit -m "feat: add schwanzerCardPoints"
```

---

## Task 3: Test and implement `resolveSchwanzer`

**Files:**
- Modify: `shared/gameEngine.test.js`
- Modify: `shared/gameEngine.js`

- [ ] **Step 1: Add the failing tests to `shared/gameEngine.test.js`**

Append after the existing `schwanzerCardPoints` describe block:

```js
import { describe, it, expect } from 'vitest'
import { schwanzerCardPoints, resolveSchwanzer } from './gameEngine.js'
```

Update the import at the top of the file to include `resolveSchwanzer`:

```js
import { schwanzerCardPoints, resolveSchwanzer } from './gameEngine.js'
```

Then append this describe block at the end of the file:

```js
// ─── helpers for resolveSchwanzer tests ──────────────────────────────────────
// Build a minimal state object — only the fields resolveSchwanzer reads
function makeState(hands, pickOrder) {
  return { hands, pickOrder, log: [] }
}

describe('resolveSchwanzer', () => {
  it('identifies the player with the most schwanzer points as the loser', () => {
    const hands = {
      p1: [c('Q','C'), c('7','C'), c('8','C'), c('9','C'), c('A','C'), c('10','C')],  // 3 pts
      p2: [c('Q','S'), c('Q','H'), c('7','S'), c('8','S'), c('9','S'), c('A','S')],   // 6 pts → loses
      p3: [c('J','C'), c('7','H'), c('8','H'), c('9','H'), c('A','H'), c('10','H')],  // 2 pts
      p4: [c('7','C'), c('8','C'), c('9','S'), c('A','S'), c('10','S'), c('K','S')],  // 0 pts
      p5: [c('K','C'), c('A','H'), c('10','C'), c('K','H'), c('A','C'), c('K','S')],  // 0 pts
    }
    const { loser, scores } = resolveSchwanzer(makeState(hands, ['p1','p2','p3','p4','p5']))
    expect(loser).toBe('p2')
    expect(scores.p2).toBe(-4)
    expect(scores.p1).toBe(1)
    expect(scores.p3).toBe(1)
    expect(scores.p4).toBe(1)
    expect(scores.p5).toBe(1)
  })

  it('tie-break: tied player with the most powerful trump loses', () => {
    // p1 has QC (TRUMP_ORDER index 0) — most powerful trump → loses
    // p2 has QS (TRUMP_ORDER index 1) — less powerful
    // both have 3 schwanzer points
    const hands = {
      p1: [c('Q','C'), c('7','S'), c('8','S'), c('9','S'), c('A','S'), c('10','S')],  // 3 pts, trump=QC(idx 0)
      p2: [c('Q','S'), c('7','H'), c('8','H'), c('9','H'), c('A','H'), c('10','H')],  // 3 pts, trump=QS(idx 1)
      p3: [c('K','C'), c('A','C'), c('10','C'), c('K','H'), c('A','H'), c('K','S')],  // 0 pts
      p4: [c('7','C'), c('8','C'), c('9','C'), c('K','H'), c('A','S'), c('10','S')],  // 0 pts (duplicate ok in test)
      p5: [c('8','H'), c('9','H'), c('10','H'), c('7','S'), c('9','S'), c('K','S')],  // 0 pts
    }
    const { loser } = resolveSchwanzer(makeState(hands, ['p1','p2','p3','p4','p5']))
    expect(loser).toBe('p1')  // QC is more powerful than QS
  })

  it('fallback tie-break: when tied players hold no trump, first in pickOrder loses', () => {
    // All players have 0 schwanzer points — no Q, J, or D cards in any hand
    const noTrumpHand = [c('A','C'), c('10','C'), c('K','C'), c('A','H'), c('10','H'), c('K','H')]
    const hands = {
      p1: noTrumpHand,
      p2: noTrumpHand,
      p3: noTrumpHand,
      p4: noTrumpHand,
      p5: noTrumpHand,
    }
    // p2 is first in pickOrder → p2 loses
    const { loser } = resolveSchwanzer(makeState(hands, ['p2','p1','p3','p4','p5']))
    expect(loser).toBe('p2')
  })

  it('pushes a log entry naming the loser and listing point totals', () => {
    const hands = {
      p1: [c('Q','C'), c('7','C'), c('8','C'), c('9','C'), c('A','C'), c('10','C')],  // 3 pts
      p2: [c('7','S'), c('8','S'), c('9','S'), c('A','S'), c('10','S'), c('K','S')],  // 0 pts
      p3: [c('7','H'), c('8','H'), c('9','H'), c('A','H'), c('10','H'), c('K','H')],  // 0 pts
      p4: [c('K','C'), c('A','H'), c('10','C'), c('K','H'), c('9','C'), c('8','H')],  // 0 pts
      p5: [c('8','C'), c('9','S'), c('K','S'), c('A','C'), c('10','H'), c('K','C')],  // 0 pts
    }
    const state = makeState(hands, ['p1','p2','p3','p4','p5'])
    resolveSchwanzer(state)
    expect(state.log.length).toBe(1)
    expect(state.log[0]).toContain('p1')
    expect(state.log[0]).toContain('loses')
  })
})
```

- [ ] **Step 2: Run tests — verify the new tests fail**

```bash
npm test
```

Expected: `resolveSchwanzer is not a function` or similar.

- [ ] **Step 3: Add `resolveSchwanzer` to `shared/gameEngine.js`**

Open `shared/gameEngine.js`. Find the `resolveLeaster` function (around line 762). Add the following block immediately after `resolveLeaster`:

```js
// ─── Schwanzer ────────────────────────────────────────────────────────────────
// No tricks are played. Each player's dealt hand is scored using Schwanzer point
// values. The player with the most points is the loser (-4); all others gain +1.
// Tie-break: most powerful trump (lowest TRUMP_ORDER index) loses.
// Fallback: if all tied players hold no trump, first tied player in pickOrder loses.
export function resolveSchwanzer(state) {
  const pointsByPlayer = {}
  for (const [uid, hand] of Object.entries(state.hands)) {
    pointsByPlayer[uid] = hand.reduce((sum, card) => sum + schwanzerCardPoints(card), 0)
  }

  const maxPoints = Math.max(...Object.values(pointsByPlayer))
  // Preserve pickOrder sequence so fallback tie-break is deterministic
  const tied = state.pickOrder.filter(uid => pointsByPlayer[uid] === maxPoints)

  function bestTrumpIndex(uid) {
    const trumps = state.hands[uid].filter(c => isTrump(c))
    if (trumps.length === 0) return TRUMP_ORDER.length  // no trump → least powerful
    return Math.min(...trumps.map(c => trumpRank(c)))
  }

  // Among tied players: lowest trump index (most powerful) loses.
  // pickOrder preserves insertion order, so the first element wins the fallback.
  const loser = tied.reduce((worst, uid) =>
    bestTrumpIndex(uid) < bestTrumpIndex(worst) ? uid : worst
  )

  const scores = {}
  for (const uid of Object.keys(state.hands)) {
    scores[uid] = uid === loser ? -4 : 1
  }

  const breakdown = state.pickOrder
    .map(uid => `${uid}: ${pointsByPlayer[uid]}pts`)
    .join(', ')
  state.log.push(`Schwanzer! Points — ${breakdown}. ${loser} had the most and loses.`)

  return { loser, scores }
}
```

- [ ] **Step 4: Run all tests — verify they pass**

```bash
npm test
```

Expected: all tests pass, including `schwanzerCardPoints` tests from Task 2.

- [ ] **Step 5: Commit**

```bash
git add shared/gameEngine.js shared/gameEngine.test.js
git commit -m "feat: add resolveSchwanzer to game engine"
```

---

## Task 4: Allow `'schwanzers'` in the settings API

**Files:**
- Modify: `functions/api/games/[id]/settings.js`

- [ ] **Step 1: Open `functions/api/games/[id]/settings.js` and find the validation check on line 21**

Current code:
```js
if (no_pick_variant !== undefined && !['leasters', 'doublers'].includes(no_pick_variant)) {
  return err('no_pick_variant must be "leasters" or "doublers".')
}
```

- [ ] **Step 2: Add `'schwanzers'` to the allowed values**

```js
if (no_pick_variant !== undefined && !['leasters', 'doublers', 'schwanzers'].includes(no_pick_variant)) {
  return err('no_pick_variant must be "leasters", "doublers", or "schwanzers".')
}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/games/[id]/settings.js
git commit -m "feat: allow schwanzers as a valid no-pick variant in settings API"
```

---

## Task 5: Resolve Schwanzers in the action handler

**Files:**
- Modify: `functions/api/games/[id]/action.js`

- [ ] **Step 1: Open `functions/api/games/[id]/action.js` and update the import**

Current import (line 1–7):
```js
import {
  pick, blitz, pass, discard, callAce, callAceUnknown, callTen, callKing, goAlone, playCard,
  crack, recrack,
  setupLeaster, awardLeasterBlind, resolveLeaster,
  dealHand,
} from '../../../../shared/gameEngine.js'
```

Add `resolveSchwanzer`:
```js
import {
  pick, blitz, pass, discard, callAce, callAceUnknown, callTen, callKing, goAlone, playCard,
  crack, recrack,
  setupLeaster, awardLeasterBlind, resolveLeaster,
  resolveSchwanzer,
  dealHand,
} from '../../../../shared/gameEngine.js'
```

- [ ] **Step 2: Add the Schwanzers branch in the `pass` case**

Find the `pass` case (around line 62). The current structure is:

```js
case 'pass':
  state = pass(state, userId)
  if (state.phase === 'no_pick') {
    const freshGame = await env.DB.prepare('SELECT no_pick_variant FROM games WHERE id = ?').bind(gameId).first()
    if (freshGame.no_pick_variant === 'leasters') {
      state = setupLeaster(state)
    } else {
      const newMultiplier = state.doublerMultiplier * 2
      // ... doublers logic ...
    }
  }
  break
```

Add the `schwanzers` branch between `leasters` and the `else` (doublers):

```js
case 'pass':
  state = pass(state, userId)
  if (state.phase === 'no_pick') {
    const freshGame = await env.DB.prepare('SELECT no_pick_variant FROM games WHERE id = ?').bind(gameId).first()
    if (freshGame.no_pick_variant === 'leasters') {
      state = setupLeaster(state)
    } else if (freshGame.no_pick_variant === 'schwanzers') {
      const { scores } = resolveSchwanzer(state)
      state.scores = scores
      state.phase = 'scoring'
      state = await finishHand(env.DB, gameId, state)
    } else {
      const newMultiplier = state.doublerMultiplier * 2
      const { results: players } = await env.DB.prepare(
        'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
      ).bind(gameId).all()
      const playerIds = players.map(p => String(p.user_id))
      const nextDealer = (state.dealerSeat + 1) % 5
      state = dealHand(playerIds, nextDealer, state.handNumber + 1, newMultiplier)
      state.doublerMultiplier = newMultiplier
      state.log.push(`Doubler! Stakes are now ×${newMultiplier}.`)

      await env.DB.prepare(
        "UPDATE games SET doubler_multiplier = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(newMultiplier, gameId).run()
    }
  }
  break
```

- [ ] **Step 3: Commit**

```bash
git add "functions/api/games/[id]/action.js"
git commit -m "feat: resolve schwanzers immediately when all players pass"
```

---

## Task 6: Add Schwanzers to the frontend admin settings

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 1: Update `VARIANT_LABELS` on line 11**

Current:
```js
const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers' }
```

Replace with:
```js
const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers', schwanzers: 'Schwanzers' }
```

- [ ] **Step 2: Update the radio group array in `AdminSettingsPanel` (around line 93)**

Current:
```js
{['leasters', 'doublers'].map(v => (
```

Replace with:
```js
{['leasters', 'doublers', 'schwanzers'].map(v => (
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/GamePage.jsx
git commit -m "feat: add schwanzers option to admin settings panel"
```

---

## Task 7: Document Schwanzer rules in README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Open `README.md` and find the Leaster section (around line 116)**

Current ending of the Leaster section:
```markdown
### Leaster

When all five players pass, a Leaster is played. There is no picker or partner — everyone plays for themselves. The blind cards are awarded to the winner of the first trick. The player who takes at least one trick and ends with the **fewest points** wins. The winner gains 4 points; all others lose 1 point.

---
```

- [ ] **Step 2: Add the Schwanzer section after the Leaster section, before the `---`**

```markdown
### Schwanzer

When all five players pass and the no-pick variant is set to Schwanzers, hands are scored immediately — no tricks are played. Each player's dealt hand is scored using the following point scheme:

| Card | Schwanzer Points |
|------|-----------------|
| Queen (any suit) | 3 |
| Jack (any suit) | 2 |
| Diamond pip (Ace, 10, King, 9, 8, 7 of Diamonds) | 1 |
| All other cards | 0 |

Note: the Queen of Diamonds scores as a queen (3 points), and the Jack of Diamonds scores as a jack (2 points) — not as diamond pips.

The player with the **most** Schwanzer points in their hand is the Schwanzer: they lose 4 points, and all other players gain 1 point.

**Tie-break:** If two or more players are tied for the most points, the player holding the most powerful trump card (Queen of Clubs > Queen of Spades > … > 7 of Diamonds) loses. If all tied players hold no trump, the first tied player in seat order loses.

The blind cards are not scored — only each player's 6 dealt cards count.
```

- [ ] **Step 3: Run a quick sanity check**

```bash
grep -n "Schwanzer" README.md
```

Expected: several lines matching, including the section heading, table, and tie-break rule.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add Schwanzer rules to README"
```

---

## Manual Verification Checklist

After all tasks are complete, verify end-to-end in the dev environment:

```bash
npm run dev
```

- [ ] In the admin settings panel (waiting lobby or active game), "Schwanzers" appears as a third radio option
- [ ] Selecting Schwanzers saves correctly (check network tab → PATCH `/api/games/:id/settings` returns `no_pick_variant: "schwanzers"`)
- [ ] Start a test game, set variant to Schwanzers, have all 5 players pass
- [ ] The game immediately advances to the next hand (no trick-playing)
- [ ] The game log contains a "Schwanzer!" entry naming the loser and showing per-player point totals
- [ ] The scoreboard shows -4 for the loser and +1 for all others
- [ ] The `doubler_multiplier` resets to 1 for the next hand
