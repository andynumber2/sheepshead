# Game Mode Visibility & Change Logging — Design

**Date:** 2026-04-18
**Issue:** https://github.com/andynumber2/sheepshead/issues/114

## Goal

Non-admin players currently have no visibility into the active game settings (no-pick variant, partner visibility, double-on-bump) once a game starts, and when the admin changes settings mid-game no other player is notified. This spec covers two deliverables:

1. Display the current settings summary to non-admin players in the same places admins already see it.
2. Append one line to the game's play-history log each time the admin closes the settings modal after making changes, showing the full post-change settings.

Both features must be forward-compatible with additional game settings added later and work for any client (web today, mobile eventually).

## Scope

In scope:

- The three existing settings: `no_pick_variant` (Leasters/Doublers/Schwanzers), `reveal_partner`, `double_on_bump`.
- Any future settings — the design must extend to them without rework.
- Display in the waiting screen and the active-play right panel.
- Log emission only during active play.

Out of scope:

- Changing when settings take effect (they still apply next hand).
- Changing which settings exist.
- Any log content beyond the settings summary line.
- Notification mechanisms other than the play-history log.

## Architecture

### Server: single extended endpoint

`PATCH /api/games/:id/settings` gains one optional boolean field: `log_change`.

- When `log_change: true`, after applying any setting updates in the same request, the endpoint reads `game_state.state_json`, appends one line to `state.log`, and writes it back.
- The line is built server-side from the current (post-patch) settings via a shared formatter. Clients never construct the string.
- When `log_change` is absent or false, the endpoint behaves exactly as today.
- If the game is in `waiting` status, the log append is skipped (no `game_state` row exists). Setting updates still persist normally.
- Validation: `log_change` must be a boolean if provided.

This shape works equally well for:

- Web auto-save-per-toggle, where a final `{ log_change: true }` PATCH with no setting fields flushes the log line.
- Mobile batch-save, where a single PATCH carries all settings plus `log_change: true`.

### Settings summary formatter

A single function — `formatSettingsSummary(settings)` — is the sole source of truth for the settings summary string. It returns the body only, without any prefix:

```
Leasters · Partner: shown · DOB
```

Consumers add their own context:

- **Log line** (server): prepends `Next Hand: ` → `Next Hand: Leasters · Partner: shown · DOB`
- **On-screen summary** (client, admin + non-admin): uses the body verbatim.

Every setting is rendered whether it changed or not. When a new setting is added, this formatter is the one place updated to include it.

The formatter lives in `shared/` (e.g., `shared/settingsSummary.js`) so both the server endpoint and the frontend import it. This guarantees admin view, non-admin view, and log line all stay in lockstep.

### Client: modal close-time flush

`GameOptionsPanel` (update mode only) tracks the settings snapshot taken when the modal opens. On close — whether via the Done button, Escape key, or backdrop click, all of which route through `onClose` — the panel compares the snapshot to the current values. If any differ, it issues one final call:

```js
api.games.updateSettings(gameId, { log_change: true })
```

No setting fields are included; the server uses the already-persisted values. If the snapshot matches current values, no call is made.

### Client: non-admin display

Extract the existing admin-only summary block into a small presentational helper:

```jsx
<SettingsSummary settings={…} />
```

Internally it calls `formatSettingsSummary(settings)` from `shared/` and renders the resulting body string, so admin view, non-admin view, and server-generated log line all stay in lockstep. Render it:

- In the waiting screen, in place of the current `No-pick variant: <X>` line, for non-admins.
- In the active-play right panel, below `LastTrickArea`, for non-admins.

The admin branch keeps its ⚙ Edit button alongside the same summary component.

## Components & Files

| File | Change |
|---|---|
| `functions/api/games/[id]/settings.js` | Accept `log_change` field; after persisting settings, if `log_change === true` and game status is `active`, append `Next Hand: <summary>` to `state.log` and write back. |
| `shared/settingsSummary.js` (new) | `formatSettingsSummary(settings)` — single source of truth for the summary body, imported by both server and frontend. |
| `frontend/src/components/GameOptionsPanel.jsx` | On modal open, capture `initialValues`. In `onClose` path, if current values differ from `initialValues` and `mode === 'update'`, send a final `updateSettings(gameId, { log_change: true })`. |
| `frontend/src/pages/GamePage.jsx` | Replace the two inline admin summary blocks with a small shared `<SettingsSummary>` component/helper; render it for non-admin players in both waiting and active-play views without the Edit button. |

`frontend/src/lib/api.js` needs no signature change — `updateSettings` already forwards the JSON body.

## Data Flow — admin editing session

1. Admin clicks ⚙ Edit → modal opens; snapshot `{ variant, reveal, dob }` saved.
2. Admin toggles `no_pick_variant` → `PATCH { no_pick_variant: 'leasters' }` → server persists, no log.
3. Admin toggles `double_on_bump` → `PATCH { double_on_bump: false }` → server persists, no log.
4. Admin clicks Done → modal `onClose` fires → snapshot differs → client sends `PATCH { log_change: true }` → server appends `Next Hand: Leasters · Partner: shown` to `state.log`.
5. All clients see the log update on their next poll.

## Edge Cases

- **No-op guard — nothing changed.** Admin opens modal, presses Done → snapshots match → no flush PATCH sent → no log entry.
- **Net-zero change.** Admin toggles a setting and reverts it to the original before closing → snapshots match → no log entry. (Intermediate PATCHes already persisted to the DB, but the final value equals the original so nothing to announce.)
- **Modal closes via Escape or backdrop.** Same `onClose` path, same behavior as Done.
- **Mid-hand change.** Settings still take effect next hand (unchanged from today). The `Next Hand:` prefix communicates this to all players.
- **Waiting screen.** Log append is skipped server-side even if the client sends `log_change: true`, because no `game_state` row exists yet. Setting persistence still works. Non-admins still see the summary on the waiting screen via the new shared component; log entries are irrelevant there since the log isn't rendered.
- **Multiple admins rapid-firing.** Only one admin can hold the modal open at a time per session, but if two admin sessions overlap, each emits its own log line on close. This matches the natural semantics.

## Testing

### Unit tests

- `formatSettingsSummary(settings)` — exhaustive combinations: each variant × reveal on/off × DOB on/off. Anchors the string format so regressions surface immediately.

### Integration / state-construction tests

Extend existing settings endpoint tests (or add new ones if none exist):

- PATCH with `log_change: true` during active game → `state.log` gets the `Next Hand: …` line.
- PATCH with `log_change: true` during waiting game → no log change; setting updates still persist.
- PATCH with `log_change: false` or absent → no log change even if settings change.
- PATCH with `log_change: true` and no setting fields → still emits the log line using the current persisted settings.
- PATCH with invalid `log_change` type → 400 with appropriate error.

### Manual verification

- Non-admin sees the summary on the waiting screen and the active-play right panel; no Edit button.
- Admin edits settings + presses Done → one `Next Hand: …` line appears in Play History for all players.
- Admin opens modal + presses Done without changing → no line appears.
- Admin changes and reverts before Done → no line appears.
- Admin presses Escape — same behavior as Done.

## Future Settings

When a new game setting is added, three places need updating:

1. Settings persistence (already the pattern: `settings.js` validator + `json_set` path).
2. `formatSettingsSummary` — add the new field to the rendered string.
3. `GameOptionsPanel` — add the control.

The log line format and non-admin display both update automatically because they consume the same formatter.
