# Double on the Bump (DOB) — Design

**Date:** 2026-04-13
**Issue:** #45

## Summary

Add "Double on the Bump" as a game option (default: on). When enabled and the picking team loses, the hand's stakes are doubled on top of all other multipliers.

## Scope

DOB applies only to normal hands where a picker exists. Leasters and schwanzers have no picker team, so DOB never fires in those variants.

## Data Layer

New DB column on `games` table:

```sql
ALTER TABLE games ADD COLUMN double_on_bump INTEGER NOT NULL DEFAULT 1;
```

Migration file: `migrations/0007_double_on_bump.sql`

## Game Engine

In `computeScores()` (`shared/gameEngine.js`), add a DOB multiplier after all existing multipliers:

```js
const dobMultiplier = (!pickerWon && (state.double_on_bump ?? true)) ? 2 : 1
const multiplier = baseMultiplier * doublerMultiplier * handCrackMultiplier * blitzMultiplier * dobMultiplier
```

`state.double_on_bump` is a boolean copied from the DB at hand-deal time (same pattern as `reveal_partner`).

## Backend

### `functions/api/games/[id]/settings.js`
- Accept `double_on_bump` boolean in PATCH body
- Validate: must be boolean if present
- Save as `INTEGER` (1/0)
- Return `double_on_bump` as boolean in response

### `functions/api/games/index.js` (create)
- Accept `double_on_bump` from request body (default `true`)
- INSERT into `games` table
- Copy into initial hand state: `state.double_on_bump = double_on_bump`

### `functions/api/games/[id]/join.js` and `fill-with-bots.js`
- After `dealHand()`, copy `state.double_on_bump = game.double_on_bump === 1`

### `functions/api/games/[id]/action.js`
- When re-reading `no_pick_variant` at no-pick resolution, also read `double_on_bump`
- When dealing next hand, copy `state.double_on_bump = freshGame.double_on_bump === 1`

## Frontend

### `GameOptionsPanel`
- Add `dob` local state: `useState(values?.double_on_bump ?? true)`
- Re-sync from `values` on open (alongside existing fields)
- Add checkbox below existing options:
  - Label: "Double on the Bump?"
  - `checked={dob}`, `onChange` calls `handleDobChange`
- `handleDobChange`: same save pattern as `handleRevealChange`
- Include `double_on_bump` in all `onChange` / `save` calls

### `GamePage`
- Add `dobEnabled` state: `useState(null)` (null = not yet overridden, falls back to `gameData.double_on_bump`)
- `handleSettingsUpdate`: if `result.double_on_bump !== undefined`, call `setDobEnabled(result.double_on_bump)`
- Pass `double_on_bump: dobEnabled ?? gameData.double_on_bump ?? true` in `values` prop to `GameOptionsPanel` (both waiting and active game instances)
- In the "Game options" summary line, append ` · DOB` when DOB is enabled:
  ```
  Doublers · Partner: shown · DOB
  ```

### `LobbyPage`
- Initial `gameOptions` state: include `double_on_bump: true`
- Pass `double_on_bump` through to game create API call

## Testing

- Unit test in `gameEngine.test.js`:
  - Normal hand, picker loses, DOB on → multiplier ×2 vs DOB off
  - Normal hand, picker wins, DOB on → no extra multiplier
  - DOB composes correctly with crack, blitz, doubler multipliers
  - Leaster scoring unaffected by DOB flag
