# Bot Suggestion Highlight — Design

Tracks https://github.com/andynumber2/sheepshead/issues/123.

## Summary

Add an opt-in, per-player visual indicator that highlights what the bot strategy would choose on the human player's turn. The indicator is a red outline on the relevant card(s) or action button(s). The toggle lives inside the game Options modal, which is simultaneously refactored so non-admin players can open it (read-only game settings + personal preferences).

## Motivation

Two overlapping uses:

1. **Bot debugging.** Seeing what the bot *would* do on every human turn makes misplays easy to spot during normal play, without waiting for a bot to act.
2. **Gameplay / learning aid.** New or inexperienced Sheepshead players can use the highlight to learn conventional play patterns. The same mechanism that helps us find bot bugs also helps a human understand *what a competent player does in this situation* — the bot encodes a reasonable strategy, and surfacing it turns every turn into a small lesson.

This dual use is deliberate and costs us nothing — the same code and UI serves both audiences. It also sets up a natural extension path: a future **tutorial mode** could use the same highlight machinery plus guided prompts and forced decisions to teach the game end-to-end. That is out of scope here, but the design does not foreclose it.

## Scope

- Highlight the bot's choice on all four player decisions: pick/pass, bury, call, and play.
- Let any player open the Options modal. Non-admins see game settings as read-only; their only editable field is the personal "Show Bot Suggestion" toggle.
- Store the toggle client-side (localStorage), per browser.

**Out of scope** (see "Deferred" below): reasoning tooltips, cross-device sync, spectator highlights, alternative-candidate display.

## Architecture

The change is entirely in the frontend. No server or DB changes.

### Components touched

| File                                          | Change                                                                                                        |
|-----------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `frontend/src/components/GameOptionsPanel.jsx` | Add `role` prop; render game settings as read-only list for `role='player'`; add "Your preferences" section. |
| `frontend/src/pages/GamePage.jsx`             | Drop admin-only gating of Options button; compute `botSuggestion` via `useMemo`; pass down props.             |
| `frontend/src/pages/LobbyPage.jsx`            | Rename button "Edit" → "Options". Preferences section hidden in create mode.                                   |
| `frontend/src/components/Hand.jsx`            | New `suggestedIds` prop; apply `card-suggested` class.                                                        |
| `frontend/src/components/ActionPanel.jsx`     | New `suggestedAction` prop; apply `btn-suggested` class to the matching button.                               |
| `frontend/src/components/Card.jsx`            | No prop change; the `card-suggested` class is applied by `Hand` via the wrapper.                              |
| CSS (existing stylesheet)                     | Add `.card-suggested` and `.btn-suggested` rules.                                                             |

### Options modal refactor

`GameOptionsPanel` gains a `role: 'admin' | 'player'` prop (default `'admin'` for backward compatibility):

- **`role === 'admin'`** — current behaviour preserved: radios and checkboxes editable, Done button commits changed fields via `PATCH /api/games/:id/settings`.
- **`role === 'player'`** — game-option inputs are *not rendered* at all. Instead, a compact key-value block shows each option's current value:
  ```
  No-pick variant     Doublers
  Partner visibility  Hidden
  Double on bump      On
  ```
  No disabled form controls. This avoids implying interactivity where there is none.

A new **"Your preferences"** section is added at the bottom of the modal, separated by a thin top border. For v1 it contains exactly one control: a checkbox labelled **"Show Bot Suggestion"** with sub-copy "Highlights the card the bot would play on your turn. Purely advisory — useful for learning the game or comparing against the bot's strategy."

The preference's value is owned by the parent (`GamePage`). `GameOptionsPanel` receives `botSuggestionEnabled: boolean` and `onBotSuggestionChange(next: boolean): void` props. The panel itself never touches localStorage.

The "Your preferences" section is **hidden** when `mode === 'create'` — there is no active game yet, so the toggle has no effect.

Button label in all three call sites (LobbyPage create-form, GamePage waiting, GamePage in-game) renames from "⚙ Edit" to "⚙ Options".

### Bot suggestion computation

`GamePage.jsx` computes the suggestion in a `useMemo` hook that depends on `state`, `effectiveUserId`, `turnUserId`, and `showBotSuggestion`:

- Returns `null` when the toggle is off or when it is not the effective player's turn.
- Dispatches on `state.phase` to the matching decision function from `shared/botStrategy.js`.
- Wrapped in `try/catch`: on any thrown error, returns `null` and logs `console.warn`. A broken bot suggestion must never break the game UI.

Return shape:

```
{ kind: 'pick' | 'bury' | 'call' | 'play',
  ids: string[],              // card IDs to highlight (empty for non-card decisions)
  actionLabel?: string }       // e.g. 'pick', 'pass', 'go_alone', 'ace:H'
```

| phase    | decision function(s)                   | `kind`  | `ids`                   | `actionLabel`                                                         |
|----------|----------------------------------------|---------|-------------------------|-----------------------------------------------------------------------|
| picking  | `decideBlitz` → `decidePick`           | `pick`  | `[]`                    | `'blitz'` / `'pick'` / `'pass'`                                       |
| burying  | `decideBury`                           | `bury`  | `[cardId, cardId]`      | `undefined`                                                           |
| calling  | `decideCall`                           | `call`  | `[]`                    | `'ace:<suit>'` / `'ten:<suit>'` / `'king:<suit>'` / `'go_alone'`       |
| playing  | `decidePlay`                           | `play`  | `[cardId]`              | `undefined`                                                           |

**Picking-phase dispatch mirrors the server's bot flow** (`functions/api/_botHelpers.js`). If the player has a `potentialBlitzes` entry *and* `decideBlitz` returns true → `actionLabel: 'blitz'`. Otherwise fall through to `decidePick`: true → `'pick'`, false → `'pass'`. `ActionPanel` highlights the matching button.

**Call decision — `ace_under` (Situation B).** When `decideCall` returns `{ type: 'ace_under', suit, underCardId }`, the `actionLabel` is `'ace:<suit>'` so the suit button is highlighted on the initial call screen (same as a normal `'ace'` call). When the user subsequently enters the under-card-selection sub-view, the recommended under card is additionally passed into that `<Hand>` as `suggestedIds: [underCardId]`. This is the only phase where the suggestion spans two UI screens.

**Bury-phase UX.** Both recommended cards glow red simultaneously and statically. Clicking one to select it does not alter the highlight on the other — the hint is purely advisory and stays visible until the Bury action is committed.

`decidePlay` can return the sentinel `'UNDER_CARD'` when the picker should play their under card. The under card is already represented in `hand` as `{ id: 'UNDER_CARD', isUnderCard: true, faceDown: true }`, so the same highlight mechanism applies uniformly — no special case.

### Client-side import note

The client now imports `shared/botStrategy.js`, which ships the full strategy logic to the browser. This is acceptable because the strategy is already publicly documented in `docs/BOTS.md`. A brief comment is added at the import site in `GamePage.jsx` to record this reasoning.

### Prop wiring

- `Hand` gains `suggestedIds: string[] | null`. For each card, adds `card-suggested` to the wrapper class when `suggestedIds?.includes(card.id)`.
- `ActionPanel` gains `suggestedAction: string | null`. Matches against its internal button identifiers and applies `btn-suggested` to the matching element. The matching is direct string equality; no parsing.

### localStorage

- **Key:** `sheepshead:showBotSuggestion`
- **Value:** `"true"` or `"false"` (missing = off).
- **Read:** lazy initializer in `useState` in `GamePage`.
- **Write:** the `onBotSuggestionChange` handler writes through to localStorage and React state in the same function.
- **No cross-tab sync.** Two tabs hold independent values until toggled. Adding a `storage` event listener is overkill for a debug preference.

### CSS

```
.card-suggested {
  outline: 3px solid #ef4444;  /* red-500 */
  outline-offset: 2px;
  border-radius: inherit;
}

.btn-suggested {
  box-shadow: 0 0 0 2px #ef4444;
}
```

Using `outline` rather than `border` avoids layout shift. `.card-suggested` composes additively with the existing `playable` class — a card can be both.

## Testing

- No new tests in `shared/`. The bot strategy suite already covers decision correctness.
- Add a small suite around `GamePage`'s suggestion wiring, exercising the four phase branches end-to-end with fixture state:
  - Toggle off → no suggestion.
  - Toggle on but not our turn → no suggestion.
  - Toggle on and `phase === 'playing'` → `{ kind: 'play', ids: [expected] }`.
  - Happy path per other phase (`burying`, `picking`, `calling`).

UI rendering assertions are incidental — we verify the hook output, not the class names.

## Success criteria

1. When "Show Bot Suggestion" is on, a non-bot player on their own turn sees red outlines on the cards / action buttons the bot would choose.
2. Highlighting works in all four phases (picking, burying, calling, playing).
3. The preference persists across reloads on the same browser and does not sync cross-device.
4. Non-admins can open the Options modal, see all three game options as read-only, and toggle only their personal Bot Suggestion.
5. Admins retain full control of the three game options and additionally have their own personal Bot Suggestion toggle.
6. No server or DB changes; no new endpoints.

## Deferred

- **Reasoning tooltip.** Tracked at https://github.com/andynumber2/sheepshead/issues/140. Requires `decide*` functions to return reason tags; out of scope for v1.
- **Cross-device sync of the preference.** Not planned.
- **Spectator highlights.** Spectator mode is not implemented; see https://github.com/andynumber2/sheepshead/issues/75.
- **Alternative candidate plays.** Not requested.

## Relationships

- **Blocks** https://github.com/andynumber2/sheepshead/issues/140 — the reasoning tooltip hangs off this feature's highlight.
- **Builds on** https://github.com/andynumber2/sheepshead/issues/114 — game-mode visibility for non-admins is extended here into a full read-only Options view.
