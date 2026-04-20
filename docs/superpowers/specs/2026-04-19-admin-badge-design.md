# Admin Badge — Design

**Date:** 2026-04-19
**Issue:** #113
**Related:** #137 (transfer admin role — separate follow-up)

## Summary

Add a visual badge identifying the **game admin** (the player with elevated privileges over a game's settings and flow) in the lobby, the in-game waiting area, and during gameplay. The current API exposes admin status only as a boolean about the *viewing* user, so other clients can't tell which other player is the admin. This design adds a forward-compatible API shape — `admin_user_id` at the game level and `is_game_admin` per player — that today resolves from `created_by`, but can be repointed at a future `admin_user_id` column when the transfer feature ships, without touching the frontend.

## Scope

**In scope:**

- Admin badge on `PlayerSeat` (visible during gameplay).
- Admin badge in the in-game waiting state's player list (`GamePage.jsx`).
- Admin badge on each row of the lobby's game list (`LobbyPage.jsx`), replacing the existing "your game" pill (which conveys the same information for one specific case).
- API additions: `admin_user_id` at the game level on both `GET /api/games` and `GET /api/games/[id]`; `is_game_admin: bool` per player on `GET /api/games/[id]`.

**Out of scope:**

- Recap / replay seats — this is post-game, the admin role isn't actionable, badge would be visual noise.
- Any actual transfer-of-admin logic — see #137.
- Any database schema changes.
- Any change to the existing `is_admin` field on game responses (kept for backwards compatibility — it remains "is the viewer the game admin").

## Terminology

This spec uses the project's standard terms:

- **Game admin** — the player with elevated privileges over a game (currently the player who created the game). Distinct from **site admin** (`users.is_admin` — system-wide privileges).

To keep these unambiguous in the API, the new fields use `game_admin` / `admin_user_id` rather than overloading `is_admin`.

## Data Layer

**No schema changes.** Today the game admin is resolved from `games.created_by`. The API hides this resolution behind the new fields so issue #137 can later swap in a dedicated `games.admin_user_id` column without any frontend change.

## API

### `GET /api/games/[id]` — `functions/api/games/[id]/index.js`

Add to the response body:

- `admin_user_id: number` — the user id of the current game admin. Populated from `game.created_by`.
- Each entry in `players` gets a new field `is_game_admin: bool`, set by comparing the player's `user_id` against `admin_user_id`.

The existing `is_admin: boolean` field (about the viewer) is preserved unchanged.

### `GET /api/games` — `functions/api/games/index.js`

Add to each game in the list:

- `admin_user_id: number` — same semantics as above. The endpoint already exposes `created_by` and `created_by_username`; `admin_user_id` is added alongside them as the canonical "who is admin" field for the lobby. `created_by` and `created_by_username` are kept (they convey "who *created* the game" and are still meaningful as historical attribution distinct from current admin).

Per-player `is_game_admin` is not needed here — the lobby list shows games, not seated players.

## Frontend

### Shared badge style — `frontend/src/index.css`

Add a new badge class `badge-game-admin` styled consistently with the existing `badge-dealer` / `badge-picker` family. Gold accent. The glyph (default: "★") is rendered via `::before { content: '★' }` on the CSS class — **not** inlined in JSX — so there is exactly one place to edit the glyph later. JSX renders an *empty* `<span className="badge badge-game-admin" aria-label="Game admin" />`; the glyph appears via CSS. Naming uses `badge-game-admin` (not `badge-admin`) to avoid collision with the existing **site admin** indicator in the lobby header (which today reuses `badge-dealer`).

### `frontend/src/components/PlayerSeat.jsx`

Accept a new prop `isGameAdmin: bool`. Render `<span className="badge badge-game-admin" aria-label="Game admin" />` (empty — the glyph is supplied by CSS) in the existing badge row, positioned after `badge-you` and before `badge-dealer` (admin status is the most stable identity, so it leads the role-specific badges).

### `frontend/src/pages/GamePage.jsx`

- In `seatProps()`, derive `isGameAdmin: String(player.user_id) === String(gameData.admin_user_id)` and pass to `PlayerSeat`.
- In the waiting-state player list (`<ul>` of player names around line 455), render the same badge inline next to the username when `String(p.user_id) === String(gameData.admin_user_id)`.

### `frontend/src/pages/LobbyPage.jsx`

- Remove the "your game" pill.
- For every game row, render the admin badge next to `game.created_by_username` when the row's admin is identifiable. Source: `game.admin_user_id` exposed by the list endpoint. Markup: `<span className="badge badge-game-admin" aria-label="Game admin" />` placed inline with the "by {created_by_username}" text (glyph comes from CSS, not JSX). The existing "by {created_by_username}" pattern stays — the badge sits inline with the username.
- The site admin badge in the lobby header (`badge-dealer` reused for the site admin label) is unchanged. (A future tidy-up could give site admin its own badge class, but that's out of scope.)

## Mobile App Considerations

The new API fields (`admin_user_id`, `is_game_admin`) are presentational metadata that any mobile client can consume identically to the web. No web-only assumptions are baked in. Per the project's mobile-app guidance, this is the right place to draw the line: the *who* of admin is in the API; the *how* of badge rendering stays in each frontend.

## Testing

- **API**: extend any existing tests for `GET /api/games/[id]` and `GET /api/games` to assert presence and correctness of `admin_user_id` and (for the single-game endpoint) `is_game_admin` per player. If no integration test scaffolding exists for these endpoints, manual verification via `npm run dev` + `curl` is acceptable for this UI-focused issue.
- **Frontend**: manual verification across the three surfaces (lobby, in-game waiting, in-game playing). Confirm the badge appears for the creator's seat across all three surfaces, does not appear for non-admin seats, and is rendered consistently in style with sibling badges.
- **No new game-engine logic** is introduced, so no `gameEngine.test.js` additions are required.

## Open Questions

_None remaining._ Glyph is "★", rendered via a single CSS `::before` rule so a future change is a one-line edit.

## Forward Compatibility With #137

When the transfer feature ships:

- `games.admin_user_id` column is added (default = `created_by` for existing rows; backfill).
- The resolver inside the two `GET` endpoints switches from `game.created_by` to `game.admin_user_id`. **No frontend change is required.**
- A new `POST /api/games/[id]/transfer-admin` endpoint and corresponding UI affordance are added.

This is the central reason for the API shape proposed here.
