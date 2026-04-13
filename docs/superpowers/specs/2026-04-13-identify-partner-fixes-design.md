# Identify Partner Fixes — Design Spec

**Issue:** #38  
**Date:** 2026-04-13  
**Status:** Approved

## Problem

The "Identify partner after ace is played" feature (`reveal_partner`) has three bugs and one missing integration:

1. Changing the setting mid-hand immediately updates the partner name in the info bar and the partner badge — it should only take effect on the next hand.
2. The partner badge in `PlayerSeat` is always shown when the ace has been played, regardless of the `reveal_partner` setting. It should be hidden when the setting is `false`.
3. `reveal_partner` is not exposed in the create game dialog — only the in-game admin panel can set it.
4. The `AdminSettingsPanel` component is one-off and can't be reused elsewhere.

## Decisions

- **Hand-boundary semantics:** `reveal_partner` changes take effect at the next hand start, same as `no_pick_variant`. This is implemented by snapshotting the value into game state at `startHand()`.
- **Reusable component:** Extract a `GameOptionsPanel` modal component usable in both the lobby create flow and the in-game admin panel.
- **Modal everywhere:** The create game form uses the same modal pattern as the in-game admin (compact summary row + "Edit" button opens modal), keeping the form compact as options grow.

## Architecture

### New file: `frontend/src/components/GameOptionsPanel.jsx`

A self-contained modal component with two modes:

**`mode="create"`**
- Renders variant + reveal_partner fields
- No API calls — calls `onChange({ no_pick_variant, reveal_partner })` on each field change
- Parent (LobbyPage) collects values and passes them to `api.games.create()`

**`mode="update"`**
- Takes `gameId` prop
- Fires `PATCH /api/games/:id/settings` directly on each field change (same optimistic pattern as current `AdminSettingsPanel`)
- Calls `onUpdated(result)` on success

Both modes use a native `<dialog>` element. The parent controls open/close state via an `open` prop and an `onClose` callback. The trigger button lives in the parent.

### `functions/api/games/[id]/action.js` — hand-start snapshot

When a hand ends, `action.js` already re-reads `no_pick_variant` from the DB before calling `dealHand()`. `reveal_partner` should be read in the same block and written onto the new state:

```js
// Alongside the existing no_pick_variant re-read:
const freshGame = await env.DB.prepare(
  'SELECT no_pick_variant, reveal_partner FROM games WHERE id = ?'
).bind(gameId).first()

state = dealHand(playerIds, nextDealer, state.handNumber + 1, newMultiplier)
state.reveal_partner = freshGame.reveal_partner === 1
```

`state.reveal_partner` is frozen for the duration of a hand. Mid-hand DB changes have no effect until the next hand starts.

### `functions/api/games/index.js` (create endpoint)

Accept `reveal_partner` (boolean) in the request body. Write it to the `games` table on creation. Default to `true` if not provided.

### `frontend/src/lib/api.js`

Extend `api.games.create()` to accept an options object:

```js
create(name, variant, testMode, options = {})
// options: { reveal_partner }
```

### `frontend/src/pages/GamePage.jsx`

- Remove the inline `AdminSettingsPanel` component entirely
- Add `showOptions` boolean state
- Add "⚙ Game options" trigger button in:
  - The waiting room (game creator only)
  - The active game settings area (game creator only)
- Render `<GameOptionsPanel mode="update" ... />`
- Fix display bugs (see below)

### `frontend/src/pages/LobbyPage.jsx`

- Add `showOptions` boolean state + `gameOptions` state (`{ no_pick_variant, reveal_partner }`)
- Add compact options summary row with "Edit ⚙" button in the create form
- Render `<GameOptionsPanel mode="create" open={showOptions} onChange={setGameOptions} onClose={...} />`
- Pass `gameOptions.reveal_partner` to `api.games.create()`

## Display Bug Fixes (`GamePage.jsx`)

Both fixes gate on `state.reveal_partner` (the hand-snapshotted value) instead of the live DB value.

**Bug 1 — Info bar:**
```js
// Before
const showPartnerName = state.partnerRevealed && (revealPartner ?? gameData.reveal_partner ?? true)

// After
const showPartnerName = state.partnerRevealed && (state.reveal_partner ?? true)
```

**Bug 2 — Partner badge:**
```js
// Before
const partnerUserId = state.partnerRevealed ? state.partner : null

// After
const partnerUserId = (state.partnerRevealed && (state.reveal_partner ?? true)) ? state.partner : null
```

The `revealPartner` local state in `GamePage` is no longer used for display logic. It is retained only to seed `GameOptionsPanel` with the current value on open.

## Testing

In `gameEngine.test.js`:

- Construct a hand state with `reveal_partner: false` set — assert display logic correctly hides partner identity
- Construct a hand state with `reveal_partner: true` set — assert display logic correctly shows partner identity
- Construct a hand state without `reveal_partner` — assert it defaults to `true` (existing behavior preserved)
- Verify no existing partner-reveal tests break from the new state field

## Change Summary

| File | Change |
|---|---|
| `functions/api/games/[id]/action.js` | Snapshot `reveal_partner` into state at hand start |
| `shared/gameEngine.test.js` | Tests for `reveal_partner` in initial state and hand start |
| `functions/api/games/index.js` | Accept `reveal_partner` on game create |
| `frontend/src/lib/api.js` | Pass `reveal_partner` in `create()` |
| `frontend/src/components/GameOptionsPanel.jsx` | New reusable modal component |
| `frontend/src/pages/GamePage.jsx` | Remove `AdminSettingsPanel`, add modal trigger, fix display bugs |
| `frontend/src/pages/LobbyPage.jsx` | Add options modal trigger to create form |
