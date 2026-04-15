# Bot Strategy Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve play bot decision quality by extracting game-state inference into `shared/botInference.js` and using it to drive five targeted strategy enhancements: schmearing, void-aware discard, trump counting, smarter go-alone, and improved pick decision.

**Architecture:** A new `shared/botInference.js` module provides pure, independently-testable functions that derive facts from the bot's view (own hand + cards already played). `shared/botStrategy.js` imports these helpers and uses them to make smarter decisions. No other files change.

**Tech Stack:** Vanilla JS (ES modules), Vitest for tests, runs in Cloudflare Workers / Node environments.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `shared/botInference.js` | Create | Pure inference helpers — derives facts from game view |
| `shared/botStrategy.js` | Modify | Decision logic — imports inference helpers, thinner bodies |
| `shared/gameEngine.test.js` | Modify | All tests — add imports and describe blocks at bottom |

---

## Task 1: Trump tracking inference helpers

**Spec:** `countTrumpPlayed(view, userId)` and `trumpRemainingElsewhere(view, userId)`.

**Files:**
- Create: `shared/botInference.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Append to `shared/gameEngine.test.js`:

```js
// ─── botInference imports ─────────────────────────────────────────────────────
import {
  countTrumpPlayed, trumpRemainingElsewhere,
} from './botInference.js'

// ─── botInference helpers ─────────────────────────────────────────────────────
const trick = (plays) => ({ plays: plays.map(([uid, card]) => ({ userId: uid, card })), winner: plays[0][0] })

describe('countTrumpPlayed', () => {
  it('counts trump in completed tricks', () => {
    const view = {
      tricks: [trick([['p1', c('Q','C')], ['p2', c('A','H')], ['p3', c('7','C')], ['p4', c('8','S')], ['p5', c('9','C')]])],
      currentTrick: [],
      hands: { p1: [] },
    }
    // QC is trump, rest are not
    expect(countTrumpPlayed(view, 'p1')).toBe(1)
  })

  it('counts trump in currentTrick', () => {
    const view = {
      tricks: [],
      currentTrick: [{ userId: 'p2', card: c('J','C') }, { userId: 'p3', card: c('K','H') }],
      hands: { p1: [] },
    }
    // JC is trump, KH is not
    expect(countTrumpPlayed(view, 'p1')).toBe(1)
  })

  it('skips hidden plays', () => {
    const view = {
      tricks: [{ plays: [{ userId: 'p2', card: { id: 'UNDER_CARD', hidden: true } }], winner: 'p2' }],
      currentTrick: [],
      hands: { p1: [] },
    }
    expect(countTrumpPlayed(view, 'p1')).toBe(0)
  })

  it('returns 0 when no tricks played', () => {
    const view = { tricks: [], currentTrick: [], hands: { p1: [] } }
    expect(countTrumpPlayed(view, 'p1')).toBe(0)
  })
})

describe('trumpRemainingElsewhere', () => {
  it('subtracts own trump and played trump from 14', () => {
    // Own hand: QC, JC = 2 trump. Played: AD = 1 trump. Remaining = 14 - 2 - 1 = 11
    const view = {
      tricks: [trick([['p2', c('A','D')], ['p1', c('7','C')]])],
      currentTrick: [],
      hands: { p1: [c('Q','C'), c('J','C'), c('A','H'), c('K','S'), c('9','C'), c('8','S')] },
    }
    expect(trumpRemainingElsewhere(view, 'p1')).toBe(11)
  })

  it('returns 0 when all trump accounted for', () => {
    // 14 trump total. Own hand has 7 trump, played tricks show 7 trump = 14 total
    const trumpCards = ['QC','QS','QH','QD','JC','JS','JH']
    const playedTrumpCards = ['JD','AD','10D','KD','9D','8D','7D']
    const view = {
      tricks: [trick(playedTrumpCards.map(id => ['p2', { id, rank: id.replace(/[CSDH]/,''), suit: id.slice(-1) }]))],
      currentTrick: [],
      hands: { p1: trumpCards.map(id => ({ id, rank: id[0] === '1' ? '10' : id[0], suit: id.slice(-1) })) },
    }
    expect(trumpRemainingElsewhere(view, 'p1')).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: fails with "Cannot find module './botInference.js'"

- [ ] **Step 3: Create `shared/botInference.js` with trump tracking helpers**

```js
// ─── Bot Inference ────────────────────────────────────────────────────────────
// Pure functions that derive facts from a player's view (own hand + played cards).
// No decisions, no side effects. All functions receive a getPlayerView-redacted view.

import { isTrump, cardPoints, schwanzerCardPoints, effectiveSuit, trumpRank, suitRank } from './gameEngine.js'

// ─── Trump tracking ───────────────────────────────────────────────────────────

// Count trump cards visible in completed tricks and the current trick.
// Skips hidden/face-down plays the bot cannot see.
export function countTrumpPlayed(view, userId) {
  let count = 0
  for (const trick of (view.tricks ?? [])) {
    for (const play of trick.plays) {
      if (!play.card.hidden && isTrump(play.card)) count++
    }
  }
  for (const play of (view.currentTrick ?? [])) {
    if (!play.card.hidden && isTrump(play.card)) count++
  }
  return count
}

// Estimate trump still held by players other than userId.
// Formula: 14 total − own trump − trump seen in tricks.
// A result ≤ 2 means opponents are likely trump-exhausted.
export function trumpRemainingElsewhere(view, userId) {
  const myTrump = (view.hands[userId] ?? []).filter(c => !c.hidden && isTrump(c)).length
  return 14 - myTrump - countTrumpPlayed(view, userId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all new tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/botInference.js shared/gameEngine.test.js
git commit -m "feat: add trump tracking inference helpers (countTrumpPlayed, trumpRemainingElsewhere)"
```

---

## Task 2: Hand evaluation inference helpers

**Spec:** `buriablePoints(hand)` and `handScore(hand)` — used by `decidePick`.

**Files:**
- Modify: `shared/botInference.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Append to `shared/gameEngine.test.js`, adding `buriablePoints, handScore` to the existing botInference import:

```js
// Update the existing botInference import line to:
import {
  countTrumpPlayed, trumpRemainingElsewhere,
  buriablePoints, handScore,
} from './botInference.js'
```

Then append the describe blocks:

```js
describe('buriablePoints', () => {
  it('returns sum of top 2 non-trump cards by point value', () => {
    // AC=11, 10H=10, KS=4 → top 2 are AC + 10H = 21
    const hand = [c('Q','C'), c('J','S'), c('A','C'), c('10','H'), c('K','S'), c('9','C')]
    expect(buriablePoints(hand)).toBe(21)
  })

  it('returns 0 when fewer than 2 non-trump cards exist', () => {
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','S'), c('A','D'), c('10','D')]
    expect(buriablePoints(hand)).toBe(0)
  })

  it('returns sum of only non-trump cards when exactly 2 non-trump exist', () => {
    // KS=4, 9C=0 → 4
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','S'), c('K','S'), c('9','C')]
    expect(buriablePoints(hand)).toBe(4)
  })
})

describe('handScore', () => {
  it('picks hand with score >= 24 (6 schwanzer pts, 0 burial → score 24)', () => {
    // QC=3, QS=3 = 6 schwanzer pts; no non-trump → buriable=0; score = 6*4+0 = 24
    const hand = [c('Q','C'), c('Q','S'), c('A','D'), c('10','D'), c('9','D'), c('8','D')]
    expect(handScore(hand)).toBeGreaterThanOrEqual(24)
  })

  it('passes hand with score < 24 (5 schwanzer pts, 0 burial → score 20)', () => {
    // QC=3, JC=2 = 5 schwanzer pts; no non-trump → buriable=0; score = 5*4+0 = 20
    const hand = [c('Q','C'), c('J','C'), c('A','D'), c('10','D'), c('9','D'), c('8','D')]
    expect(handScore(hand)).toBeLessThan(24)
  })

  it('picks hand with 5 schwanzer pts + two aces to bury (score 20 + 22 = 42)', () => {
    // QC=3, JC=2 = 5 schwanzer pts; AC=11, AH=11 → buriable=22; score = 5*4+22 = 42
    const hand = [c('Q','C'), c('J','C'), c('A','D'), c('A','C'), c('A','H'), c('8','S')]
    expect(handScore(hand)).toBeGreaterThanOrEqual(24)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: fails with "buriablePoints is not a function"

- [ ] **Step 3: Add helpers to `shared/botInference.js`**

Append to `shared/botInference.js` after the trump tracking section:

```js
// ─── Hand evaluation ──────────────────────────────────────────────────────────

// Sum of card points for the top 2 non-trump cards in hand.
// Returns 0 if fewer than 2 non-trump cards exist.
export function buriablePoints(hand) {
  const nonTrump = hand.filter(c => !c.hidden && !isTrump(c))
  const sorted = [...nonTrump].sort((a, b) => cardPoints(b) - cardPoints(a))
  return sorted.slice(0, 2).reduce((sum, c) => sum + cardPoints(c), 0)
}

// Combined hand quality score for the pick decision.
// schwanzerPts * 4 + buriablePoints. Threshold: >= 24 → pick.
// Constants are tunable — adjust PICK_THRESHOLD in decidePick if needed.
export function handScore(hand) {
  const schwanzerPts = hand.reduce((sum, c) => sum + schwanzerCardPoints(c), 0)
  return schwanzerPts * 4 + buriablePoints(hand)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/botInference.js shared/gameEngine.test.js
git commit -m "feat: add hand evaluation inference helpers (buriablePoints, handScore)"
```

---

## Task 3: Move currentWinner to botInference, add teammateWinning

**Spec:** Move `beats` and `currentWinner` from `botStrategy.js` to `botInference.js` (they are inference, not decisions). Add `teammateWinning(view, userId)`.

**Files:**
- Modify: `shared/botInference.js`
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Update the botInference import in `shared/gameEngine.test.js`:

```js
import {
  countTrumpPlayed, trumpRemainingElsewhere,
  buriablePoints, handScore,
  currentWinner, teammateWinning,
} from './botInference.js'
```

Append describe blocks:

```js
describe('currentWinner', () => {
  it('returns the play with the highest trump when trump is led', () => {
    const plays = [
      { userId: 'p1', card: c('Q','C') },
      { userId: 'p2', card: c('J','C') },
      { userId: 'p3', card: c('A','D') },
    ]
    expect(currentWinner(plays).userId).toBe('p1')
  })

  it('returns the play with the highest led-suit card when no trump played', () => {
    const plays = [
      { userId: 'p1', card: c('K','H') },
      { userId: 'p2', card: c('A','H') },
      { userId: 'p3', card: c('9','H') },
    ]
    expect(currentWinner(plays).userId).toBe('p2')
  })

  it('trump beats led suit', () => {
    const plays = [
      { userId: 'p1', card: c('A','H') },
      { userId: 'p2', card: c('7','D') },  // 7D is trump (diamond pip)
    ]
    expect(currentWinner(plays).userId).toBe('p2')
  })
})

describe('teammateWinning', () => {
  it('returns true when picker is winning and bot is the partner', () => {
    const view = {
      currentTrick: [{ userId: 'p1', card: c('Q','C') }],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p2')).toBe(true)
  })

  it('returns true when partner is winning and bot is the picker', () => {
    const view = {
      currentTrick: [{ userId: 'p2', card: c('Q','C') }],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(true)
  })

  it('returns false when an opponent is winning and bot is on picker team', () => {
    const view = {
      currentTrick: [{ userId: 'p3', card: c('Q','C') }],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(false)
  })

  it('returns true when fellow opponent is winning and partner is known', () => {
    const view = {
      currentTrick: [{ userId: 'p4', card: c('Q','C') }],
      picker: 'p1',
      partner: 'p2',  // partner is revealed/known to this bot
    }
    expect(teammateWinning(view, 'p3')).toBe(true)
  })

  it('returns false when opponent bot cannot identify partner (partner null)', () => {
    const view = {
      currentTrick: [{ userId: 'p4', card: c('Q','C') }],
      picker: 'p1',
      partner: null,  // partner unrevealed — unsafe to schmear
    }
    expect(teammateWinning(view, 'p3')).toBe(false)
  })

  it('returns false when trick is empty (leading)', () => {
    const view = {
      currentTrick: [],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: fails with "currentWinner is not a function" and "teammateWinning is not a function"

- [ ] **Step 3: Add to `shared/botInference.js`**

Append to `shared/botInference.js`:

```js
// ─── Trick evaluation ─────────────────────────────────────────────────────────

// Internal: returns true if challenger beats current winner in the context of ledSuit.
function beats(challenger, current, ledSuit) {
  if (!current || current.hidden || current.faceDown) return true
  const cTrump = isTrump(challenger)
  const wTrump = isTrump(current)
  if (cTrump && !wTrump) return true
  if (!cTrump && wTrump) return false
  if (cTrump && wTrump) return trumpRank(challenger) < trumpRank(current)
  const cIsLed = challenger.suit === ledSuit
  const wIsLed = current.suit === ledSuit
  if (cIsLed && !wIsLed) return true
  if (!cIsLed && wIsLed) return false
  if (challenger.suit !== current.suit) return false
  return suitRank(challenger) < suitRank(current)
}

// Returns the play object currently winning the trick (array of {userId, card}).
// Used by both botStrategy.js (following logic) and teammateWinning.
export function currentWinner(trick) {
  if (!trick || trick.length === 0) return null
  const first = trick[0]
  const ledSuit = first.declaredSuit ?? effectiveSuit(first.card)
  let winner = trick[0]
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, winner.card, ledSuit)) winner = trick[i]
  }
  return winner
}

// ─── Schmear detection ────────────────────────────────────────────────────────

// Returns true if the player currently winning the trick is on the same team as userId.
// Picker-team bots: teammate = picker or partner.
// Opponent bots: teammate = any player who is neither picker nor partner.
//   If partner is null (unrevealed/unknown to this bot), returns false — unsafe to schmear.
export function teammateWinning(view, userId) {
  const { currentTrick, picker, partner } = view
  if (!currentTrick || currentTrick.length === 0) return false

  const winner = currentWinner(currentTrick)
  if (!winner) return false
  const winnerId = winner.userId

  const onPickerTeam = userId === picker || userId === partner

  if (onPickerTeam) {
    return winnerId === picker || winnerId === partner
  } else {
    // Only schmear when partner identity is known — avoid donating points to partner's trick
    if (partner === null) return false
    return winnerId !== picker && winnerId !== partner
  }
}
```

- [ ] **Step 4: Remove `beats` and `currentWinner` from `shared/botStrategy.js` and import from botInference**

In `shared/botStrategy.js`, find and **remove** these two functions (lines ~75–99):

```js
function beats(challenger, current, ledSuit) {
  // ... (the entire function body)
}

function currentWinner(trick) {
  // ... (the entire function body)
}
```

Then add to the imports at the top of `shared/botStrategy.js`:

```js
import {
  decidePick, decideBlitz, decideDiscard, decideCall, decidePlay,
} from '../../shared/botStrategy.js'
```

Wait — that's the wrong file. Add to the imports at the top of `shared/botStrategy.js`:

```js
import { currentWinner } from './botInference.js'
```

The existing import block in `botStrategy.js` looks like:

```js
import {
  isTrump, cardPoints, effectiveSuit, trumpRank, suitRank, schwanzerCardPoints,
} from './gameEngine.js'
```

Add after it:

```js
import { currentWinner } from './botInference.js'
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass (currentWinner and teammates tests pass; existing tests unaffected)

- [ ] **Step 6: Commit**

```bash
git add shared/botInference.js shared/botStrategy.js shared/gameEngine.test.js
git commit -m "refactor: move beats/currentWinner to botInference, add teammateWinning"
```

---

## Task 4: Add bestVoidDiscard inference helper

**Spec:** `bestVoidDiscard(hand)` — returns 2-card burial that voids a suit with ≥11 pts total, or `null`.

**Files:**
- Modify: `shared/botInference.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Update the botInference import in `shared/gameEngine.test.js`:

```js
import {
  countTrumpPlayed, trumpRemainingElsewhere,
  buriablePoints, handScore,
  currentWinner, teammateWinning,
  bestVoidDiscard,
} from './botInference.js'
```

Append describe block:

```js
describe('bestVoidDiscard', () => {
  it('returns 2-card IDs that void a suit when burial total >= 11', () => {
    // AC + KC in clubs → 11+4=15 pts, void clubs
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('K','C'), c('9','H'), c('8','S'), c('7','S')]
    const result = bestVoidDiscard(hand)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    expect(result).toContain('AC')
    expect(result).toContain('KC')
  })

  it('returns null when no suit can be voided with >= 11 pts', () => {
    // Clubs: 7C + 8C = 0+0 = 0 pts — does not qualify
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('10','D'), c('7','C'), c('8','C'), c('9','H'), c('7','H')]
    expect(bestVoidDiscard(hand)).toBeNull()
  })

  it('handles 1-card suit: pairs with highest-point filler from another suit', () => {
    // Spades: only KS (4 pts). Filler: AH (11 pts). Total = 15 → qualifies
    const hand = [c('Q','C'), c('J','C'), c('A','D'), c('10','D'), c('K','S'), c('A','H'), c('8','C'), c('7','C')]
    const result = bestVoidDiscard(hand)
    expect(result).not.toBeNull()
    expect(result).toContain('KS')
    expect(result).toContain('AH')
  })

  it('does not void a suit that requires 3+ cards to clear', () => {
    // Clubs: AC, 10C, KC — 3 cards, burying 2 won't void
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('10','C'), c('K','C'), c('9','H'), c('7','H')]
    // No 2-card void available — all suits have 3 cards or are trump
    expect(bestVoidDiscard(hand)).toBeNull()
  })

  it('excludes mustHold cards (picker holds all 3 fail aces)', () => {
    // Picker holds AC, AH, AS — mustHold kicks in. Cannot bury AC.
    const hand = [c('Q','C'), c('J','S'), c('A','C'), c('A','H'), c('A','S'), c('K','C'), c('9','D'), c('8','D')]
    // AC is mustHold, so clubs can't be voided with AC
    // KC alone in clubs + filler needed: KC (4) + next best non-mustHold non-trump
    // 9D and 8D are trump. No other non-trump eligible. Result: null
    expect(bestVoidDiscard(hand)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: fails with "bestVoidDiscard is not a function"

- [ ] **Step 3: Add `bestVoidDiscard` to `shared/botInference.js`**

Append to `shared/botInference.js`:

```js
// ─── Void analysis ────────────────────────────────────────────────────────────

// Returns 2 card IDs whose burial voids a non-trump suit with combined points >= 11,
// or null if no qualifying void exists. Respects mustHold restrictions (same logic
// as decideDiscard in botStrategy.js).
//
// For a 1-card suit, the second burial card is the highest-point eligible card
// from any other suit (chosen for point value, not secondary voiding).
// Among qualifying pairs, returns the highest-total pair.
export function bestVoidDiscard(hand) {
  const failAces = ['AC', 'AH', 'AS']
  const failTens = ['10C', '10H', '10S']
  const holdsAllAces = failAces.every(id => hand.some(c => c.id === id))
  const holdsAllTens = failTens.every(id => hand.some(c => c.id === id))

  let mustHold = []
  if (holdsAllAces && holdsAllTens) mustHold = [...failAces, ...failTens]
  else if (holdsAllAces) mustHold = [...failAces]

  const eligible = hand.filter(c => !isTrump(c) && !mustHold.includes(c.id))

  const bySuit = {}
  for (const card of eligible) {
    if (!bySuit[card.suit]) bySuit[card.suit] = []
    bySuit[card.suit].push(card)
  }

  let bestPair = null
  let bestTotal = 10  // threshold is > 10, i.e., >= 11

  for (const [suit, cards] of Object.entries(bySuit)) {
    if (cards.length === 1) {
      // Need a filler card from another suit
      const filler = eligible
        .filter(c => c.suit !== suit)
        .sort((a, b) => cardPoints(b) - cardPoints(a))[0]
      if (!filler) continue
      const total = cardPoints(cards[0]) + cardPoints(filler)
      if (total > bestTotal) {
        bestTotal = total
        bestPair = [cards[0].id, filler.id]
      }
    } else if (cards.length === 2) {
      const total = cardPoints(cards[0]) + cardPoints(cards[1])
      if (total > bestTotal) {
        bestTotal = total
        bestPair = [cards[0].id, cards[1].id]
      }
    }
    // 3+ cards: burying 2 won't void the suit — skip
  }

  return bestPair
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/botInference.js shared/gameEngine.test.js
git commit -m "feat: add bestVoidDiscard inference helper"
```

---

## Task 5: Update decidePick to use handScore

**Spec:** Replace tiered schwanzer thresholds with `handScore(hand) >= 24`.

**Files:**
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Append to `shared/gameEngine.test.js` — add botStrategy imports:

```js
import { decidePick } from './botStrategy.js'
```

Append describe block:

```js
describe('decidePick', () => {
  // handScore = schwanzerPts * 4 + buriablePoints. Threshold = 24.

  it('picks when score >= 24 (6 schwanzer pts, 0 burial = 24)', () => {
    // QC=3, QS=3 → 6 schwanzer pts; all trump, no burial → score = 24
    const hand = [c('Q','C'), c('Q','S'), c('A','D'), c('10','D'), c('9','D'), c('8','D')]
    const view = { hands: { p1: hand } }
    expect(decidePick(view, 'p1')).toBe(true)
  })

  it('passes when score < 24 (5 schwanzer pts, 0 burial = 20)', () => {
    // QC=3, JC=2 → 5 schwanzer pts; no burial → score = 20
    const hand = [c('Q','C'), c('J','C'), c('A','D'), c('10','D'), c('9','D'), c('8','D')]
    const view = { hands: { p1: hand } }
    expect(decidePick(view, 'p1')).toBe(false)
  })

  it('picks when 5 schwanzer pts + two aces buried (score = 42)', () => {
    // QC=3, JC=2 → 5 schwanzer pts; AC=11, AH=11 → buriable=22; score = 42
    const hand = [c('Q','C'), c('J','C'), c('A','D'), c('A','C'), c('A','H'), c('8','S')]
    const view = { hands: { p1: hand } }
    expect(decidePick(view, 'p1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: the 5-schwanzer-pts-no-burial test currently passes (old code would pick at 5 pts unconditionally) — run to confirm mismatch

- [ ] **Step 3: Update `decidePick` in `shared/botStrategy.js`**

Add `handScore` to the botInference import at the top of `botStrategy.js`:

```js
import { currentWinner, handScore } from './botInference.js'
```

Replace the entire `decidePick` function body:

```js
export function decidePick(view, userId) {
  const hand = view.hands[userId]
  return handScore(hand) >= 24
}
```

Remove the now-unused `schwanzerCardPoints` from the gameEngine import in `botStrategy.js` if it's no longer used elsewhere in the file. Check first: `grep schwanzerCardPoints shared/botStrategy.js` — if only in `decidePick`, remove it from the import.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat: update decidePick to use combined handScore threshold"
```

---

## Task 6: Update decideDiscard to use bestVoidDiscard

**Spec:** Attempt a void burial before falling through to greedy sort.

**Files:**
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Update the botStrategy import in `shared/gameEngine.test.js`:

```js
import { decidePick, decideDiscard } from './botStrategy.js'
```

Append describe block:

```js
describe('decideDiscard', () => {
  it('buries void pair when suit can be voided with >= 11 pts', () => {
    // After picking up blind: has AC + KC in clubs (15 pts) — should void clubs
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('K','C'), c('9','H'), c('8','S'), c('7','S')]
    const view = { hands: { p1: hand }, discard: [] }
    const result = decideDiscard(view, 'p1')
    expect(result).toHaveLength(2)
    expect(result).toContain('AC')
    expect(result).toContain('KC')
  })

  it('falls back to greedy (high-point non-trump) when no qualifying void', () => {
    // No suit can be voided with >= 11 pts — greedy buries AC then 10H
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('10','H'), c('9','H'), c('8','S'), c('7','S')]
    // Clubs: only AC (1 card), spades: 8S+7S (0 pts), hearts: 10H+9H (10 pts < 11)
    // No qualifying void → greedy → AC + 10H
    const view = { hands: { p1: hand }, discard: [] }
    const result = decideDiscard(view, 'p1')
    expect(result).toContain('AC')
    expect(result).toContain('10H')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: void test fails (current code ignores void logic)

- [ ] **Step 3: Update `decideDiscard` in `shared/botStrategy.js`**

Add `bestVoidDiscard` to the botInference import:

```js
import { currentWinner, handScore, bestVoidDiscard } from './botInference.js'
```

At the top of `decideDiscard`, before the existing `candidates` sort, insert:

```js
export function decideDiscard(view, userId) {
  const hand = view.hands[userId]  // 8 cards after picking up blind

  const voidCards = bestVoidDiscard(hand)
  if (voidCards) return voidCards

  // Replicate mustHold logic from gameEngine.discard to avoid illegal discards
  // ... (rest of existing function unchanged)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat: update decideDiscard to prefer void burial when >= 11 pts"
```

---

## Task 7: Update decideCall to go alone with dominant hand

**Spec:** Go alone when hand has ≥6 trump AND ≥2 queens, before evaluating any call type.

**Files:**
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Update the botStrategy import:

```js
import { decidePick, decideDiscard, decideCall } from './botStrategy.js'
```

Append describe block:

```js
describe('decideCall go-alone', () => {
  it('goes alone with 6 trump and 2 queens', () => {
    // QC, QS (2 queens), JC, JH, AD, 10D = 6 trump total
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','H'), c('A','D'), c('10','D')]
    const view = {
      callMode: 'ace',
      hands: { p1: hand },
      discard: [],
    }
    expect(decideCall(view, 'p1').type).toBe('alone')
  })

  it('does not go alone with only 1 queen even if 6 trump', () => {
    // QC (1 queen), JC, JS, JH, JD, AD = 6 trump — not enough queens
    const hand = [c('Q','C'), c('J','C'), c('J','S'), c('J','H'), c('J','D'), c('A','D')]
    const view = {
      callMode: 'ace',
      hands: { p1: hand },
      discard: [],
    }
    expect(decideCall(view, 'p1').type).not.toBe('alone')
  })

  it('does not go alone with 2 queens but only 5 trump', () => {
    // QC, QS (2 queens), JC, AD, 10D = 5 trump; AH is fail
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('A','D'), c('10','D'), c('A','H')]
    const view = {
      callMode: 'ace',
      hands: { p1: hand },
      discard: [],
    }
    expect(decideCall(view, 'p1').type).not.toBe('alone')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: go-alone test fails (current code never proactively goes alone)

- [ ] **Step 3: Update `decideCall` in `shared/botStrategy.js`**

At the very top of the `decideCall` function body, before accessing `callMode`, add:

```js
export function decideCall(view, userId) {
  const { callMode, hands, discard: discardCards } = view
  const hand = hands[userId]

  // Go alone with a dominant trump hand
  const trumpCount = hand.filter(c => isTrump(c)).length
  const queenCount = hand.filter(c => c.rank === 'Q').length
  if (trumpCount >= 6 && queenCount >= 2) return { type: 'alone' }

  // ... rest of existing function unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat: update decideCall to go alone with dominant trump hand"
```

---

## Task 8: Update decidePlay for schmearing

**Spec:** When a teammate is winning the current trick and the bot is following, dump the highest-point non-trump card instead of the lowest. Applies to both picker team and opponent team. Does not burn trump to schmear.

**Files:**
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Update the botStrategy import:

```js
import { decidePick, decideDiscard, decideCall, decidePlay } from './botStrategy.js'
```

Append describe block:

```js
describe('decidePlay schmearing', () => {
  // Build a minimal view for following a trick where a teammate is winning
  function makeFollowView({ userId, picker, partner, trickWinner, trickCard, handCards }) {
    return {
      hands: { [userId]: handCards },
      currentTrick: [{ userId: trickWinner, card: trickCard }],
      tricks: [],
      picker,
      partner,
      isLeaster: false,
      phase: 'playing',
    }
  }

  it('picker-team bot dumps highest non-trump when partner is winning', () => {
    // Bot is picker (p1). Partner (p2) is winning with QC.
    // Hand: AC (11 pts), KH (4 pts), 9S (0 pts) — must follow, all are legal off-suit
    const view = makeFollowView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      trickWinner: 'p2',
      trickCard: c('Q','C'),
      handCards: [c('A','C'), c('K','H'), c('9','S')],
    })
    // Led suit is trump (QC). p1 has no trump (AC etc are fail clubs/hearts/spades).
    // All cards are off-suit legal. Should schmear with AC (highest non-trump = 11 pts).
    expect(decidePlay(view, 'p1')).toBe('AC')
  })

  it('opponent bot dumps highest non-trump when fellow opponent is winning and partner is known', () => {
    // Bot is p3 (opponent). p4 (fellow opponent) is winning. Partner is p2 (revealed).
    // Hand: AH (11), 9S (0), 8S (0) — all off-suit legal
    const view = makeFollowView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      trickWinner: 'p4',
      trickCard: c('Q','C'),
      handCards: [c('A','H'), c('9','S'), c('8','S')],
    })
    expect(decidePlay(view, 'p3')).toBe('AH')
  })

  it('does not burn trump to schmear — plays lowest when only trump is legal', () => {
    // Bot is picker (p1), partner (p2) winning with QC.
    // Bot must follow trump (trump was led, bot has only trump)
    const view = makeFollowView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      trickWinner: 'p2',
      trickCard: c('Q','C'),
      handCards: [c('J','D'), c('7','D')],  // only trump
    })
    // Must follow trump. Should play lowest (7D), not burn JD
    expect(decidePlay(view, 'p1')).toBe('7D')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: schmear tests fail (current code plays lowest card on teammate wins)

- [ ] **Step 3: Update `decidePlay` in `shared/botStrategy.js`**

Add `teammateWinning` to the botInference import:

```js
import { currentWinner, handScore, bestVoidDiscard, teammateWinning } from './botInference.js'
```

In the following-trick section of `decidePlay`, replace both teammate-winning branches:

**Picker team section** — replace:
```js
const teammateWinning = winner && (winner.userId === picker || winner.userId === partner)
if (teammateWinning) return lowestCard(realCards).id
```

With:
```js
if (teammateWinning(view, userId)) {
  const nonTrump = realCards.filter(c => !isTrump(c))
  if (nonTrump.length > 0) return highestValueCard(nonTrump).id
  return lowestCard(realCards).id  // only trump available — don't burn trump to schmear
}
```

**Opponent section** — replace:
```js
} else {
  // Opponent: play low by default
  return lowestCard(realCards).id
}
```

With:
```js
} else {
  // Opponent: schmear on confirmed teammate wins; otherwise play low
  if (teammateWinning(view, userId)) {
    const nonTrump = realCards.filter(c => !isTrump(c))
    if (nonTrump.length > 0) return highestValueCard(nonTrump).id
    return lowestCard(realCards).id
  }
  return lowestCard(realCards).id
}
```

Also remove the now-unused local `winner` variable that was only used for the old `teammateWinning` check — check if `winner` is still used elsewhere in `decidePlay` before removing.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat: update decidePlay to schmear high-point cards on teammate wins"
```

---

## Task 9: Update decidePlay for trump counting

**Spec:** When leading, if `trumpRemainingElsewhere <= 2`, lead a fail Ace instead of the default lead. Applies to both picker team (who would otherwise lead trump) and opponents (who would otherwise lead lowest non-trump).

**Files:**
- Modify: `shared/botStrategy.js`
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests**

Append describe block to `shared/gameEngine.test.js`:

```js
describe('decidePlay trump counting', () => {
  // Build a view where trump is nearly exhausted
  function makeTrumpExhaustedView({ userId, picker, partner, handCards, trumpPlayed }) {
    // trumpPlayed: array of card objects already seen in tricks
    return {
      hands: { [userId]: handCards },
      currentTrick: [],  // leading
      tricks: trumpPlayed.length > 0
        ? [{ plays: trumpPlayed.map(card => ({ userId: 'other', card })), winner: 'other' }]
        : [],
      picker,
      partner,
      isLeaster: false,
      phase: 'playing',
    }
  }

  it('picker team leads fail Ace instead of trump when opponents exhausted', () => {
    // Bot is picker. Hand: QC (trump), AC (fail ace), KH (fail).
    // Own trump: 1 (QC). Played trump: 13 (all others). Remaining elsewhere = 14 - 1 - 13 = 0.
    const playedTrump = ['QS','QH','QD','JC','JS','JH','JD','AD','10D','KD','9D','8D','7D']
      .map(id => ({ id, rank: id.replace(/[CSDH]/g,'').replace(/^1/,'10'), suit: id.slice(-1) }))
    const view = makeTrumpExhaustedView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('Q','C'), c('A','C'), c('K','H')],
      trumpPlayed: playedTrump,
    })
    // trumpRemainingElsewhere = 14 - 1 - 13 = 0 ≤ 2 → lead fail Ace (AC)
    expect(decidePlay(view, 'p1')).toBe('AC')
  })

  it('picker team leads highest trump normally when opponents not exhausted', () => {
    // Same hand, but no trump played yet → remaining = 14 - 1 - 0 = 13 > 2
    const view = makeTrumpExhaustedView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('Q','C'), c('A','C'), c('K','H')],
      trumpPlayed: [],
    })
    // Normal lead: highest trump = QC
    expect(decidePlay(view, 'p1')).toBe('QC')
  })

  it('opponent leads fail Ace when picker team exhausted', () => {
    // Bot is p3 (opponent). Hand: AH (fail ace), 9S, 8C.
    // Own trump: 0. Played trump: 13. Remaining = 14 - 0 - 13 = 1 ≤ 2 → lead AH
    const playedTrump = ['QC','QS','QH','QD','JC','JS','JH','JD','AD','10D','KD','9D','8D']
      .map(id => ({ id, rank: id.replace(/[CSDH]/g,'').replace(/^1/,'10'), suit: id.slice(-1) }))
    const view = makeTrumpExhaustedView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('A','H'), c('9','S'), c('8','C')],
      trumpPlayed: playedTrump,
    })
    expect(decidePlay(view, 'p3')).toBe('AH')
  })

  it('opponent leads lowest non-trump normally when trump not exhausted', () => {
    const view = makeTrumpExhaustedView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('A','H'), c('9','S'), c('8','C')],
      trumpPlayed: [],
    })
    // Normal opponent lead: lowest non-trump = 8C (0 pts) or 9S (0 pts)
    // lowestCard prefers lowest points → 8C or 9S (both 0, tie broken by non-trump first)
    const result = decidePlay(view, 'p3')
    expect(['8C', '9S']).toContain(result)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: trump counting tests fail (current code ignores trump count when leading)

- [ ] **Step 3: Update `decidePlay` in `shared/botStrategy.js`**

Add `trumpRemainingElsewhere` to the botInference import:

```js
import { currentWinner, handScore, bestVoidDiscard, teammateWinning, trumpRemainingElsewhere } from './botInference.js'
```

In the `isLeading` branch of `decidePlay`, update both sub-branches:

**Picker team leading** — insert before `const best = highestTrump(realCards)`:

```js
if (isLeading) {
  if (isPickerTeam) {
    // Cash a fail Ace when opponents are likely trump-exhausted
    if (trumpRemainingElsewhere(view, userId) <= 2) {
      const failAces = realCards.filter(c => !isTrump(c) && c.rank === 'A')
      if (failAces.length > 0) return failAces[0].id
    }
    // Lead strongest trump to win tricks and accumulate points
    const best = highestTrump(realCards)
    if (best) return best.id
    // No trump; lead highest-value fail card
    return highestValueCard(realCards).id
  } else {
    // Cash a fail Ace when picker team is likely trump-exhausted
    if (trumpRemainingElsewhere(view, userId) <= 2) {
      const failAces = realCards.filter(c => !isTrump(c) && c.rank === 'A')
      if (failAces.length > 0) return failAces[0].id
    }
    // Opponent: lead a non-trump to avoid burning trump while looking for called suit
    const nonTrump = realCards.filter(c => !isTrump(c))
    if (nonTrump.length > 0) return lowestCard(nonTrump).id
    return lowestCard(realCards).id
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat: update decidePlay to lead fail Aces when trump is exhausted"
```

---

## Self-Review Checklist

- [x] Spec §trump tracking → Tasks 1, 9
- [x] Spec §hand evaluation → Task 2, 5
- [x] Spec §schmear detection → Task 3, 8
- [x] Spec §void analysis → Task 4, 6
- [x] Spec §decideCall go-alone → Task 7
- [x] Spec §beats/currentWinner moved to inference → Task 3
- [x] No TBDs or placeholders
- [x] Function names consistent across all tasks: `countTrumpPlayed`, `trumpRemainingElsewhere`, `buriablePoints`, `handScore`, `currentWinner`, `teammateWinning`, `bestVoidDiscard`
- [x] Import lists updated in each task that adds a new function
- [x] `schwanzerCardPoints` removal from botStrategy checked in Task 5 step 3
