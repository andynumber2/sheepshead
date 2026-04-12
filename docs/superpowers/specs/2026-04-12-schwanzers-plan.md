# Schwanzers Implementation Plan

**Spec:** `2026-04-12-schwanzers-design.md`
**Issue:** #50

---

## Step 1 — Game engine: add `schwanzerCardPoints` and `resolveSchwanzer`

**File:** `shared/gameEngine.js`

Add after the existing `cardPoints` function:

```js
// Schwanzer point value of a card (used only in Schwanzer no-pick hands)
// Queens=3, Jacks=2, diamond pips (non-Q, non-J diamonds)=1, all else=0
export function schwanzerCardPoints(card) {
  if (card.rank === 'Q') return 3
  if (card.rank === 'J') return 2
  if (card.suit === 'D') return 1
  return 0
}
```

Add after the `resolveLeaster` function:

```js
// ─── Schwanzer ────────────────────────────────────────────────────────────────
// No tricks are played. Each player's 6 dealt cards are scored using Schwanzer
// point values. The player with the most points loses 4; all others gain 1.
// Tie-break: most powerful trump (lowest TRUMP_ORDER index) loses.
// Fallback: first tied player in pickOrder loses.
export function resolveSchwanzer(state) {
  const pointsByPlayer = {}
  for (const [uid, hand] of Object.entries(state.hands)) {
    pointsByPlayer[uid] = hand.reduce((sum, card) => sum + schwanzerCardPoints(card), 0)
  }

  const maxPoints = Math.max(...Object.values(pointsByPlayer))
  const tied = state.pickOrder.filter(uid => pointsByPlayer[uid] === maxPoints)

  // Tie-break by most powerful trump held (lowest TRUMP_ORDER index = most powerful)
  function bestTrumpIndex(uid) {
    const trumps = state.hands[uid].filter(c => isTrump(c))
    if (trumps.length === 0) return TRUMP_ORDER.length  // no trump → least powerful
    return Math.min(...trumps.map(c => trumpRank(c)))
  }

  const loser = tied.reduce((worst, uid) =>
    bestTrumpIndex(uid) < bestTrumpIndex(worst) ? uid : worst
  )

  const scores = {}
  for (const uid of Object.keys(state.hands)) {
    scores[uid] = uid === loser ? -4 : 1
  }

  const breakdown = state.pickOrder
    .map(uid => `${uid}: ${pointsByPlayer[uid]}pts`)
    .join(', ')
  state.log.push(`Schwanzer! Points — ${breakdown}. ${loser} had the most and loses.`)

  return { loser, scores }
}
```

---

## Step 2 — Settings API: allow `'schwanzers'` as a valid variant

**File:** `functions/api/games/[id]/settings.js`

Change:
```js
if (no_pick_variant !== undefined && !['leasters', 'doublers'].includes(no_pick_variant)) {
```
To:
```js
if (no_pick_variant !== undefined && !['leasters', 'doublers', 'schwanzers'].includes(no_pick_variant)) {
```

---

## Step 3 — Action handler: resolve Schwanzers on all-pass

**File:** `functions/api/games/[id]/action.js`

1. Add `resolveSchwanzer` to the import from `gameEngine.js`.

2. In the `pass` case, add the Schwanzers branch:

```js
if (freshGame.no_pick_variant === 'leasters') {
  state = setupLeaster(state)
} else if (freshGame.no_pick_variant === 'schwanzers') {
  const { scores } = resolveSchwanzer(state)
  state.scores = scores
  state.phase = 'scoring'
  state = await finishHand(env.DB, gameId, state)
} else {
  // doublers (existing code)
  ...
}
```

---

## Step 4 — Frontend: add Schwanzers to variant labels and admin radio

**File:** `frontend/src/pages/GamePage.jsx`

1. Update `VARIANT_LABELS`:
```js
const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers', schwanzers: 'Schwanzers' }
```

2. Update the radio group in `AdminSettingsPanel`:
```js
{['leasters', 'doublers', 'schwanzers'].map(v => ( ... ))}
```

---

## Step 5 — README: document Schwanzer rules

**File:** `README.md`

Add a `### Schwanzer` section after the Leaster section:

- Triggered when all five players pass and the no-pick variant is set to Schwanzers
- No tricks are played — each player's dealt hand is scored immediately
- Point scheme: Q=3, J=2, diamond pip=1
- The player with the most Schwanzer points loses 4; all others gain 1
- Tie-break: most powerful trump (QC > QS > … > 7D) loses; if none, first in seat order

---

## Verification Checklist

- [ ] `schwanzerCardPoints` returns 3/2/1/0 for Q/J/pip-D/other; QD=3, JD=2
- [ ] `resolveSchwanzer` correctly identifies max-points player
- [ ] Tie-break: player with more powerful trump loses
- [ ] Fallback tie-break: first in pickOrder wins when no trump held by any tied player
- [ ] Blind cards are excluded from scoring (only `state.hands` used)
- [ ] Scores written to `score_events` table (handled by `finishHand`)
- [ ] Next hand dealt immediately after Schwanzer resolves
- [ ] `doubler_multiplier` resets to 1 after Schwanzer (handled by `finishHand`)
- [ ] Settings API accepts `'schwanzers'` and rejects anything else
- [ ] Admin radio shows all three variants; non-admin label shows correct name
- [ ] Game log clearly names the loser and their point total
