# Schwanzers Design

**Date:** 2026-04-12
**Issue:** #50
**Status:** Approved

---

## Overview

Implement Schwanzers as a third no-pick variant alongside Leasters and Doublers. When all five players pass and the game's `no_pick_variant` is set to `schwanzers`, hands are scored immediately using a trump-based point scheme — no tricks are played. The player with the most Schwanzer points loses; all others gain.

---

## Point Scheme

| Card | Schwanzer Points |
|------|-----------------|
| Queen (any suit) | 3 |
| Jack (any suit) | 2 |
| Diamond pip (non-Q, non-J, suit=D) | 1 |
| All other cards | 0 |

Total Schwanzer points in the 32-card deck: 26 (4Q×3 + 4J×2 + 6 pip diamonds×1).

Note: QD and JD score as queen (3) and jack (2) respectively — not as diamond pips.

---

## Resolution Rules

1. Sum each player's Schwanzer points from their 6 dealt cards.
2. The player with the **most** points is the Schwanzer (loser).
3. **Tie-break:** Among tied players, the one holding the most powerful trump (lowest index in `TRUMP_ORDER`) loses.
4. **Fallback tie-break:** If all tied players hold no trump, the first tied player in `pickOrder` loses.
5. **The blind is excluded** — it is not in anyone's hand and is not scored.
6. **No multiplier** — scoring is flat: loser gets −4, all others get +1. The doubler multiplier does not apply (same as Leasters).

---

## Architecture

### `shared/gameEngine.js`

Add two exported functions:

**`schwanzerCardPoints(card)`**
```
if rank === 'Q' → 3
if rank === 'J' → 2
if suit === 'D' → 1   (catches AD, 10D, KD, 9D, 8D, 7D — Qs and Js already handled)
else → 0
```

**`resolveSchwanzer(state)`**
- Compute points per player from `state.hands`
- Identify loser (max points, tie-break by best trump in TRUMP_ORDER, fallback to pickOrder)
- Build `scores` object: loser → −4, all others → +1
- Push a log line listing each player's totals and naming the loser
- Return `{ loser, scores }`

### `functions/api/games/[id]/action.js`

In the `pass` case, add a Schwanzers branch after the Leasters branch:

```js
const freshGame = await env.DB.prepare('SELECT no_pick_variant FROM games WHERE id = ?').bind(gameId).first()
if (freshGame.no_pick_variant === 'leasters') {
  state = setupLeaster(state)
} else if (freshGame.no_pick_variant === 'schwanzers') {
  const { scores } = resolveSchwanzer(state)
  state.scores = scores
  state.phase = 'scoring'
  state = await finishHand(env.DB, gameId, state)
} else {
  // doublers: double multiplier and re-deal
  ...
}
```

`finishHand` requires no changes. When `state.isLeaster` is false and `state.scores` is already set, it uses those scores directly, writes `score_events` to the DB, resets `doubler_multiplier` to 1, and deals the next hand.

Import `resolveSchwanzer` alongside the existing engine imports.

### `functions/api/games/[id]/settings.js`

Extend the valid values check:
```js
// Before:
!['leasters', 'doublers'].includes(no_pick_variant)
// After:
!['leasters', 'doublers', 'schwanzers'].includes(no_pick_variant)
```

### `frontend/src/pages/GamePage.jsx`

Two small changes:

1. Add to `VARIANT_LABELS`:
   ```js
   const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers', schwanzers: 'Schwanzers' }
   ```

2. Add `'schwanzers'` to the radio group array in `AdminSettingsPanel`:
   ```js
   {['leasters', 'doublers', 'schwanzers'].map(v => ( ... ))}
   ```

No changes to `ActionPanel` — Schwanzers resolves entirely within the `pass` action; the game never enters a phase requiring player input during a Schwanzer hand. The game log is the player-facing result.

### `README.md`

Add a Schwanzer section after the Leaster section describing the rules, point scheme, and scoring.

---

## What Is Not Changing

- No new game phase — Schwanzers resolves immediately in the `pass` handler.
- No scoring overlay or badge — the game log communicates the result.
- No DB migration required — `no_pick_variant` is a TEXT column with no constraint.
- No changes to trick-playing, cracking, or any other game phase.

---

## Out of Scope

- Multiplier interaction with accumulated doublers (Schwanzers resets to ×1, same as Leasters).
- Blind card inclusion in scoring (blind is excluded; only dealt hands count).
