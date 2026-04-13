# Identify Partner Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs in the "Identify partner after ace is played" feature, add it to the create game dialog, and extract a reusable `GameOptionsPanel` modal component.

**Architecture:** `reveal_partner` is snapshotted from the DB into game state at each hand start (in `finishHand` and the doublers re-deal path), making it authoritative for display during a hand. A new `GameOptionsPanel` component handles both the create-game flow (mode="create", no API calls) and the in-game admin panel (mode="update", auto-saves via PATCH). `GamePage` and `LobbyPage` use this component via a modal trigger button.

**Tech Stack:** React 18, Cloudflare Workers Functions, Cloudflare D1 (SQLite), Vitest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `shared/gameEngine.js` | Modify | Fix `getPlayerView` to respect `reveal_partner` |
| `shared/gameEngine.test.js` | Modify | Add `reveal_partner` tests |
| `functions/api/_botHelpers.js` | Modify | Snapshot `reveal_partner` in `finishHand` |
| `functions/api/games/[id]/action.js` | Modify | Snapshot `reveal_partner` in doublers re-deal |
| `functions/api/games/index.js` | Modify | Accept `reveal_partner` + schwanzers in create; snapshot in test mode deal |
| `frontend/src/lib/api.js` | Modify | Add `revealPartner` option to `create()` |
| `frontend/src/components/GameOptionsPanel.jsx` | Create | Reusable modal for game options |
| `frontend/src/pages/GamePage.jsx` | Modify | Remove `AdminSettingsPanel`, fix display bugs, use `GameOptionsPanel` |
| `frontend/src/pages/LobbyPage.jsx` | Modify | Replace variant fieldset with options summary row + modal |

---

### Task 1: Tests for `reveal_partner` in `getPlayerView`

**Files:**
- Modify: `shared/gameEngine.test.js`

- [ ] **Step 1: Add failing tests to the `getPlayerView` describe block**

Open `shared/gameEngine.test.js`. After the existing `'partner identity is hidden from opponents when partnerRevealed is false'` test (around line 1500), add two new tests inside the `describe('getPlayerView')` block:

```js
it('partner identity is hidden from opponents when reveal_partner is false, even if partnerRevealed is true', () => {
  const state = { ...makeViewState(), partnerRevealed: true, reveal_partner: false }

  const oppView = getPlayerView(state, 'p3')
  expect(oppView.partner).toBeNull()

  const pickerView = getPlayerView(state, 'p1')
  expect(pickerView.partner).toBe('p2')   // picker always sees partner

  const partnerView = getPlayerView(state, 'p2')
  expect(partnerView.partner).toBe('p2')  // partner sees themselves
})

it('partner identity is visible to opponents when reveal_partner is true and partnerRevealed is true', () => {
  const state = { ...makeViewState(), partnerRevealed: true, reveal_partner: true }
  const oppView = getPlayerView(state, 'p3')
  expect(oppView.partner).toBe('p2')
})
```

- [ ] **Step 2: Run the new tests and confirm they fail**

```bash
npx vitest run shared/gameEngine.test.js --reporter=verbose 2>&1 | grep -A 5 "reveal_partner"
```

Expected: both new tests FAIL — `getPlayerView` doesn't check `reveal_partner` yet.

---

### Task 2: Fix `getPlayerView` to respect `reveal_partner`

**Files:**
- Modify: `shared/gameEngine.js` (around line 914)

- [ ] **Step 1: Update the partner-hiding condition in `getPlayerView`**

Find this block in `shared/gameEngine.js` (around line 914):

```js
  // Hide partner identity until revealed (don't expose to non-partners)
  if (!view.partnerRevealed && view.partner && view.partner !== userId && view.picker !== userId) {
    view.partner = null
  }
```

Replace it with:

```js
  // Hide partner identity from bystanders when:
  // 1. The ace hasn't been played yet (partnerRevealed is false), OR
  // 2. The "identify partner" game option is disabled (reveal_partner is false)
  const partnerVisible = view.partnerRevealed && (view.reveal_partner ?? true)
  if (!partnerVisible && view.partner && view.partner !== userId && view.picker !== userId) {
    view.partner = null
  }
```

- [ ] **Step 2: Run all tests and confirm the new tests pass and nothing regresses**

```bash
npx vitest run shared/gameEngine.test.js --reporter=verbose 2>&1 | tail -20
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/gameEngine.js shared/gameEngine.test.js
git commit -m "fix: getPlayerView respects reveal_partner setting to hide partner identity"
```

---

### Task 3: Snapshot `reveal_partner` into game state at hand start

**Files:**
- Modify: `functions/api/_botHelpers.js` (line 42 area)
- Modify: `functions/api/games/[id]/action.js` (line 67 area)

- [ ] **Step 1: Update `finishHand` to snapshot `reveal_partner`**

In `functions/api/_botHelpers.js`, find the `finishHand` function. After this line:

```js
  const nextState = dealHand(playerIds, nextDealer, state.handNumber + 1, 1)
```

Add:

```js
  const gameRow = await DB.prepare('SELECT reveal_partner FROM games WHERE id = ?').bind(gameId).first()
  nextState.reveal_partner = gameRow.reveal_partner === 1
```

The full block around that area should now look like:

```js
  const nextState = dealHand(playerIds, nextDealer, state.handNumber + 1, 1)

  const gameRow = await DB.prepare('SELECT reveal_partner FROM games WHERE id = ?').bind(gameId).first()
  nextState.reveal_partner = gameRow.reveal_partner === 1

  nextState.log = [...state.log, `--- Hand ${state.handNumber} complete ---`]
  nextState.lastTrick = state.lastTrick
```

- [ ] **Step 2: Update the doublers re-deal path in `action.js` to snapshot `reveal_partner`**

In `functions/api/games/[id]/action.js`, find the `pass` case around line 67. Change the existing DB query from:

```js
          const freshGame = await env.DB.prepare('SELECT no_pick_variant FROM games WHERE id = ?').bind(gameId).first()
```

To:

```js
          const freshGame = await env.DB.prepare('SELECT no_pick_variant, reveal_partner FROM games WHERE id = ?').bind(gameId).first()
```

Then, after this existing line (around line 82-84):

```js
          state = dealHand(playerIds, nextDealer, state.handNumber + 1, newMultiplier)
          state.doublerMultiplier = newMultiplier
          state.log.push(`Doubler! Stakes are now ×${newMultiplier}.`)
```

Add:

```js
          state.reveal_partner = freshGame.reveal_partner === 1
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/_botHelpers.js functions/api/games/[id]/action.js
git commit -m "feat: snapshot reveal_partner into game state at each hand start"
```

---

### Task 4: Accept `reveal_partner` in the create endpoint and update `api.js`

**Files:**
- Modify: `functions/api/games/index.js`
- Modify: `frontend/src/lib/api.js`

- [ ] **Step 1: Update the create endpoint to accept `reveal_partner` and `schwanzers`**

In `functions/api/games/index.js`, in the `createGame` function, find these lines (around line 72-73):

```js
  const name         = body?.name?.trim() || `${user.username}'s game`
  const noPickVariant = body?.no_pick_variant === 'doublers' ? 'doublers' : 'leasters'
  const testMode     = !!(body?.test_mode && user.is_admin)
```

Replace with:

```js
  const name         = body?.name?.trim() || `${user.username}'s game`
  const VALID_VARIANTS = ['leasters', 'doublers', 'schwanzers']
  const noPickVariant  = VALID_VARIANTS.includes(body?.no_pick_variant) ? body.no_pick_variant : 'leasters'
  const revealPartner  = typeof body?.reveal_partner === 'boolean' ? body.reveal_partner : true
  const testMode       = !!(body?.test_mode && user.is_admin)
```

- [ ] **Step 2: Write `reveal_partner` to the DB on game creation**

Find the INSERT statement (around line 84-86):

```js
  const result = await env.DB.prepare(
    'INSERT INTO games (name, no_pick_variant, is_test_mode, created_by) VALUES (?, ?, ?, ?)'
  ).bind(name, noPickVariant, testMode ? 1 : 0, user.user_id).run()
```

Replace with:

```js
  const result = await env.DB.prepare(
    'INSERT INTO games (name, no_pick_variant, reveal_partner, is_test_mode, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(name, noPickVariant, revealPartner ? 1 : 0, testMode ? 1 : 0, user.user_id).run()
```

- [ ] **Step 3: Snapshot `reveal_partner` in the test mode initial deal**

In the test mode block (around line 111), after:

```js
    const state = dealHand(allPlayers.map(String), 0, 1, 1)
```

Add:

```js
    state.reveal_partner = revealPartner
```

- [ ] **Step 4: Update `api.games.create` to pass `reveal_partner`**

In `frontend/src/lib/api.js`, change line 27:

```js
    create:         (name, noPickVariant, testMode) => request('POST',  '/games', { name, no_pick_variant: noPickVariant, test_mode: testMode }),
```

To:

```js
    create:         (name, noPickVariant, testMode, options = {}) => request('POST',  '/games', { name, no_pick_variant: noPickVariant, test_mode: testMode, ...options }),
```

- [ ] **Step 5: Commit**

```bash
git add functions/api/games/index.js frontend/src/lib/api.js
git commit -m "feat: accept reveal_partner and schwanzers in game create endpoint"
```

---

### Task 5: Build `GameOptionsPanel` component

**Files:**
- Create: `frontend/src/components/GameOptionsPanel.jsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/GameOptionsPanel.jsx` with this content:

```jsx
import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api.js'

const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers', schwanzers: 'Schwanzers' }

/**
 * Reusable game options modal.
 *
 * mode="create"  — no API calls; calls onChange({ no_pick_variant, reveal_partner }) on each change.
 * mode="update"  — auto-saves via PATCH /api/games/:gameId/settings on each change; calls onUpdated(result).
 *
 * The parent controls open/close via the `open` prop and `onClose` callback.
 */
export default function GameOptionsPanel({ mode, gameId, open, values, onChange, onUpdated, onClose }) {
  const dialogRef  = useRef(null)
  const [variant, setVariant] = useState(values?.no_pick_variant ?? 'leasters')
  const [reveal,  setReveal]  = useState(values?.reveal_partner  ?? true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  // Re-sync form from parent values each time the panel opens
  useEffect(() => {
    if (open) {
      setVariant(values?.no_pick_variant ?? 'leasters')
      setReveal(values?.reveal_partner  ?? true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Drive the native <dialog> open/close
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) dialog.showModal()
    } else {
      if (dialog.open) dialog.close()
    }
  }, [open])

  async function handleVariantChange(v) {
    setVariant(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: v, reveal_partner: reveal })
    } else {
      await save({ no_pick_variant: v })
    }
  }

  async function handleRevealChange(v) {
    setReveal(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: variant, reveal_partner: v })
    } else {
      await save({ reveal_partner: v })
    }
  }

  async function save(patch) {
    setSaving(true)
    setSaved(false)
    try {
      const result = await api.games.updateSettings(gameId, patch)
      setSaved(true)
      onUpdated?.(result)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* revert handled by parent re-poll */ }
    finally { setSaving(false) }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      style={{
        background: '#1a1a2e',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        padding: '18px 22px',
        color: '#fff',
        minWidth: 300,
        maxWidth: 420,
      }}
    >
      <strong style={{ fontSize: '0.95rem' }}>⚙ Game options</strong>
      {mode === 'update' && (
        <small style={{ color: '#aaa', display: 'block', marginBottom: 12, marginTop: 2 }}>
          Changes take effect next hand
        </small>
      )}
      {mode === 'create' && (
        <div style={{ marginBottom: 12 }} />
      )}

      {/* No-pick variant */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: '#ccc', fontSize: '0.82rem', marginBottom: 4 }}>No-pick variant:</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {['leasters', 'doublers', 'schwanzers'].map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="radio"
                name={`variant-${gameId ?? 'create'}`}
                value={v}
                checked={variant === v}
                onChange={() => handleVariantChange(v)}
                disabled={saving}
              />
              {VARIANT_LABELS[v]}
            </label>
          ))}
        </div>
      </div>

      {/* Identify partner */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: '#ccc', fontSize: '0.82rem', marginBottom: 4 }}>
          Identify partner after ace is played?
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[true, false].map(v => (
            <label key={String(v)} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="radio"
                name={`reveal-${gameId ?? 'create'}`}
                value={String(v)}
                checked={reveal === v}
                onChange={() => handleRevealChange(v)}
                disabled={saving}
              />
              {v ? 'Yes' : 'No'}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.82rem' }}>
          {mode === 'update' && saving && <span style={{ color: '#aaa' }}>Saving…</span>}
          {mode === 'update' && saved  && <span style={{ color: '#4ade80' }}>✓ Saved</span>}
        </div>
        <button
          onClick={onClose}
          style={{ fontSize: '0.85rem', padding: '4px 16px' }}
        >
          Done
        </button>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/GameOptionsPanel.jsx
git commit -m "feat: add GameOptionsPanel reusable modal component (create + update modes)"
```

---

### Task 6: Update `GamePage.jsx` — replace `AdminSettingsPanel`, fix display bugs

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 1: Add the import for `GameOptionsPanel` at the top of `GamePage.jsx`**

After the existing imports (around line 8), add:

```js
import GameOptionsPanel from '../components/GameOptionsPanel.jsx'
```

- [ ] **Step 2: Add `showOptions` state**

In the `GamePage` component, find the state declarations (around line 210). After:

```js
  const [revealPartner, setRevealPartner]   = useState(null)
```

Add:

```js
  const [showOptions, setShowOptions]       = useState(false)
```

- [ ] **Step 3: Delete the entire `AdminSettingsPanel` function**

Remove the function from line 44 to line 121 (the entire `function AdminSettingsPanel(...)` block including its closing `}`).

- [ ] **Step 4: Fix the `showPartnerName` display bug**

Find this line (around line 535, now shifted after the deletion):

```js
  const showPartnerName = state.partnerRevealed && (revealPartner ?? gameData.reveal_partner ?? true)
```

Replace with:

```js
  const showPartnerName = state.partnerRevealed && (state.reveal_partner ?? true)
```

- [ ] **Step 5: Fix the partner badge display bug**

Find this line (around line 531):

```js
  const partnerUserId  = state.partnerRevealed ? state.partner : null
```

Replace with:

```js
  const partnerUserId  = (state.partnerRevealed && (state.reveal_partner ?? true)) ? state.partner : null
```

- [ ] **Step 6: Replace the `AdminSettingsPanel` usage in the waiting room**

Find this block in the waiting room section (around the `if (status === 'waiting')` block):

```jsx
        {isGameAdmin
          ? (
            <AdminSettingsPanel
              gameId={gameId}
              currentVariant={currentVariant ?? noPickVariant}
              revealPartner={revealPartner ?? gameData.reveal_partner ?? true}
              onUpdated={handleSettingsUpdate}
            />
          )
          : (
            <p style={{ color: '#aaa', fontSize: '0.85rem', marginTop: 8 }}>
              No-pick variant: <strong>{VARIANT_LABELS[noPickVariant]}</strong>
            </p>
          )
        }
```

Replace with:

```jsx
        {isGameAdmin ? (
          <>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: '#aaa', fontSize: '0.85rem' }}>
                {VARIANT_LABELS[currentVariant ?? noPickVariant]} ·{' '}
                Identify partner: {(revealPartner ?? gameData.reveal_partner ?? true) ? 'Yes' : 'No'}
              </span>
              <button className="outline" style={{ fontSize: '0.8rem', padding: '2px 10px' }}
                onClick={() => setShowOptions(true)}>
                ⚙ Options
              </button>
            </div>
            <GameOptionsPanel
              mode="update"
              gameId={gameId}
              open={showOptions}
              values={{ no_pick_variant: currentVariant ?? noPickVariant, reveal_partner: revealPartner ?? gameData.reveal_partner ?? true }}
              onUpdated={handleSettingsUpdate}
              onClose={() => setShowOptions(false)}
            />
          </>
        ) : (
          <p style={{ color: '#aaa', fontSize: '0.85rem', marginTop: 8 }}>
            No-pick variant: <strong>{VARIANT_LABELS[noPickVariant]}</strong>
          </p>
        )}
```

- [ ] **Step 7: Replace the `AdminSettingsPanel` usage in the active game area**

Find this block near the bottom of the return (inside `className="score-board"`):

```jsx
      {/* ── Game admin settings (game creator only) ── */}
      {isGameAdmin && (
        <div className="score-board">
          <AdminSettingsPanel
            gameId={gameId}
            currentVariant={currentVariant ?? noPickVariant}
            revealPartner={revealPartner ?? gameData.reveal_partner ?? true}
            onUpdated={handleSettingsUpdate}
          />
        </div>
      )}
```

Replace with:

```jsx
      {/* ── Game admin settings (game creator only) ── */}
      {isGameAdmin && (
        <div className="score-board" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#aaa', fontSize: '0.78rem' }}>
            {VARIANT_LABELS[currentVariant ?? noPickVariant]} ·{' '}
            Partner: {(revealPartner ?? gameData.reveal_partner ?? true) ? 'shown' : 'hidden'}
          </span>
          <button className="outline" style={{ fontSize: '0.78rem', padding: '2px 8px' }}
            onClick={() => setShowOptions(true)}>
            ⚙
          </button>
          <GameOptionsPanel
            mode="update"
            gameId={gameId}
            open={showOptions}
            values={{ no_pick_variant: currentVariant ?? noPickVariant, reveal_partner: revealPartner ?? gameData.reveal_partner ?? true }}
            onUpdated={handleSettingsUpdate}
            onClose={() => setShowOptions(false)}
          />
        </div>
      )}
```

- [ ] **Step 8: Verify the app builds without errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/GamePage.jsx
git commit -m "fix: replace AdminSettingsPanel with GameOptionsPanel modal; fix partner display bugs"
```

---

### Task 7: Update `LobbyPage.jsx` — add game options modal to create form

**Files:**
- Modify: `frontend/src/pages/LobbyPage.jsx`

- [ ] **Step 1: Add import for `GameOptionsPanel`**

At the top of `frontend/src/pages/LobbyPage.jsx`, after the existing imports:

```js
import GameOptionsPanel from '../components/GameOptionsPanel.jsx'
```

- [ ] **Step 2: Replace `variant` state with `gameOptions` state and add `showOptions`**

Find the existing state declarations (around line 12-13):

```js
  const [variant, setVariant]   = useState('leasters')
```

Replace with:

```js
  const [gameOptions, setGameOptions] = useState({ no_pick_variant: 'leasters', reveal_partner: true })
  const [showOptions, setShowOptions] = useState(false)
```

- [ ] **Step 3: Update `handleCreate` to use `gameOptions`**

Find the `api.games.create` call inside `handleCreate` (around line 43):

```js
      const game = await api.games.create(
        gameName.trim() || `${user.username}'s game`,
        variant,
        user.is_admin ? testMode : false,
      )
```

Replace with:

```js
      const game = await api.games.create(
        gameName.trim() || `${user.username}'s game`,
        gameOptions.no_pick_variant,
        user.is_admin ? testMode : false,
        { reveal_partner: gameOptions.reveal_partner },
      )
```

- [ ] **Step 4: Replace the variant `fieldset` with an options summary row**

Find this entire `<fieldset>` block in the create form:

```jsx
            <fieldset>
              <legend>No-pick variant</legend>
              <label>
                <input type="radio" name="variant" value="leasters"
                  checked={variant === 'leasters'} onChange={() => setVariant('leasters')} />
                Leasters — fewest points wins
              </label>
              <label>
                <input type="radio" name="variant" value="doublers"
                  checked={variant === 'doublers'} onChange={() => setVariant('doublers')} />
                Doublers — stakes double each pass
              </label>
            </fieldset>
```

Replace with:

```jsx
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
              <span style={{ fontSize: '0.85rem', color: '#aaa' }}>
                {gameOptions.no_pick_variant.charAt(0).toUpperCase() + gameOptions.no_pick_variant.slice(1)} ·{' '}
                Identify partner: {gameOptions.reveal_partner ? 'Yes' : 'No'}
              </span>
              <button
                type="button"
                className="outline"
                style={{ fontSize: '0.8rem', padding: '2px 10px' }}
                onClick={() => setShowOptions(true)}
              >
                ⚙ Options
              </button>
            </div>
            <GameOptionsPanel
              mode="create"
              open={showOptions}
              values={gameOptions}
              onChange={setGameOptions}
              onClose={() => setShowOptions(false)}
            />
```

- [ ] **Step 5: Verify the app builds without errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LobbyPage.jsx
git commit -m "feat: add game options modal to create game form in lobby"
```

---

## Verification Checklist

After all tasks are complete, manually verify in the dev environment (`npm run dev`):

1. **Create game** — "⚙ Options" button appears in create form; modal opens with variant + identify partner fields; selections persist when modal is closed and form is submitted
2. **Waiting room** — game admin sees options summary + "⚙ Options" button; modal opens, changes auto-save
3. **Active game** — game admin sees compact options summary + ⚙ button in score board area; modal works
4. **Partner badge** — with "Identify partner: No", the `partner` badge never appears next to any player's name after the ace is played
5. **Info bar** — with "Identify partner: No", the called ace badge never shows the partner's name
6. **Hand boundary** — changing identify partner mid-hand takes effect only when the next hand starts
