# Consolidate getLegalCards and beats into gameEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicated game rule logic spread across `botStrategy.js` and `botInference.js` by centralizing `getCalledCardId`, `beats`, and `getLegalCards` in `gameEngine.js`, then refactoring `validatePlay` to delegate to `getLegalCards`.

**Architecture:** Three functions move to `gameEngine.js` in order: `getCalledCardId` (resolves circular dep), `beats` (make exported and canonical), `getLegalCards` (move from botStrategy, now references local fns). Then `validatePlay` is replaced with a single membership check against `getLegalCards`. Finally, `botStrategy.js` drops its local `getLegalCards` and imports the one from gameEngine.

**Tech Stack:** Vanilla JS (ESM modules), Vitest

---

## File Map

| File | Change |
|------|--------|
| `shared/gameEngine.js` | Export `getCalledCardId`, export `beats` (add null guard), add `getLegalCards`, simplify `validatePlay` |
| `shared/botInference.js` | Remove `getCalledCardId` and `beats` definitions; import both from `gameEngine.js` |
| `shared/botStrategy.js` | Remove `getLegalCards` implementation; update imports |
| `shared/gameEngine.test.js` | Add `getLegalCards` tests; move `beats` import from botInference → gameEngine |

---

### Task 1: Create worktree

**Files:** none

- [ ] Create feature branch worktree

```bash
git worktree add .worktrees/feature/66-consolidate-game-logic -b feature/66-consolidate-game-logic
```

- [ ] Verify worktree is clean

```bash
cd .worktrees/feature/66-consolidate-game-logic && git status
```

---

### Task 2: Write failing tests for getLegalCards

**Files:**
- Modify: `shared/gameEngine.test.js`

Add a `describe('getLegalCards', ...)` block. The import will fail (function not yet exported from gameEngine) — that's expected. Add `getLegalCards` to the gameEngine import at the top of the file.

- [ ] Add `getLegalCards` to the gameEngine import in `shared/gameEngine.test.js`

Change the existing gameEngine import block from:
```js
import {
  isTrump, trumpRank, suitRank, effectiveSuit, cardPoints,
  schwanzerCardPoints, resolveSchwanzer,
  dealHand, pick, pass, blitz,
  bury, callAce, goAlone, callTen, callKing,
  callAceUnder, crack, recrack,
  playCard, computeScores, resolveLeaster,
  setupLeaster, awardLeasterBlind, getPlayerView,
} from './gameEngine.js'
```
to:
```js
import {
  isTrump, trumpRank, suitRank, effectiveSuit, cardPoints,
  schwanzerCardPoints, resolveSchwanzer,
  dealHand, pick, pass, blitz,
  bury, callAce, goAlone, callTen, callKing,
  callAceUnder, crack, recrack,
  playCard, computeScores, resolveLeaster,
  setupLeaster, awardLeasterBlind, getPlayerView,
  getLegalCards,
} from './gameEngine.js'
```

- [ ] Add the test block. Append near the end of `shared/gameEngine.test.js` (before the final closing of the file):

```js
// ─── getLegalCards ────────────────────────────────────────────────────────────

// Minimal state factory — only the fields getLegalCards reads.
function lcs(overrides = {}) {
  return {
    hands: { p1: [] },
    currentTrick: [],
    calledSuit: null,
    partner: null,
    partnerRevealed: false,
    underCard: null,
    picker: null,
    pickerForcedPlays: [],
    calledAce: null,
    calledTen: null,
    calledKing: null,
    ...overrides,
  }
}

describe('getLegalCards', () => {
  it('leading with no restrictions — all hand cards are legal', () => {
    const state = lcs({
      hands: { p1: [c('A','H'), c('K','C')] },
      currentTrick: null,
    })
    expect(getLegalCards(state, 'p1').map(c => c.id)).toEqual(['AH', 'KC'])
  })

  it('leading as partner — cannot lead called suit except with the called card', () => {
    const state = lcs({
      hands: { p1: [c('A','H'), c('9','H'), c('K','C')] },
      currentTrick: null,
      calledSuit: 'H',
      calledAce: { aceId: 'AH', suit: 'H' },
      partner: 'p1',
      partnerRevealed: false,
    })
    const ids = getLegalCards(state, 'p1').map(c => c.id)
    expect(ids).toContain('AH')   // called card itself is always leadable
    expect(ids).not.toContain('9H')  // other H cards are blocked
    expect(ids).toContain('KC')   // off-suit is fine
  })

  it('following — must follow led suit when possible', () => {
    const state = lcs({
      hands: { p1: [c('A','H'), c('K','H'), c('K','C')] },
      currentTrick: [{ userId: 'p2', card: c('7','H') }],
    })
    const ids = getLegalCards(state, 'p1').map(c => c.id)
    expect(ids).toContain('AH')
    expect(ids).toContain('KH')
    expect(ids).not.toContain('KC')
  })

  it('following — any card legal when cannot follow suit', () => {
    const state = lcs({
      hands: { p1: [c('A','H'), c('K','C')] },
      currentTrick: [{ userId: 'p2', card: c('7','S') }],  // S led; p1 has no S
    })
    const ids = getLegalCards(state, 'p1').map(c => c.id)
    expect(ids).toContain('AH')
    expect(ids).toContain('KC')
  })

  it('following — partner must play called card when called suit is led', () => {
    const state = lcs({
      hands: { p1: [c('A','H'), c('9','H')] },
      currentTrick: [{ userId: 'p2', card: c('K','H') }],  // H led
      calledSuit: 'H',
      calledAce: { aceId: 'AH', suit: 'H' },
      partner: 'p1',
      partnerRevealed: false,
    })
    expect(getLegalCards(state, 'p1').map(c => c.id)).toEqual(['AH'])
  })

  it('following — called card cannot be played unless called suit is led', () => {
    const state = lcs({
      hands: { p1: [c('A','H'), c('K','C')] },
      currentTrick: [{ userId: 'p2', card: c('9','C') }],  // C led, not H
      calledSuit: 'H',
      calledAce: { aceId: 'AH', suit: 'H' },
    })
    const ids = getLegalCards(state, 'p1').map(c => c.id)
    expect(ids).not.toContain('AH')  // called card blocked when H not led
    expect(ids).toContain('KC')      // must follow C
  })

  it('following — picker must keep last called-suit card until called suit is led', () => {
    // p1 (picker) has KH (last H, NOT the called card) and KC. C is led.
    // The holding rule blocks KH — playing it would leave no H in hand before H is led.
    // (AH is the called card but p1 doesn't hold it.)
    const state = lcs({
      hands: { p1: [c('K','H'), c('K','C')] },
      currentTrick: [{ userId: 'p2', card: c('9','C') }],  // C led
      calledSuit: 'H',
      calledAce: { aceId: 'AH', suit: 'H' },  // AH is called card, but not in p1's hand
      picker: 'p1',
      partnerRevealed: false,
    })
    // Must play KC (follows C). KH is blocked by the holding rule (last H in hand).
    expect(getLegalCards(state, 'p1').map(c => c.id)).toEqual(['KC'])
  })
})
```

- [ ] Run the tests — expect failure on the getLegalCards import

```bash
cd .worktrees/feature/66-consolidate-game-logic && npx vitest run shared/gameEngine.test.js 2>&1 | tail -20
```

Expected: tests fail with something like `getLegalCards is not a function` or import error.

---

### Task 3: Move getCalledCardId to gameEngine.js

**Files:**
- Modify: `shared/gameEngine.js` (add export)
- Modify: `shared/botInference.js` (remove definition, import from gameEngine)
- Modify: `shared/botStrategy.js` (move import source)

`getCalledCardId` is a pure game-state accessor with no dependencies — it only reads `calledAce/calledTen/calledKing` from state. Moving it to gameEngine breaks the would-be circular dependency before it forms.

- [ ] Add `export function getCalledCardId` to `shared/gameEngine.js`, placed after `currentPlayer` (around line 553):

```js
export function getCalledCardId(state) {
  return state.calledAce?.aceId ?? state.calledTen?.tenId ?? state.calledKing?.kingId
}
```

- [ ] In `shared/botInference.js`, remove the existing `getCalledCardId` definition (lines ~15-17):

Remove:
```js
export function getCalledCardId(view) {
  return view.calledAce?.aceId ?? view.calledTen?.tenId ?? view.calledKing?.kingId
}
```

Add `getCalledCardId` to the existing gameEngine import at the top of `botInference.js`:

```js
import { isTrump, cardPoints, schwanzerCardPoints, effectiveSuit, trumpRank, suitRank, getCalledCardId } from './gameEngine.js'
```

- [ ] In `shared/botStrategy.js`, move `getCalledCardId` from the botInference import to the gameEngine import:

Change the gameEngine import from:
```js
import {
  isTrump, cardPoints, effectiveSuit, trumpRank, suitRank, schwanzerCardPoints,
} from './gameEngine.js'
```
to:
```js
import {
  isTrump, cardPoints, effectiveSuit, trumpRank, suitRank, schwanzerCardPoints,
  getCalledCardId,
} from './gameEngine.js'
```

And remove `getCalledCardId` from the botInference import line.

- [ ] Run all tests to confirm nothing broke

```bash
cd .worktrees/feature/66-consolidate-game-logic && npx vitest run 2>&1 | tail -20
```

Expected: all existing tests pass (getLegalCards tests still fail — that's fine).

- [ ] Commit

```bash
git add shared/gameEngine.js shared/botInference.js shared/botStrategy.js
git commit -m "refactor: move getCalledCardId from botInference to gameEngine"
```

---

### Task 4: Export beats from gameEngine.js, remove duplicate from botInference.js

**Files:**
- Modify: `shared/gameEngine.js`
- Modify: `shared/botInference.js`
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

The `beats` function exists in both files. The botInference version has a defensive null/hidden/faceDown guard that the gameEngine version lacks. The canonical exported version must include that guard since `beats` is called by botStrategy with potentially hidden cards.

- [ ] In `shared/gameEngine.js`, update `beats` (around line 710): add `export` keyword and the defensive guard from botInference:

Change:
```js
function beats(challenger, current, ledSuit) {
  const cTrump = isTrump(challenger)
  const wTrump = isTrump(current)
```
to:
```js
export function beats(challenger, current, ledSuit) {
  if (!current || current.hidden || current.faceDown) return true
  const cTrump = isTrump(challenger)
  const wTrump = isTrump(current)
```

- [ ] In `shared/botInference.js`, remove the `beats` function definition (the entire `export function beats(...)` block, ~14 lines). Add `beats` to the gameEngine import:

```js
import { isTrump, cardPoints, schwanzerCardPoints, effectiveSuit, trumpRank, suitRank, getCalledCardId, beats } from './gameEngine.js'
```

- [ ] In `shared/botStrategy.js`, move `beats` from the botInference import to the gameEngine import:

gameEngine import becomes:
```js
import {
  isTrump, cardPoints, effectiveSuit, trumpRank, suitRank, schwanzerCardPoints,
  getCalledCardId, beats,
} from './gameEngine.js'
```

Remove `beats` from the botInference import line.

- [ ] In `shared/gameEngine.test.js`, move `beats` from the botInference import to the gameEngine import.

Change the gameEngine import to include `beats`:
```js
import {
  isTrump, trumpRank, suitRank, effectiveSuit, cardPoints,
  schwanzerCardPoints, resolveSchwanzer,
  dealHand, pick, pass, blitz,
  bury, callAce, goAlone, callTen, callKing,
  callAceUnder, crack, recrack,
  playCard, computeScores, resolveLeaster,
  setupLeaster, awardLeasterBlind, getPlayerView,
  getLegalCards, beats,
} from './gameEngine.js'
```

Remove `beats` from the botInference import block.

- [ ] Run all tests

```bash
cd .worktrees/feature/66-consolidate-game-logic && npx vitest run 2>&1 | tail -20
```

Expected: all existing tests pass (getLegalCards tests still fail).

- [ ] Commit

```bash
git add shared/gameEngine.js shared/botInference.js shared/botStrategy.js shared/gameEngine.test.js
git commit -m "refactor: export beats from gameEngine, remove duplicate from botInference"
```

---

### Task 5: Move getLegalCards to gameEngine.js

**Files:**
- Modify: `shared/gameEngine.js`

Copy the `getLegalCards` function from `botStrategy.js` into `gameEngine.js`, export it, and update the internal reference from `getCalledCardId(state)` (imported from botInference) to the now-local `getCalledCardId(state)`. Also replace the string literal `'UNDER_CARD'` with the exported constant `UNDER_CARD_ID`.

- [ ] In `shared/gameEngine.js`, insert the following after `getCalledCardId` (around line 556, before `getLedSuit`):

```js
// Returns the legal cards a player can play given the current game state.
// Mirrors getLegalCardIds in the frontend — these rules must stay in sync.
export function getLegalCards(state, userId) {
  const hand = state.hands[userId] ?? []
  const {
    currentTrick, calledSuit,
    partner, partnerRevealed, underCard, picker, pickerForcedPlays = [],
  } = state

  const handCards = hand.filter(c => !c.isUnderCard)
  const hasUnderCard = underCard && !underCard.played && userId === picker

  const calledCardId = getCalledCardId(state)

  // Leading
  if (!currentTrick || currentTrick.length === 0) {
    if (calledCardId && userId === partner && !partnerRevealed) {
      const cards = handCards.filter(c => effectiveSuit(c) !== calledSuit || c.id === calledCardId)
      if (hasUnderCard) cards.push({ id: UNDER_CARD_ID, isUnderCard: true })
      return cards
    }
    const cards = [...handCards]
    if (hasUnderCard) cards.push({ id: UNDER_CARD_ID, isUnderCard: true })
    return cards
  }

  const first = currentTrick[0]
  const ledSuit = first.declaredSuit ?? effectiveSuit(first.card)

  // Picker with under card must play it when called suit is led
  if (userId === picker && hasUnderCard && ledSuit === calledSuit) {
    return [{ id: UNDER_CARD_ID, isUnderCard: true }]
  }

  // Partner must play called card when called suit is led
  if (calledCardId && userId === partner && !partnerRevealed && ledSuit === calledSuit) {
    if (handCards.some(c => c.id === calledCardId)) {
      return handCards.filter(c => c.id === calledCardId)
    }
  }

  // Picker forced plays (Situation A / King case)
  if (userId === picker && pickerForcedPlays.length > 0 && ledSuit === calledSuit) {
    const heldForced = pickerForcedPlays.filter(cid => handCards.some(c => c.id === cid))
    if (heldForced.length > 0) return handCards.filter(c => heldForced.includes(c.id))
  }

  // Called card cannot be played unless the called suit is led
  let playableCards = (
    calledCardId &&
    ledSuit !== calledSuit &&
    handCards.some(c => c.id !== calledCardId)
  )
    ? handCards.filter(c => c.id !== calledCardId)
    : handCards

  // Picker must keep ≥1 called-suit card until the called suit is led
  if (
    userId === picker &&
    calledSuit &&
    !partnerRevealed &&
    ledSuit !== calledSuit &&
    playableCards.length > 1
  ) {
    const filtered = playableCards.filter(card => {
      if (pickerForcedPlays.includes(card.id)) return false
      if (effectiveSuit(card) === calledSuit) {
        const remaining = playableCards.filter(
          c => c.id !== card.id && effectiveSuit(c) === calledSuit
        ).length
        if (remaining === 0) return false
      }
      return true
    })
    if (filtered.length > 0) playableCards = filtered
  }

  const hasSuit = playableCards.some(c => effectiveSuit(c) === ledSuit)
  return hasSuit
    ? playableCards.filter(c => effectiveSuit(c) === ledSuit)
    : playableCards
}
```

- [ ] Run tests — getLegalCards tests should now pass

```bash
cd .worktrees/feature/66-consolidate-game-logic && npx vitest run shared/gameEngine.test.js 2>&1 | grep -A5 "getLegalCards"
```

Expected: all 7 getLegalCards tests pass.

- [ ] Run all tests to confirm nothing else broke

```bash
cd .worktrees/feature/66-consolidate-game-logic && npx vitest run 2>&1 | tail -20
```

- [ ] Commit

```bash
git add shared/gameEngine.js
git commit -m "feat(gameEngine): export getLegalCards, consolidating legal-play logic"
```

---

### Task 6: Refactor validatePlay to delegate to getLegalCards

**Files:**
- Modify: `shared/gameEngine.js`

Replace the ~112-line `validatePlay` body (lines ~563-675) with a single membership check. The 7 game rules now live exclusively in `getLegalCards`; `validatePlay` just enforces them.

- [ ] In `shared/gameEngine.js`, replace the entire body of `validatePlay` with:

```js
function validatePlay(state, userId, card) {
  const legal = getLegalCards(state, userId).filter(c => !c.isUnderCard)
  if (!legal.some(c => c.id === card.id)) {
    throw new Error(`Illegal play: ${card.id} is not a legal card for ${userId}.`)
  }
}
```

The old `validatePlay` is lines ~563-675. Replace the entire function (keep the function declaration line, replace just the body, keep the closing brace).

- [ ] Run the full test suite

```bash
cd .worktrees/feature/66-consolidate-game-logic && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass. The existing `playCard` tests exercise `validatePlay` indirectly — if any rule was incorrectly transcribed to `getLegalCards`, failures will surface here.

- [ ] If tests pass, commit

```bash
git add shared/gameEngine.js
git commit -m "refactor(gameEngine): validatePlay delegates to getLegalCards"
```

---

### Task 7: Remove getLegalCards from botStrategy.js, update imports

**Files:**
- Modify: `shared/botStrategy.js`

`getLegalCards` now lives in gameEngine. Remove the local implementation and import the canonical one.

- [ ] In `shared/botStrategy.js`, delete the entire `getLegalCards` function (lines ~11-95, from the `// ─── Legal card helper` comment through the closing `}`).

- [ ] Update the gameEngine import in `shared/botStrategy.js` to include `getLegalCards` and remove `getCalledCardId` (no longer needed directly — it's internal to gameEngine's getLegalCards):

```js
import {
  isTrump, cardPoints, effectiveSuit, trumpRank, suitRank, schwanzerCardPoints,
  beats, getLegalCards,
} from './gameEngine.js'
```

- [ ] Verify the botInference import no longer contains `beats` or `getCalledCardId` — both were removed in Tasks 3 and 4 respectively. It should look like:

```js
import { currentWinner, handScore, bestVoidBury, computeMustHold, teammateWinning, isGuaranteedWinner, cheapestGuaranteedWin, pickBySchmearPriority, resolveView, opponentsRemaining } from './botInference.js'
```

- [ ] Run all tests

```bash
cd .worktrees/feature/66-consolidate-game-logic && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] Commit

```bash
git add shared/botStrategy.js
git commit -m "refactor(botStrategy): remove getLegalCards, import from gameEngine"
```

---

### Task 8: Verify and check line counts

- [ ] Confirm line reduction

```bash
wc -l .worktrees/feature/66-consolidate-game-logic/shared/botStrategy.js .worktrees/feature/66-consolidate-game-logic/shared/botInference.js .worktrees/feature/66-consolidate-game-logic/shared/gameEngine.js
```

Expected: `botStrategy.js` ~80 lines shorter, `botInference.js` ~15 lines shorter, `gameEngine.js` gains ~80 lines (net wash since `validatePlay` shrinks ~100 lines).

- [ ] Run full test suite one final time

```bash
cd .worktrees/feature/66-consolidate-game-logic && npx vitest run 2>&1
```

Expected: all tests pass, no regressions.

---

## Out of Scope

- **Frontend `GamePage.jsx:66`** — a third copy of `getLegalCardIds` exists in the frontend. Left for a follow-up issue. Note: it uses `||` instead of `??` for called card ID derivation — a minor divergence worth fixing separately.
