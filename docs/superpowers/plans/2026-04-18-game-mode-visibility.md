# Game Mode Visibility & Change Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the current game settings to non-admin players in the same places admins see them, and log admin settings changes as a single `Next Hand: …` line in the play history when the admin presses Done.

**Architecture:** A shared `formatSettingsSummary(settings)` helper in `shared/` is the single source of truth for the summary body string, imported by both server and frontend. The existing `PATCH /api/games/:id/settings` endpoint gains an optional `log_change: true` flag — when present and the game is active, the server appends `Next Hand: <summary>` to `state.log` after persisting settings. The `GameOptionsPanel` update mode is reworked from per-toggle auto-save to deferred-save: local state until the admin presses Done (commits via one batched PATCH) or Escape/backdrop (cancels and discards).

**Tech Stack:** React 18 + Vite (frontend), Cloudflare Pages Functions (backend, plain JS), D1 (SQLite) via `env.DB`, Vitest for unit tests, `shared/` modules consumed by both sides.

**Spec:** `docs/superpowers/specs/2026-04-18-game-mode-visibility-design.md`

---

## File Structure

**Create:**

- `shared/settingsSummary.js` — Pure function `formatSettingsSummary(settings)` returning the summary body string.
- `shared/settingsSummary.test.js` — Vitest unit tests for the formatter.
- `frontend/src/components/SettingsSummary.jsx` — Small presentational component rendering `formatSettingsSummary(settings)` output. No edit button; caller decides layout.

**Modify:**

- `functions/api/games/[id]/settings.js` — Validate optional `log_change: boolean`; after persisting settings, if `log_change === true` and a `game_state` row exists, append `Next Hand: <summary>` to `state.log` and write back.
- `frontend/src/components/GameOptionsPanel.jsx` — Rework `update` mode to deferred save. Remove per-toggle auto-save. Add commit-on-Done / cancel-on-close (Escape/backdrop). Remove per-control Saving/Saved UI; add single save state on Done. No change to `create` mode.
- `frontend/src/pages/GamePage.jsx` — Replace the two inline admin summary blocks with `<SettingsSummary>`. Render it for non-admin players in both the waiting screen and the active-play right panel. Remove the old non-admin `No-pick variant: …` line.

**Do not touch:**

- `shared/gameEngine.js` — no rule changes.
- `docs/RULES.md` / `docs/BOTS.md` — no rule or bot changes.

---

## Summary Format Reference

`formatSettingsSummary(settings)` returns the body string with every setting always rendered:

| Input | Output |
|---|---|
| `{ no_pick_variant: 'leasters', reveal_partner: true,  double_on_bump: true  }` | `Leasters · Partner: shown · DOB: on` |
| `{ no_pick_variant: 'doublers', reveal_partner: false, double_on_bump: false }` | `Doublers · Partner: hidden · DOB: off` |
| `{ no_pick_variant: 'schwanzers', reveal_partner: true, double_on_bump: false }` | `Schwanzers · Partner: shown · DOB: off` |

The log line prepends `Next Hand: ` to this body. The on-screen summary renders the body verbatim.

**Note on DOB display:** Today's admin UI hides DOB when off. The new shared formatter always renders DOB state (`on`/`off`). This is an intentional alignment with the spec's requirement that every setting is listed whether or not it changed. After Task 3 the admin on-screen summary will show `DOB: off` instead of hiding it, matching the log line.

---

## Task 1: Shared settings summary formatter + tests

**Files:**
- Create: `shared/settingsSummary.js`
- Create: `shared/settingsSummary.test.js`

- [ ] **Step 1: Write failing tests**

Create `shared/settingsSummary.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { formatSettingsSummary } from './settingsSummary.js'

describe('formatSettingsSummary', () => {
  it('renders leasters, partner shown, DOB on', () => {
    expect(formatSettingsSummary({
      no_pick_variant: 'leasters',
      reveal_partner: true,
      double_on_bump: true,
    })).toBe('Leasters · Partner: shown · DOB: on')
  })

  it('renders doublers, partner hidden, DOB off', () => {
    expect(formatSettingsSummary({
      no_pick_variant: 'doublers',
      reveal_partner: false,
      double_on_bump: false,
    })).toBe('Doublers · Partner: hidden · DOB: off')
  })

  it('renders schwanzers, partner shown, DOB off', () => {
    expect(formatSettingsSummary({
      no_pick_variant: 'schwanzers',
      reveal_partner: true,
      double_on_bump: false,
    })).toBe('Schwanzers · Partner: shown · DOB: off')
  })

  it('always shows DOB state (not conditional)', () => {
    const off = formatSettingsSummary({
      no_pick_variant: 'leasters',
      reveal_partner: true,
      double_on_bump: false,
    })
    expect(off).toContain('DOB: off')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/settingsSummary.test.js`
Expected: FAIL — `Failed to resolve import "./settingsSummary.js"` (module does not exist).

- [ ] **Step 3: Create `shared/settingsSummary.js`**

```js
const VARIANT_LABELS = {
  leasters: 'Leasters',
  doublers: 'Doublers',
  schwanzers: 'Schwanzers',
}

/**
 * Returns a single-line summary of the game settings, used both in the
 * play-history log line and as the on-screen settings summary. Every
 * setting is always rendered — callers rely on the body being a full
 * snapshot, not a diff.
 *
 * Example: "Leasters · Partner: shown · DOB: on"
 */
export function formatSettingsSummary(settings) {
  const variant = VARIANT_LABELS[settings.no_pick_variant] ?? settings.no_pick_variant
  const partner = settings.reveal_partner ? 'shown' : 'hidden'
  const dob = settings.double_on_bump ? 'on' : 'off'
  return `${variant} · Partner: ${partner} · DOB: ${dob}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/settingsSummary.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/settingsSummary.js shared/settingsSummary.test.js
git commit -m "feat(shared): add formatSettingsSummary helper"
```

---

## Task 2: Server endpoint — accept `log_change` and append log line

**Files:**
- Modify: `functions/api/games/[id]/settings.js`

- [ ] **Step 1: Read the current endpoint**

Open `functions/api/games/[id]/settings.js` to confirm existing structure (validators for `no_pick_variant`, `reveal_partner`, `double_on_bump`; `json_set` update; re-read of `settings_json`).

- [ ] **Step 2: Update imports and validation**

At the top of `functions/api/games/[id]/settings.js`, add the formatter import below the existing helpers import:

```js
import { json, err, requireUser, AuthError } from '../../_helpers.js'
import { formatSettingsSummary } from '../../../../shared/settingsSummary.js'
```

In the validation block (around line 17-27), add a validator for `log_change`. Change:

```js
const { no_pick_variant, reveal_partner, double_on_bump } = body ?? {}
```

to:

```js
const { no_pick_variant, reveal_partner, double_on_bump, log_change } = body ?? {}
```

Add after the `double_on_bump` validator:

```js
if (log_change !== undefined && typeof log_change !== 'boolean') {
  return err('log_change must be a boolean.')
}
```

- [ ] **Step 3: Relax the "no settings to update" guard**

The current endpoint errors with `No settings to update.` when no setting fields are provided. This must change so a caller may send `{ log_change: true }` with no setting fields (supports mobile clients and matches the spec's noted shape). Replace:

```js
if (bindings.length === 0) return err('No settings to update.')

bindings.push(gameId)
await env.DB.prepare(
  `UPDATE games SET settings_json = ${jsonSetExpr}, updated_at = datetime('now') WHERE id = ?`
).bind(...bindings).run()
```

with:

```js
if (bindings.length === 0 && log_change !== true) {
  return err('No settings to update.')
}

if (bindings.length > 0) {
  bindings.push(gameId)
  await env.DB.prepare(
    `UPDATE games SET settings_json = ${jsonSetExpr}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...bindings).run()
}
```

- [ ] **Step 4: Append log line when `log_change` is true**

After the existing re-read block (which computes `settings`) and before `return json({ ok: true, settings })`, add:

```js
if (log_change === true) {
  const stateRow = await env.DB.prepare(
    'SELECT state_json FROM game_state WHERE game_id = ?'
  ).bind(gameId).first()
  if (stateRow) {
    const state = JSON.parse(stateRow.state_json)
    const line = `Next Hand: ${formatSettingsSummary(settings)}`
    state.log = [...(state.log ?? []), line]
    await env.DB.prepare(
      "UPDATE game_state SET state_json = ?, updated_at = datetime('now') WHERE game_id = ?"
    ).bind(JSON.stringify(state), gameId).run()
  }
}
```

Rationale: the `stateRow` null-check naturally covers waiting-status games (no `game_state` row yet). Game status `'complete'` is already rejected earlier in the handler (line 11). Only active games with a live game_state receive the log line.

- [ ] **Step 5: Sanity-check by reading the full file**

Read `functions/api/games/[id]/settings.js` top-to-bottom and confirm: imports present, validator added, guard relaxed, log-append block inserted in the right place (after `settings` is computed, before the JSON response).

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: All existing tests pass. (There are no integration tests for the settings endpoint in this codebase; manual verification covers the endpoint in Task 5.)

- [ ] **Step 7: Commit**

```bash
git add functions/api/games/\[id\]/settings.js
git commit -m "feat(api): PATCH settings accepts log_change flag and appends Next Hand log line"
```

---

## Task 3: Extract `<SettingsSummary>` and render for all players

**Files:**
- Create: `frontend/src/components/SettingsSummary.jsx`
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 1: Create `<SettingsSummary>` component**

Create `frontend/src/components/SettingsSummary.jsx`:

```jsx
import { formatSettingsSummary } from '@shared/settingsSummary.js'

/**
 * Renders the single-line settings summary body. Plain span — the
 * caller controls surrounding layout, labels, and any adjacent
 * controls (e.g. the admin Edit button).
 */
export default function SettingsSummary({ settings, style }) {
  if (!settings) return null
  return (
    <span style={style}>{formatSettingsSummary(settings)}</span>
  )
}
```

(Uses the existing `@shared` Vite alias from `frontend/vite.config.js`.)

- [ ] **Step 2: Update `GamePage.jsx` imports**

At the top of `frontend/src/pages/GamePage.jsx`, add:

```jsx
import SettingsSummary from '../components/SettingsSummary.jsx'
```

You may also remove `const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers', schwanzers: 'Schwanzers' }` if no other reference to `VARIANT_LABELS` remains after this task. Search the file first: `VARIANT_LABELS` — if the only references are in the summary blocks you're replacing and the non-admin `No-pick variant: …` line, remove the constant. Otherwise leave it.

- [ ] **Step 3: Build a small `currentSettings` helper inside `GamePage.jsx`**

The file currently spreads settings across props + local state (`currentVariant`, `revealPartner`, `dobEnabled`, `noPickVariant`, `gameData.settings`). Add a single derived object inside the component, near the other derived values (e.g. next to where `noPickVariant` is computed):

```jsx
const currentSettings = {
  no_pick_variant: currentVariant ?? noPickVariant,
  reveal_partner:  revealPartner  ?? gameData.settings?.reveal_partner  ?? true,
  double_on_bump:  dobEnabled     ?? gameData.settings?.double_on_bump  ?? true,
}
```

This is used by both the admin and non-admin renders below.

- [ ] **Step 4: Replace the waiting-screen admin summary (line ~426)**

Locate the `isGameAdmin ?` waiting-screen block. Replace:

```jsx
<span style={{ color: '#ccc', fontSize: '0.85rem' }}>
  {VARIANT_LABELS[currentVariant ?? noPickVariant]} ·{' '}
  Partner: {(revealPartner ?? gameData.settings?.reveal_partner ?? true) ? 'shown' : 'hidden'}
  {(dobEnabled ?? gameData.settings?.double_on_bump ?? true) ? ' · DOB' : ''}
</span>
```

with:

```jsx
<SettingsSummary
  settings={currentSettings}
  style={{ color: '#ccc', fontSize: '0.85rem' }}
/>
```

- [ ] **Step 5: Replace the waiting-screen non-admin line (line ~450)**

Replace:

```jsx
<p style={{ color: '#aaa', fontSize: '0.85rem', marginTop: 8 }}>
  No-pick variant: <strong>{VARIANT_LABELS[noPickVariant]}</strong>
</p>
```

with:

```jsx
<div style={{ marginTop: 8 }}>
  <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: 3 }}>Game options</div>
  <SettingsSummary
    settings={currentSettings}
    style={{ color: '#aaa', fontSize: '0.85rem' }}
  />
</div>
```

This matches the label (`Game options`) the admin view uses, so both player types see a consistent layout.

- [ ] **Step 6: Replace the active-play admin summary (line ~622)**

In the `last-trick-area` block, replace:

```jsx
<span style={{ color: '#aaa', fontSize: '0.78rem' }}>
  {VARIANT_LABELS[currentVariant ?? noPickVariant]} ·{' '}
  Partner: {(revealPartner ?? gameData.settings?.reveal_partner ?? true) ? 'shown' : 'hidden'}
  {(dobEnabled ?? gameData.settings?.double_on_bump ?? true) ? ' · DOB' : ''}
</span>
```

with:

```jsx
<SettingsSummary
  settings={currentSettings}
  style={{ color: '#aaa', fontSize: '0.78rem' }}
/>
```

- [ ] **Step 7: Add non-admin summary to the active-play right panel**

In the same `last-trick-area` block, the `{isGameAdmin && ( … )}` wrapper currently hides the entire summary section from non-admins. Replace the admin-only block with an if/else that renders either the admin version (summary + Edit button + modal) or the non-admin version (summary only):

Find this section:

```jsx
{isGameAdmin && (
  <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
    <div style={{ fontSize: '0.68rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Game options</div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <SettingsSummary
        settings={currentSettings}
        style={{ color: '#aaa', fontSize: '0.78rem' }}
      />
      <button className="outline" style={{ fontSize: '0.78rem', padding: '2px 8px' }}
        onClick={() => setShowOptions(true)}>
        ⚙ Edit
      </button>
    </div>
    <GameOptionsPanel
      mode="update"
      gameId={gameId}
      open={showOptions}
      values={{ no_pick_variant: currentVariant ?? noPickVariant, reveal_partner: revealPartner ?? gameData.settings?.reveal_partner ?? true, double_on_bump: dobEnabled ?? gameData.settings?.double_on_bump ?? true }}
      onUpdated={handleSettingsUpdate}
      onClose={() => setShowOptions(false)}
    />
  </div>
)}
```

And replace with:

```jsx
<div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
  <div style={{ fontSize: '0.68rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Game options</div>
  {isGameAdmin ? (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <SettingsSummary
          settings={currentSettings}
          style={{ color: '#aaa', fontSize: '0.78rem' }}
        />
        <button className="outline" style={{ fontSize: '0.78rem', padding: '2px 8px' }}
          onClick={() => setShowOptions(true)}>
          ⚙ Edit
        </button>
      </div>
      <GameOptionsPanel
        mode="update"
        gameId={gameId}
        open={showOptions}
        values={currentSettings}
        onUpdated={handleSettingsUpdate}
        onClose={() => setShowOptions(false)}
      />
    </>
  ) : (
    <SettingsSummary
      settings={currentSettings}
      style={{ color: '#aaa', fontSize: '0.78rem' }}
    />
  )}
</div>
```

Note: this also switches the `values` prop of the existing admin `GameOptionsPanel` to use `currentSettings` — a readability cleanup that doesn't change behavior.

- [ ] **Step 8: Do the same `values` prop cleanup on the waiting-screen GameOptionsPanel**

Find the waiting-screen `<GameOptionsPanel … />` (around line 439-446) and change:

```jsx
values={{ no_pick_variant: currentVariant ?? noPickVariant, reveal_partner: revealPartner ?? gameData.settings?.reveal_partner ?? true, double_on_bump: dobEnabled ?? gameData.settings?.double_on_bump ?? true }}
```

to:

```jsx
values={currentSettings}
```

- [ ] **Step 9: Start the dev server and verify visually**

Run: `npm run dev`

Navigate to a game in two browser tabs (one admin, one non-admin). Confirm:
- Waiting screen: both users see the same `<variant> · Partner: <shown|hidden> · DOB: <on|off>` line. Admin has the Edit button; non-admin does not.
- Active play: both users see the same summary in the last-trick-area right panel. Admin has the Edit button; non-admin does not.

If something is off, adjust styling/layout inline, then recheck.

Stop the dev server when finished.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/SettingsSummary.jsx frontend/src/pages/GamePage.jsx
git commit -m "feat(ui): show settings summary to non-admin players via shared SettingsSummary"
```

---

## Task 4: Rework `GameOptionsPanel` update mode to deferred save

**Files:**
- Modify: `frontend/src/components/GameOptionsPanel.jsx`

- [ ] **Step 1: Read the current file**

Open `frontend/src/components/GameOptionsPanel.jsx`. Current behavior: `update` mode calls `save(patch)` on every toggle, which does `api.games.updateSettings(gameId, patch)` and sets Saving/Saved flags. `create` mode uses `onChange` only — do NOT change `create`.

- [ ] **Step 2: Replace the component body**

Replace the entire contents of `frontend/src/components/GameOptionsPanel.jsx` with the following. Rationale: the changes touch nearly every part of the component (state, handlers, close path, render); an inline rewrite is cleaner than a sequence of edits.

```jsx
import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api.js'

const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers', schwanzers: 'Schwanzers' }

/**
 * Reusable game options modal.
 *
 * mode="create"  — no API calls; calls onChange({ no_pick_variant, reveal_partner, double_on_bump }) on each change.
 * mode="update"  — deferred save: local state only until the admin presses Done, which sends
 *                  one PATCH carrying the changed fields plus log_change: true. Escape or
 *                  backdrop click cancels and discards local edits.
 *
 * The parent controls open/close via the `open` prop and `onClose` callback.
 */
export default function GameOptionsPanel({ mode, gameId, open, values, onChange, onUpdated, onClose }) {
  const dialogRef = useRef(null)
  // True when the in-flight close was initiated by the Done button. Lets us
  // distinguish a commit (Done) from a cancel (Escape/backdrop), since the
  // native <dialog> onClose event fires for both.
  const committedRef = useRef(false)
  // Snapshot of the settings at the moment the modal opened. Used in update
  // mode to decide which fields actually changed when Done is pressed.
  const initialRef = useRef(null)

  const [variant, setVariant] = useState(values?.no_pick_variant ?? 'doublers')
  const [reveal,  setReveal]  = useState(values?.reveal_partner  ?? false)
  const [dob,     setDob]     = useState(values?.double_on_bump  ?? true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  // Re-sync form from parent values each time the panel opens, and capture
  // the initial snapshot.
  useEffect(() => {
    if (open) {
      const v = values?.no_pick_variant ?? 'leasters'
      const r = values?.reveal_partner  ?? true
      const d = values?.double_on_bump  ?? true
      setVariant(v)
      setReveal(r)
      setDob(d)
      setError(null)
      committedRef.current = false
      initialRef.current = { no_pick_variant: v, reveal_partner: r, double_on_bump: d }
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

  function handleVariantChange(v) {
    setVariant(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: v, reveal_partner: reveal, double_on_bump: dob })
    }
  }

  function handleRevealChange(v) {
    setReveal(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: variant, reveal_partner: v, double_on_bump: dob })
    }
  }

  function handleDobChange(v) {
    setDob(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: variant, reveal_partner: reveal, double_on_bump: v })
    }
  }

  async function handleDone() {
    if (mode !== 'update') {
      onClose?.()
      return
    }
    const initial = initialRef.current
    const changed = {}
    if (variant !== initial.no_pick_variant) changed.no_pick_variant = variant
    if (reveal  !== initial.reveal_partner)  changed.reveal_partner  = reveal
    if (dob     !== initial.double_on_bump)  changed.double_on_bump  = dob

    if (Object.keys(changed).length === 0) {
      // Nothing changed — close without any network call.
      committedRef.current = true
      onClose?.()
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await api.games.updateSettings(gameId, { ...changed, log_change: true })
      onUpdated?.(result)
      committedRef.current = true
      onClose?.()
    } catch (e) {
      setError(e?.message ?? 'Failed to save.')
      // Stay open so the admin can retry. Local state is preserved.
    } finally {
      setSaving(false)
    }
  }

  // Fires for any dialog close — Done, Escape, backdrop click. We only
  // propagate to the parent here; the commit path is in handleDone.
  function handleDialogClose() {
    if (!committedRef.current) {
      // Cancel path: discard local edits by simply closing. The next open
      // will reseed from `values` (parent state).
    }
    committedRef.current = false
    onClose?.()
  }

  return (
    <dialog
      ref={dialogRef}
      className="game-options-dialog"
      onClose={handleDialogClose}
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
        <div style={{ color: '#ccc', fontSize: '0.82rem', marginBottom: 4 }}>No-pick variant</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {['doublers', 'leasters', 'schwanzers'].map(v => (
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
          Partner Visibility
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[false, true].map(v => (
            <label key={String(v)} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="radio"
                name={`reveal-${gameId ?? 'create'}`}
                value={String(v)}
                checked={reveal === v}
                onChange={() => handleRevealChange(v)}
                disabled={saving}
              />
              {v ? 'Shown' : 'Hidden'}
            </label>
          ))}
        </div>
      </div>

      {/* Double on the Bump */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
          Double on the Bump?
          <input
            type="checkbox"
            checked={dob}
            onChange={e => handleDobChange(e.target.checked)}
            disabled={saving}
          />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.82rem' }}>
          {mode === 'update' && saving && <span style={{ color: '#aaa' }}>Saving…</span>}
          {mode === 'update' && error  && <span style={{ color: '#f87171' }}>{error}</span>}
        </div>
        <button
          type="button"
          onClick={handleDone}
          disabled={saving}
          style={{ fontSize: '0.85rem', padding: '4px 16px' }}
        >
          Done
        </button>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 3: Verify the dev server still builds**

Run: `npm run dev`
Expected: Vite compiles successfully with no errors about `GameOptionsPanel`.

- [ ] **Step 4: Manual verification — happy path commit**

With the dev server running, open two browser tabs on the same game (one admin, one non-admin).

Admin tab:
1. Press ⚙ Edit — modal opens.
2. Change the no-pick variant to a different value.
3. Toggle DOB off.
4. Press Done.

Expected:
- Modal closes.
- Admin's on-screen summary updates to reflect the new values.
- Non-admin tab (after the next poll) sees the same updated summary and one new `Next Hand: …` line in the Play History.

- [ ] **Step 5: Manual verification — cancel path**

Admin tab:
1. Press ⚙ Edit — modal opens.
2. Change any setting.
3. Press Escape (or click outside the modal).

Expected:
- Modal closes.
- Admin's summary is unchanged.
- No new line in Play History.
- Reopening the modal shows the previously-saved values (local edits were discarded).

- [ ] **Step 6: Manual verification — no-op press Done**

Admin tab:
1. Press ⚙ Edit — modal opens.
2. Don't change anything.
3. Press Done.

Expected:
- Modal closes.
- No network PATCH fires (check DevTools Network panel).
- No new line in Play History.

- [ ] **Step 7: Manual verification — net-zero change**

Admin tab:
1. Press ⚙ Edit — modal opens.
2. Toggle DOB off.
3. Toggle DOB on (back to original).
4. Press Done.

Expected:
- No network PATCH fires.
- No new line in Play History.

- [ ] **Step 8: Manual verification — error handling**

Temporarily break the endpoint (e.g., stop Wrangler or set a bad URL) and try Done. The modal should stay open with a red error message visible. Restore the endpoint, press Done again, and it should succeed.

- [ ] **Step 9: Stop the dev server and run the test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/GameOptionsPanel.jsx
git commit -m "feat(ui): GameOptionsPanel update mode uses deferred save with cancel on Escape"
```

---

## Task 5: Final manual verification + PR-readiness check

**Files:** none modified.

- [ ] **Step 1: Run the full test suite one more time**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run the build to catch production-only issues**

Run: `npm run build`
Expected: Build succeeds with no errors or warnings about missing imports.

- [ ] **Step 3: Full end-to-end manual verification**

Run: `npm run dev`, then run through this checklist in two browser tabs (admin + non-admin):

- [ ] Waiting screen, non-admin: sees `<variant> · Partner: <shown|hidden> · DOB: <on|off>` with the `Game options` label, no Edit button.
- [ ] Waiting screen, admin: sees the same summary plus ⚙ Edit.
- [ ] Active play, non-admin: sees the same summary in the last-trick-area right panel, no Edit button.
- [ ] Active play, admin: sees the same summary plus ⚙ Edit.
- [ ] Admin edits settings + Done → one `Next Hand: …` line appears in Play History for both tabs.
- [ ] Admin opens modal + Done without changing → no log line.
- [ ] Admin changes and reverts → no log line.
- [ ] Admin presses Escape → no save, no log line.
- [ ] Admin clicks outside modal → no save, no log line.
- [ ] Game behavior remains correct: settings still take effect on the next hand (play one hand after a change, confirm new variant rules applied).

Stop the dev server when done.

- [ ] **Step 4: Review diff against the spec**

Run: `git diff main...HEAD --stat`
Review the changed files against the spec's "Components & Files" section. There should be no unexpected files touched.

- [ ] **Step 5: No commit for this task** — it's purely verification. If any issue is found in steps 1–4, fix it inline and commit under the appropriate previous task's topic.

---

## Out of scope reminders

- No changes to `shared/gameEngine.js` (no rule changes).
- No updates to `docs/RULES.md` or `docs/BOTS.md` (neither rules nor bot strategy changes).
- `create` mode of `GameOptionsPanel` is unchanged — it already defers via `onChange`.
- No new push notifications, toasts, or banners.
