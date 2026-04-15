# Bot Trump Efficiency Design

**Date:** 2026-04-14  
**Status:** Approved

## Problem

The picker and partner bots waste strong trump when a weaker trump (or a point diamond trump) would guarantee the trick. The root cause is `lowestCard()`, which sorts trump by card points ascending. This misaligns with trump strength:

- JD (rank 7, 2 pts) is stronger trump than KD (rank 10, 4 pts)
- But `lowestCard` picks JD (lower points), spending strong trump unnecessarily

Additionally, when the picker team is guaranteed to take a trick, they should use point diamonds (AD, 10D, KD) over pip diamonds (9D, 8D, 7D) — those card points end up in the picker team's pile.

## Trump Order Reference

```
QC(0) > QS(1) > QH(2) > QD(3) > JC(4) > JS(5) > JH(6) > JD(7) > AD(8) > 10D(9) > KD(10) > 9D(11) > 8D(12) > 7D(13)
```

Lower index = stronger trump. Higher index = weaker trump.

## Approach

Add a new helper `cheapestWinningTrump(cards)` in `botStrategy.js`. Replace `lowestCard(winning)` in the picker-team "try to win" path with logic that branches on scenario.

`lowestCard()` is unchanged — it remains correct for non-trump follows and for the "can't win, dump low" path.

## New Helper: `cheapestWinningTrump(cards)`

Groups the input trump cards into three tiers and returns the weakest card from the highest-priority non-empty tier:

| Tier | Cards | Rationale |
|------|-------|-----------|
| 1 (preferred) | AD, 10D, KD | Point diamonds — spend these to accumulate card points in your pile |
| 2 | 9D, 8D, 7D | Pip diamonds — cheap trump but 0 card points |
| 3 (last resort) | All Jacks and Queens | High trump — save these |

Within each tier, pick the weakest (highest trump rank index):
- Tier 1: KD before 10D before AD
- Tier 2: 7D before 8D before 9D
- Tier 3: JD before JH before JS before JC before QD before QH before QS before QC

## Changes to `decidePlay` — Picker-Team "Try to Win" Path

The existing block:

```js
const winning = realCards.filter(c => {
  for (const play of currentTrick) {
    if (!beats(c, play.card, ledSuit)) return false
  }
  return true
})
if (winning.length > 0) return lowestCard(winning).id
```

The winning set is always all-trump or all-non-trump (never mixed), so:

### Non-trump wins
Bot has the led fail suit and wins with a fail card. Behavior unchanged: `lowestCard(winning)`.

### Trump wins only — two scenarios

**Scenario 1: Trump trick (`ledSuit === 'T'`)**

Compute opponents who haven't played yet (players in `Object.keys(view.hands)` who are not in `currentTrick`, not the bot itself, and not picker/partner):

- **0 opponents remaining:** Win is guaranteed regardless of what anyone else plays. Use `cheapestWinningTrump(winning)`.
- **≥1 opponent remaining:** An opponent could beat cheap trump. Use `highestTrump(winning)` to best secure the lead.

**Scenario 2: Fail trick, bot is void, playing trump (`ledSuit !== 'T'`)**

Getting the lead is valuable for the picker team. Picker and partner behave differently:

- **Picker:** Always play `highestTrump(winning)`. Taking the lead is the goal; commit strongest trump.
- **Partner with >1 trump in hand:** Play `highestTrump(winning)`. Plan is to win the trick and lead trump back to the picker.
- **Partner with exactly 1 trump in hand:** Play `lowestCard(realCards)`. No lead-back plan exists; don't spend the only trump on this trick.

"Trump in hand" is counted from `realCards.filter(c => isTrump(c)).length` (since the bot is void in led suit, `realCards` = full hand).

## Tests

New tests in `gameEngine.test.js`:

### `cheapestWinningTrump`
- Returns the weakest point diamond when point diamonds are present (e.g., KD preferred over 10D and AD)
- Falls back to weakest pip diamond when no point diamond present
- Falls back to weakest high trump when no diamond trump present
- Handles single-card input

### `decidePlay` integration (state-construction tests)
Six branches to cover:
1. Non-trump win → `lowestCard` behavior unchanged
2. Trump trick, 0 opponents remaining → cheapest winning trump selected
3. Trump trick, ≥1 opponent remaining → highest winning trump selected
4. Picker void on fail trick → highest trump
5. Partner void on fail trick, >1 trump → highest trump
6. Partner void on fail trick, 1 trump → low non-trump dumped
