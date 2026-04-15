# Bot Strategy Improvements — Design Spec

**Date:** 2026-04-14
**Issue:** #82
**Scope:** `shared/botInference.js` (new), `shared/botStrategy.js` (enhanced), `shared/gameEngine.test.js` (new tests)

---

## Overview

Improve play bot decision quality by extracting game-state inference into a dedicated module and using it to drive five targeted strategy enhancements:

1. Schmearing — dump high-point cards on teammate's winning tricks
2. Void-aware discard — prefer burying cards that void a suit (≥11 pts threshold)
3. Trump counting — lead fail Aces safely when opponents are trump-exhausted
4. Smarter go-alone — go alone when hand is dominant
5. Improved pick decision — combined hand score replacing schwanzer-only threshold

Bots have no knowledge beyond their own hand and cards already played (via `view.tricks`, `view.currentTrick`). All inference is derived from that information only.

---

## File Structure

| File | Change |
|------|--------|
| `shared/botInference.js` | New file — pure inference helpers |
| `shared/botStrategy.js` | Enhanced — imports from botInference, thinner decision logic |
| `shared/gameEngine.test.js` | New tests for inference helpers and strategy decisions |
| Everything else | Unchanged |

---

## `shared/botInference.js`

Pure functions only. No side effects, no decisions. All exported for independent testing.

### Trump tracking

**`countTrumpPlayed(view, userId)`**
Counts trump cards visible to `userId` across `view.tricks` and `view.currentTrick`. Skips plays with `hidden: true` (face-down under-card plays not visible to this bot). Returns a number 0–14.

**`trumpRemainingElsewhere(view, userId)`**
Estimates trump still held by other players:
```
14 - trumpInMyHand(view, userId) - countTrumpPlayed(view, userId)
```
Where `trumpInMyHand` counts trump in `view.hands[userId]`. Returns a number ≥ 0.

"Opponents likely trump-exhausted" threshold: `trumpRemainingElsewhere <= 2`.

Note: the buried discard is unknown, so a small margin of error is accepted. Two or fewer remaining is conservative enough to act on.

---

### Hand evaluation

**`buriablePoints(hand)`**
Takes an array of card objects. Returns the sum of card points for the top 2 non-trump cards sorted by `cardPoints` descending. Returns 0 if fewer than 2 non-trump cards exist. Range: 0–22.

**`handScore(hand)`**
Combined pick-quality score:
```
schwanzerPts(hand) * 4 + buriablePoints(hand)
```
Where `schwanzerPts` sums `schwanzerCardPoints` across the hand.

Pick threshold: **≥ 24**.

Calibration reference:
- 6 schwanzer pts, 0 burial → 24 (picks)
- 5 schwanzer pts, 22 burial (two aces) → 42 (picks)
- 5 schwanzer pts, 0 burial → 20 (passes)
- 7 schwanzer pts, 0 burial → 28 (picks)

Constants (`4`, `24`) are tunable without changing the interface.

---

### Schmear detection

**`teammateWinning(view, userId)`**
Returns `true` if the current trick's leading winner is on the same team as `userId`.

Team assignment:
- If `userId === view.picker` or `userId === view.partner` → picker team. Teammate wins if the winning play belongs to the other picker-team member.
- Otherwise → opponent team. Teammate wins if the winning play belongs to any player who is neither picker nor known partner (`view.partner` may be `null` if unrevealed/not visible).

Uses the existing `currentWinner` logic (same as the helper already in `botStrategy.js`).

---

### Void analysis

**`bestVoidDiscard(hand)`**
Finds the best 2-card burial that voids a non-trump suit.

Algorithm:
1. For each non-trump suit, find cards of that suit in `hand` that are not mustHold (replicate mustHold logic from `decideDiscard`).
2. If the suit has exactly 1 eligible card: pair it with the highest-point eligible non-trump card from another suit. Total = sum of both cards' points.
3. If the suit has exactly 2 eligible cards: total = sum of both.
4. If the suit has 3+ eligible cards: skip (burying 2 doesn't void it).
5. The filler card (1-card suit case) is chosen for point value only — it does not need to come from a suit that would itself be voided.
6. Among all candidate pairs with total ≥ 11, pick the pair with the highest total.
6. Return the card IDs (length 2), or `null` if no qualifying pair found.

---

## `shared/botStrategy.js` Changes

### `decidePick`

Replace tiered schwanzer thresholds with single condition:

```js
return handScore(hand) >= 24
```

`decideBlitz` is unchanged.

### `decideDiscard`

Before existing greedy sort, attempt a void:

```js
const voidCards = bestVoidDiscard(hand)
if (voidCards) return voidCards
// existing greedy logic follows
```

### `decideCall`

Add going-alone check at the top, before any call type is evaluated:

```js
const trumpCount = hand.filter(c => isTrump(c)).length
const queenCount = hand.filter(c => c.rank === 'Q').length
if (trumpCount >= 6 && queenCount >= 2) return { type: 'alone' }
```

Existing ace/ten/king/alone fallback logic follows unchanged.

### `decidePlay`

Three additions, in order of evaluation:

**1. Schmearing (following only)**

After the existing `isLeading` check, when following a trick and `teammateWinning(view, userId)` is true:

```js
const nonTrump = realCards.filter(c => !isTrump(c))
if (nonTrump.length > 0) return highestValueCard(nonTrump).id
// only trump available — fall through to normal following logic
```

Applied to both picker team and opponent team followers. Does not burn trump to schmear.

**2. Trump counting — picker team leading**

In the existing picker-team lead branch, before leading highest trump:

```js
if (trumpRemainingElsewhere(view, userId) <= 2) {
  const failAces = realCards.filter(c => !isTrump(c) && c.rank === 'A')
  if (failAces.length > 0) return failAces[0].id
}
// existing: lead highest trump
```

**3. Trump counting — opponent leading**

In the existing opponent lead branch, before leading lowest non-trump:

```js
if (trumpRemainingElsewhere(view, userId) <= 2) {
  const failAces = realCards.filter(c => !isTrump(c) && c.rank === 'A')
  if (failAces.length > 0) return failAces[0].id
}
// existing: lead lowest non-trump
```

End-game (tricks 5–6) awareness falls out naturally from `trumpRemainingElsewhere` — no separate branch needed.

---

## Testing

New tests in `shared/gameEngine.test.js`.

### Inference unit tests

| Function | Cases |
|----------|-------|
| `countTrumpPlayed` | trick array with known trump → correct count; hidden plays not counted |
| `trumpRemainingElsewhere` | known hand + known tricks → correct remainder |
| `buriablePoints` | hand with 2 high-point non-trump; hand with fewer than 2 non-trump |
| `handScore` | score ≥ 24 picks; score < 24 passes; boundary case |
| `teammateWinning` | picker team bot, teammate winning; picker team bot, opponent winning; opponent bot, fellow opponent winning; opponent bot, picker winning |
| `bestVoidDiscard` | qualifying void ≥ 11 pts returns IDs; qualifying void with 1-card suit; no qualifying void returns null; mustHold cards excluded |

### Strategy decision tests

| Decision | Cases |
|----------|-------|
| `decidePick` | hand just above threshold picks; hand just below passes |
| `decideDiscard` | hand with qualifying void returns void cards; hand without falls back to greedy |
| `decideCall` | 6 trump + 2 queens → alone; 5 trump + 2 queens → normal call; 6 trump + 1 queen → normal call |
| `decidePlay` schmear | picker-team follower, teammate winning → highest non-trump played; only trump legal → falls back |
| `decidePlay` schmear | opponent follower, teammate winning → highest non-trump played |
| `decidePlay` trump count | picker team leading, opponents exhausted → fail Ace led |
| `decidePlay` trump count | opponent leading, picker team exhausted → fail Ace led |
| `decidePlay` trump count | trump not exhausted → existing behavior unchanged |

---

## Constraints

- Bots see only: `view.hands[userId]` (own hand), `view.tricks` (completed tricks, minus hidden face-down plays), `view.currentTrick`, `view.picker`, `view.partner` (only when revealed and `reveal_partner` is on), `view.discard` (hidden to non-pickers), `view.calledSuit`, `view.phase`.
- No inference may assume knowledge of cards not yet played or not in the bot's hand.
- `handScore` constants are tunable — document them but don't hardcode magic numbers without a comment.
