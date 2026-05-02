# Design: Blitz Inference for Bots (Issue #150)

## Problem

When a player declares a blitz, they publicly announce which two queens they hold (black blitz = QC + QS, red blitz = QH + QD). Since the blitzer is always the picker (enforced by the engine), this is visible to all players. Currently `botInference.js` ignores it.

The practical gap: a partner bot holding QH cannot recognize it as a guaranteed winner when the picker black-blitzed, because QC and QS haven't appeared in tricks yet — the "are all stronger trump accounted for?" check fails even though those queens are in a teammate's hand.

## Background

- `view.blitzes` is already present in the redacted player view: `Array<{ userId, type: 'black'|'red' }>`.
- The blitzer is always the picker — enforced by the engine; a leaster can never follow a blitz.
- Black blitz → picker holds QC and QS. Red blitz → picker holds QH and QD.
- Only picker-team bots benefit: for opponent-team bots, blitzed queens are in an opponent's hand and remain correctly treated as threats.

## Approach: resolveView (Phase 1)

Rather than threading extra state through individual inference calls, we introduce a thin pre-computation wrapper: `resolveView(view, userId)` enriches the player view with derived facts and returns a new view object. `decidePlay` in `botStrategy.js` calls `resolveView` once and passes the enriched view downstream to all inference functions.

Phase 1 adds only `knownLocations`. Phase 2 (#176) will migrate `deducedPartner`, `deducedTrumpVoids`, and `deducedNonTrumpVoids` into the same step.

## Data Shape

```
knownLocations: Map<userId, Array<card>>
```

A map from userId to an array of card objects `{ id, rank, suit }` known — by public announcement — to be in that player's hand. Populated only from blitz declarations in Phase 1.

## New Functions (botInference.js)

### `knownCardLocations(view)` → `Map<userId, Array<card>>`

Derives `knownLocations` from `view.blitzes`:
- Black blitz entry → picker's array includes `{ id: 'QC', rank: 'Q', suit: 'C' }` and `{ id: 'QS', rank: 'Q', suit: 'S' }`.
- Red blitz entry → picker's array includes `{ id: 'QH', rank: 'Q', suit: 'H' }` and `{ id: 'QD', rank: 'Q', suit: 'D' }`.

No blitzes → returns an empty Map.

### `resolveView(view, userId)` → enriched view

Returns `{ ...view, knownLocations: knownCardLocations(view) }`. The `userId` parameter is included for Phase 2 API symmetry; it is unused in Phase 1.

## Modified Functions (botInference.js)

### `isGuaranteedWinner(card, view, userId)`

No signature change. Reads `view.knownLocations` when present.

**Team membership check (internal)**

"On picker team" means `userId === view.picker || userId === view.partner`. Teammate IDs are the other picker-team member(s) not including `userId`. If the bot is not on the picker team, `knownLocations` is not consulted and behavior is unchanged.

**Trump case — higher-rank trump check**

Currently: every trump with a lower rank index (stronger trump) must appear in the bot's own hand, played tricks, current trick, or bury.

With `knownLocations`: trump in a known **teammate's** hand is also treated as accounted for, since a teammate cannot play it against us. Concretely, for each entry in `view.knownLocations` where the key is a teammate ID, every trump card in that array has its `trumpRank` added to the "seen ranks" set.

**Non-trump (fail) case — condition 2 (no opponent can trump)**

Currently: satisfied if `trumpRemainingElsewhere(view, userId) === 0` OR all other players are trump-void.

With `knownLocations`: compute `knownTeammateTrump` (count of trump in known teammate entries). Use `trumpRemainingElsewhere - knownTeammateTrump` for the zero check. If the adjusted count is 0, condition 2 is satisfied regardless of raw `trumpRemainingElsewhere`.

`trumpRemainingElsewhere` itself is not modified; the subtraction is inline in `isGuaranteedWinner`.

## botStrategy.js Change

At the top of `decidePlay`, before any inference calls:

```javascript
const rv = resolveView(view, userId)
```

All calls that currently receive `view` are updated to receive `rv`. This covers:
- `isGuaranteedWinner(c, view, userId)` calls (direct and via `cheapestGuaranteedWin`)
- `deducedNonTrumpVoids(view)`
- `deducedTrumpVoids(view)`
- `deducedPartner(view, userId)`
- `teammateWinning(view, userId)`
- `trumpRemainingElsewhere(view, userId)`

Since `rv` is a superset of `view` (only adds `knownLocations`), functions that don't read that field are unaffected.

## Tests (botInference.test.js)

1. **`knownCardLocations`**
   - No blitzes → empty Map.
   - Black blitz → picker entry contains QC and QS card objects.
   - Red blitz → picker entry contains QH and QD card objects.

2. **`resolveView`**
   - Returns a view with `knownLocations` populated correctly from blitzes.
   - All other view fields are unchanged.

3. **`isGuaranteedWinner` — trump case with blitz inference**
   - Partner holds QH; picker black-blitzed (QC+QS in picker's hand); neither played in tricks → `isGuaranteedWinner(QH, rv, partnerId)` returns `true`.
   - Same setup, userId is an opponent bot → returns `false` (no blitz benefit to opponent).

4. **`isGuaranteedWinner` — fail case with blitz inference**
   - Partner holds AH; one trump unaccounted for, but known to be the picker's blitzed queen; no other opponent trump → returns `true`.

## docs/BOTS.md Update

Add `knownCardLocations` and `resolveView` to the Inference Helpers table. Document that `resolveView` is the single entry point for pre-computed inference, and that `knownLocations` carries blitz-derived card location knowledge.

## Out of Scope

- Pre-computing `deducedPartner`, `deducedTrumpVoids`, `deducedNonTrumpVoids` into `resolveView` → tracked in #176.
- Inferences from non-picker blitzers (not possible by game rules).
- UI changes of any kind.

## Success Criteria

1. Partner bot correctly uses blitz declarations in `isGuaranteedWinner` for both trump and fail cases.
2. Opponent-team bot behavior is unchanged.
3. All existing `botInference.test.js` and `botStrategy` tests continue to pass.
4. New tests cover `knownCardLocations`, `resolveView`, and blitz-aware `isGuaranteedWinner`.
5. `docs/BOTS.md` accurately reflects the new inference helpers.
