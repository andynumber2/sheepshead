# Admin Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visual badge that identifies the game admin across the lobby, the in-game waiting state, and active gameplay — in a way that won't need to change when issue #137 (transfer-admin) ships.

**Architecture:** Extend the `GET /api/games` and `GET /api/games/[id]` responses with a forward-compatible admin identity (`admin_user_id` on the game; `is_game_admin: bool` per player). The resolver reads from `games.created_by` today; no schema changes. Render the badge by adding one CSS class (`badge-game-admin`) whose glyph is defined in a single CSS `::before` rule — JSX renders an empty span, so the glyph is swappable from one place.

**Tech Stack:** React 18 + Vite (frontend), Cloudflare Pages Functions + D1 (backend), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-04-19-admin-badge-design.md`
**Related:** #137 (admin transfer — separate follow-up)

**Branch / worktree:** `feature/admin-badge` in `.worktrees/admin-badge` (already created).

---

## File Map

- **Create**: (none)
- **Modify**:
  - `functions/api/games/[id]/index.js` — add `admin_user_id` + per-player `is_game_admin` to response
  - `functions/api/games/index.js` — add `admin_user_id` to each game in list response
  - `frontend/src/index.css` — add `.badge-game-admin` class with glyph via `::before`
  - `frontend/src/components/PlayerSeat.jsx` — accept `isGameAdmin` prop; render badge
  - `frontend/src/pages/GamePage.jsx` — pass `isGameAdmin` to each seat; badge in waiting-state player list
  - `frontend/src/pages/LobbyPage.jsx` — render admin badge per game row; remove "your game" pill
- **Tests**: no new automated tests (no existing API/frontend test harness; spec calls for manual verification). `npm test` must still pass (210 tests).

---

## Task 1: API — add admin identity to single-game response

**Files:**
- Modify: `functions/api/games/[id]/index.js` (lines 53-82)

- [ ] **Step 1: Add `is_game_admin` per player and `admin_user_id` to response body**

Replace the block that builds `playersWithScores` and the final `return json({...})`:

```js
    const adminUserId = game.created_by

    const playersWithScores = players.map(p => ({
      ...p,
      score:          scoreMap[p.user_id]?.game_score  ?? 0,
      day_score:      scoreMap[p.user_id]?.day_score    ?? 0,
      lifetime_score: lifetimeMap[p.user_id]            ?? 0,
      is_game_admin:  p.user_id === adminUserId,
    }))
```

And later, in the `return json({...})`:

```js
    return json({
      id:             game.id,
      name:           game.name,
      status:         game.status,
      is_admin:       game.created_by === user.user_id,
      admin_user_id:  adminUserId,
      settings,
      players:        playersWithScores,
      state:          stateView,
    })
```

Leave the existing `is_admin` field untouched — it still describes the viewer.

- [ ] **Step 2: Verify the endpoint returns the new fields**

Run the dev server and call the endpoint with a known game id (use any existing waiting game, or create one via the UI):

```bash
npm run dev    # runs Vite + Wrangler; kill with Ctrl+C when done
```

In another shell:

```bash
# Log in via the UI first to get a session cookie, then hit the endpoint
# (or use the existing browser tab's devtools network panel to confirm the response shape)
```

Expected: response JSON now contains `admin_user_id: <number>` at the top level, and each `players[i]` contains `is_game_admin: <bool>` (true for exactly one player — the creator).

- [ ] **Step 3: Run existing tests to confirm nothing breaks**

Run: `npm test`
Expected: 210 tests pass (shared game-engine tests are unaffected).

- [ ] **Step 4: Commit**

```bash
git add functions/api/games/\[id\]/index.js
git commit -m "feat(api): add admin_user_id and per-player is_game_admin to game detail response"
```

---

## Task 2: API — add admin identity to lobby list response

**Files:**
- Modify: `functions/api/games/index.js` (lines 33-46)

- [ ] **Step 1: Add `admin_user_id` to each game in the list**

In the `.map(g => { ... })` inside `listGames`, add `admin_user_id`:

```js
  return json(results.map(g => {
    const settings = JSON.parse(g.settings_json)
    return {
      id:                   g.id,
      name:                 g.name,
      status:               g.status,
      created_by:           g.created_by,
      created_by_username:  g.created_by_username,
      player_count:         g.player_count,
      is_member:            g.is_member === 1,
      is_admin:             g.created_by === user.user_id,
      admin_user_id:        g.created_by,
      settings,
    }
  }))
```

No SQL change — `g.created_by` is already selected.

- [ ] **Step 2: Verify**

Refresh the lobby in the browser with the dev server running. In devtools, inspect the response body for `GET /api/games` — each game object should now include `admin_user_id`.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 210 tests pass.

- [ ] **Step 4: Commit**

```bash
git add functions/api/games/index.js
git commit -m "feat(api): add admin_user_id to game list response"
```

---

## Task 3: CSS — add the `badge-game-admin` class with a single-source glyph

**Files:**
- Modify: `frontend/src/index.css` (around lines 189-196, sibling badges)

- [ ] **Step 1: Add the new class block**

Insert the new rule immediately below the existing badge color rules (after `.badge-blitz-red` on line 196):

```css
/* Game admin badge — glyph defined here in ONE place so it can be changed
   without editing JSX. JSX renders an empty <span class="badge badge-game-admin" />. */
.badge-game-admin {
  background: #eab308;
  color: #000;
  display: inline-block;
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 4px;
}
.badge-game-admin::before { content: '★'; }
```

Rationale for self-contained sizing (unlike `.badge-dealer` which relies on the scoped `.player-seat .badge` rule): this badge appears both inside `.player-seat` *and* in the lobby / waiting list, so it needs baseline sizing that works in any context.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(ui): add .badge-game-admin class with single-source glyph"
```

---

## Task 4: PlayerSeat — render the badge when the seat holds the game admin

**Files:**
- Modify: `frontend/src/components/PlayerSeat.jsx` (props list lines 5-23; badge row lines 36-56)

- [ ] **Step 1: Add `isGameAdmin` to props**

Update the function signature at line 5-23 to include `isGameAdmin` in the destructured props list. Place it just after `isYou`:

```jsx
export default function PlayerSeat({
  player,
  isDealer,
  isPicker,
  isGoingAlone,
  isPartner,
  isYou,
  isGameAdmin,
  isActiveTurn,
  blitzType,
  dayScore,
  lifetimeScore,
  hand,
  showFaceUp,
  playableIds,
  onCardClick,
  noOverlap,
  onCrack,
  onRecrack,
}) {
```

- [ ] **Step 2: Render the badge inside the existing badge row**

In the badge row (starting at line 36), insert the game admin badge immediately after `badge-you` and before `badge-dealer`:

```jsx
      <div style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 3 }}>
        {player.username}
        {player.bot_type === 'play' && <span className="badge badge-bot">BOT</span>}
        {isYou     && <span className="badge badge-you">you</span>}
        {isGameAdmin && <span className="badge badge-game-admin" aria-label="Game admin" />}
        {isDealer  && <span className="badge badge-dealer">D</span>}
        {isPicker && !isGoingAlone && <span className="badge badge-picker">picker</span>}
        {isGoingAlone && <span className="badge badge-alone">alone</span>}
        {isPicker && blitzType === 'black' && <span className="badge badge-blitz-black">Black Blitz</span>}
        {isPicker && blitzType === 'red'   && <span className="badge badge-blitz-red">Red Blitz</span>}
        {isPartner && <span className="badge badge-partner">partner</span>}
        {onCrack   && (
          <button onClick={onCrack} style={{ fontSize: '0.6rem', padding: '1px 4px', lineHeight: 1.4, marginLeft: 2 }}>
            crack
          </button>
        )}
```

(The empty span is intentional — the glyph comes from CSS.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PlayerSeat.jsx
git commit -m "feat(ui): render game admin badge in PlayerSeat"
```

---

## Task 5: GamePage — wire `isGameAdmin` into seats and waiting-state list

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx` (destructure around line 384; `seatProps` around line 518; waiting-state `<ul>` around line 455)

- [ ] **Step 1: Pull `admin_user_id` out of `gameData`**

Update the destructuring of `gameData` (starting at line 384) to include `admin_user_id`:

```jsx
  const {
    players,
    state,
    status,
    is_admin:      isGameAdmin,
    admin_user_id: adminUserId,
    settings: {
      is_test_mode:    isTestMode,
      no_pick_variant: noPickVariant,
    } = {},
  } = gameData
```

Note: `isGameAdmin` here (destructured from `is_admin`) is the **viewer's** admin status. The per-seat flag is different — see next step.

- [ ] **Step 2: Pass `isGameAdmin` to `PlayerSeat` from `seatProps`**

In `seatProps(player)` (around line 518), add a line that compares the player's `user_id` to `adminUserId`, and pass it into the returned props object:

```jsx
    return {
      isDealer:      uid === dealerUserId,
      isPicker:      uid === pickerUserId,
      isGoingAlone:  uid === pickerUserId && !!state.goingAlone,
      isPartner:     uid === partnerUserId,
      isYou:         uid === myUserId,
      isGameAdmin:   String(adminUserId) === uid,
      isActiveTurn:  uid === turnUserId,
      blitzType:     uid === pickerUserId ? blitz?.type : undefined,
      cardCount:     hand.length,
      // ...rest unchanged
```

- [ ] **Step 3: Add the badge to the waiting-state player list**

In the `status === 'waiting'` branch, locate the `<ul>` (around line 455):

```jsx
        <ul>{players.map(p => <li key={p.user_id}>{p.username}</li>)}</ul>
```

Replace with:

```jsx
        <ul>{players.map(p => (
          <li key={p.user_id}>
            {p.username}
            {String(p.user_id) === String(adminUserId) && (
              <span className="badge badge-game-admin" aria-label="Game admin" style={{ marginLeft: 6 }} />
            )}
          </li>
        ))}</ul>
```

- [ ] **Step 4: Verify**

Run: `npm run dev` — in the browser:
1. Create a game (you are the admin). In the waiting room, confirm the star appears next to your name in the player list.
2. Join with another account (or use test mode with bots). Start the game. Confirm the star appears on the admin's seat at the table and does not appear on other seats.

Run: `npm run build` — expected: build succeeds.
Run: `npm test` — expected: 210 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/GamePage.jsx
git commit -m "feat(ui): show game admin badge in seats and waiting-state list"
```

---

## Task 6: LobbyPage — show the badge per game row, replace "your game" pill

**Files:**
- Modify: `frontend/src/pages/LobbyPage.jsx` (game row around lines 199-220)

- [ ] **Step 1: Replace the "your game" pill with the admin badge next to the creator's name**

Locate the game-row block starting at line 199:

```jsx
          <article key={game.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong>{game.name}</strong>
                {game.is_admin && (
                  <span className="badge badge-dealer" style={{ marginLeft: 6 }}>your game</span>
                )}
                {game.settings?.is_test_mode && (
                  <span className="badge" style={{ background: '#7c3aed', color: '#fff', marginLeft: 6 }}>test</span>
                )}
                <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#888' }}>
                  by {game.created_by_username}
                </span>
```

Replace with:

```jsx
          <article key={game.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong>{game.name}</strong>
                {game.settings?.is_test_mode && (
                  <span className="badge" style={{ background: '#7c3aed', color: '#fff', marginLeft: 6 }}>test</span>
                )}
                <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#888' }}>
                  by {game.created_by_username}
                  <span
                    className="badge badge-game-admin"
                    aria-label="Game admin"
                    style={{ marginLeft: 4 }}
                  />
                </span>
```

The admin badge now appears on **every** game row next to the creator's name (not only when it's your game). The "your game" pill is removed because the admin badge plus the visible username already conveys the same information.

- [ ] **Step 2: Verify**

Run: `npm run dev`. Open the lobby:
1. Confirm every game row shows a star next to `by <username>`.
2. Confirm the "your game" pill is gone from games you created.
3. Confirm nothing else shifted layout-wise.

Run: `npm run build` — expected: build succeeds.
Run: `npm test` — expected: 210 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LobbyPage.jsx
git commit -m "feat(ui): show game admin badge per lobby row; drop 'your game' pill"
```

---

## Task 7: End-to-end manual verification

- [ ] **Step 1: Walk the three surfaces with the dev server running**

Run: `npm run dev`

As the game creator:
1. **Lobby:** Create a new game. Confirm the new row in the lobby shows the star next to `by <you>`. Open a second browser / incognito and register/login as a second user; from that session the star on your game still appears (admin identity is not viewer-specific).
2. **Waiting state:** Enter the game. Confirm the star appears next to your name in the `<ul>` player list.
3. **Active gameplay:** Fill with bots and start. Confirm the star appears on your seat (the `seat-bottom`) and not on any bot seats.

- [ ] **Step 2: Cross-check that no regressions appeared**

- Dealer `D`, picker, partner, you, BOT badges still render normally.
- Lobby status, player count, and Join/Rejoin buttons unchanged.
- Test-mode pill still appears on test games.

- [ ] **Step 3: Final test run**

Run: `npm test`
Expected: 210 tests pass.

Run: `npm run build`
Expected: build succeeds with no warnings introduced by this change.

---

## Out of scope (deliberately)

- Recap / replay screens (`ReplaySeat` etc.) — spec says post-game role is not actionable.
- Site admin badge in lobby header — unchanged (separate concern).
- Any schema change or transfer endpoint — that's #137.
