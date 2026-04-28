# Bot Defender Force-Take to Enable Called-Suit Lead-Back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a defender-bot following-trick branch that force-takes the current trick (highest trump when threats remain, schmear-self priority when no threats remain) so the bot can lead the called suit on the following trick to flush the picker's partner. Consolidate existing duplicated schmear closures around the same priority helper while we're there.

**Architecture:** One new pure helper `pickBySchmearPriority(candidates, kind, hand)` in `shared/botInference.js`. Two existing schmear closures in `shared/botStrategy.js` (`schmear()` and `schmearOpp()`) refactored to call it with `kind: 'fail'`. New branch in `decidePlay`'s opponent-following section between the existing schmear-on-confirmed-teammate block and the trump-in-on-called-suit block. Lead-back behavior already exists at `botStrategy.js:312-318` and is unchanged. `docs/BOTS.md` updated to match.

**Tech Stack:** JavaScript (ESM), Vitest test runner. No new dependencies.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `shared/botInference.js` | Pure card-selection primitives | **Modify**: add `TRUMP_SCHMEAR_PRIORITY`, `FAIL_SCHMEAR_PRIORITY`, `pickBySchmearPriority` |
| `shared/botStrategy.js` | Bot decision logic (`decidePlay` etc.) | **Modify**: import new helper; replace bodies of `schmear()` and `schmearOpp()` closures; add new opponent-following branch |
| `shared/gameEngine.test.js` | Existing test file housing bot strategy tests | **Modify**: add helper unit tests, schmear regression tests, and new-branch behavior tests |
| `docs/BOTS.md` | Plain-English bot strategy reference | **Modify**: add new branch to "Opponent bot following" section; update schmear description to mention new tiebreak |

Spec to reference throughout: `docs/superpowers/specs/2026-04-26-bot-defender-force-take-called-suit-design.md`.

---

## Spec section: Helper

### Task 1: Add `pickBySchmearPriority` helper

**Files:**
- Modify: `shared/botInference.js`
- Test: `shared/gameEngine.test.js` (add to existing botInference test region; create a new `describe` block)

- [ ] **Step 1.1: Write failing tests for the helper**

Add a new `describe` block at the end of `shared/gameEngine.test.js` (the file already imports from `botInference.js` at the top — add `pickBySchmearPriority` to that import). Use the existing `c(rank, suit)` helper for card construction (defined at line 21).

```javascript
import {
  // ... existing imports
  pickBySchmearPriority,
} from './botInference.js'

describe('pickBySchmearPriority', () => {
  it('trump kind: returns A♦ when winning set covers all priority ranks', () => {
    const candidates = [c('A','D'), c('10','D'), c('K','D'), c('9','D'), c('J','H'), c('Q','D')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'trump', hand).id).toBe('AD')
  })

  it('trump kind: returns J♥ over Q (J before Q in priority)', () => {
    const candidates = [c('Q','C'), c('Q','D'), c('J','H')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'trump', hand).id).toBe('JH')
  })

  it('trump kind: among Qs, returns weakest by trump rank (Q♦)', () => {
    const candidates = [c('Q','C'), c('Q','D'), c('Q','S')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'trump', hand).id).toBe('QD')
  })

  it('trump kind: among Js, returns weakest by trump rank (J♦)', () => {
    const candidates = [c('J','C'), c('J','S'), c('J','D')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'trump', hand).id).toBe('JD')
  })

  it('fail kind: returns A♠ when winning set is single-suit', () => {
    const candidates = [c('A','S'), c('K','S'), c('8','S')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'fail', hand).id).toBe('AS')
  })

  it('fail kind: prefers card from shortest non-trump suit in hand', () => {
    const candidates = [c('A','S'), c('A','C')]
    // Hand has 3 spades and 1 club among non-trump → clubs is shorter
    const hand = [c('A','S'), c('K','S'), c('9','S'), c('A','C'), c('Q','D')]
    expect(pickBySchmearPriority(candidates, 'fail', hand).id).toBe('AC')
  })

  it('fail kind: alphabetical suit tiebreak when suit lengths tied', () => {
    const candidates = [c('A','S'), c('A','C')]
    // 2 spades, 2 clubs in non-trump hand → tied; C < S alphabetically → AC
    const hand = [c('A','S'), c('8','S'), c('A','C'), c('7','C')]
    expect(pickBySchmearPriority(candidates, 'fail', hand).id).toBe('AC')
  })

  it('fail kind: moves toward voiding — picks card from the rarer non-trump suit', () => {
    const candidates = [c('9','S'), c('9','C')]
    // Hand has 1 spade and 3 clubs in non-trump → spades is shorter
    const hand = [c('9','S'), c('9','C'), c('K','C'), c('7','C'), c('Q','D')]
    expect(pickBySchmearPriority(candidates, 'fail', hand).id).toBe('9S')
  })

  it('returns null when candidates is empty', () => {
    expect(pickBySchmearPriority([], 'trump', [])).toBe(null)
    expect(pickBySchmearPriority([], 'fail', [])).toBe(null)
  })

  it('returns null when no candidate matches any priority rank', () => {
    // Should not happen in practice but defensive
    const candidates = []
    expect(pickBySchmearPriority(candidates, 'fail', [])).toBe(null)
  })
})
```

- [ ] **Step 1.2: Run the new tests to confirm they fail**

Run: `npx vitest run shared/gameEngine.test.js -t pickBySchmearPriority`
Expected: All tests fail with `pickBySchmearPriority is not exported by ./botInference.js` (or similar import error).

- [ ] **Step 1.3: Implement the helper in `shared/botInference.js`**

Add at the end of `shared/botInference.js` (after the `teammateWinning` block, in a new section):

```javascript
// ─── Schmear-priority pick ────────────────────────────────────────────────────

// Rank priority for "schmear-self" — when the bot is guaranteed to take the
// trick and is choosing the least-painful winning card to spend.
//
// Order rationale: cash high-point cards (A=11, 10=10, K=4) first, then 0-point
// pip cards (9, 8, 7), then keep tactical strength in reserve (Js before Qs,
// since Q is the top trump rank).
const TRUMP_SCHMEAR_PRIORITY = ['A', '10', 'K', '9', '8', '7', 'J', 'Q']
const FAIL_SCHMEAR_PRIORITY = ['A', '10', 'K', '9', '8', '7']

// Returns the schmear-priority pick from `candidates`, or null if no candidate
// matches any priority rank (or `candidates` is empty).
//
// `kind` ∈ {'trump', 'fail'} selects the priority list.
// `hand` is the bot's full remaining hand — used only for the fail tiebreak
// (prefer card whose suit is shortest in hand to move toward voiding a suit).
//
// Within-rank tiebreaks:
//   'trump' → weakest by trump rank (e.g., among Qs: Q♦ over Q♣)
//   'fail'  → shortest non-trump suit in `hand`; secondary tiebreak alphabetical by suit
export function pickBySchmearPriority(candidates, kind, hand) {
  if (!candidates || candidates.length === 0) return null
  const ranks = kind === 'trump' ? TRUMP_SCHMEAR_PRIORITY : FAIL_SCHMEAR_PRIORITY

  for (const rank of ranks) {
    const matches = candidates.filter(card => card.rank === rank)
    if (matches.length === 0) continue
    if (matches.length === 1) return matches[0]

    if (kind === 'trump') {
      // Weakest by trump rank = highest trumpRank index value
      return matches.reduce((best, card) =>
        trumpRank(card) > trumpRank(best) ? card : best
      )
    }

    // 'fail' tiebreak: shortest non-trump suit in hand, then alphabetical
    const nonTrumpHand = (hand ?? []).filter(card => !card.hidden && !isTrump(card))
    const suitCount = {}
    for (const card of nonTrumpHand) {
      suitCount[card.suit] = (suitCount[card.suit] ?? 0) + 1
    }
    return matches.reduce((best, card) => {
      const cCount = suitCount[card.suit] ?? 0
      const bestCount = suitCount[best.suit] ?? 0
      if (cCount !== bestCount) return cCount < bestCount ? card : best
      return card.suit < best.suit ? card : best
    })
  }

  return null
}
```

- [ ] **Step 1.4: Run the new tests to confirm they pass**

Run: `npx vitest run shared/gameEngine.test.js -t pickBySchmearPriority`
Expected: All 9 tests pass.

- [ ] **Step 1.5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All previously-passing tests still pass; new tests pass; 0 failures.

- [ ] **Step 1.6: Commit**

```bash
git add shared/botInference.js shared/gameEngine.test.js
git commit -m "feat(bot): add pickBySchmearPriority helper

New pure helper in botInference.js that picks the least-painful
winning card to spend, walking a rank-priority list with kind-specific
within-rank tiebreaks (weakest trump rank for trump; shortest non-trump
suit in hand for fail)."
```

---

## Spec section: Refactor existing schmear closures

### Task 2: Replace schmear/schmearOpp bodies with helper call

**Files:**
- Modify: `shared/botStrategy.js` (around line 9 import; line 333 `schmear()`; line 450 `schmearOpp()`)
- Test: `shared/gameEngine.test.js` — adjust the existing schmear test that depends on prior tiebreak behavior; add a regression test asserting the new shortest-suit tiebreak.

- [ ] **Step 2.1: Write failing regression test for new shortest-suit tiebreak**

Add the following test inside the existing `describe('decidePlay schmearing', ...)` block in `shared/gameEngine.test.js` (around line 1816):

```javascript
it('schmears card from shortest non-trump suit on within-rank tie', () => {
  // Bot p3 (defender). Picker=p1, partner=p2 (revealed/known). Confirmed defender
  // teammate p4 is winning with Q♣. teammateWinning=true → schmearOpp fires.
  // Bot hand has A♠ and A♣ — both highest priority. Hand has 3 spades and 1 club
  // among non-trump → clubs is the shortest non-trump suit → schmear A♣, not A♠.
  const view = makeFollowView({
    userId: 'p3',
    picker: 'p1',
    partner: 'p2',
    trickWinner: 'p4',
    trickCard: c('Q','C'),
    handCards: [c('A','S'), c('K','S'), c('9','S'), c('A','C')],
  })
  expect(decidePlay(view, 'p3')).toBe('AC')
})
```

- [ ] **Step 2.2: Run the new regression test to confirm it fails**

Run: `npx vitest run shared/gameEngine.test.js -t "shortest non-trump suit on within-rank tie"`
Expected: Failure — current schmear uses `highestValueCard`, which returns whichever A its reduce encounters first (likely AS).

- [ ] **Step 2.3: Add `pickBySchmearPriority` to `botStrategy.js` imports**

Edit `shared/botStrategy.js` line 9. Change:

```javascript
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, trumpRemainingElsewhere, isGuaranteedWinner, cheapestGuaranteedWin } from './botInference.js'
```

to:

```javascript
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, trumpRemainingElsewhere, isGuaranteedWinner, cheapestGuaranteedWin, pickBySchmearPriority } from './botInference.js'
```

- [ ] **Step 2.4: Refactor `schmear()` body (picker-team branch)**

In `shared/botStrategy.js`, find the `schmear` closure (currently around lines 333-337):

```javascript
const schmear = () => {
  const nonTrump = realCards.filter(c => !isTrump(c))
  if (nonTrump.length > 0) return highestValueCard(nonTrump).id
  return lowestCard(realCards).id  // only trump available — don't burn trump to schmear
}
```

Replace with:

```javascript
const schmear = () => {
  const nonTrump = realCards.filter(c => !isTrump(c))
  // Pass the bot's full hand (not realCards) so the suit-count tiebreak counts
  // suits across the entire remaining hand, not just legal plays.
  const pick = pickBySchmearPriority(nonTrump, 'fail', view.hands[userId])
  return (pick ?? lowestCard(realCards)).id  // helper returns null when no non-trump available — don't burn trump
}
```

- [ ] **Step 2.5: Refactor `schmearOpp()` body (opponent branch)**

In `shared/botStrategy.js`, find the `schmearOpp` closure (currently around lines 450-454):

```javascript
const schmearOpp = () => {
  const nonTrump = realCards.filter(c => !isTrump(c))
  if (nonTrump.length > 0) return highestValueCard(nonTrump).id
  return lowestCard(realCards).id
}
```

Replace with:

```javascript
const schmearOpp = () => {
  const nonTrump = realCards.filter(c => !isTrump(c))
  const pick = pickBySchmearPriority(nonTrump, 'fail', view.hands[userId])
  return (pick ?? lowestCard(realCards)).id
}
```

- [ ] **Step 2.6: Run the new regression test to confirm it now passes**

Run: `npx vitest run shared/gameEngine.test.js -t "shortest non-trump suit on within-rank tie"`
Expected: PASS — schmear now returns AC.

- [ ] **Step 2.7: Run full test suite; review and update any existing tests that depended on old tiebreak**

Run: `npm test`
Expected: Most tests pass. If any of the existing schmear-related tests in `gameEngine.test.js` fail because they hand-picked `highestValueCard`'s first-encountered tiebreak, update them to reflect the new behavior. Likely candidates: the four tests in `describe('decidePlay schmearing', ...)` starting line 1816, and the schmear tests in `describe('decidePlay — picker-team schmear guard (#121)', ...)` starting line 2666.

For each failing test:
1. Read the test setup (handCards, trickWinner, trickCard).
2. Compute the new expected card under the priority rule:
   - List candidates after `nonTrump = realCards.filter(c => !isTrump(c))`.
   - Find the highest-priority rank that appears (`A` first, then `10`, etc.).
   - If multiple of that rank, prefer the card in the shortest non-trump suit of `realCards`; alphabetical secondary.
3. Update the assertion to the new expected ID. Do **not** remove the test.

If a test fails for a reason other than the new tiebreak (e.g. unrelated regression), STOP and surface it.

- [ ] **Step 2.8: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "refactor(bot): consolidate schmear closures via pickBySchmearPriority

Both schmear() and schmearOpp() now delegate to the shared helper.
Behavior change: within-rank tiebreak among non-trump cards now prefers
the card from the shortest non-trump suit in hand, moving the bot toward
voiding a suit. Existing schmear tests updated where the old reduce
tiebreak was implicitly relied upon."
```

---

## Spec section: New opponent-following branch (force-take for called-suit lead-back)

### Task 3: Add the new branch to `decidePlay`

**Files:**
- Modify: `shared/botStrategy.js` (insert new branch in opponent-following section, after the `schmearOpp` block ending around line 478, before the "Trump in on called suit" block around line 480)
- Test: `shared/gameEngine.test.js` (new `describe` block)

- [ ] **Step 3.1: Write failing tests for the new branch**

Add a new `describe` block at the end of `shared/gameEngine.test.js`:

```javascript
describe('decidePlay — defender force-take to enable called-suit lead-back', () => {
  // Helper: build a 5-player view with the bot following on a trick already in progress.
  // playedSeq is an array of {userId, card} representing the current trick so far.
  function makeForceTakeView({
    userId,
    picker,
    partner,
    partnerRevealed,
    calledSuit,
    handCards,
    playedSeq,
  }) {
    // Hands: only the bot's hand needs real cards; others can be placeholders for length detection.
    const allIds = ['p1','p2','p3','p4','p5']
    const hands = {}
    for (const id of allIds) hands[id] = id === userId ? handCards : []
    return {
      hands,
      currentTrick: playedSeq,
      tricks: [],
      picker,
      partner,
      partnerRevealed,
      isLeaster: false,
      phase: 'playing',
      calledSuit,
      calledAce: calledSuit ? { aceId: `A${calledSuit}` } : null,
      calledTen: null,
      calledKing: null,
      pickerForcedPlays: [],
      underCard: null,
      buried: [],
    }
  }

  it('void in led fail, picker still to play → highest trump (Q♣)', () => {
    // Bot p3 (defender), called suit = hearts, partner unrevealed.
    // p1 (picker) hasn't played; p2 led 8♠. Bot has Q♣ (top trump), J♦, A♥ (called-suit fail).
    // Bot is void in spades → can play trump. picker still to play → highest trump = Q♣.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('J','D'), c('A','H')],
      playedSeq: [{ userId: 'p2', card: c('8','S') }],
    })
    expect(decidePlay(view, 'p3')).toBe('QC')
  })

  it('void in led fail, last to play (0 opps remaining) → A♦ from priority list', () => {
    // Bot p5 (defender). p1 (picker) and p2,p3,p4 already played; bot is last.
    // Called suit = hearts, partner unrevealed.
    // Played: p1=8♠, p2=7♠, p3=K♠, p4=9♠. Bot is void in spades. Hand: A♦, 7♦, A♥.
    // 0 opps remain → schmear-self priority → A♦ (top of trump priority).
    const view = makeForceTakeView({
      userId: 'p5',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('A','D'), c('7','D'), c('A','H')],
      playedSeq: [
        { userId: 'p1', card: c('8','S') },
        { userId: 'p2', card: c('7','S') },
        { userId: 'p3', card: c('K','S') },
        { userId: 'p4', card: c('9','S') },
      ],
    })
    expect(decidePlay(view, 'p5')).toBe('AD')
  })

  it('trump led, 0 opps, only Qs in winning set → weakest Q (Q♦)', () => {
    // Bot p5 (defender), last to play. Called=H, partner unrevealed.
    // Played: p1=K♦ (trump led), p2=8♠? — but this would be invalid (must follow
    // trump if held). Use a setup where everyone is void in trump:
    // p1=K♦ (leads trump), p2=8♠ (void in trump), p3=7♠, p4=9♠. winner = K♦.
    // Bot p5 has [Q♣, Q♦, A♥]. Must follow trump (has trump) → realCards excludes
    // A♥ (called card) → [Q♣, Q♦]. Both beat K♦.
    // 0 opps remain → schmear-self trump priority. Walk to Q rank → tiebreak by
    // weakest trump rank → Q♦ (rank 3) over Q♣ (rank 0).
    //
    // Note: This setup is engine-legal only if other players truly have no trump.
    // The test exercises decidePlay directly with a constructed view, so engine
    // legality of historical plays isn't enforced.
    const view = makeForceTakeView({
      userId: 'p5',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('Q','D'), c('A','H')],
      playedSeq: [
        { userId: 'p1', card: c('K','D') },
        { userId: 'p2', card: c('8','S') },
        { userId: 'p3', card: c('7','S') },
        { userId: 'p4', card: c('9','S') },
      ],
    })
    expect(decidePlay(view, 'p5')).toBe('QD')
  })

  it('trump led, 0 opps, Q♦ and J♥ both winning → J♥ (J before Q in priority)', () => {
    // Bot p5 (defender), last to play. Called=H, partner unrevealed.
    // Played: p1=8♦, p2=7♦, p3=9♦, p4=K♦ (trump trick). Current winner: p4 K♦ (rank 10).
    // Bot hand: [Q♦, J♥, A♥]. Must follow trump → realCards excludes A♥ (called card,
    // ledSuit T ≠ called H). realCards = [Q♦, J♥]. Both beat K♦.
    // 0 opps remain → schmear-self trump priority. Walk A,10,K,9,8,7,J,Q:
    //   J♥ found before Q♦ → return J♥.
    const view = makeForceTakeView({
      userId: 'p5',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','D'), c('J','H'), c('A','H')],
      playedSeq: [
        { userId: 'p1', card: c('8','D') },
        { userId: 'p2', card: c('7','D') },
        { userId: 'p3', card: c('9','D') },
        { userId: 'p4', card: c('K','D') },
      ],
    })
    expect(decidePlay(view, 'p5')).toBe('JH')
  })

  it('must-follow non-called fail, opps remain → strategy SKIPPED, plays lowest', () => {
    // Bot p3 (defender). Called suit = hearts. Partner unrevealed. Picker still to play.
    // p2 led 8♠. Bot has A♠ (could win), 7♠, A♥ (called-suit fail).
    // Must follow spades → realCards = [A♠, 7♠]. Bot has A♥ to lead back.
    // BUT picker still to play and could be void in spades → trump over.
    // → strategy skipped; default lowest = 7♠.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('A','S'), c('7','S'), c('A','H')],
      playedSeq: [{ userId: 'p2', card: c('8','S') }],
    })
    expect(decidePlay(view, 'p3')).toBe('7S')
  })

  it('must-follow non-called fail, 0 opps, A♠ and K♠ both winning → A♠', () => {
    // Bot p5 (defender), last to play. Called=H, partner unrevealed.
    // Played: p1=9♠ (current winner among spades), p2=8♠, p3=7♠, p4=9♣ (void).
    // Bot p5 hand: [A♠, K♠, A♥]. Must follow spades → realCards = [A♠, K♠].
    //   A♠(rank 0) and K♠(rank 2) both beat 9♠(rank 4). winningSet = [A♠, K♠].
    // canPlayTrump = false (both non-trump). 0 opps remain.
    // → fail priority: A first → A♠.
    const view = makeForceTakeView({
      userId: 'p5',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('A','S'), c('K','S'), c('A','H')],
      playedSeq: [
        { userId: 'p1', card: c('9','S') },
        { userId: 'p2', card: c('8','S') },
        { userId: 'p3', card: c('7','S') },
        { userId: 'p4', card: c('9','C') },
      ],
    })
    expect(decidePlay(view, 'p5')).toBe('AS')
  })

  it('strategy skipped when bot has no called-suit non-trump card', () => {
    // Bot p3 defender. Called = hearts. Partner unrevealed. Picker still to play.
    // Bot is void in spades and has trump but NO hearts (called-suit non-trump).
    // p2 led 8♠. Hand: Q♣, J♦, 8♣. Bot is void in spades, can play any.
    // Trigger #3 fails → strategy skipped → default opponent-following lowest non-trump = 8♣.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('J','D'), c('8','C')],
      playedSeq: [{ userId: 'p2', card: c('8','S') }],
    })
    expect(decidePlay(view, 'p3')).toBe('8C')
  })

  it('strategy skipped when partner is already revealed', () => {
    // partnerRevealed=true, partner=p4. Picker p1 leads 8♠ (so picker is winning →
    // teammateWinning is false → schmearOpp does NOT fire). New branch is skipped
    // because partnerRevealed=true. Trump-in-on-called-suit skipped (S !== H).
    // Falls to default lowestCard(realCards).
    //
    // Bot hand [Q♣, J♦, A♥]. A♥ is called card; ledSuit S ≠ called H, so A♥ excluded
    // from realCards. realCards = [Q♣, J♦]. Both trump. lowestCard by points: Q♣=3, J♦=2 → J♦.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p4',
      partnerRevealed: true,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('J','D'), c('A','H')],
      playedSeq: [{ userId: 'p1', card: c('8','S') }],
    })
    expect(decidePlay(view, 'p3')).toBe('JD')
  })

  it('strategy skipped when bot has no winning cards', () => {
    // Bot p3 defender, called=H, partner unrevealed, picker still to play.
    // p2 led Q♣ (top trump). Bot hand: [J♦, 7♦, A♥].
    // Bot has no spades; ledSuit is trump. Bot has trump → must follow trump.
    // realCards: A♥ is called card; ledSuit T ≠ called H → A♥ excluded.
    //   = [J♦, 7♦] (both trump → satisfy follow-suit rule).
    // winningSet: J♦(rank 7) and 7♦(rank 13) both lose to Q♣ (rank 0) → empty.
    // New branch: winningSet empty → fall through. Default lowestCard:
    //   both trump, both 0 points (J♦=2, 7♦=0). 7♦ has lower points → 7♦.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('J','D'), c('7','D'), c('A','H')],
      playedSeq: [{ userId: 'p2', card: c('Q','C') }],
    })
    expect(decidePlay(view, 'p3')).toBe('7D')
  })

  it('current trick led with called suit → existing trump-in branch fires (not new branch)', () => {
    // Called = hearts, p2 led 9♥ (the called suit itself). Bot p3 defender, partner unrevealed.
    // Bot is void in hearts; has trump. Existing logic: trump in with lowest trump.
    // Bot hand: Q♣, J♦, 8♣. Void in hearts → realCards is full hand.
    // Existing line 480 branch: "Trump in on called suit if picker team currently winning"
    // Currently p2 is winning with 9♥. p2 is unknown role from defender POV (partner unrevealed).
    // The check at line 484 is `winner.userId !== picker && winner.userId !== partner`
    //   → with partner=null and winner=p2, opponentWinning = (p2 !== p1) && (p2 !== null) = true.
    // opponentWinning=true → DOES NOT trump in. Falls through to default lowestCard(nonTrump) = 8♣.
    // This test confirms the new branch is correctly gated to non-called-suit-led tricks.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('J','D'), c('8','C')],
      playedSeq: [{ userId: 'p2', card: c('9','H') }],
    })
    expect(decidePlay(view, 'p3')).toBe('8C')
  })
})
```

- [ ] **Step 3.2: Run the new tests to confirm they fail**

Run: `npx vitest run shared/gameEngine.test.js -t "defender force-take"`
Expected: Most assertions in this block fail (current code defaults to lowest card, not the strategic picks). The "strategy skipped" tests may already pass (they assert the existing default behavior).

- [ ] **Step 3.3: Implement the new branch in `shared/botStrategy.js`**

In `shared/botStrategy.js`, find the opponent-following section. After the `schmearOpp` `teammateWinning` block (which currently ends with `return schmearOpp()` around line 478) and **before** the existing "Trump in on called suit if picker team is currently winning the trick" block (around line 480-489), insert the new branch.

The exact insertion point is between the closing `}` of the `if (teammateWinning(view, userId)) { ... }` block and the line `// Trump in on called suit if picker team is currently winning the trick`.

Insert this code:

```javascript
    // Force-take to enable called-suit lead-back: when the called suit hasn't been led
    // yet (partner unrevealed) and the bot has a called-suit fail card to lead back,
    // win this trick aggressively so the bot can lead the called suit on the next
    // trick and flush the picker's partner.
    {
      const { calledSuit, partnerRevealed } = view
      const ledThisTrickIsCalled = ledSuit === calledSuit
      const hasCalledSuitFail = !!calledSuit && realCards.some(card =>
        !isTrump(card) && effectiveSuit(card) === calledSuit
      )
      // Note: realCards already filters by must-follow rules. If the bot has a called-suit
      // card but is here following a different suit, the called-suit card is in `view.hands[userId]`
      // but not in `realCards`. We need to check the bot's full hand for the lead-back card.
      const fullHand = view.hands[userId] ?? []
      const hasCalledSuitFailInHand = !!calledSuit && fullHand.some(card =>
        !card.hidden && !isTrump(card) && effectiveSuit(card) === calledSuit
      )

      if (!partnerRevealed && !ledThisTrickIsCalled && hasCalledSuitFailInHand) {
        const winningSet = realCards.filter(card => {
          for (const play of currentTrick) {
            if (!beats(card, play.card, ledSuit)) return false
          }
          return true
        })

        if (winningSet.length > 0) {
          const playedIds = new Set(currentTrick.map(p => p.userId))
          const allIds = Object.keys(view.hands)
          const potentialOppsRemaining = allIds.filter(id =>
            !playedIds.has(id) && id !== userId
          ).length

          const canPlayTrump = winningSet.some(card => isTrump(card))

          if (canPlayTrump) {
            // Void in led suit, or trump led
            if (potentialOppsRemaining > 0) {
              // Highest trump in winning set
              return highestTrump(winningSet).id
            }
            // 0 opps remain — schmear-self with trump priority
            const pick = pickBySchmearPriority(winningSet, 'trump', fullHand)
            if (pick) return pick.id
          } else {
            // Must-follow non-called fail; only fail-suit winners
            if (potentialOppsRemaining === 0) {
              const pick = pickBySchmearPriority(winningSet, 'fail', fullHand)
              if (pick) return pick.id
            }
            // potentialOppsRemaining > 0 → fall through (opponent could trump over)
          }
        }
      }
    }
    // Trump in on called suit if picker team is currently winning the trick
```

(Leave the existing "Trump in on called suit..." block exactly as it was.)

- [ ] **Step 3.4: Run the new branch tests to confirm they pass**

Run: `npx vitest run shared/gameEngine.test.js -t "defender force-take"`
Expected: All tests in the new `describe` block pass.

- [ ] **Step 3.5: Run the full test suite**

Run: `npm test`
Expected: All tests pass; 0 regressions. If any pre-existing test changes its expected outcome because of the new branch, STOP and review whether the change is intentional. The new branch is gated to defender + partner-unrevealed + has-called-suit-fail-in-hand + non-called-suit-led + has-winning-cards — narrow enough that broad regressions should be unlikely.

- [ ] **Step 3.6: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(bot): defender force-takes trick to enable called-suit lead-back

When a defender bot is following a non-called-suit-led trick, the
partner is unrevealed, and the bot holds a called-suit fail card to
lead back, the bot now takes the trick: highest trump when picker-team
threats remain to play, schmear-self priority list when no threats
remain. The existing leading logic already leads called suit on the
next trick to flush the partner."
```

---

## Spec section: Documentation sync

### Task 4: Update `docs/BOTS.md`

**Files:**
- Modify: `docs/BOTS.md`

- [ ] **Step 4.1: Read the current "Opponent bot following" section**

Read `docs/BOTS.md` lines 107-113 (the "Opponent bot following" section). The current text:

```
#### Opponent bot following
1. **Schmear** (a confirmed teammate — partner identity must be known — is currently winning):
   - **Safe** (no picker or partner remains to play, or the teammate's winning card is itself a guaranteed winner): dump the highest-value non-trump. If only trump available, play the lowest card.
   - **Not safe**: if the bot can take the trick with a guaranteed-winning card, play the lowest-point such card. Otherwise schmear anyway — no speculative trump burn when a guaranteed takeover isn't available.
2. **Trump in on called suit**: If the called suit was led and the picker team is currently winning the trick, play the lowest available trump to contest.
3. **Otherwise**: play the lowest card.
```

- [ ] **Step 4.2: Insert the new branch as item 2; renumber subsequent items**

Replace the whole "Opponent bot following" section with:

```
#### Opponent bot following
1. **Schmear** (a confirmed teammate — partner identity must be known — is currently winning):
   - **Safe** (no picker or partner remains to play, or the teammate's winning card is itself a guaranteed winner): dump the highest-priority non-trump per the **schmear priority** (see below). If only trump available, play the lowest card.
   - **Not safe**: if the bot can take the trick with a guaranteed-winning card, play the lowest-point such card. Otherwise schmear anyway — no speculative trump burn when a guaranteed takeover isn't available.
2. **Force-take to enable called-suit lead-back**: When the partner is **not yet revealed**, the current trick is **not** led with the called suit, the bot holds **at least one non-trump card of the called suit** in hand (a card that can be led back next trick), and the bot can take the current trick:
   - Compute **potential opponents remaining** = count of non-self players still to play this trick. With partner unrevealed, no other defender is confirmed as a teammate, so every yet-to-play seat is treated as a picker-team threat.
   - **Bot can play trump** (void in led suit, or trump led):
     - Threats remaining > 0 → take with **highest trump** in the winning set.
     - Threats remaining = 0 → take with the schmear-self pick using the **trump priority** (see below).
   - **Bot must follow a non-called fail suit** (only fail winners available):
     - Threats remaining > 0 → **skip** (an unrevealed opponent could be void and trump over). Fall through to default.
     - Threats remaining = 0 → take with the schmear-self pick using the **fail priority** (see below).
3. **Trump in on called suit**: If the called suit was led and the picker team is currently winning the trick, play the lowest available trump to contest.
4. **Otherwise**: play the lowest card.

**Schmear priority** (used by both the schmear branch above and the force-take branch's 0-threats-remaining cases): walk a rank-priority list and pick the first card found.
- **Trump priority**: A, 10, K, 9, 8, 7, J, Q. Within the same letter (only meaningful for J or Q), prefer the **weakest by trump rank** (e.g. among Qs: Q♦ before Q♥ before Q♠ before Q♣).
- **Fail priority**: A, 10, K, 9, 8, 7. Within the same rank (only meaningful for the schmear branch where the input may span multiple non-trump suits), prefer the card from the **shortest non-trump suit in hand** (move toward voiding); secondary tiebreak by suit alphabetical.

Rationale: cash high-point cards (A=11, 10=10, K=4) first; spend zero-point pip cards next; keep the tactically valuable Js and Qs in reserve.
```

- [ ] **Step 4.3: Update the Inference Helpers table to include the new helper**

Find the "Inference Helpers" table at the bottom of `docs/BOTS.md` (around line 120). After the row for `cheapestGuaranteedWin`, add:

```
| `pickBySchmearPriority` | Pick the least-painful winning card to spend, walking a rank-priority list (`A,10,K,9,8,7,J,Q` for trump; `A,10,K,9,8,7` for fail). Trump tiebreak: weakest trump rank. Fail tiebreak: shortest non-trump suit in hand, then alphabetical. |
```

- [ ] **Step 4.4: Sanity-check the updated doc by reading it end-to-end**

Read `docs/BOTS.md` in full and verify:
- The "Opponent bot following" section is internally consistent.
- The schmear-priority block is referenced correctly from both the schmear branch and the new force-take branch.
- The Inference Helpers table includes `pickBySchmearPriority`.
- No leftover references to "highest-value non-trump" in the schmear sub-bullet (replaced by "highest-priority non-trump per the schmear priority").

- [ ] **Step 4.5: Commit**

```bash
git add docs/BOTS.md
git commit -m "docs(bots): document defender force-take and schmear priority

Adds the new opponent-following branch to BOTS.md and centralizes the
'schmear priority' rank list used by both the schmear branch and the
new force-take branch. Updates the Inference Helpers table to include
pickBySchmearPriority."
```

---

## Final Verification

### Task 5: Whole-suite verification and summary

- [ ] **Step 5.1: Final full test run**

Run: `npm test`
Expected: All tests pass across both backend (`shared/`) and frontend suites.

- [ ] **Step 5.2: Visual diff of changes vs main**

Run: `git diff main --stat`
Expected: Changes confined to:
- `shared/botInference.js` (new helper)
- `shared/botStrategy.js` (import, two refactored closures, new branch)
- `shared/gameEngine.test.js` (helper tests, schmear tiebreak test, new branch tests, possibly a few existing-schmear test assertion updates)
- `docs/BOTS.md` (opponent-following section, helper table)
- `docs/superpowers/specs/2026-04-26-...` (already committed earlier in the brainstorming phase)
- `docs/superpowers/plans/2026-04-26-...` (this plan, committed once at task setup)

- [ ] **Step 5.3: Confirm BOTS.md / code consistency**

Re-read `docs/BOTS.md` "Opponent bot following" section and `shared/botStrategy.js` opponent-following code path side-by-side. Verify ordering of branches and conditions match exactly.

- [ ] **Step 5.4: Plan complete**

If all of the above pass, the plan is complete. Hand back to the user with:
- A short summary of what changed.
- Suggestion to manually playtest a hand or two to feel the new behavior in action.
- Note that the implementation is in worktree `.worktrees/bot-defender-force-take` on branch `feat/bot-defender-force-take-called-suit`; merging is a separate user decision.
