# Bot Strategy: Card-Counting Inference for Trump-Follow Decisions

**Date:** 2026-04-18
**Issues:** #92, #121
**Follow-up:** #132 (out-of-scope applications of the same inference primitive)

## Context

`shared/botStrategy.js` currently makes "should I play trump?" and "how high should my trump be?" decisions using only aggregate trump counts (`trumpRemainingElsewhere`) and seat-order facts (`opponentsRemaining`). This is coarse. Two concrete shortcomings are tracked in #92 and #121:

- **#92** — When a partner bot has exactly one trump and the picker is already winning the trick, the partner should be able to save that trump in more cases than the current "opponents remaining == 0" rule covers. If every trump that could beat the picker's card has already been played or is in the partner's own hand, the picker's win is locked — no matter how many opponents still play — and the partner should play low.

- **#121** — When a picker-team bot schmears (dumps a high-value non-trump on a teammate's winning trick), it does so unconditionally. If a non-partner opponent is still to play and could trump over the teammate, the schmear is counterproductive — the bot has just handed points to the opponent.

Both reduce to the same primitive: *is the currently-winning card guaranteed to hold against any remaining trump that could beat it?* This spec introduces that primitive and wires it into the follow-win branch, the schmear branches, and every related "play highest trump when opponents remain" call site that shares the same structural inefficiency.

## Scope

**In scope:**
1. A new inference function `isGuaranteedWinner(card, view, userId)` in `shared/botInference.js` and a thin wrapper `cheapestGuaranteedWin(candidates, view, userId)`.
2. Refactored decision tree in the picker-team and opponent-team follow-win branches of `decidePlay` (`shared/botStrategy.js` lines 326-395).
3. Updated schmear branches on both teams to gate on "is teammate's win secure?" and, where applicable, attempt a takeover.
4. A new conditional in the non-trump-win branch: play the highest-point non-trump when no opponent can trump in; otherwise preserve current lowest-wins behavior.
5. A new rule for the partner bot when the picker is still to play in the trick: lean toward playing low; contest only when guaranteed or when holding ≥2 trump (lead-back insurance).
6. Test coverage and `docs/BOTS.md` updates matching the new behavior.

**Out of scope (tracked in #132):**
- Leading decisions informed by per-rank card counting (e.g., precise "cash the fail ace" trigger).
- Opponent-team "trump in" decisions during called-suit tricks.
- Non-trump void tracking (a separate inference primitive).
- Partner trump lead-back timing.

## Glossary

Terms used throughout this spec. Definitions are precise — the ambiguity between "this card is safe" and "my candidate play is safe" caused earlier design friction.

- **`isGuaranteedWinner(card, view, userId)`** — Returns `true` iff no trump that outranks `card` exists outside the caller's visible knowledge. "Visible" means: played in completed tricks, played in the current trick, in the caller's own hand, or in the caller's visible bury (picker only). Any unseen higher trump is treated as a potential threat, regardless of whether it is actually in an opponent's hand, in a teammate's hand, or in the hidden bury. Conservative by design.

- **`cheapestGuaranteedWin(candidates, view, userId)`** — Returns the card in `candidates` with the lowest point value that satisfies `isGuaranteedWinner`, or `null` if no such card exists. Callers are expected to pass an already-filtered set (e.g., the existing `winning` array, which holds cards that beat every play in the current trick). Tiebreaks follow existing `cheapestWinningTrump` conventions (point-diamonds, then pip-diamonds, then Q/J).

- **Picker-strength prior** — The heuristic assumption that a bot that picked has strong trump. Applied only in schmear branches to decide whether a partner bot should trust the picker's implicit defense (yes) vs. whether a picker bot should assume the same of the partner (no).

## Design

### 1. New inference primitives (`shared/botInference.js`)

Add two functions at the end of the existing file.

```js
// Returns true iff every trump outranking `card` is in the caller's visible knowledge:
// own hand, played tricks (non-hidden), current trick (non-hidden), visible bury.
// Unseen higher trump is always treated as a potential threat.
export function isGuaranteedWinner(card, view, userId) { /* ... */ }

// Lowest-point card in `candidates` that is (a) in the caller's hand,
// (b) beats every play in `view.currentTrick` given the led suit,
// and (c) satisfies isGuaranteedWinner. Returns null if none.
export function cheapestGuaranteedWin(candidates, view, userId) { /* ... */ }
```

`isGuaranteedWinner` iterates the 14 trump cards in rank order and, for each trump ranked higher than `card`, checks whether it appears in:
- `view.hands[userId]` (own hand, non-hidden)
- Any play in `view.tricks` (non-hidden)
- Any play in `view.currentTrick` (non-hidden)
- `view.buried` filtered by `!c.hidden` (mirrors the pattern in `trumpRemainingElsewhere` at `botInference.js:30-31`)

If any higher trump is not found in any of those sets, return `false`. Otherwise return `true`.

No new dependencies; uses the existing `trumpRank`, `isTrump` helpers from `gameEngine.js`.

### 2. Follow-win branch changes (`decidePlay`, lines 326-375)

The decision tree is restructured. Bracket numbers correspond to the existing structure; arrows indicate changed behavior.

Compute `pickerStillToPlay` alongside `opponentsRemaining` using the same approach:
```js
const playedIds = new Set(currentTrick.map(p => p.userId))
const pickerStillToPlay = !playedIds.has(picker) && picker !== userId
```

**Branch 2a — Non-trump win available** (was: `lowestCard(nonTrumpWins)`):
- If `opponentsRemaining === 0` OR `trumpRemainingElsewhere(view, userId) === 0`:
  → play **highest-point** non-trump that wins (maximize capture when no opponent can trump in)
- Else: play **lowest** non-trump that wins (preserve current risk-averse behavior)

**Branch 2b — Trump trick (`ledSuit === 'T'`):**
- If `opponentsRemaining === 0`: `cheapestWinningTrump(winning)` (unchanged)
- Else: `cheapestGuaranteedWin(winning, view, userId) ?? highestTrump(winning)`

**Branch 2c — Fail-led trick, bot is picker, picker is void:**
- `cheapestGuaranteedWin(winning, view, userId) ?? highestTrump(winning)`

**Branch 2d — Fail-led trick, bot is partner, picker still to play:**
- If `myTrumpCount >= 2`: `highestTrump(winning)` (contest; have lead-back insurance)
- If `myTrumpCount === 1`:
  - If `isGuaranteedWinner(myOnlyWinningTrump, view, userId)`: play it
  - Else: play low (defer to picker)

**Branch 2e — Fail-led trick, bot is partner, picker has played:**
- If picker is currently winning AND (`opponentsRemaining === 0` OR `isGuaranteedWinner(pickerCard, view, userId)`): play low *(this is #92)*
- Else if `myTrumpCount >= 2`: `cheapestGuaranteedWin(winning, view, userId) ?? highestTrump(winning)`
- Else (`myTrumpCount === 1`, picker already played): play it (no reason to save — picker already played, and being in the `winning` set means the trump beats everything so far)

### 3. Schmear branch changes

The two existing schmear branches diverge in this spec because of the picker-strength prior.

#### 3.1 Picker-team schmear (line 331-335)

```js
if (teammateWinning(view, userId)) {
  const winnerPlay = currentWinner(currentTrick)
  const teammateCard = winnerPlay.card

  // Is teammate's currently-winning card safe against remaining plays?
  const teammateSafe =
    opponentsRemaining === 0 ||
    isGuaranteedWinner(teammateCard, view, userId)

  if (teammateSafe) {
    return schmearHighestNonTrump()  // current behavior
  }

  // Not safe — opponent could trump over teammate.
  // Role-asymmetric fallback:
  if (userId === partner) {
    // I am the partner; teammate is the picker.
    // Picker-strength prior: trust picker to recover elsewhere if overtaken.
    return schmearHighestNonTrump()
  }

  // I am the picker; teammate is the partner.
  // No corresponding prior — partner may be trump-weak. Try to take over.
  const takeover = cheapestGuaranteedWin(winning, view, userId)
  if (takeover) return takeover.id

  const highTrump = highestTrump(winning)
  if (highTrump) return highTrump.id  // risk reduction

  return schmearHighestNonTrump()  // fallback: can't secure any better
}
```

Helper: `schmearHighestNonTrump()` encapsulates the existing body:
```js
const nonTrump = realCards.filter(c => !isTrump(c))
return nonTrump.length > 0 ? highestValueCard(nonTrump).id : lowestCard(realCards).id
```

#### 3.2 Opponent-team schmear (line 377-382)

```js
if (teammateWinning(view, userId)) {
  const winnerPlay = currentWinner(currentTrick)
  const teammateCard = winnerPlay.card

  const teammateSafe =
    opponentsRemaining === 0 ||  // note: from opponent POV, "opponents" = picker + partner
    isGuaranteedWinner(teammateCard, view, userId)

  if (teammateSafe) {
    return schmearHighestNonTrump()
  }

  // Not safe. Take over only if guaranteed — no picker-strength prior applies,
  // and opponents avoid burning trump speculatively.
  const takeover = cheapestGuaranteedWin(winning, view, userId)
  if (takeover) return takeover.id

  return schmearHighestNonTrump()
}
```

### 4. Intentional conservatism

`isGuaranteedWinner` treats teammate hands as unknown, so scenarios where the partner could trump over a picker-team-winning card (or vice versa) are flagged "not guaranteed" — same as true opponent threats. This is strategically harmless because:
- In the follow-win partner-still-to-play branch (2d), conservatism leads to "play low, defer to picker." Picker-as-teammate trumping over only helps the picker team.
- In schmear branches, teammate-could-trump-over almost never happens in practice (same-team trumping the teammate's win is suboptimal), but if it does, the bot plays as though threatened — a harmless over-defense.

No special-case logic needed.

## Test Plan

### Unit tests — `shared/botInference.test.js` (new file, or extend existing tests)

1. `isGuaranteedWinner`: all higher trump accounted for in played tricks → `true`.
2. `isGuaranteedWinner`: all higher trump accounted for across played + own-hand mix → `true`.
3. `isGuaranteedWinner`: one higher trump unseen → `false`.
4. `isGuaranteedWinner`: hidden buried trump treated as unseen (partner's view) → `false` when it could have beat the card; picker's view with visible bury → `true` when the buried card is the only unseen higher trump.
5. `isGuaranteedWinner`: card is itself the highest trump (Q♣) → trivially `true`.
6. `cheapestGuaranteedWin`: mix of candidates, only some guaranteed → returns lowest-point guaranteed.
7. `cheapestGuaranteedWin`: no guaranteed candidates → `null`.

### Strategy tests — `shared/botStrategy.test.js`

Constructed state tests, one per scenario:

1. Partner with 1 trump, picker winning, opponents remain, **guaranteed** → plays low.
2. Partner with 1 trump, picker winning, opponents remain, **not guaranteed** → plays the trump.
3. Partner with 1 trump, picker still to play, **not guaranteed** → plays low (new rule).
4. Partner with 1 trump, picker still to play, **guaranteed** → plays the trump.
5. Partner with 2+ trump, picker still to play → plays highest winning trump.
6. Picker void, fail led, opponents remain, **cheapest-guaranteed available** → plays it (symmetric refinement).
7. Picker void, fail led, opponents remain, **no guaranteed** → plays highest trump (fallback preserved).
8. Picker-team schmear: **partner bot**, teammate picker winning, opponent could overtake → still schmears.
9. Picker-team schmear: **picker bot**, teammate partner winning, opponent could overtake, **takeover available** → takes over.
10. Picker-team schmear: **picker bot**, teammate partner winning, opponent could overtake, **no takeover** → plays highest trump.
11. Opponent-team schmear: teammate safe → schmears.
12. Opponent-team schmear: teammate unsafe, takeover available → takes over.
13. Opponent-team schmear: teammate unsafe, no takeover → schmears anyway.
14. 2a — non-trump win available, opponents can still trump in → lowest-wins (current).
15. 2a — non-trump win available, `trumpRemainingElsewhere === 0` → highest-point-wins (new).

### Regression coverage

The existing bot-strategy test suite continues to run. New rules should not regress any existing assertion; if they do, inspect whether the existing assertion codified now-obsolete behavior and update accordingly (expect small number — the #92 and symmetric-refinement changes purposely deviate from current behavior).

## Documentation Updates

`docs/BOTS.md` — three sections need revision:

1. **Picker-team bot following** — add the partner-picker-still-to-play rule, expand the partner-with-1-trump paragraph to reference the card-counting guarantee check, note the symmetric-refinement ("cheapest-guaranteed when available, otherwise highest trump") for the remaining "opponents remain" call sites.

2. **Picker-team bot schmear** — replace the unconditional "dump highest-value non-trump" with the secure check, then branch on role (partner schmears anyway; picker attempts takeover or risk-reduction).

3. **Opponent-team bot schmear** — replace with the secure check; takeover only when guaranteed.

Per `CLAUDE.md`, `docs/BOTS.md` must match the code after this change. This doc update is part of the spec's implementation.

## Risk & Rollout

- **Behavior drift in existing tests.** Expected for the explicit new rules (#92 core, partner-picker-still-to-play, schmear takeovers); unexpected elsewhere. Review case-by-case.
- **Conservatism cost.** The "unseen = threat" rule may miss cases where a trump is actually in a teammate's hand. Accepted for v1; can be revisited with per-player trump estimation (adjacent to #132).
- **Lead-back insurance assumes partner plays trump back.** Current `decidePlay` leading logic for picker-team leads trump when possible. This assumption holds for v1 — if future changes alter lead behavior, the 2d branch should be re-evaluated.
