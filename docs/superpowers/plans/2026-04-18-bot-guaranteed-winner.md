# Bot Card-Counting Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-rank trump card-counting to the bot's trump-follow and schmear decisions so it can recognize when a currently-winning card is locked in and act accordingly.

**Architecture:** One new inference function (`isGuaranteedWinner`) plus a wrapper (`cheapestGuaranteedWin`) in `shared/botInference.js`. `decidePlay` in `shared/botStrategy.js` is refactored to route several existing branches (non-trump-win, trump-trick, picker-void-fail, partner-trump-follow, schmear) through these helpers. No engine changes, no UI changes.

**Tech Stack:** JavaScript (ES modules), Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-04-18-bot-guaranteed-winner-design.md`

---

## File Structure

**Modify:**
- `shared/botInference.js` — add `isGuaranteedWinner` and `cheapestGuaranteedWin` exports.
- `shared/botStrategy.js` — refactor the `decidePlay` follow-win branch (lines 326-375), both schmear branches (lines 331-335 and 377-382), and the non-trump-win sub-branch (line 346).
- `shared/gameEngine.test.js` — append new inference unit tests and strategy state tests (following the existing pattern of co-locating tests by module; `makeTrumpEfficiencyView` helper already exists at line 2167).
- `docs/BOTS.md` — update the three affected sections.

**No new files.**

---

## Test Fixture Notes

All strategy tests use `makeTrumpEfficiencyView({ userId, picker, partner, hand, trick })` from `gameEngine.test.js:2167`. This helper returns a view with:
- All 5 player IDs (`p1`-`p5`) in `hands` (required for `opponentsRemaining` computation)
- `tricks: []` (empty completed-trick history — extend inline per-test via a custom helper or spread)
- `calledAce: { aceId: 'AH' }`, `partnerRevealed: true`, `calledSuit: 'H'`
- `buried` field **not present** — `isGuaranteedWinner` handles `view.buried ?? []`

For tests that need completed trick history (to verify per-rank counting), Task 1 introduces a helper `withTricks(view, tricks)` that spreads completed tricks into the view.

Trump rank reference (from `gameEngine.js`, lower index = stronger):
- 0:QC, 1:QS, 2:QH, 3:QD (queens)
- 4:JC, 5:JS, 6:JH, 7:JD (jacks)
- 8:AD, 9:10D, 10:KD (point diamonds)
- 11:9D, 12:8D, 13:7D (pip diamonds)

---

## Task 1: Add `isGuaranteedWinner` inference helper (TDD)

**Files:**
- Modify: `shared/botInference.js` (append new function + section header)
- Modify: `shared/gameEngine.test.js` (append new `describe` block)

- [ ] **Step 1.1: Write failing test for trivial "highest trump is guaranteed"**

Append to `shared/gameEngine.test.js` (after the last `describe` block for decidePlay, around line 2363):

```js
// Helper for tests that need completed-trick history.
// `tricks` is an array of arrays of { userId, card } plays.
function withTricks(view, tricks) {
  return { ...view, tricks: tricks.map(plays => ({ plays })) }
}

describe('isGuaranteedWinner', () => {
  it('returns true for Queen of Clubs (highest trump)', () => {
    // QC (rank 0) has no higher trump → trivially guaranteed.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('Q','C')],
      trick: [],
    })
    expect(isGuaranteedWinner(c('Q','C'), view, 'p1')).toBe(true)
  })
})
```

Also update the imports at the top of `gameEngine.test.js` to add `isGuaranteedWinner`:

```js
import {
  countTrumpPlayed, trumpRemainingElsewhere,
  buriablePoints, handScore,
  beats, currentWinner, teammateWinning,
  bestVoidBury,
  isGuaranteedWinner,  // NEW
} from './botInference.js'
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npm test -- shared/gameEngine.test.js -t "isGuaranteedWinner"`
Expected: FAIL with `isGuaranteedWinner is not a function` (or import error).

- [ ] **Step 1.3: Implement minimal `isGuaranteedWinner`**

Append to `shared/botInference.js` (after the `teammateWinning` function):

```js
// ─── Guaranteed-winner inference ──────────────────────────────────────────────

// Returns true iff every trump that outranks `card` is visible to userId:
//   - in userId's own hand
//   - played in completed tricks (non-hidden)
//   - played in the current trick (non-hidden)
//   - in the visible bury (non-hidden; picker-only)
// Unseen higher trump is always treated as a potential opponent holding.
// Non-trump cards are never "guaranteed" — callers combine with trumpRemainingElsewhere.
export function isGuaranteedWinner(card, view, userId) {
  if (!isTrump(card)) return false
  const myRank = trumpRank(card)
  if (myRank === 0) return true  // highest trump (Queen of Clubs)

  const seenRanks = new Set()
  const noteIfHigherTrump = (c) => {
    if (!c || c.hidden) return
    if (!isTrump(c)) return
    seenRanks.add(trumpRank(c))
  }

  for (const c of (view.hands[userId] ?? [])) noteIfHigherTrump(c)
  for (const trick of (view.tricks ?? [])) {
    for (const play of trick.plays) noteIfHigherTrump(play.card)
  }
  for (const play of (view.currentTrick ?? [])) noteIfHigherTrump(play.card)
  for (const c of (view.buried ?? [])) noteIfHigherTrump(c)

  // Every rank strictly lower than myRank must be seen somewhere.
  for (let r = 0; r < myRank; r++) {
    if (!seenRanks.has(r)) return false
  }
  return true
}
```

Also add the export to the existing imports (no action needed if using `export function`).

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npm test -- shared/gameEngine.test.js -t "isGuaranteedWinner"`
Expected: PASS (1 test).

- [ ] **Step 1.5: Add remaining test cases for `isGuaranteedWinner`**

Add inside the existing `describe('isGuaranteedWinner', ...)` block:

```js
it('returns true when all higher trump played in completed tricks', () => {
  // Own card: KD (rank 10). Higher trump (rank 0-9) = all Qs, all Js, AD, 10D.
  // Put them all in completed tricks.
  const higherTrump = [
    c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
    c('J','C'), c('J','S'), c('J','H'), c('J','D'),
    c('A','D'), c('10','D'),
  ]
  const baseView = makeTrumpEfficiencyView({
    userId: 'p1', picker: 'p1', partner: 'p2',
    hand: [c('K','D')],
    trick: [],
  })
  // Distribute higher trump across two completed tricks (5 cards each).
  const tricks = [
    higherTrump.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
    higherTrump.slice(5, 10).map((card, i) => ({ userId: `p${i+1}`, card })),
  ]
  const view = withTricks(baseView, tricks)
  expect(isGuaranteedWinner(c('K','D'), view, 'p1')).toBe(true)
})

it('returns true when higher trump is split between own hand and played tricks', () => {
  // Own card: JD (rank 7). Higher trump = all Qs (0-3), JC/JS/JH (4-6).
  // Put QC, QS, QH in own hand. Put QD, JC, JS, JH in tricks.
  const baseView = makeTrumpEfficiencyView({
    userId: 'p1', picker: 'p1', partner: 'p2',
    hand: [c('J','D'), c('Q','C'), c('Q','S'), c('Q','H')],
    trick: [],
  })
  const tricks = [
    [
      { userId: 'p1', card: c('Q','D') },
      { userId: 'p2', card: c('J','C') },
      { userId: 'p3', card: c('J','S') },
      { userId: 'p4', card: c('J','H') },
      { userId: 'p5', card: c('7','C') },
    ],
  ]
  const view = withTricks(baseView, tricks)
  expect(isGuaranteedWinner(c('J','D'), view, 'p1')).toBe(true)
})

it('returns false when one higher trump is unseen', () => {
  // Own card: KD (rank 10). Higher trump (rank 0-9) = all Qs, Js, AD, 10D (10 cards).
  // Account for 9 of them; leave AD unseen.
  const higherTrump = [
    c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
    c('J','C'), c('J','S'), c('J','H'), c('J','D'),
    c('10','D'),
    // AD missing
  ]
  const baseView = makeTrumpEfficiencyView({
    userId: 'p1', picker: 'p1', partner: 'p2',
    hand: [c('K','D')],
    trick: [],
  })
  const tricks = [
    higherTrump.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
    higherTrump.slice(5, 9).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
      { userId: 'p5', card: c('7','C') },  // filler non-trump
    ]),
  ]
  const view = withTricks(baseView, tricks)
  expect(isGuaranteedWinner(c('K','D'), view, 'p1')).toBe(false)
})

it('returns false for non-trump card', () => {
  const view = makeTrumpEfficiencyView({
    userId: 'p1', picker: 'p1', partner: 'p2',
    hand: [c('A','C')],
    trick: [],
  })
  expect(isGuaranteedWinner(c('A','C'), view, 'p1')).toBe(false)
})

it('counts visible buried trump (picker view)', () => {
  // Picker view: buried cards are not hidden. KD is picker's own card; bury holds QC+QS.
  // Higher trump than KD = QC,QS,QH,QD,JC,JS,JH,JD,AD,10D (10 cards).
  // QC+QS are in bury, the other 8 are in the current trick.
  const higherInTrick = [
    c('Q','H'), c('Q','D'),
    c('J','C'), c('J','S'), c('J','H'), c('J','D'),
    c('A','D'), c('10','D'),
  ]
  const baseView = makeTrumpEfficiencyView({
    userId: 'p1', picker: 'p1', partner: 'p2',
    hand: [c('K','D')],
    trick: [],
  })
  const view = {
    ...baseView,
    buried: [c('Q','C'), c('Q','S')],  // visible to picker
    tricks: [{
      plays: higherInTrick.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
    }, {
      plays: higherInTrick.slice(5, 8).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p4', card: c('7','C') },
        { userId: 'p5', card: c('8','C') },
      ]),
    }],
  }
  expect(isGuaranteedWinner(c('K','D'), view, 'p1')).toBe(true)
})

it('treats hidden buried trump as unseen (partner view)', () => {
  // Same setup as above, but buried cards are marked hidden.
  // The KD test card can still be guaranteed only if those buried slots are
  // filled in via other means. Mark buried as hidden; account for the 10 higher
  // trump in tricks only (8 there) → 2 missing → false.
  const higherInTrick = [
    c('Q','C'), c('Q','S'),
    c('Q','H'), c('Q','D'),
    c('J','C'), c('J','S'), c('J','H'), c('J','D'),
    // AD, 10D missing
  ]
  const baseView = makeTrumpEfficiencyView({
    userId: 'p2', picker: 'p1', partner: 'p2',
    hand: [c('K','D')],
    trick: [],
  })
  const view = {
    ...baseView,
    buried: [{ ...c('A','D'), hidden: true }, { ...c('10','D'), hidden: true }],
    tricks: [{
      plays: higherInTrick.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
    }, {
      plays: higherInTrick.slice(5, 8).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p4', card: c('7','C') },
        { userId: 'p5', card: c('8','C') },
      ]),
    }],
  }
  expect(isGuaranteedWinner(c('K','D'), view, 'p2')).toBe(false)
})
```

- [ ] **Step 1.6: Run all `isGuaranteedWinner` tests**

Run: `npm test -- shared/gameEngine.test.js -t "isGuaranteedWinner"`
Expected: PASS (6 tests).

- [ ] **Step 1.7: Run full test suite to verify no regression**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 1.8: Commit**

```bash
git add shared/botInference.js shared/gameEngine.test.js
git commit -m "feat(botInference): add isGuaranteedWinner helper"
```

---

## Task 2: Add `cheapestGuaranteedWin` wrapper (TDD)

**Files:**
- Modify: `shared/botInference.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 2.1: Write failing test**

Append to `shared/gameEngine.test.js` (after the `isGuaranteedWinner` describe):

```js
describe('cheapestGuaranteedWin', () => {
  it('returns null when no candidate is guaranteed', () => {
    // Candidates: KD, JD. Leave AD unseen → neither is guaranteed (AD beats both).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('J','D')],
      trick: [],
    })
    expect(cheapestGuaranteedWin([c('K','D'), c('J','D')], view, 'p1')).toBe(null)
  })

  it('returns lowest-point guaranteed card when multiple qualify', () => {
    // Candidates: KD (4pts), QS (3pts). Higher trump accounted for below.
    // Higher than KD (rank 10) = 10 cards. Higher than QS (rank 1) = just QC.
    // Put QC in own hand (user has KD, QS, QC).
    const higherTrumpForKD = [
      c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('A','D'), c('10','D'),
    ]
    // Hand has KD, QS. Higher trump distributed: QS/QC/etc in hand or tricks.
    // Simpler: put QC in hand, other 9 higher trump in tricks (covers both KD and QS).
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('Q','S'), c('Q','C')],
      trick: [],
    })
    const othersInTricks = higherTrumpForKD.filter(x => x.id !== 'QC' && x.id !== 'QS')
    const tricks = [
      othersInTricks.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      othersInTricks.slice(5, 8).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p4', card: c('7','C') },
        { userId: 'p5', card: c('8','C') },
      ]),
    ]
    const view = withTricks(baseView, tricks)
    // Both KD (4pts) and QS (3pts) guaranteed; return QS (lowest points).
    expect(cheapestGuaranteedWin([c('K','D'), c('Q','S')], view, 'p1').id).toBe('QS')
  })

  it('returns the single guaranteed candidate when only one qualifies', () => {
    // Candidates: KD (not guaranteed — AD unseen), QC (always guaranteed).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('Q','C')],
      trick: [],
    })
    expect(cheapestGuaranteedWin([c('K','D'), c('Q','C')], view, 'p1').id).toBe('QC')
  })

  it('returns null for empty candidates', () => {
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [],
      trick: [],
    })
    expect(cheapestGuaranteedWin([], view, 'p1')).toBe(null)
  })
})
```

Also update the import block:

```js
import {
  countTrumpPlayed, trumpRemainingElsewhere,
  buriablePoints, handScore,
  beats, currentWinner, teammateWinning,
  bestVoidBury,
  isGuaranteedWinner,
  cheapestGuaranteedWin,  // NEW
} from './botInference.js'
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npm test -- shared/gameEngine.test.js -t "cheapestGuaranteedWin"`
Expected: FAIL with `cheapestGuaranteedWin is not a function` or import error.

- [ ] **Step 2.3: Implement `cheapestGuaranteedWin`**

Append to `shared/botInference.js` (after `isGuaranteedWinner`):

```js
// Returns the card in `candidates` with the lowest point value for which
// isGuaranteedWinner returns true. Tiebreak by trump rank (weaker/higher-index first,
// matching cheapestWinningTrump conventions). Returns null if no card qualifies.
export function cheapestGuaranteedWin(candidates, view, userId) {
  const eligible = candidates.filter(card => isGuaranteedWinner(card, view, userId))
  if (eligible.length === 0) return null
  return eligible.reduce((best, c) => {
    const bestPts = cardPoints(best)
    const cPts = cardPoints(c)
    if (cPts !== bestPts) return cPts < bestPts ? c : best
    // Tie on points: prefer weaker trump (higher rank index = weaker).
    const bestTrump = isTrump(best)
    const cTrump = isTrump(c)
    if (cTrump && bestTrump) return trumpRank(c) > trumpRank(best) ? c : best
    return best
  })
}
```

- [ ] **Step 2.4: Run all `cheapestGuaranteedWin` tests**

Run: `npm test -- shared/gameEngine.test.js -t "cheapestGuaranteedWin"`
Expected: PASS (4 tests).

- [ ] **Step 2.5: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add shared/botInference.js shared/gameEngine.test.js
git commit -m "feat(botInference): add cheapestGuaranteedWin wrapper"
```

---

## Task 3: Wire `isGuaranteedWinner` into #92 partner-with-1-trump branch

**Files:**
- Modify: `shared/botStrategy.js` (lines ~368-371)
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 3.1: Write failing test — partner plays low when picker's card is guaranteed despite opponents remaining**

Append after the "fail trick, bot void (Scenario 2)" describe block:

```js
describe('decidePlay — partner saves trump when picker card is guaranteed (#92)', () => {
  it('partner with 1 trump plays low when picker winning AND card guaranteed AND opponents remain', () => {
    // Clubs led. Partner (p2) void in clubs.
    // Current trick: p3(AC), p4(KC), p1(picker plays QC — Queen of Clubs, highest trump).
    // Partner holds JD (only trump). p5 (opponent) still to play — so opponentsRemaining > 0.
    // QC is rank 0 (highest trump) → isGuaranteedWinner trivially true.
    // Expect partner plays low (not the trump).
    // Partner hand: JD (trump), AH (11pts), 8S (0pts). lowestCard prefers non-trump, low points.
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('J','D'), c('A','H'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p1', card: c('Q','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('8S')
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npm test -- shared/gameEngine.test.js -t "picker card is guaranteed"`
Expected: FAIL — current behavior returns `JD` (plays the trump because `opponentsRemaining > 0`).

- [ ] **Step 3.3: Update `decidePlay` to check `isGuaranteedWinner`**

In `shared/botStrategy.js`, update the import at line 9:

```js
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, trumpRemainingElsewhere, isGuaranteedWinner, cheapestGuaranteedWin } from './botInference.js'
```

Then replace the existing partner-1-trump block (lines 368-371):

```js
      // Partner with exactly 1 trump: play it unless the picker has the trick locked
      const pickerCurrentlyWinning = currentWinner(currentTrick)?.userId === picker
      if (pickerCurrentlyWinning && opponentsRemaining === 0) return lowestCard(realCards).id
      return highestTrump(winning).id
```

With:

```js
      // Partner with exactly 1 trump: play it unless the picker has the trick locked,
      // either because no opponents remain OR the picker's card can't be beaten by
      // any remaining trump (card-counting check).
      const winnerPlay = currentWinner(currentTrick)
      const pickerCurrentlyWinning = winnerPlay?.userId === picker
      const pickerCardLocked = pickerCurrentlyWinning && (
        opponentsRemaining === 0 ||
        isGuaranteedWinner(winnerPlay.card, view, userId)
      )
      if (pickerCardLocked) return lowestCard(realCards).id
      return highestTrump(winning).id
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `npm test -- shared/gameEngine.test.js -t "picker card is guaranteed"`
Expected: PASS.

- [ ] **Step 3.5: Run full test suite — guard against regression in existing #92 "no opponents remain" case**

Run: `npm test`
Expected: all tests pass. The existing "partner with 1 trump plays low when picker has the trick locked" test (at line 2343) should still pass because the `opponentsRemaining === 0` disjunct covers it.

- [ ] **Step 3.6: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(botStrategy): partner saves last trump when picker's card is guaranteed (#92)"
```

---

## Task 4: New partner-picker-still-to-play branch (1-trump case)

**Files:**
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 4.1: Write failing test — partner plays low when picker still to play and not guaranteed**

Append to the new describe block:

```js
describe('decidePlay — partner defers to picker still-to-play', () => {
  it('partner with 1 trump plays low when picker still to play AND not guaranteed', () => {
    // Clubs led. Partner (p2) void in clubs.
    // Current trick: p3(AC — opponent currently winning). p4, p1(picker), p5 still to play.
    // Partner hand: JD (only trump), KS (4pts), 7H (0pts).
    // JD is rank 7 — higher trump (QC,QS,QH,QD,JC,JS,JH = 7 cards) all unseen → not guaranteed.
    // Rule: picker still to play + 1 trump + not guaranteed → play low.
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('J','D'), c('K','S'), c('7','H')],
      trick: [
        { userId: 'p3', card: c('A','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('7H')  // lowest non-trump
  })

  it('partner with 1 trump plays the trump when picker still to play AND trump is guaranteed', () => {
    // Setup: partner's only trump is QC (rank 0, trivially guaranteed).
    // Clubs led. Partner (p2) void in clubs. p3(AC), picker+others still to play.
    // Rule: guaranteed → take the trick.
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('K','S'), c('7','H')],
      trick: [
        { userId: 'p3', card: c('A','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('QC')
  })
})
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `npm test -- shared/gameEngine.test.js -t "defers to picker still-to-play"`
Expected: FAIL — current behavior returns `JD` in both tests (always plays the 1 trump to contest).

- [ ] **Step 4.3: Restructure partner follow-win branch to split on picker-still-to-play**

In `shared/botStrategy.js`, find the block starting around line 361 (after the `if (userId === picker) return highestTrump(winning).id` line) and replace through the end of the outer `if (winning.length > 0)` block.

Current code (lines 362-372):

```js
      // Scenario 2: Fail trick, bot is void, playing trump to contest the lead
      if (userId === picker) return highestTrump(winning).id

      // Partner: play highest trump only when there is another trump to lead back
      const myTrumpCount = realCards.filter(c => isTrump(c)).length
      if (myTrumpCount > 1) return highestTrump(winning).id

      // Partner with exactly 1 trump: play it unless the picker has the trick locked
      const winnerPlay = currentWinner(currentTrick)
      const pickerCurrentlyWinning = winnerPlay?.userId === picker
      const pickerCardLocked = pickerCurrentlyWinning && (
        opponentsRemaining === 0 ||
        isGuaranteedWinner(winnerPlay.card, view, userId)
      )
      if (pickerCardLocked) return lowestCard(realCards).id
      return highestTrump(winning).id
```

Replace with:

```js
      // Scenario 2: Fail trick, bot is void, playing trump to contest the lead
      if (userId === picker) return highestTrump(winning).id

      // Partner (void in led fail suit). playedIds already defined above.
      const myTrumpCount = realCards.filter(c => isTrump(c)).length
      const pickerStillToPlay = picker !== userId && !playedIds.has(picker)

      if (pickerStillToPlay) {
        // Picker hasn't played; picker likely has trump (picker-strength prior).
        if (myTrumpCount >= 2) {
          // Lead-back insurance: contest aggressively.
          return highestTrump(winning).id
        }
        // Exactly 1 trump: only spend it if guaranteed to win the trick.
        const myOnlyTrump = realCards.find(c => isTrump(c))
        if (myOnlyTrump && isGuaranteedWinner(myOnlyTrump, view, userId)) {
          return myOnlyTrump.id
        }
        return lowestCard(realCards).id
      }

      // Picker has played. Check if picker has the trick locked.
      const winnerPlay = currentWinner(currentTrick)
      const pickerCurrentlyWinning = winnerPlay?.userId === picker
      const pickerCardLocked = pickerCurrentlyWinning && (
        opponentsRemaining === 0 ||
        isGuaranteedWinner(winnerPlay.card, view, userId)
      )
      if (pickerCardLocked) return lowestCard(realCards).id

      if (myTrumpCount > 1) return highestTrump(winning).id
      return highestTrump(winning).id  // 1 trump, picker already played — play it
```

Note: the last two branches return the same value; they're kept separate for clarity and Task 5 will refine the `myTrumpCount > 1` branch.

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `npm test -- shared/gameEngine.test.js -t "defers to picker still-to-play"`
Expected: PASS (2 tests).

- [ ] **Step 4.5: Run full test suite**

Run: `npm test`
Expected: all tests pass. The existing partner-1-trump tests (lines 2327-2362 in gameEngine.test.js) should still pass: the one at line 2327 has picker not in trick (pickerStillToPlay=true, but in that test picker=p1 and only p3,p4 have played — wait, check again). Verify carefully: if a test breaks because of the new `pickerStillToPlay` path, review whether the expected value is still correct under the new rule or if the test codified pre-change behavior.

- [ ] **Step 4.6: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(botStrategy): partner defers to picker still-to-play when trump not guaranteed"
```

---

## Task 5: Symmetric refinement — use `cheapestGuaranteedWin` at "highest trump, opponents remain" call sites

**Files:**
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 5.1: Write failing test — trump trick, opponents remain, cheapest guaranteed available**

Append to the describe block:

```js
describe('decidePlay — cheapest-guaranteed refinement', () => {
  it('picker plays cheapest guaranteed trump on trump trick with opponents remaining', () => {
    // Trump trick (JC led by p3, rank 4). Partner (p2) played 9D (rank 11).
    // Current winner: p3 (JC). Picker (p1) hand: QC (rank 0), KD (rank 4pts, rank 10).
    // Higher than KD: QC,QS,QH,QD,JC,JS,JH,JD,AD,10D (10 cards).
    //   QC in own hand. JC in current trick. 8 others unseen → KD not guaranteed.
    // Higher than QC: none → QC trivially guaranteed.
    // Both QC and KD beat JC.
    //   Old behavior: opponentsRemaining > 0 → highestTrump([QC,KD]) = QC (rank 0).
    //   New behavior: cheapestGuaranteedWin prefers lowest-point. QC=3pts, KD=4pts.
    //     Only QC is guaranteed → return QC. (Same result by different path.)
    // Better test: make KD guaranteed too so cheapest-guaranteed matters.
    // Put all higher-than-KD trump in visible places.
    const higherThanKD = [
      c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('A','D'), c('10','D'),
    ]
    // Picker hand includes QC and KD plus two dummies to make 4 cards.
    // Other 8 higher trump in tricks.
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('K','D'), c('7','H'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('J','C') },  // opponent led trump
        { userId: 'p2', card: c('9','D') },  // partner played
        // p4, p5 still to play — opponents remaining
      ],
    })
    // Put 8 higher trump (excluding QC, JC) in completed tricks.
    const inTricks = higherThanKD.filter(x => x.id !== 'QC' && x.id !== 'JC')
    const view = withTricks(baseView, [
      inTricks.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      inTricks.slice(5, 8).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p4', card: c('7','C') },
        { userId: 'p5', card: c('8','C') },
      ]),
    ])
    // Now QC is guaranteed (highest). KD is guaranteed (all higher accounted for).
    // winning = {QC, KD}. cheapestGuaranteedWin prefers lower points.
    // KD = 4pts, QC = 3pts → pick QC (lower).
    // Hmm — both are guaranteed with QC cheaper; this returns QC.
    // To prove the refinement, we need a case where highestTrump differs from cheapestGuaranteed.
    // highestTrump([QC, KD]) = QC (rank 0 < rank 10). cheapestGuaranteedWin = QC (3pts<4pts).
    // Same result. Need different test: make highestTrump pick high-rank but cheapestGuaranteed pick lower-points.
    // Try: picker hand = [QS (3pts, rank 1), 10D (10pts, rank 9)]. Both trump.
    // highestTrump picks QS (rank 1). cheapestGuaranteed picks QS too (3pts < 10pts). Same.
    // The key differentiator: points-weaker (higher rank) vs. same-points-weaker.
    // Try: hand = [QC (3pts, rank 0), JS (2pts, rank 5)].
    //   highestTrump picks QC (rank 0). cheapestGuaranteed picks JS (2pts < 3pts, if both guaranteed).
    // For JS to be guaranteed: all of QC,QS,QH,QD,JC must be accounted for.
    // Simpler to drop this test's subtlety and use a clearer differentiator below.
    expect(decidePlay(view, 'p1')).toBe('QC')
  })

  it('picker on trump trick picks weaker guaranteed trump when opponents remain', () => {
    // Trump trick. Picker (p1) hand: QC (3pts,rank0), JS (2pts,rank5).
    // For both to be guaranteed: all trump rank 0-4 accounted for.
    //   QC in hand. QS, QH, QD, JC need to be visible. Put them in tricks.
    // Current trick: p3 leads 7D (lowest trump, rank 13). p2 void plays off-suit.
    // Opponents (p4, p5) still to play. Picker to act.
    // winning = [QC, JS] (both beat 7D).
    // highestTrump = QC (rank 0). cheapestGuaranteedWin:
    //   points: JS=2, QC=3 → JS wins.
    const higherTrumpInTricks = [c('Q','S'), c('Q','H'), c('Q','D'), c('J','C')]
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('J','S'), c('7','H'), c('8','H')],
      trick: [
        { userId: 'p3', card: c('7','D') },
        { userId: 'p2', card: c('A','C') },  // partner void in trump
      ],
    })
    const view = withTricks(baseView, [
      higherTrumpInTricks.map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p5', card: c('7','C') },
      ]),
    ])
    expect(decidePlay(view, 'p1')).toBe('JS')
  })
})
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `npm test -- shared/gameEngine.test.js -t "cheapest-guaranteed refinement"`
Expected: FAIL on the "weaker guaranteed trump" test — current behavior returns `QC` (highestTrump).
The first test ("cheapest guaranteed trump on trump trick") may already pass or not depending on the exact path.

- [ ] **Step 5.3: Update three "highest trump, opponents remain" call sites**

In `shared/botStrategy.js`, find and replace three locations:

**Site 1 — trump trick branch (around line 358):**

Old:
```js
      if (ledSuit === 'T') {
        // Scenario 1: Trump trick
        if (opponentsRemaining === 0) return cheapestWinningTrump(winning).id
        return highestTrump(winning).id
      }
```

New:
```js
      if (ledSuit === 'T') {
        // Scenario 1: Trump trick
        if (opponentsRemaining === 0) return cheapestWinningTrump(winning).id
        const guaranteed = cheapestGuaranteedWin(winning, view, userId)
        if (guaranteed) return guaranteed.id
        return highestTrump(winning).id
      }
```

**Site 2 — picker void fail trick (was line 362):**

Old:
```js
      // Scenario 2: Fail trick, bot is void, playing trump to contest the lead
      if (userId === picker) return highestTrump(winning).id
```

New:
```js
      // Scenario 2: Fail trick, bot is void, playing trump to contest the lead
      if (userId === picker) {
        const guaranteed = cheapestGuaranteedWin(winning, view, userId)
        if (guaranteed) return guaranteed.id
        return highestTrump(winning).id
      }
```

**Site 3 — partner with 2+ trump, picker has played (the `myTrumpCount > 1` branch added in Task 4):**

Old (from Task 4):
```js
      if (myTrumpCount > 1) return highestTrump(winning).id
      return highestTrump(winning).id  // 1 trump, picker already played — play it
```

New:
```js
      if (myTrumpCount > 1) {
        const guaranteed = cheapestGuaranteedWin(winning, view, userId)
        if (guaranteed) return guaranteed.id
        return highestTrump(winning).id
      }
      return highestTrump(winning).id  // 1 trump, picker already played — play it
```

Note: do NOT change the `pickerStillToPlay && myTrumpCount >= 2` branch — per spec, that one contests aggressively with `highestTrump(winning)` regardless of guarantee (lead-back insurance).

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `npm test -- shared/gameEngine.test.js -t "cheapest-guaranteed refinement"`
Expected: PASS.

- [ ] **Step 5.5: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(botStrategy): prefer cheapest-guaranteed trump over highest when safe"
```

---

## Task 6: Picker-team schmear — role-asymmetric guard

**Files:**
- Modify: `shared/botStrategy.js` (line ~331)
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 6.1: Write failing tests**

Append to gameEngine.test.js:

```js
describe('decidePlay — picker-team schmear guard (#121)', () => {
  it('partner still schmears when picker is winning but opponent could overtake (trust picker)', () => {
    // Hearts led (fail). Partner (p2) following. Picker (p1) currently winning with QD (rank 3).
    // Higher than QD = QC, QS, QH (3 cards). Suppose QC is unseen → not guaranteed.
    // Opponent p5 still to play (could trump QD with QC).
    // Partner hand: AH (11pts fail ace), 7C (0pts), 8S (0pts).
    // Partner role → schmear (trust picker). schmearHighestNonTrump picks AH (11pts).
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('A','H'), c('7','C'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p4', card: c('K','H') },
        { userId: 'p1', card: c('Q','D') },  // picker trumped in
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('AH')
  })

  it('partner still schmears when picker is winning and card IS guaranteed', () => {
    // Same setup but picker plays QC (rank 0, trivially guaranteed).
    // Partner schmears (was current behavior).
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('A','H'), c('7','C'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p4', card: c('K','H') },
        { userId: 'p1', card: c('Q','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('AH')
  })

  it('picker takes over when partner winning, opponent could overtake, and a guaranteed takeover exists', () => {
    // Hearts led. Partner (p2) currently winning with QD (rank 3, not guaranteed — QC,QS,QH unseen).
    // Picker (p1) is following after partner. Opponent p5 still to play.
    // Picker hand includes QC (rank 0, trivially guaranteed) and a fail ace AS.
    // Picker role → attempt takeover. cheapestGuaranteedWin([QC]) = QC.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('A','S'), c('7','C')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p2', card: c('Q','D') },  // partner trumped in
        { userId: 'p4', card: c('K','H') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('QC')
  })

  it('picker plays highest trump as risk reduction when no guaranteed takeover exists', () => {
    // Same scenario — partner winning, opponent could overtake — but picker's trump is KD (rank 10).
    // Higher than KD = 10 cards, many unseen → KD not guaranteed. No other trump.
    // Picker role → no takeover available; play highest-winning trump (= KD) for risk reduction.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('A','S'), c('7','C')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p2', card: c('Q','D') },
        { userId: 'p4', card: c('K','H') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('KD')
  })

  it('picker schmears as fallback when partner winning, not guaranteed, and no winning trump in hand', () => {
    // Same partner-winning scenario but picker has no trump that beats QD.
    // Picker hand: 7D (rank 13, fail-rank in trump order; does NOT beat QD rank 3). No, 7D is trump rank 13.
    // 7D rank 13 beats rank < 13 → 7D does NOT beat QD (rank 3 < 13). So 7D not in winning set.
    // Actually: beats(challenger, current, ledSuit) — trump over non-trump always true.
    // Hearts led. 7D is trump, QD is trump rank 3. 7D rank 13, beats returns trumpRank(7D)<trumpRank(QD) → 13<3 false.
    // So 7D doesn't beat QD. Good.
    // winning for picker = [] → falls out of the "try to win" block, goes to "can't win → lowest".
    // Actually the teammateWinning schmear check fires BEFORE the "winning" computation.
    // So schmear should pick highest-value non-trump (AS=11).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('7','D'), c('A','S'), c('7','C')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p2', card: c('Q','D') },
        { userId: 'p4', card: c('K','H') },
      ],
    })
    // teammateSafe=false (QD not guaranteed), picker role → try takeover.
    // winning = [7D]? 7D doesn't beat QD. So winning = []. Takeover = null.
    // Highest trump in winning set: none. Fallback to schmear → AS.
    expect(decidePlay(view, 'p1')).toBe('AS')
  })
})
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `npm test -- shared/gameEngine.test.js -t "picker-team schmear guard"`
Expected: FAIL on the "picker takes over" test (current code schmears unconditionally).
The partner-role tests may already pass — verify.

- [ ] **Step 6.3: Refactor picker-team schmear branch**

In `shared/botStrategy.js`, locate the existing schmear block (lines 331-335):

```js
    // Schmear: dump highest-point non-trump on teammate's winning trick
    if (teammateWinning(view, userId)) {
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (nonTrump.length > 0) return highestValueCard(nonTrump).id
      return lowestCard(realCards).id  // only trump available — don't burn trump to schmear
    }
```

Replace with:

```js
    // Schmear: dump highest-point non-trump on teammate's winning trick,
    // unless an opponent still to play could trump over the teammate.
    if (teammateWinning(view, userId)) {
      const schmear = () => {
        const nonTrump = realCards.filter(c => !isTrump(c))
        if (nonTrump.length > 0) return highestValueCard(nonTrump).id
        return lowestCard(realCards).id  // only trump available — don't burn trump to schmear
      }

      const winnerPlay = currentWinner(currentTrick)
      const playedIdsLocal = new Set(currentTrick.map(p => p.userId))
      const allIdsLocal = Object.keys(view.hands)
      const opponentsRemainingLocal = allIdsLocal.filter(id =>
        !playedIdsLocal.has(id) && id !== userId && id !== picker && id !== partner
      ).length

      const teammateSafe = opponentsRemainingLocal === 0 ||
        isGuaranteedWinner(winnerPlay.card, view, userId)

      if (teammateSafe) return schmear()

      // Not safe — opponent could overtake.
      if (userId === partner) {
        // Partner role: trust picker's implied trump strength; schmear anyway.
        return schmear()
      }

      // Picker role: try to secure the trick.
      // Winning set for takeover — any card in hand that beats every play so far.
      const ledSuitLocal = currentTrick[0].declaredSuit ?? effectiveSuit(currentTrick[0].card)
      const winningLocal = realCards.filter(card => {
        for (const play of currentTrick) {
          if (!beats(card, play.card, ledSuitLocal)) return false
        }
        return true
      })
      const takeover = cheapestGuaranteedWin(winningLocal, view, userId)
      if (takeover) return takeover.id
      const highTrump = highestTrump(winningLocal)
      if (highTrump) return highTrump.id  // risk reduction
      return schmear()  // fallback
    }
```

Note: `opponentsRemainingLocal` is recomputed here because at this point in `decidePlay` we're still before the `winning.length > 0` block where it's computed further down. Alternative: lift the computation earlier; keeping local for minimal diff.

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npm test -- shared/gameEngine.test.js -t "picker-team schmear guard"`
Expected: PASS (5 tests).

- [ ] **Step 6.5: Run full test suite**

Run: `npm test`
Expected: all tests pass. The existing schmear tests at `describe('decidePlay schmearing', ...)` (line 1814) should still pass — they all feature `opponentsRemainingLocal === 0` scenarios or teammate-winning with no threat.

- [ ] **Step 6.6: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(botStrategy): picker-team schmear guards against opponent trump-in (#121)"
```

---

## Task 7: Opponent-team schmear guard

**Files:**
- Modify: `shared/botStrategy.js` (line ~377)
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 7.1: Write failing test**

Append:

```js
describe('decidePlay — opponent-team schmear guard (#121)', () => {
  it('opponent takes over when teammate opponent winning, picker still to play, takeover guaranteed', () => {
    // Hearts led (fail). Opponent p3 currently winning (e.g., with AH - fail ace).
    // Another opponent (userId=p4, same team as p3) is following.
    // Picker (p1) still to play and could trump over AH. Partner also not yet played.
    // p4 hand: QC (rank 0 trivially guaranteed), 7C, 8S.
    //   teammateSafe = false (picker could trump). takeover = QC (guaranteed).
    //   Expect p4 plays QC.
    const view = makeTrumpEfficiencyView({
      userId: 'p4', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('7','C'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('A','H') },
      ],
    })
    expect(decidePlay(view, 'p4')).toBe('QC')
  })

  it('opponent schmears when no takeover available', () => {
    // Same scenario but p4 has no trump — falls back to schmear.
    const view = makeTrumpEfficiencyView({
      userId: 'p4', picker: 'p1', partner: 'p2',
      hand: [c('A','S'), c('7','C'), c('8','H')],
      trick: [
        { userId: 'p3', card: c('A','H') },
      ],
    })
    // partnerRevealed=true in fixture; p4 is opponent (not picker or partner).
    // teammateWinning(p4): teammate of opponent p4 = other non-picker-team player = p3 or p5.
    //   currentWinner = p3 (AH). p3 is on same team as p4 → teammateWinning true.
    // Schmear highest-value non-trump: AS (11pts).
    expect(decidePlay(view, 'p4')).toBe('AS')
  })
})
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `npm test -- shared/gameEngine.test.js -t "opponent-team schmear guard"`
Expected: FAIL on the takeover test (current opponent-team schmear is unconditional).

- [ ] **Step 7.3: Refactor opponent-team schmear branch**

In `shared/botStrategy.js`, locate the opponent-team schmear block (lines 377-382):

```js
    // Opponent: schmear on confirmed teammate wins; otherwise play low
    if (teammateWinning(view, userId)) {
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (nonTrump.length > 0) return highestValueCard(nonTrump).id
      return lowestCard(realCards).id
    }
```

Replace with:

```js
    // Opponent: schmear on confirmed teammate wins — unless picker-team still to play
    // could trump over the teammate, in which case attempt a guaranteed takeover.
    if (teammateWinning(view, userId)) {
      const schmearOpp = () => {
        const nonTrump = realCards.filter(c => !isTrump(c))
        if (nonTrump.length > 0) return highestValueCard(nonTrump).id
        return lowestCard(realCards).id
      }

      const winnerPlay = currentWinner(currentTrick)
      const playedIdsOpp = new Set(currentTrick.map(p => p.userId))
      const allIdsOpp = Object.keys(view.hands)
      // From opponent POV, "opponents" (threats) = picker + partner still to play.
      const threatsRemaining = allIdsOpp.filter(id =>
        !playedIdsOpp.has(id) && id !== userId && (id === picker || id === partner)
      ).length

      const teammateSafe = threatsRemaining === 0 ||
        isGuaranteedWinner(winnerPlay.card, view, userId)

      if (teammateSafe) return schmearOpp()

      const ledSuitOpp = currentTrick[0].declaredSuit ?? effectiveSuit(currentTrick[0].card)
      const winningOpp = realCards.filter(card => {
        for (const play of currentTrick) {
          if (!beats(card, play.card, ledSuitOpp)) return false
        }
        return true
      })
      const takeover = cheapestGuaranteedWin(winningOpp, view, userId)
      if (takeover) return takeover.id
      return schmearOpp()
    }
```

Note: opponent-team variant intentionally omits the "highest trump risk reduction" step (no obligation to defend speculatively).

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `npm test -- shared/gameEngine.test.js -t "opponent-team schmear guard"`
Expected: PASS (2 tests).

- [ ] **Step 7.5: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7.6: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(botStrategy): opponent-team schmear attempts takeover when guaranteed"
```

---

## Task 8: Non-trump-win branch — highest-point-wins when safe (2a)

**Files:**
- Modify: `shared/botStrategy.js` (line ~346)
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 8.1: Write failing test**

```js
describe('decidePlay — non-trump-win point maximization', () => {
  it('plays highest-point non-trump win when trumpRemainingElsewhere is 0', () => {
    // Hearts led. Picker (p1) following; has AH (11pts) and 7H (0pts). Both beat what's played.
    // Current trick: p3 plays 9H, p4 plays 8H. p5 (opponent) still to play.
    // trumpRemainingElsewhere check: construct view so every trump outside p1's hand is played.
    // Simpler: use handScore path — if 0 trump anywhere, opponent can't trump in.
    // Manually stub: put all 14 trump in completed tricks.
    const allTrump = [
      c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('A','D'), c('10','D'), c('K','D'),
      c('9','D'), c('8','D'), c('7','D'),
    ]
    // 14 trump → 3 tricks of 5 = 15 slots; fill 14 + 1 non-trump filler.
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('A','H'), c('7','H'), c('8','C')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p4', card: c('8','H') },
      ],
    })
    const tricks = [
      allTrump.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      allTrump.slice(5, 10).map((card, i) => ({ userId: `p${i+1}`, card })),
      allTrump.slice(10, 14).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p5', card: c('7','C') },
      ]),
    ]
    const view = withTricks(baseView, tricks)
    // trumpRemainingElsewhere: 14 - (trump in hand=0) - (played=14) - (buried=0) = 0.
    // nonTrumpWins = [AH, 7H] (both beat 9H and 8H in hearts).
    // New behavior: highest-point-wins = AH (11pts).
    expect(decidePlay(view, 'p1')).toBe('AH')
  })

  it('plays lowest non-trump win when opponents could still trump in', () => {
    // Standard case: no exhaustion, current behavior preserved.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('A','H'), c('7','H'), c('8','C')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p4', card: c('8','H') },
      ],
    })
    // trumpRemainingElsewhere > 0 → fallback to lowestCard(nonTrumpWins) = 7H.
    expect(decidePlay(view, 'p1')).toBe('7H')
  })
})
```

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `npm test -- shared/gameEngine.test.js -t "non-trump-win point maximization"`
Expected: FAIL on the "highest-point" test (current returns 7H).

- [ ] **Step 8.3: Update non-trump-wins branch**

In `shared/botStrategy.js`, locate around line 346:

```js
    if (winning.length > 0) {
      const nonTrumpWins = winning.filter(c => !isTrump(c))
      if (nonTrumpWins.length > 0) return lowestCard(nonTrumpWins).id
```

Replace the `if (nonTrumpWins.length > 0)` line with:

```js
    if (winning.length > 0) {
      const nonTrumpWins = winning.filter(c => !isTrump(c))
      if (nonTrumpWins.length > 0) {
        // Compute opponentsRemaining early so this branch can use it.
        // (Duplicates the computation below; acceptable for readability.)
        const playedIdsNT = new Set(currentTrick.map(p => p.userId))
        const allIdsNT = Object.keys(view.hands)
        const opponentsRemainingNT = allIdsNT.filter(id =>
          !playedIdsNT.has(id) && id !== userId && id !== picker && id !== partner
        ).length
        const safeFromTrumpIn = opponentsRemainingNT === 0 ||
          trumpRemainingElsewhere(view, userId) === 0
        if (safeFromTrumpIn) {
          return highestValueCard(nonTrumpWins).id
        }
        return lowestCard(nonTrumpWins).id
      }
```

(The closing brace for the `nonTrumpWins.length > 0` block is the existing `.id` line being replaced.)

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `npm test -- shared/gameEngine.test.js -t "non-trump-win point maximization"`
Expected: PASS (2 tests).

- [ ] **Step 8.5: Run full test suite**

Run: `npm test`
Expected: all tests pass. This change could affect existing tests that exercise the non-trump-wins path; review failures.

- [ ] **Step 8.6: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(botStrategy): maximize points on guaranteed non-trump wins"
```

---

## Task 9: Update `docs/BOTS.md`

**Files:**
- Modify: `docs/BOTS.md`

- [ ] **Step 9.1: Read current `docs/BOTS.md` to locate affected sections**

Run: `grep -n "Schmear\|partner.*trump\|picker.*void\|Scenario" docs/BOTS.md`

Identify the following sections (approximate — line numbers will vary):
- Picker-team bot following — Step 1 (Schmear)
- Picker-team bot following — Step N (trump scenarios)
- Opponent-team bot following — Step (Schmear)

- [ ] **Step 9.2: Update Schmear sections**

For **Picker-team schmear**, replace the unconditional schmear rule with:

```markdown
**Picker-team bot following — Step 1 (Schmear guard):**
If a teammate is currently winning the trick, first check whether the winning card is safe:
the card is **safe** if either no non-picker-team opponents remain to play, or every trump that
could outrank it is already accounted for (in own hand, played, or visible bury).

- **If safe** — schmear as before: dump highest-value non-trump on the pile.
- **If not safe, and I am the partner bot** — schmear anyway. The picker picked with a strong
  hand and likely holds additional trump to recover if this trick is overtaken.
- **If not safe, and I am the picker bot** — try to secure the trick myself:
  1. If any card in hand is a guaranteed winner (beats every played card and has no outranking
     trump unseen), play the lowest-point such card.
  2. Otherwise, play the highest trump that currently beats the trick as risk reduction.
  3. If neither option is available, fall back to schmearing.
```

For **Opponent-team schmear**:

```markdown
**Opponent-team bot following — Schmear guard:**
Same safety check (adjusted: "opponents" from the opponent's POV = picker + partner still to play).

- **If safe** — schmear highest-value non-trump.
- **If not safe** — if a guaranteed-winning card exists in hand, take over with the lowest-point
  such card. Otherwise schmear anyway (do not burn trump speculatively).
```

- [ ] **Step 9.3: Update partner trump-follow section**

For the partner-void-fail-trick section, document the new split:

```markdown
**Partner bot, void in led fail suit, playing trump:**

- **If the picker has not yet played in this trick** (picker-strength prior applies):
  - With 2+ trump in hand: play highest winning trump (lead-back insurance).
  - With exactly 1 trump: play it only if guaranteed to win (no outranking trump remains unseen);
    otherwise play low and defer to the picker.

- **If the picker has played and is currently winning**:
  - If no opponents remain OR the picker's card is guaranteed to hold against any remaining
    unseen trump, play the lowest card in hand (save the trump).
  - Otherwise, play the highest trump that wins, refined as below.

- **If the picker has played and is NOT currently winning**:
  - With 2+ trump, play the lowest-point card that is itself guaranteed, if any; else the
    highest winning trump.
  - With exactly 1 trump, play it.
```

- [ ] **Step 9.4: Update "highest trump when opponents remain" sections for trump trick and picker-void**

Find sections describing the trump-trick following decision ("when opponents remain") and the picker-void-fail-trick decision, and add a clause:

```markdown
When opponents remain after this play, prefer the lowest-point card that is itself guaranteed
to win (via trump-rank counting). If none qualify, fall back to the highest winning trump.
```

- [ ] **Step 9.5: Update non-trump-win section (if separately documented)**

If `BOTS.md` documents the non-trump-wins path, add:

```markdown
When a non-trump in hand currently beats the trick, play the lowest such card by default — any
opponent could still trump in. But when no opponent can possibly trump in (no opponents remain
to play, or `trumpRemainingElsewhere` is 0), play the highest-point winner to maximize captured
points.
```

If the path is not currently documented, skip this step.

- [ ] **Step 9.6: Verify `docs/BOTS.md` matches code**

Re-read the updated `BOTS.md` alongside the final `shared/botStrategy.js` and confirm descriptions match implementation. No discrepancies allowed (per `CLAUDE.md` BOTS Sync rule).

- [ ] **Step 9.7: Commit**

```bash
git add docs/BOTS.md
git commit -m "docs(BOTS): document card-counting guards and schmear asymmetry"
```

---

## Task 10: Final full-suite run and cross-check

**Files:** (none modified)

- [ ] **Step 10.1: Run entire test suite**

Run: `npm test`
Expected: all tests pass (no failures, no skips).

- [ ] **Step 10.2: Sanity-check `botStrategy.js` structure**

Read the updated `shared/botStrategy.js` top-to-bottom and verify:
- All three schmear branches go through the safe/not-safe guard.
- The follow-win branch handles: trump trick, picker void fail, partner picker-still-to-play (1 and 2+ trump), partner picker-played-winning (#92), partner picker-played-not-winning.
- No unreachable code paths.
- No duplicated variable names shadowing each other.

- [ ] **Step 10.3: Run the bot end-to-end smoke check**

Run the dev server:

```bash
npm run dev
```

Play 2-3 hands against the bots to confirm no thrown errors and no obviously wrong plays. Stop after verification (no need to finish a full game).

- [ ] **Step 10.4: Commit any tiny follow-up fixes**

If any issues surfaced in 10.2 or 10.3, fix inline with a dedicated commit per fix.
