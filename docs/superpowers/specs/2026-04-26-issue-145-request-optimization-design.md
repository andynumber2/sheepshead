# Request Optimization (Smart Polling) — Design

**Issue:** [#145](https://github.com/andynumber2/sheepshead/issues/145)
**Related:** [#149](https://github.com/andynumber2/sheepshead/issues/149) (Durable Objects + WebSockets — long-term replacement)
**Date:** 2026-04-26
**Status:** Approved

## Context

The Cloudflare dashboard shows ~345K Worker requests/week from a single user, driven by a sustained ~0.5 req/sec idle baseline. Audit (in #145) traced this to `frontend/src/pages/GamePage.jsx:201-205`:

```js
useEffect(() => {
  fetchGame()
  pollingRef.current = setInterval(fetchGame, 2000)
  return () => clearInterval(pollingRef.current)
}, [fetchGame])
```

This `setInterval` polls `GET /api/games/[id]` every 2s unconditionally. It runs while the game is `complete`, while `waiting` for players, and while the browser tab is hidden. Each poll triggers ~7 D1 queries on the server. `LobbyPage.jsx:34` polls `/api/games` every 5s with the same lack of gating.

Issue #149 tracks the long-term fix: re-architect in-flight game state onto Durable Objects with WebSocket subscriptions, eliminating polling. This spec is the "stop the bleeding" change that lands first and stands alone.

## Goals

- Cut Worker requests to **< 50K / week** (from 345K).
- Pause polling when nothing meaningful can change: tab hidden, game `complete`, no current game.
- Slow polling when changes are infrequent: lobby (5s), waiting-for-players (5s).
- Cache the `score_timezone` config singleton in Worker module scope.
- Introduce a frontend abstraction (`useGameState(gameId)` hook) so the future Durable Objects transport in #149 is a one-file swap.

## Non-Goals

- ETag / `304 Not Modified` short-circuit on `GET /api/games/[id]` — deferred to #149 ([noted in comment](https://github.com/andynumber2/sheepshead/issues/149#issuecomment-4323677349)). Smart polling alone is projected to hit the target; any ETag plumbing built now would be deleted when push-based transport lands.
- Reducing the 6 remaining queries on `GET /api/games/[id]` (beyond the config cache) — #149 rewrites that path.
- Real-time push (SSE / WebSocket) — that is #149.
- Indexes, query consolidation, payload shrinking — same reason.
- Server-side changes to handle the new client cadence — server stays stateless and identical; only the client behaves more politely.

## Architecture

### Polling state machine (client-side)

A single rule decides the effective polling interval at each tick:

| Condition | Effective interval |
|---|---|
| `document.hidden` | none (interval cleared) |
| `game.status === 'complete'` | none |
| `game.status === 'waiting'` | 5000 ms |
| `game.status === 'active'` | 2000 ms |
| Lobby page (no `gameId`) | 5000 ms, also subject to visibility gate |

When `document.visibilityState` flips back to `visible`, fire one immediate fetch then resume the cadence above.

### Server-side cache

`score_timezone` is a singleton config row currently fetched on every `GET /api/games/[id]` call. Move to a Worker module-scope memoized lookup. No invalidation logic — config is set once at deploy time, isolates eventually recycle, and a fresh deploy guarantees fresh isolates.

### Seam for Durable Objects (#149)

A single React hook, `useGameState(gameId)`, encapsulates all transport. Its return shape (`{ game, loading, error, refresh }`) becomes the contract that #149 will swap polling for WebSocket behind, with no consumer changes.

## Components

### `frontend/src/hooks/useGameState.js` (new)

The seam. Encapsulates fetch + interval management + visibility handling.

**Returns:** `{ game, loading, error, refresh }`

**Behavior:**
- Fetches `GET /api/games/[id]` on mount.
- Computes effective interval from `game.status` and `document.hidden` per the table above.
- Subscribes to `visibilitychange`: on `visible`, do an immediate fetch then resume the interval.
- Cleans up the interval on unmount and whenever the effective interval changes (no overlapping timers).
- Cancels the active interval and starts a new one when `gameId` changes.
- `refresh()` triggers an immediate fetch without disturbing the interval cadence.

**Critical invariant:** at most one timer alive per hook instance at any time. The bug we are fixing is "intervals accumulate or persist past their useful life" — this hook must not reproduce it.

### `frontend/src/pages/GamePage.jsx` (modified)

Delete the `pollingRef` / `useEffect` / `setInterval` block at lines 201–205 and the `fetchGame` plumbing. Replace with:

```js
const { game, loading, error, refresh } = useGameState(gameId)
```

Action handlers (`handlePick`, `handlePlay`, etc.) call `refresh()` after a successful POST so the UI reflects the post-action state immediately rather than waiting for the next tick.

### `frontend/src/pages/LobbyPage.jsx` (modified)

Inline change — no hook abstraction (lobby is explicitly out-of-scope for the WebSocket migration in #149's first cut).

- Keep the existing 5000 ms cadence on `loadGames`.
- Add a `visibilitychange` listener: pause when hidden, do an immediate fetch and resume when visible.
- Verify the existing cleanup on unmount still holds.

### `functions/api/games/[id]/index.js` (modified)

Replace the per-request `SELECT value FROM config WHERE key = 'score_timezone'` query with a memoized lookup:

```js
let scoreTimezoneCache = null
async function getScoreTimezone(db) {
  if (scoreTimezoneCache) return scoreTimezoneCache
  const row = await db.prepare(
    "SELECT value FROM config WHERE key = 'score_timezone'"
  ).first()
  scoreTimezoneCache = row?.value ?? 'America/Chicago'
  return scoreTimezoneCache
}
```

If the same singleton is read from any other endpoint (quick check during implementation), promote the helper to `functions/api/_helpers.js` so all routes share the cache. Otherwise leave inline.

## Data Flow

1. User opens a game page → `GamePage` mounts → `useGameState(gameId)` mounts.
2. Hook fires initial fetch → server runs the 6 game-fetch queries + (cold-isolate only) 1 config query.
3. Hook starts a 2000 ms interval (game is `active`) or 5000 ms (game is `waiting`).
4. On every tick, hook re-fetches; server reuses cached `score_timezone` (warm isolate).
5. User switches tabs away → `visibilitychange` fires → hook clears the interval. Zero requests.
6. User switches back → `visibilitychange` fires → hook does one immediate fetch and restarts the interval.
7. Hand finishes, game state moves to `complete` → next tick reads the new status → hook clears the interval. Zero further requests.
8. User navigates away → `GamePage` unmounts → hook cleanup clears the interval.

## Error Handling

- Failed fetches surface via the hook's `error` state. No retry-with-backoff in this spec — the next tick is the retry. (Adding backoff is in scope only if testing reveals tight failure loops, which the gating already mitigates.)
- The hook never throws synchronously from the timer callback; errors are caught and stored in state.

## Testing

### Unit — `frontend/src/hooks/useGameState.test.js` (new)

Use React Testing Library + fake timers + `vi.spyOn` on `fetch`. Cover:

- Polls every 2000 ms when `game.status === 'active'`.
- Polls every 5000 ms when `game.status === 'waiting'`.
- Stops polling when `game.status === 'complete'`.
- Stops polling when `document.hidden` becomes true; resumes (with an immediate fetch) when it becomes false.
- Cleans up the interval on unmount — assert no leaked timers.
- Switching `gameId` cancels the old interval and starts a new one.
- `refresh()` triggers an immediate fetch without disturbing cadence.

### Integration — `GamePage`

Light touch. Existing GamePage tests (if any) should pass without modification — that's the seam working.

### Backend — config cache

Single test in the existing pattern (or add one if none exists): two consecutive calls to `getScoreTimezone` hit the DB once. Stub the D1 binding's `prepare(...).first()` and assert call count.

### Manual verification (required before declaring done)

Run `npm run dev` and watch the network panel:
- Idle on `/lobby` → one request every 5 s; stops when tab hidden.
- Mid-game → one request every 2 s; stops when tab hidden.
- Game completes → polling stops.
- Switch tab away and back → polling pauses then resumes with one immediate fetch.

This is behavior that passes unit tests and silently regresses in production. The manual check is non-negotiable.

## Mobile App Considerations

CLAUDE.md flags that a mobile app is on the roadmap. Recording the implications so future mobile work has the context:

- **Polling endpoint contract is unchanged** — mobile can call the same `GET /api/games/[id]` if it ships before #149.
- **`useGameState` hook is web-only**, but the *concept* — a single subscription primitive that abstracts transport — translates directly to a mobile equivalent (Swift/Kotlin observer, React Native hook). The lesson the seam encodes is what mobile needs.
- **Visibility handling is web-specific** (`document.visibilitychange`). Mobile has its own foreground/background lifecycle; the same gating concept applies but the trigger is the platform's app-lifecycle event. Worth wiring up explicitly on mobile so it doesn't poll continuously.
- **2 s active cadence is aggressive on cellular.** When mobile lands before #149, use a more conservative cadence (5 s active, 10 s waiting). Better: mobile may want to wait for #149 entirely so it ships on WebSocket from day one.

## Success Criteria

The change is done when **all** of the following hold:

1. **Unit tests pass** for `useGameState` covering every cadence/visibility transition.
2. **Manual verification confirms** each of the four browser behaviors above.
3. **Cloudflare dashboard, after one week of post-deploy traffic**, shows:
   - Worker requests: **< 50K / week** (down from 345K).
   - Idle baseline (rolling 1-hour window with no active gameplay): **< 100 requests/hour** (down from ~1,800).
   - Per-request D1 query count on `GET /api/games/[id]`: **6** (down from 7).
4. **No regressions** in observed gameplay — the game still feels live during play, lobby still updates, action POSTs still reflect immediately.

The week-long check is the real gate. If smart polling does not close the gap to target, that is the signal to revisit deferred ETag work earlier than #149 — not by re-opening this design, but by filing a follow-up.

## Rollout

- Single PR, single deploy. No flag — the changes are pure client-side gating + a server-side cache that defaults to identical behavior.
- Post-deploy: monitor the Cloudflare dashboard daily for the first week. The 1-hour idle baseline should drop within minutes of deploy as soon as the user closes the tab.
- Rollback: standard `git revert` of the PR. No schema migration to undo.
