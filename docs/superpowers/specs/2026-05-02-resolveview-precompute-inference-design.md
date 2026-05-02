# Design: Pre-compute Shared Inference State in resolveView (Issue #176)

## Problem

`resolveView(view, userId)` was introduced in #150 to pre-compute `knownLocations` (cards pinned to specific hands via blitz declarations). Several other inference helpers are still called redundantly on every invocation of `decidePlay`:

- `deducedPartner(view, userId)` — 4–5 call sites per play decision
- `deducedNonTrumpVoids(view)` — 2 call sites in leading-play branches
- `deducedTrumpVoids(view)` — called internally inside `isGuaranteedWinner`, which is itself called ~7 times per play decision
- `trumpRemainingElsewhere(view, userId)` — called at multiple points in `decidePlay`

All of these scan `view.tricks` (up to 30 plays in late-game) and/or `view.currentTrick` on every invocation. The cumulative result is approximately 14–15 redundant trick-history scans per play decision.

## Approach

Extend `resolveView` to call these helpers once each and attach results to the returned view object. All consumers in `botStrategy.js` replace inline helper calls with property reads on the resolved view. `isGuaranteedWinner` replaces its internal `deducedTrumpVoids` call with a read from `view.trumpVoids`.

The standalone helper functions remain exported and behaviorally unchanged.

## Data Shape

`resolveView(view, userId)` returns:

```
{
  ...view,
  knownLocations: Map<userId, Array<card>>,    // from blitzes — existing (#150)
  resolvedPartner: userId | null,              // from deducedPartner
  trumpVoids: Set<userId>,                     // from deducedTrumpVoids
  nonTrumpVoids: { [userId]: Set<suit> },      // from deducedNonTrumpVoids (plain object, unchanged)
  resolvedTrumpRemaining: number,              // from trumpRemainingElsewhere
}
```

**Key naming note:** `resolvedPartner` is intentionally distinct from the engine-set `view.partner`. The engine sets `view.partner` only when the called card is played in a trick. `deducedPartner` can be non-null earlier — via elimination logic — before the engine confirms it. The two fields carry different meanings and both may be needed simultaneously by a caller. Using `resolvedPartner` preserves this distinction.

## Changes to `resolveView` (botInference.js)

The function currently returns `{ ...view, knownLocations: knownCardLocations(view) }`.

It will be updated to also call:
- `deducedPartner(view, userId)` → `resolvedPartner`
- `deducedTrumpVoids(view)` → `trumpVoids`
- `deducedNonTrumpVoids(view)` → `nonTrumpVoids`
- `trumpRemainingElsewhere(view, userId)` → `resolvedTrumpRemaining`

Note: `trumpRemainingElsewhere` itself calls `countTrumpPlayed(view, userId)` which scans `view.tricks`. Pre-computing it here eliminates those repeated scans.

## Changes to `isGuaranteedWinner` (botInference.js)

No signature change. The function currently calls two helpers internally on every invocation:

- `deducedTrumpVoids(view)` (to check which players are trump-void)
- `trumpRemainingElsewhere(view, userId)` (to check if any trump is left elsewhere)

Both callers already pass `rv`, so replace both with reads from the resolved view:
- `deducedTrumpVoids(view)` → `view.trumpVoids`
- `trumpRemainingElsewhere(view, userId)` → `view.resolvedTrumpRemaining`

This removes the most expensive redundancies: ~7 re-scans of `deducedTrumpVoids` and ~7 re-calls of `trumpRemainingElsewhere` per play decision, reduced to zero.

Note: `trumpRemainingElsewhere` is only called from inside `isGuaranteedWinner` — it has no direct call sites in `botStrategy.js`.

## Changes to `botStrategy.js`

Only `deducedPartner` and `deducedNonTrumpVoids` have direct call sites in `decidePlay`. Replace them with property reads on `rv`:

| Current call | Replacement |
|---|---|
| `deducedPartner(rv, userId)` (5 sites) | `rv.resolvedPartner` |
| `deducedNonTrumpVoids(rv)` (2 sites) | `rv.nonTrumpVoids` |

No logic changes. `rv` is already the resolved view at all call sites.

## Tests (botInference.test.js)

1. **`resolveView` pre-computation consistency** — construct a view with known trick history; assert that all four new fields match the values returned by the individual helpers for the same view. Verifies the wiring, not the helper logic.

2. **`userId` threading** — call `resolveView` with two different userIds; assert that `resolvedPartner` and `resolvedTrumpRemaining` (which are userId-sensitive) differ appropriately. Verifies that `userId` is correctly forwarded.

3. **Existing `isGuaranteedWinner` tests** — since `isGuaranteedWinner` will now read `view.trumpVoids` and `view.resolvedTrumpRemaining` without fallbacks, any test that currently passes a plain `view` to `isGuaranteedWinner` must be updated to wrap it with `resolveView(view, userId)` first. Behavior is unchanged; only the setup changes.

Existing `deducedPartner`, `deducedTrumpVoids`, `deducedNonTrumpVoids`, and `trumpRemainingElsewhere` tests are unchanged — the helpers themselves are unmodified.

## docs/BOTS.md Update

Update the `resolveView` entry to list all five pre-computed fields (adding the four new ones). No other BOTS.md changes needed — the underlying helper behaviors are unchanged.

## Out of Scope

- Internalizing helper functions (removing exports) — tracked in #181
- Normalizing `nonTrumpVoids` to ES6 `Map` — tracked in #181
- Extending `knownCardLocations` with new inference sources (crack/recrack, elimination) — tracked in #180

## Success Criteria

1. `resolveView` returns all five pre-computed fields, each matching the corresponding helper's output for the same inputs.
2. All `botInference.test.js` tests pass, including two new tests per above.
3. All `botStrategy` tests pass — no behavioral change.
4. `docs/BOTS.md` accurately reflects the updated `resolveView` output.
