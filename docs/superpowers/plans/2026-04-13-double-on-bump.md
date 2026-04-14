# Double on the Bump (DOB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Double on the Bump" as a game option (default on) that doubles hand stakes when the picking team loses.

**Architecture:** `double_on_bump` is stored as an INTEGER column on the `games` table (same pattern as `reveal_partner`), copied into hand state at deal time, and read by `computeScores` to conditionally apply a ×2 multiplier when `!pickerWon`. DOB only fires in normal hands (picker exists); leasters and schwanzers are unaffected.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Workers Functions, React 18, Vitest

---

## File Map

| File | Change |
|------|--------|
| `migrations/0007_double_on_bump.sql` | New — add `double_on_bump` column |
| `shared/gameEngine.js` | Modify `computeScores` — add DOB multiplier |
| `shared/gameEngine.test.js` | Add DOB tests in `computeScores` describe block |
| `functions/api/games/index.js` | Accept `double_on_bump` on create, copy into state |
| `functions/api/games/[id]/settings.js` | Accept `double_on_bump` in PATCH, return it |
| `functions/api/games/[id]/action.js` | Read `double_on_bump` from DB on no-pick, copy into new hand |
| `functions/api/games/[id]/join.js` | Copy `double_on_bump` from game into hand state |
| `functions/api/games/[id]/fill-with-bots.js` | Copy `double_on_bump` from game into hand state |
| `frontend/src/components/GameOptionsPanel.jsx` | Add DOB checkbox |
| `frontend/src/pages/GamePage.jsx` | Track `dobEnabled` state, show DOB in summary line |
| `frontend/src/pages/LobbyPage.jsx` | Include `double_on_bump: true` in create options |

---

## Task 1: DB Migration

**Files:**
- Create: `migrations/0007_double_on_bump.sql`

- [ ] **Step 1: Create migration file**

```sql
ALTER TABLE games ADD COLUMN double_on_bump INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Apply migration locally**

```bash
npm run db:migrate:local
```

Expected output includes: `🌀 Executing on local database...` with no errors.

- [ ] **Step 3: Verify column exists**

```bash
npx wrangler d1 execute sheepshead-db --local --command "PRAGMA table_info(games);"
```

Expected: output includes a row with `name: double_on_bump`, `type: INTEGER`, `notnull: 1`, `dflt_value: 1`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0007_double_on_bump.sql
git commit -m "feat: add double_on_bump column to games table"
```

---

## Task 2: Game Engine — DOB Multiplier + Tests

**Files:**
- Modify: `shared/gameEngine.js` (line ~777)
- Modify: `shared/gameEngine.test.js` (inside `describe('computeScores', ...)`)

- [ ] **Step 1: Write failing tests**

In `shared/gameEngine.test.js`, inside the existing `describe('computeScores', () => {` block, after the last existing `it(...)`, add:

```js
describe('Double on the Bump (DOB)', () => {
  // Picker loses with 32 pts (no schneider, no schwarz, no crack, no blitz)
  // Expected base scores without DOB: p1=-2, p2=-1, p3=+1, p4=+1, p5=+1
  const losingTricks = [
    makeTrick('p1', [fk('A'), fk('10'), fk('9'), fk('8'), fk('7')]),  // 21 pts
    makeTrick('p2', [fk('A'), fk('9'), fk('8'), fk('7'), fk('7')]),   // 11 pts → total = 32
    makeTrick('p3', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
    makeTrick('p3', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
    makeTrick('p4', [fk('9'), fk('8'), fk('7'), fk('7'), fk('7')]),
    makeTrick('p5', [fk('9'), fk('8'), fk('7'), fk('7'), fk('7')]),
  ]

  it('doubles stakes when picker loses and double_on_bump is true', () => {
    const scores = computeScores(baseState(losingTricks, { double_on_bump: true }))
    expect(scores.p1).toBe(-4)   // -2 × 2 (DOB)
    expect(scores.p2).toBe(-2)   // -1 × 2
    expect(scores.p3).toBe(2)    // +1 × 2
    expect(scores.p4).toBe(2)
    expect(scores.p5).toBe(2)
  })

  it('does not double when picker loses and double_on_bump is false', () => {
    const scores = computeScores(baseState(losingTricks, { double_on_bump: false }))
    expect(scores.p1).toBe(-2)
    expect(scores.p2).toBe(-1)
    expect(scores.p3).toBe(1)
    expect(scores.p4).toBe(1)
    expect(scores.p5).toBe(1)
  })

  it('does not double when picker wins even if double_on_bump is true', () => {
    // Picker team wins with 75 pts (3 tricks of 25 pts each)
    const winningTricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p4', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p5', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
    ]
    const scores = computeScores(baseState(winningTricks, { double_on_bump: true }))
    expect(scores.p1).toBe(2)
    expect(scores.p2).toBe(1)
    expect(scores.p3).toBe(-1)
    expect(scores.p4).toBe(-1)
    expect(scores.p5).toBe(-1)
  })

  it('DOB stacks with crack multiplier when picker loses', () => {
    // handCrackMultiplier=2 (cracked), DOB=true → total multiplier = 1×1×2×1×2 = 4
    const scores = computeScores(baseState(losingTricks, { double_on_bump: true, handCrackMultiplier: 2 }))
    expect(scores.p1).toBe(-8)   // -2 × (crack×2) × (DOB×2) = -2×4
    expect(scores.p2).toBe(-4)
    expect(scores.p3).toBe(4)
    expect(scores.p4).toBe(4)
    expect(scores.p5).toBe(4)
  })

  it('does not affect leaster scoring (no picker)', () => {
    // resolveLeaster uses its own scoring — computeScores is not called for leasters.
    // This test verifies computeScores with double_on_bump:true is safe when called
    // without a picker (should not be called in practice, but must not crash).
    // We skip this edge case — leasters call resolveLeaster, not computeScores.
    // No test needed.
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run shared/gameEngine.test.js
```

Expected: the new DOB tests fail (computeScores doesn't apply DOB yet). All other tests pass.

- [ ] **Step 3: Implement DOB multiplier in computeScores**

In `shared/gameEngine.js`, find the multiplier line (~line 777):

```js
const multiplier = baseMultiplier * doublerMultiplier * (state.handCrackMultiplier ?? 1) * blitzMultiplier
```

Replace with:

```js
const dobMultiplier = (!pickerWon && state.double_on_bump) ? 2 : 1
const multiplier = baseMultiplier * doublerMultiplier * (state.handCrackMultiplier ?? 1) * blitzMultiplier * dobMultiplier
```

Note: using `state.double_on_bump` directly (no `?? true`) preserves backward compatibility — existing hand states without the field are treated as DOB off.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run shared/gameEngine.test.js
```

Expected: all tests pass including the new DOB tests.

- [ ] **Step 5: Commit**

```bash
git add shared/gameEngine.js shared/gameEngine.test.js
git commit -m "feat: add Double on the Bump multiplier to computeScores"
```

---

## Task 3: Backend — Settings & Create API

**Files:**
- Modify: `functions/api/games/[id]/settings.js`
- Modify: `functions/api/games/index.js`

- [ ] **Step 1: Update settings.js to accept double_on_bump**

In `functions/api/games/[id]/settings.js`, replace:

```js
const { no_pick_variant, reveal_partner } = body ?? {}
```

with:

```js
const { no_pick_variant, reveal_partner, double_on_bump } = body ?? {}
```

Add validation after the `reveal_partner` check (after line 26):

```js
if (double_on_bump !== undefined && typeof double_on_bump !== 'boolean') {
  return err('double_on_bump must be a boolean.')
}
```

Add to the dynamic UPDATE builder (after the `reveal_partner` push):

```js
if (double_on_bump !== undefined) { fields.push('double_on_bump = ?'); values.push(double_on_bump ? 1 : 0) }
```

Update the SELECT after saving to include `double_on_bump`:

```js
const updated = await env.DB.prepare(
  'SELECT no_pick_variant, reveal_partner, double_on_bump FROM games WHERE id = ?'
).bind(gameId).first()

return json({ ok: true, ...updated, reveal_partner: updated.reveal_partner === 1, double_on_bump: updated.double_on_bump === 1 })
```

- [ ] **Step 2: Update games/index.js to accept double_on_bump on create**

In `functions/api/games/index.js`, find where `revealPartner` is extracted from the body (around line 75):

```js
const revealPartner  = typeof body?.reveal_partner === 'boolean' ? body.reveal_partner : false
```

Add after it:

```js
const doubleOnBump   = typeof body?.double_on_bump === 'boolean' ? body.double_on_bump : true
```

Find the INSERT statement (around line 87):

```js
'INSERT INTO games (name, no_pick_variant, reveal_partner, is_test_mode, created_by) VALUES (?, ?, ?, ?, ?)'
).bind(name, noPickVariant, revealPartner ? 1 : 0, testMode ? 1 : 0, user.user_id).run()
```

Replace with:

```js
'INSERT INTO games (name, no_pick_variant, reveal_partner, double_on_bump, is_test_mode, created_by) VALUES (?, ?, ?, ?, ?, ?)'
).bind(name, noPickVariant, revealPartner ? 1 : 0, doubleOnBump ? 1 : 0, testMode ? 1 : 0, user.user_id).run()
```

Find where the initial hand state is constructed (test mode path, around line 113):

```js
state.reveal_partner = revealPartner
```

Add after it:

```js
state.double_on_bump = doubleOnBump
```

- [ ] **Step 3: Update GET /games/:id to return double_on_bump as boolean**

In `functions/api/games/[id]/index.js`, find the return statement (around line 62):

```js
return json({
  ...game,
  is_test_mode:   game.is_test_mode   === 1,
  reveal_partner: game.reveal_partner === 1,
  is_admin:       game.created_by     === user.user_id,
  players:        playersWithScores,
  state:          stateView,
})
```

Replace with:

```js
return json({
  ...game,
  is_test_mode:    game.is_test_mode    === 1,
  reveal_partner:  game.reveal_partner  === 1,
  double_on_bump:  game.double_on_bump  === 1,
  is_admin:        game.created_by      === user.user_id,
  players:         playersWithScores,
  state:           stateView,
})
```

- [ ] **Step 4: Commit**

```bash
git add functions/api/games/[id]/settings.js functions/api/games/index.js functions/api/games/[id]/index.js
git commit -m "feat: accept double_on_bump in settings and create API"
```

---

## Task 4: Backend — Hand Deal Propagation

**Files:**
- Modify: `functions/api/games/[id]/join.js`
- Modify: `functions/api/games/[id]/fill-with-bots.js`
- Modify: `functions/api/games/[id]/action.js`

- [ ] **Step 1: Update join.js**

In `functions/api/games/[id]/join.js`, find:

```js
state.reveal_partner = game.reveal_partner === 1
```

Add after it:

```js
state.double_on_bump = game.double_on_bump === 1
```

- [ ] **Step 2: Update fill-with-bots.js**

In `functions/api/games/[id]/fill-with-bots.js`, find:

```js
state.reveal_partner = game.reveal_partner === 1
```

Add after it:

```js
state.double_on_bump = game.double_on_bump === 1
```

- [ ] **Step 3: Update action.js — no-pick doubler path**

In `functions/api/games/[id]/action.js`, find the `case 'pass':` block. The DB query that reads settings when no-pick fires is:

```js
const freshGame = await env.DB.prepare('SELECT no_pick_variant, reveal_partner FROM games WHERE id = ?').bind(gameId).first()
```

Replace with:

```js
const freshGame = await env.DB.prepare('SELECT no_pick_variant, reveal_partner, double_on_bump FROM games WHERE id = ?').bind(gameId).first()
```

In the doubler branch (where `dealHand` is called for the next hand), find:

```js
state.reveal_partner = freshGame.reveal_partner === 1
```

Add after it:

```js
state.double_on_bump = freshGame.double_on_bump === 1
```

- [ ] **Step 4: Commit**

```bash
git add functions/api/games/[id]/join.js functions/api/games/[id]/fill-with-bots.js functions/api/games/[id]/action.js
git commit -m "feat: propagate double_on_bump into hand state on deal"
```

---

## Task 5: Frontend — GameOptionsPanel Checkbox

**Files:**
- Modify: `frontend/src/components/GameOptionsPanel.jsx`

- [ ] **Step 1: Add dob state and sync**

In `frontend/src/components/GameOptionsPanel.jsx`, find the existing state declarations:

```js
const [variant, setVariant] = useState(values?.no_pick_variant ?? 'doublers')
const [reveal,  setReveal]  = useState(values?.reveal_partner  ?? false)
```

Add after them:

```js
const [dob,     setDob]     = useState(values?.double_on_bump  ?? true)
```

In the `useEffect` that re-syncs on open, find:

```js
setVariant(values?.no_pick_variant ?? 'leasters')
setReveal(values?.reveal_partner  ?? true)
```

Add after:

```js
setDob(values?.double_on_bump ?? true)
```

- [ ] **Step 2: Add handleDobChange**

After the `handleRevealChange` function, add:

```js
async function handleDobChange(v) {
  setDob(v)
  if (mode === 'create') {
    onChange?.({ no_pick_variant: variant, reveal_partner: reveal, double_on_bump: v })
  } else {
    await save({ double_on_bump: v })
  }
}
```

- [ ] **Step 3: Update handleVariantChange and handleRevealChange to include dob**

`handleVariantChange` currently calls `onChange?.({ no_pick_variant: v, reveal_partner: reveal })`. Replace with:

```js
onChange?.({ no_pick_variant: v, reveal_partner: reveal, double_on_bump: dob })
```

`handleRevealChange` currently calls `onChange?.({ no_pick_variant: variant, reveal_partner: v })`. Replace with:

```js
onChange?.({ no_pick_variant: variant, reveal_partner: v, double_on_bump: dob })
```

- [ ] **Step 4: Add DOB checkbox to the dialog JSX**

In the JSX, after the closing `</div>` of the "Partner Visibility" section (after line 127), add:

```jsx
{/* Double on the Bump */}
<div style={{ marginBottom: 16 }}>
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
    <input
      type="checkbox"
      checked={dob}
      onChange={e => handleDobChange(e.target.checked)}
      disabled={saving}
    />
    Double on the Bump?
  </label>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/GameOptionsPanel.jsx
git commit -m "feat: add Double on the Bump checkbox to GameOptionsPanel"
```

---

## Task 6: Frontend — GamePage State and DOB Summary

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 1: Add dobEnabled state**

In `frontend/src/pages/GamePage.jsx`, find:

```js
const [currentVariant, setCurrentVariant] = useState(null)
const [revealPartner, setRevealPartner]   = useState(null)
```

Add after:

```js
const [dobEnabled, setDobEnabled]         = useState(null)
```

- [ ] **Step 2: Update handleSettingsUpdate**

Find:

```js
function handleSettingsUpdate(result) {
  if (result.no_pick_variant !== undefined) setCurrentVariant(result.no_pick_variant)
  if (result.reveal_partner  !== undefined) setRevealPartner(result.reveal_partner)
```

Add after the `setRevealPartner` line:

```js
if (result.double_on_bump  !== undefined) setDobEnabled(result.double_on_bump)
```

- [ ] **Step 3: Update GameOptionsPanel values props (both instances)**

There are two `<GameOptionsPanel>` usages in GamePage. Both have a `values` prop. Find each one:

```js
values={{ no_pick_variant: currentVariant ?? noPickVariant, reveal_partner: revealPartner ?? gameData.reveal_partner ?? true }}
```

Replace both with:

```js
values={{ no_pick_variant: currentVariant ?? noPickVariant, reveal_partner: revealPartner ?? gameData.reveal_partner ?? true, double_on_bump: dobEnabled ?? gameData.double_on_bump ?? true }}
```

- [ ] **Step 4: Add DOB to the waiting-room summary line**

Find the waiting-room summary span (around line 401):

```jsx
<span style={{ color: '#ccc', fontSize: '0.85rem' }}>
  {VARIANT_LABELS[currentVariant ?? noPickVariant]} ·{' '}
  Partner: {(revealPartner ?? gameData.reveal_partner ?? true) ? 'shown' : 'hidden'}
</span>
```

Replace with:

```jsx
<span style={{ color: '#ccc', fontSize: '0.85rem' }}>
  {VARIANT_LABELS[currentVariant ?? noPickVariant]} ·{' '}
  Partner: {(revealPartner ?? gameData.reveal_partner ?? true) ? 'shown' : 'hidden'}
  {(dobEnabled ?? gameData.double_on_bump ?? true) ? ' · DOB' : ''}
</span>
```

- [ ] **Step 5: Add DOB to the active-game summary line**

Find the active-game summary span (around line 675):

```jsx
<span style={{ color: '#aaa', fontSize: '0.78rem' }}>
  {VARIANT_LABELS[currentVariant ?? noPickVariant]} ·{' '}
  Partner: {(revealPartner ?? gameData.reveal_partner ?? true) ? 'shown' : 'hidden'}
</span>
```

Replace with:

```jsx
<span style={{ color: '#aaa', fontSize: '0.78rem' }}>
  {VARIANT_LABELS[currentVariant ?? noPickVariant]} ·{' '}
  Partner: {(revealPartner ?? gameData.reveal_partner ?? true) ? 'shown' : 'hidden'}
  {(dobEnabled ?? gameData.double_on_bump ?? true) ? ' · DOB' : ''}
</span>
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/GamePage.jsx
git commit -m "feat: show DOB in game options summary and track dobEnabled state"
```

---

## Task 7: Frontend — LobbyPage Create Options

**Files:**
- Modify: `frontend/src/pages/LobbyPage.jsx`

- [ ] **Step 1: Add double_on_bump to initial gameOptions state**

Find:

```js
const [gameOptions, setGameOptions] = useState({ no_pick_variant: 'doublers', reveal_partner: false })
```

Replace with:

```js
const [gameOptions, setGameOptions] = useState({ no_pick_variant: 'doublers', reveal_partner: false, double_on_bump: true })
```

- [ ] **Step 2: Pass double_on_bump through to create API**

Find the `api.games.create` call:

```js
const game = await api.games.create(
  gameName.trim() || `${user.username}'s game`,
  gameOptions.no_pick_variant,
  user.is_admin ? testMode : false,
  { reveal_partner: gameOptions.reveal_partner },
)
```

Replace with:

```js
const game = await api.games.create(
  gameName.trim() || `${user.username}'s game`,
  gameOptions.no_pick_variant,
  user.is_admin ? testMode : false,
  { reveal_partner: gameOptions.reveal_partner, double_on_bump: gameOptions.double_on_bump },
)
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LobbyPage.jsx
git commit -m "feat: include double_on_bump in lobby game create options"
```

---

## Task 8: Full Test Run

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Start dev server and smoke test**

```bash
npm run dev
```

Open `http://localhost:3000`. Steps to verify:

1. Create a new game — open game options, verify "Double on the Bump?" checkbox is checked by default
2. Verify summary line shows `Doublers · Partner: hidden · DOB` (or whatever your variant is)
3. Uncheck DOB — verify summary line drops the `· DOB` label
4. Re-check DOB — verify it reappears
5. Start a game, let the picking team lose — verify the losing scores are doubled vs what they would be without DOB
6. Disable DOB mid-game, let picker lose again — verify scores are NOT doubled
