# Rewind Feature Design

**Issue:** #37  
**Date:** 2026-04-12  
**Status:** Approved

## Overview

Add "Rewind Play" and "Rewind Trick" controls to test-mode games, allowing an admin to step backwards through card plays within the current hand. Rewind never crosses hand boundaries or returns to the pick/bury/calling phase.

## Section 1: State History

A `rewindHistory: []` array is added to the game state JSON. It holds complete state snapshots (oldest-first), one per card play.

- `dealHand` initializes `rewindHistory: []`, clearing history at the start of each hand
- `playCard` pushes a deep clone of the pre-play state onto `rewindHistory` before applying the play. **The snapshot must have `rewindHistory` stripped (set to `[]`) before pushing**, otherwise each snapshot would nest all prior snapshots inside it, causing exponential JSON growth.
- Existing in-flight games that lack the field are handled via a `?? []` fallback

History is bounded naturally to the current hand (max 30 card plays = 6 tricks × 5 players). Storage is O(N × base state size) because snapshots do not carry nested history.

## Section 2: Game Engine Functions

### `rewindPlay(state)`

- Asserts phase is `playing` and `rewindHistory` is non-empty (throws otherwise)
- Pops the last snapshot off `rewindHistory`
- Sets the popped snapshot's `rewindHistory` to the remaining entries (the array minus the popped entry)
- Returns the restored state

### `rewindTrick(state)`

- Asserts phase is `playing`
- If `rewindHistory` is empty, returns state unchanged (no-op)
- Pops snapshots until `currentTrick.length === 0` in the restored state
- If `currentTrick` was already empty when called, pops one full additional trick's worth (rewinding to the previous trick)
- After each pop: sets the popped snapshot's `rewindHistory` to the remaining entries before continuing
- After settling, if `tricks.length === 0` (start of hand): resets `crackState = null` and `handCrackMultiplier = 1`
- Returns the restored state

### `playCard` change

Before applying each card play, push `deepClone(state)` onto `state.rewindHistory`, **with `rewindHistory` stripped to `[]` in the snapshot** to avoid exponential nesting.

## Section 3: API Layer

Two new action types in `functions/api/games/[id]/action.js`:

| Action type    | Engine function  | Guard                              |
|----------------|------------------|------------------------------------|
| `rewind_play`  | `rewindPlay()`   | `is_test_mode && user.is_admin`    |
| `rewind_trick` | `rewindTrick()`  | `is_test_mode && user.is_admin`    |

- Both return 403 if not test mode or not admin
- No `act_as` needed — rewind operates on the global game state
- `processBotTurns` is skipped after either rewind action (same treatment as `play_card` during the playing phase)

## Section 4: Frontend

Two buttons shown in `GamePage.jsx` when `isTestMode && user.is_admin && state.phase === 'playing'`:

- **"Rewind Play"** — disabled when `rewindHistory` is empty
- **"Rewind Trick"** — disabled when `rewindHistory` is empty, or when `currentTrick.length === 0 && tricks.length === 0` (already at start of hand with no previous trick)

Both buttons call `onAction({ type: 'rewind_play' })` and `onAction({ type: 'rewind_trick' })` using the existing action dispatch mechanism. No new API client code required.

Placement: a dedicated "Test Controls" section, visually separate from the normal action panel, to make it clear these are administrative tools.

## Out of Scope

- Rewind during picking, discarding, or calling phases
- Rewind across hand boundaries
- Rewind in leaster or schwanzer variants (no explicit requirement; can be revisited). Note: leasters use the same `playing` phase, so rewind would technically function — but rewinding past trick 1 in a leaster hand could create inconsistency with the `awardLeasterBlind` side effect that fires after trick 1 completes.
- Non-admin players triggering rewind
- Option C (action log replay) — tracked separately in #70
