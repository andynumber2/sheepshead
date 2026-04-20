# Bot Suggestion Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in per-player red-outline highlight on the card/action the bot strategy would choose, with the toggle housed in a refactored Options modal that non-admins can now open in read-only mode.

**Architecture:** Thin client-only feature. A pure helper (`shared/botSuggestion.js`) dispatches on `state.phase` to the existing `shared/botStrategy.js` decision functions. `GamePage` calls it in a gated `useMemo`; the result is threaded as `suggestedIds`/`suggestedAction` props into `Hand` and `ActionPanel`. The toggle persists in `localStorage`. `GameOptionsPanel` gains a `role` prop: admin keeps the form; player gets a read-only key-value list plus a new "Your preferences" section with the one toggle. No server, DB, or API changes.

**Tech Stack:** React 18 + Vite (frontend), Vitest (tests), plain CSS.

**Spec:** `docs/superpowers/specs/2026-04-19-bot-suggestion-highlight-design.md`
**Issue:** https://github.com/andynumber2/sheepshead/issues/123
**Blocks:** https://github.com/andynumber2/sheepshead/issues/140

---

## File Map

- **Create:**
  - `shared/botSuggestion.js` — pure `computeBotSuggestion(view, userId)` helper dispatching on phase
  - `shared/botSuggestion.test.js` — vitest tests for the helper
- **Modify:**
  - `frontend/src/index.css` — add `.card-suggested`, `.btn-suggested` rules
  - `frontend/src/components/Card.jsx` — accept optional `suggested` prop, add `card-suggested` class
  - `frontend/src/components/Hand.jsx` — accept optional `suggestedIds` prop, forward to `Card`
  - `frontend/src/components/ActionPanel.jsx` — accept optional `suggestedAction` prop, apply `btn-suggested` class to the matching button; in the `ace_under` sub-view, forward `suggestedIds` to the inner `Hand`
  - `frontend/src/components/GameOptionsPanel.jsx` — add `role` prop, `botSuggestionEnabled` + `onBotSuggestionChange` props; render read-only list for `role === 'player'`; add "Your preferences" section; hide section when `mode === 'create'`; rename dialog title / behavior unchanged
  - `frontend/src/pages/GamePage.jsx` — drop admin-only gating of the Options button in both waiting-state and in-game; read/write `sheepshead:showBotSuggestion` in `localStorage`; compute `botSuggestion` via `useMemo` (wrapped in try/catch); pass `suggestedIds`/`suggestedAction` through to `Hand`/`ActionPanel`; pass `role`, `botSuggestionEnabled`, `onBotSuggestionChange` to `GameOptionsPanel`; rename button text to "⚙ Options"
  - `frontend/src/pages/LobbyPage.jsx` — rename create-form button text to "⚙ Options"
- **Tests:** `shared/botSuggestion.test.js` covers phase dispatch. No new frontend harness — manual verification per spec. Existing `npm test` suite must still pass.

---

## Task 1: Add CSS classes for the highlight

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Append `.card-suggested` and `.btn-suggested` rules**

Add the following at the end of `frontend/src/index.css`:

```css
/* Bot suggestion highlight — issue #123 */
.card-suggested {
  outline: 3px solid #ef4444;
  outline-offset: 2px;
  border-radius: inherit;
}

.btn-suggested {
  box-shadow: 0 0 0 2px #ef4444;
}
```

- [ ] **Step 2: Run the build to confirm no CSS errors**

```
npm run build
```

Expected: build succeeds (the existing "✓ built in …" line appears).

- [ ] **Step 3: Commit**

```
git add frontend/src/index.css
git commit -m "feat(ui): add .card-suggested / .btn-suggested CSS for bot hint (#123)"
```

---

## Task 2: Add pure helper `computeBotSuggestion` with tests

**Files:**
- Create: `shared/botSuggestion.js`
- Create: `shared/botSuggestion.test.js`

- [ ] **Step 1: Write the failing test file**

Create `shared/botSuggestion.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { computeBotSuggestion } from './botSuggestion.js'

// Stub view factories — minimal shapes sufficient for dispatch.
// Real decision correctness is covered by the botStrategy test suite.
function playingView({ hands, currentTrick = [] }) {
  return {
    phase: 'playing',
    hands,
    currentTrick,
    tricks: [],
    picker: 'u1',
    partner: 'u2',
    calledSuit: 'H',
    partnerRevealed: false,
    lastTrick: [],
    isLeaster: false,
    reveal_partner: false,
  }
}

describe('computeBotSuggestion', () => {
  it('returns { kind: "play", ids: [cardId] } in playing phase', () => {
    const view = playingView({ hands: { u1: [{ id: 'QC', suit: 'C', rank: 'Q' }] } })
    const result = computeBotSuggestion(view, 'u1')
    expect(result.kind).toBe('play')
    expect(result.ids).toEqual(['QC'])
    expect(result.actionLabel).toBeUndefined()
  })

  it('returns { kind: "bury", ids: [a, b] } in burying phase', () => {
    const view = {
      phase: 'burying',
      hands: {
        u1: [
          { id: 'AC', suit: 'C', rank: 'A' }, { id: 'KC', suit: 'C', rank: 'K' },
          { id: '9C', suit: 'C', rank: '9' }, { id: '8C', suit: 'C', rank: '8' },
          { id: '7C', suit: 'C', rank: '7' }, { id: 'AS', suit: 'S', rank: 'A' },
          { id: 'KS', suit: 'S', rank: 'K' }, { id: '9S', suit: 'S', rank: '9' },
        ],
      },
      picker: 'u1',
      blind: [],
      calledSuit: null,
    }
    const result = computeBotSuggestion(view, 'u1')
    expect(result.kind).toBe('bury')
    expect(result.ids).toHaveLength(2)
  })

  it('returns { kind: "pick", actionLabel: "pick"|"pass" } in picking phase', () => {
    const view = {
      phase: 'picking',
      hands: { u1: [
        { id: 'QC', suit: 'C', rank: 'Q' }, { id: 'QS', suit: 'S', rank: 'Q' },
        { id: 'QH', suit: 'H', rank: 'Q' }, { id: 'JC', suit: 'C', rank: 'J' },
        { id: 'AD', suit: 'D', rank: 'A' }, { id: '10D', suit: 'D', rank: '10' },
      ]},
      potentialBlitzes: [],
      pickOrder: ['u1'], pickIndex: 0,
    }
    const result = computeBotSuggestion(view, 'u1')
    expect(result.kind).toBe('pick')
    expect(['pick', 'pass', 'blitz']).toContain(result.actionLabel)
    expect(result.ids).toEqual([])
  })

  it('returns { kind: "call", actionLabel: "ace:X"|"ten:X"|"king:X"|"go_alone" } in calling phase', () => {
    const view = {
      phase: 'calling',
      hands: { u1: [
        { id: 'QC', suit: 'C', rank: 'Q' }, { id: 'QS', suit: 'S', rank: 'Q' },
        { id: 'JC', suit: 'C', rank: 'J' }, { id: 'AD', suit: 'D', rank: 'A' },
        { id: '9S', suit: 'S', rank: '9' }, { id: '9H', suit: 'H', rank: '9' },
      ]},
      picker: 'u1',
      buried: [],
    }
    const result = computeBotSuggestion(view, 'u1')
    expect(result.kind).toBe('call')
    expect(result.actionLabel).toMatch(/^(ace:[CHS]|ten:[CHS]|king:[CHS]|go_alone)$/)
  })

  it('throws on unknown phase', () => {
    expect(() => computeBotSuggestion({ phase: 'scoring', hands: { u1: [] } }, 'u1'))
      .toThrow(/unknown phase/i)
  })
})
```

- [ ] **Step 2: Run the test file and confirm failure**

```
npm test -- shared/botSuggestion.test.js
```

Expected: FAIL with "Cannot find module './botSuggestion.js'" or equivalent.

- [ ] **Step 3: Implement `shared/botSuggestion.js`**

Create `shared/botSuggestion.js`:

```js
// Dispatches on state.phase to the matching bot-strategy decision function.
// Pure — no side effects, no I/O. Caller is responsible for deciding *when*
// to call (toggle on, my turn). Errors are thrown; the caller wraps in try/catch.
import {
  decidePick, decideBlitz, decideBury, decideCall, decidePlay,
} from './botStrategy.js'

export function computeBotSuggestion(view, userId) {
  switch (view.phase) {
    case 'picking': {
      const potentialBlitz = (view.potentialBlitzes ?? []).find(b => b.userId === userId)
      if (potentialBlitz && decideBlitz(view, userId)) {
        return { kind: 'pick', ids: [], actionLabel: 'blitz' }
      }
      const shouldPick = decidePick(view, userId)
      return { kind: 'pick', ids: [], actionLabel: shouldPick ? 'pick' : 'pass' }
    }

    case 'burying': {
      const ids = decideBury(view, userId)
      return { kind: 'bury', ids }
    }

    case 'calling': {
      const decision = decideCall(view, userId)
      let actionLabel
      switch (decision.type) {
        case 'ace':
        case 'ace_under':
          actionLabel = `ace:${decision.suit}`
          break
        case 'ten':
          actionLabel = `ten:${decision.suit}`
          break
        case 'king':
          actionLabel = `king:${decision.suit}`
          break
        default:
          actionLabel = 'go_alone'
      }
      const ids = decision.type === 'ace_under' && decision.underCardId
        ? [decision.underCardId]
        : []
      return { kind: 'call', ids, actionLabel }
    }

    case 'playing': {
      const cardId = decidePlay(view, userId)
      return { kind: 'play', ids: [cardId] }
    }

    default:
      throw new Error(`Unknown phase: ${view.phase}`)
  }
}
```

- [ ] **Step 4: Re-run tests to confirm they pass**

```
npm test -- shared/botSuggestion.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run the full suite to confirm no regressions**

```
npm test
```

Expected: all existing tests still pass (210 pre-existing + 5 new = 215, approximately).

- [ ] **Step 6: Commit**

```
git add shared/botSuggestion.js shared/botSuggestion.test.js
git commit -m "feat(bot): add computeBotSuggestion phase-dispatch helper (#123)"
```

---

## Task 3: `Card` — accept `suggested` prop and apply class

**Files:**
- Modify: `frontend/src/components/Card.jsx`

- [ ] **Step 1: Add the `suggested` prop and compose into class list**

Replace the entire function body of `Card` (lines 9-49) with:

```js
export default function Card({ card, playable = false, selected = false, suggested = false, onClick }) {
  if (!card || card.hidden) {
    const hiddenClasses = [
      'card', 'card-img', 'hidden',
      playable  ? 'playable'       : '',
      selected  ? 'selected'       : '',
      suggested ? 'card-suggested' : '',
    ].filter(Boolean).join(' ')
    return (
      <div
        className={hiddenClasses}
        aria-label={card?.isUnderCard ? 'Under card' : 'Hidden card'}
        title={card?.isUnderCard ? 'Under card' : undefined}
        onClick={playable ? onClick : undefined}
        role={playable ? 'button' : undefined}
      >
        <img src={CARD_BACK_SRC} alt="Card back" className="card-image" />
      </div>
    )
  }

  const trump = isTrump(card)

  const classes = [
    'card',
    'card-img',
    trump     ? 'trump'          : '',
    playable  ? 'playable'       : '',
    selected  ? 'selected'       : '',
    suggested ? 'card-suggested' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      onClick={playable ? onClick : undefined}
      title={trump ? `${card.id} (trump)` : card.id}
      role={playable ? 'button' : undefined}
    >
      <img src={cardImageSrc(card.id)} alt={card.id} className="card-image" />
    </div>
  )
}
```

- [ ] **Step 2: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```
git add frontend/src/components/Card.jsx
git commit -m "feat(ui): add suggested prop to Card for bot-hint highlight (#123)"
```

---

## Task 4: `Hand` — accept `suggestedIds` prop and forward

**Files:**
- Modify: `frontend/src/components/Hand.jsx`

- [ ] **Step 1: Add `suggestedIds` prop and forward to each `Card`**

Replace the Hand component (lines 21-41) with:

```js
export default function Hand({ cards = [], playableIds = null, selectedIds = [], suggestedIds = null, onCardClick }) {
  const sorted = sortHand(cards)

  return (
    <div className="hand">
      {sorted.map(card => {
        const playable  = playableIds === null ? false : playableIds.includes(card.id)
        const selected  = selectedIds.includes(card.id)
        const suggested = suggestedIds !== null && suggestedIds.includes(card.id)
        return (
          <Card
            key={card.id}
            card={card}
            playable={playable}
            selected={selected}
            suggested={suggested}
            onClick={() => onCardClick?.(card)}
          />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```
git add frontend/src/components/Hand.jsx
git commit -m "feat(ui): thread suggestedIds through Hand to Card (#123)"
```

---

## Task 5: `ActionPanel` — accept `suggestedAction`, apply to matching buttons

**Files:**
- Modify: `frontend/src/components/ActionPanel.jsx`

- [ ] **Step 1: Add `suggestedAction` and `suggestedIds` props to the function signature**

Replace line 6 (the `export default function ActionPanel(...)` signature) with:

```js
export default function ActionPanel({ state, myUserId, myHand, onAction, loading, actingForName, suggestedAction = null, suggestedIds = null }) {
```

- [ ] **Step 2: Define a small className helper just below the signature**

Insert after line 6 (inside the function body, near the top, before `const botStyle`):

```js
  const suggestedClass = (label) => (suggestedAction === label ? 'btn-suggested' : '')
```

- [ ] **Step 3: Apply to the picking-phase buttons**

In the picking block (lines 86-93), update the three action buttons:

```js
          {playerBlitz?.type === 'black' && (
            <button className={suggestedClass('blitz')} onClick={() => act('blitz')} disabled={loading}>Black Blitz?</button>
          )}
          {playerBlitz?.type === 'red' && (
            <button className={suggestedClass('blitz')} onClick={() => act('blitz')} disabled={loading}>Red Blitz?</button>
          )}
          <button className={suggestedClass('pick')} onClick={() => act('pick')} disabled={loading}>Pick the Blind?</button>
          <button className={`secondary ${suggestedClass('pass')}`} onClick={() => act('pass')} disabled={loading}>Pass</button>
```

- [ ] **Step 4: Apply to the burying-phase Hand**

In the burying block (lines 112-131), forward `suggestedIds` to the `<Hand>`:

```js
        <Hand
          cards={myHand}
          playableIds={myHand.map(c => c.id)}
          selectedIds={selectedBuried.map(c => c.id)}
          suggestedIds={suggestedIds}
          onCardClick={toggleBury}
        />
```

- [ ] **Step 5: Apply to calling-phase suit buttons (king, ten, ace, ace-under)**

For each of the three `callMode` blocks (king, ten, ace), compose `suggestedClass('king:${suit}')` / `suggestedClass('ten:${suit}')` / `suggestedClass('ace:${suit}')` into the button's `className`. Example for king (lines 158-167):

```js
            {callableSuits.map(suit => (
              <button
                key={suit}
                className={`suit-btn ${suit === 'H' ? 'red' : 'black'} ${suggestedClass(`king:${suit}`)}`}
                onClick={() => act('call_king', { suit })}
                disabled={loading}
                title={`Call K${suit}`}
              >
                K{SUIT_SYMBOLS[suit]}
              </button>
            ))}
```

Repeat the same pattern for ten mode (replace `king:` with `ten:`) and ace mode (replace with `ace:`). The under-call buttons in ace mode should also use `ace:${suit}` — the bot's `ace_under` decision maps to the same `actionLabel`, so the same button highlights.

- [ ] **Step 6: Apply to the Go Alone button**

Replace the `goAloneSection` (lines 17-50). The only change is the button inside the non-confirming branch (line 41-48):

```js
        <button
          className={`secondary ${suggestedClass('go_alone')}`}
          onClick={() => setConfirmingAlone(true)}
          disabled={loading}
        >
          Go Alone
        </button>
```

- [ ] **Step 7: Forward `suggestedIds` to the under-card-selection sub-view `<Hand>`**

In the Situation B sub-view (lines 213-247), update the inner `<Hand>` call (lines 222-227):

```js
          <Hand
            cards={myHand}
            playableIds={myHand.map(c => c.id)}
            selectedIds={selectedUnderCard ? [selectedUnderCard] : []}
            suggestedIds={suggestedIds}
            onCardClick={(card) => setSelectedUnderCard(card.id)}
          />
```

- [ ] **Step 8: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 9: Commit**

```
git add frontend/src/components/ActionPanel.jsx
git commit -m "feat(ui): thread suggestedAction/suggestedIds through ActionPanel (#123)"
```

---

## Task 6: `GameOptionsPanel` — add `role` prop and read-only layout

**Files:**
- Modify: `frontend/src/components/GameOptionsPanel.jsx`

- [ ] **Step 1: Add new props to the signature**

Replace line 16 with:

```js
export default function GameOptionsPanel({
  mode, gameId, open, values, onChange, onUpdated, onClose,
  role = 'admin',
  botSuggestionEnabled = false,
  onBotSuggestionChange = null,
}) {
```

- [ ] **Step 2: Replace the three form-option sections with a role-aware render**

Replace the entire JSX block from the opening `<dialog>` (line 126) through the closing `</dialog>` (line 210) with the following. Preserve the existing `dialogRef`, `onClose`, and header semantics.

```jsx
  const isReadOnly = role === 'player'
  const VARIANT_DISPLAY = { doublers: 'Doublers', leasters: 'Leasters', schwanzers: 'Schwanzers' }

  return (
    <dialog
      ref={dialogRef}
      className="game-options-dialog"
      onClose={handleDialogClose}
    >
      <strong style={{ fontSize: '0.95rem' }}>⚙ Game options</strong>
      {mode === 'update' && !isReadOnly && (
        <small style={{ color: '#aaa', display: 'block', marginBottom: 12, marginTop: 2 }}>
          Changes take effect next hand
        </small>
      )}
      {isReadOnly && (
        <small style={{ color: '#aaa', display: 'block', marginBottom: 12, marginTop: 2 }}>
          Only the game admin can change these
        </small>
      )}
      {mode === 'create' && (
        <div style={{ marginBottom: 12 }} />
      )}

      {isReadOnly ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 6, columnGap: 16, marginBottom: 16, fontSize: '0.85rem' }}>
          <span style={{ color: '#aaa' }}>No-pick variant</span>
          <span>{VARIANT_DISPLAY[variant] ?? variant}</span>
          <span style={{ color: '#aaa' }}>Partner visibility</span>
          <span>{reveal ? 'Shown' : 'Hidden'}</span>
          <span style={{ color: '#aaa' }}>Double on bump</span>
          <span>{dob ? 'On' : 'Off'}</span>
        </div>
      ) : (
        <>
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
        </>
      )}

      {/* Your preferences — hidden in create mode (no game yet) */}
      {mode !== 'create' && onBotSuggestionChange && (
        <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.15)', marginBottom: 16 }}>
          <div style={{ color: '#ccc', fontSize: '0.82rem', marginBottom: 6 }}>Your preferences</div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={botSuggestionEnabled}
              onChange={e => onBotSuggestionChange(e.target.checked)}
              disabled={saving}
              style={{ marginTop: 3 }}
            />
            <span>
              Show Bot Suggestion
              <small style={{ display: 'block', color: '#888', marginTop: 2 }}>
                Highlights the card the bot would play on your turn. Purely advisory — useful for learning the game or comparing against the bot's strategy.
              </small>
            </span>
          </label>
        </div>
      )}

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
```

- [ ] **Step 3: Guard the Done-handler against player-role writes**

Replace `handleDone` (lines 81-112) so a player role never PATCHes, regardless of whether the UI would let it:

```js
  async function handleDone() {
    if (mode !== 'update' || role === 'player') {
      committedRef.current = true
      onClose?.()
      return
    }
    const initial = initialRef.current
    const changed = {}
    if (variant !== initial.no_pick_variant) changed.no_pick_variant = variant
    if (reveal  !== initial.reveal_partner)  changed.reveal_partner  = reveal
    if (dob     !== initial.double_on_bump)  changed.double_on_bump  = dob

    if (Object.keys(changed).length === 0) {
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
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 4: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```
git add frontend/src/components/GameOptionsPanel.jsx
git commit -m "feat(ui): add role + botSuggestion props to GameOptionsPanel (#123)"
```

---

## Task 7: `LobbyPage` — rename Edit → Options on create form

**Files:**
- Modify: `frontend/src/pages/LobbyPage.jsx`

- [ ] **Step 1: Rename the button label**

On `frontend/src/pages/LobbyPage.jsx` line 156, change `⚙ Edit` to `⚙ Options`. The button is the one inside the `{showCreate && …}` create-game form.

- [ ] **Step 2: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```
git add frontend/src/pages/LobbyPage.jsx
git commit -m "feat(ui): rename create-form game options button to Options (#123)"
```

---

## Task 8: `GamePage` — localStorage-backed `showBotSuggestion` state

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 1: Add the state and change handler**

Near the top of the component, alongside the other `useState` declarations (e.g. next to `setCurrentVariant`), insert:

```js
  const [showBotSuggestion, setShowBotSuggestion] = useState(() => {
    try {
      return localStorage.getItem('sheepshead:showBotSuggestion') === 'true'
    } catch {
      return false
    }
  })

  const handleBotSuggestionChange = (next) => {
    setShowBotSuggestion(next)
    try {
      localStorage.setItem('sheepshead:showBotSuggestion', next ? 'true' : 'false')
    } catch {
      // localStorage unavailable — in-memory state still updates.
    }
  }
```

- [ ] **Step 2: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```
git add frontend/src/pages/GamePage.jsx
git commit -m "feat(ui): persist showBotSuggestion in localStorage (#123)"
```

---

## Task 9: `GamePage` — import botSuggestion helper and compute in `useMemo`

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 1: Add the import at the top of the file**

Near the existing `@shared/` imports in `GamePage.jsx`, add:

```js
// NOTE: Importing the bot strategy here bundles its full logic into the
// shipped JS. The logic is already documented in docs/BOTS.md, so this
// exposure is acceptable. See issue #123.
import { computeBotSuggestion } from '@shared/botSuggestion.js'
```

- [ ] **Step 2: Add the `useMemo` after `effectiveUserId` / `turnUserId` are defined**

Immediately after the existing `isMyPlayingTurn` / `legalIds` computation (around line 604-605), add:

```js
  const botSuggestion = useMemo(() => {
    if (!showBotSuggestion) return null
    if (!turnUserId || turnUserId !== effectiveUserId) return null
    try {
      return computeBotSuggestion(state, effectiveUserId)
    } catch (err) {
      console.warn('[botSuggestion] computation failed:', err)
      return null
    }
  }, [showBotSuggestion, turnUserId, effectiveUserId, state])
```

Add `useMemo` to the `import { useState, useEffect } from 'react'` line if it's not already imported.

- [ ] **Step 3: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```
git add frontend/src/pages/GamePage.jsx
git commit -m "feat(ui): compute botSuggestion in GamePage via useMemo (#123)"
```

---

## Task 10: `GamePage` — thread props into `Hand`/`ActionPanel` and open Options to non-admins (waiting state)

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 1: Replace the waiting-state admin/non-admin branch with a unified Options button**

In the `if (status === 'waiting')` block (roughly lines 414-462), replace the `{isGameAdmin ? (...) : (...)}` branch with a single unified render. The goal: both admin and non-admin see an Options button; the modal's `role` prop branches.

```jsx
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: 3 }}>Game options</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <SettingsSummary
              settings={currentSettings}
              style={{ color: '#ccc', fontSize: '0.85rem' }}
            />
            <button className="outline" style={{ fontSize: '0.8rem', padding: '2px 10px' }}
              onClick={() => setShowOptions(true)}>
              ⚙ Options
            </button>
          </div>
        </div>
        <GameOptionsPanel
          mode="update"
          gameId={gameId}
          open={showOptions}
          values={currentSettings}
          onUpdated={handleSettingsUpdate}
          onClose={() => setShowOptions(false)}
          role={isGameAdmin ? 'admin' : 'player'}
          botSuggestionEnabled={showBotSuggestion}
          onBotSuggestionChange={handleBotSuggestionChange}
        />
```

- [ ] **Step 2: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```
git add frontend/src/pages/GamePage.jsx
git commit -m "feat(ui): open Options to non-admin players in waiting state (#123)"
```

---

## Task 11: `GamePage` — in-game Options button + suggestion props wired to `Hand`/`ActionPanel`

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`

- [ ] **Step 1: Replace the in-game admin/non-admin branch in the right-panel**

In the right-panel options block (roughly lines 635-663), replace the `{isGameAdmin ? (...) : (...)}` branch with:

```jsx
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <SettingsSummary
              settings={currentSettings}
              style={{ color: '#aaa', fontSize: '0.78rem' }}
            />
            <button className="outline" style={{ fontSize: '0.78rem', padding: '2px 8px' }}
              onClick={() => setShowOptions(true)}>
              ⚙ Options
            </button>
          </div>
          <GameOptionsPanel
            mode="update"
            gameId={gameId}
            open={showOptions}
            values={currentSettings}
            onUpdated={handleSettingsUpdate}
            onClose={() => setShowOptions(false)}
            role={isGameAdmin ? 'admin' : 'player'}
            botSuggestionEnabled={showBotSuggestion}
            onBotSuggestionChange={handleBotSuggestionChange}
          />
```

- [ ] **Step 2: Derive `suggestedIdsForHand` and `suggestedActionForPanel` near the bottom of the component**

Just before the `return` statement that renders the game table, add:

```js
  const suggestedIdsForHand = botSuggestion &&
    (botSuggestion.kind === 'play' || botSuggestion.kind === 'bury')
      ? botSuggestion.ids
      : null

  // Pass ids through in the call phase too (for the ace_under sub-view's inner Hand).
  const suggestedIdsForActionPanel = botSuggestion &&
    (botSuggestion.kind === 'call' || botSuggestion.kind === 'bury')
      ? botSuggestion.ids
      : null

  const suggestedActionForPanel = botSuggestion?.actionLabel ?? null
```

- [ ] **Step 3: Thread `suggestedIds` into the player's bottom-seat `<Hand>` render**

Locate the `<Hand cards={activeHand} ... />` render in the bottom seat (inside `seat-bottom`). Add the `suggestedIds` prop:

```jsx
              <Hand
                cards={activeHand}
                playableIds={state.phase === 'playing' && isMyPlayingTurn ? legalIds : null}
                selectedIds={[]}
                suggestedIds={suggestedIdsForHand}
                onCardClick={handlePlayCard}
              />
```

(The exact surrounding props may differ — keep all existing props, add `suggestedIds={suggestedIdsForHand}`.)

- [ ] **Step 4: Thread `suggestedAction` and `suggestedIds` into `<ActionPanel>`**

Locate the `<ActionPanel ... />` render. Add:

```jsx
          <ActionPanel
            state={state}
            myUserId={effectiveUserId}
            myHand={activeHand}
            onAction={...existing}
            loading={...existing}
            actingForName={actingForPlayer?.username}
            suggestedAction={suggestedActionForPanel}
            suggestedIds={suggestedIdsForActionPanel}
          />
```

- [ ] **Step 5: Confirm build still succeeds**

```
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Run the full test suite**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```
git add frontend/src/pages/GamePage.jsx
git commit -m "feat(ui): open Options to non-admin in-game; thread bot hint props (#123)"
```

---

## Task 12: Manual verification walkthrough

**Files:** none — this is a verification pass.

- [ ] **Step 1: Start the dev environment**

```
npm run dev
```

Open http://localhost:3000 in a browser.

- [ ] **Step 2: Verify lobby create form**

- Open New Game. Click ⚙ Options (renamed). Confirm the modal opens with game-option form inputs and NO "Your preferences" section (create mode hides it).
- Close, create a game with bots.

- [ ] **Step 3: Verify non-admin read-only Options**

- In a second browser (or incognito window), sign in as a different user, join the game.
- In that second browser, click ⚙ Options.
- Confirm: a key-value list (no form controls) showing the current settings, plus a "Your preferences" section with the Show Bot Suggestion checkbox.
- Toggle the checkbox on. Close the modal.

- [ ] **Step 4: Verify highlight appears on your turn (play phase)**

- In the second browser, wait for the hand to reach the playing phase and for your turn.
- Confirm exactly one card in your hand has a red outline (the bot's recommended play).
- Confirm the outline does NOT change while you hover other cards.

- [ ] **Step 5: Verify highlight on pick/pass/blitz, bury, and call phases**

- Start a new hand. On a turn where you are the first picker, confirm Pick or Pass is outlined (or Blitz if you hold Q♣ and qualify).
- When you pick, confirm the bury screen shows exactly two red-outlined cards.
- When you call, confirm the recommended suit button is outlined (or Go Alone).

- [ ] **Step 6: Verify toggle off hides the highlight**

- Open ⚙ Options, uncheck Show Bot Suggestion, close.
- Confirm no red outlines appear on any turn.

- [ ] **Step 7: Verify persistence across reload**

- Enable the toggle, reload the page.
- Confirm the toggle is still on and the hint reappears on your next turn.

- [ ] **Step 8: Verify admin view is unchanged**

- In the first browser (the admin), click ⚙ Options. Confirm the form controls are editable as before, and the "Your preferences" section is present at the bottom.
- Change a game option and click Done. Confirm the change persists (this exercises that the player-role guard does not interfere with admin writes).

- [ ] **Step 9: Confirm production build**

```
npm run build
```

Expected: build succeeds with no new warnings.

- [ ] **Step 10: Commit a tag-only verification note (optional)**

If a manual-verification note in the PR description is desired, record it there rather than in code. No further commit needed from this task.

---

## Out of scope (tracked separately)

- Reasoning tooltip on the highlighted element → https://github.com/andynumber2/sheepshead/issues/140
- Cross-device sync of the preference — not planned
- Spectator highlights — blocked on spectator mode (https://github.com/andynumber2/sheepshead/issues/75)
- Alternative candidate plays — not requested
