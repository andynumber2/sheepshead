# Deduced Partner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic partner-deduction layer to `botInference.js`, plus engine state for who cracked/recracked, and update five consumer call sites in `botStrategy.js` so opponent bots correctly identify their partner from public information (crack, recrack, called-suit-led elimination) before `partnerRevealed` flips.

**Architecture:** Two new pure helpers in `shared/botInference.js` — `knownNonPartners(view, userId)` and `deducedPartner(view, userId)`. Two new state fields in `shared/gameEngine.js` (`crackerId`, `recrackerId`) populated by `crack()` / `recrack()` and exposed unredacted in the player view. Five consumer call sites in `shared/botStrategy.js` (and one in `botInference.js`) switch from `view.partner` to `deducedPartner(view, userId)`. The strict rule: identity questions ("who is the partner?") use the deducer; timing questions ("has the called card been played?") keep `partnerRevealed`.

**Tech Stack:** JavaScript (ESM), Vitest. No new dependencies.

Spec to reference throughout: `docs/superpowers/specs/2026-04-30-deduced-partner-design.md`.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `shared/gameEngine.js` | Game engine + state shape | **Modify**: add `crackerId`/`recrackerId` to `dealHand` initial state; populate in `crack()` and `recrack()` |
| `shared/botInference.js` | Pure inference helpers | **Modify**: add `knownNonPartners` and `deducedPartner`; update `teammateWinning` to use `deducedPartner` |
| `shared/botStrategy.js` | Bot decision logic | **Modify**: update four identity-check call sites to use `deducedPartner` |
| `shared/botInference.test.js` | New test file for inference helpers | **Create**: unit tests for `knownNonPartners` and `deducedPartner` |
| `shared/gameEngine.test.js` | Engine tests | **Modify**: add `crackerId`/`recrackerId` assertions to crack/recrack tests; add `getPlayerView` exposure tests |
| `shared/botStrategy.test.js` | Strategy integration tests | **Modify**: add headline schmear unlock test, recrack/lead-flush/force-take/predicted-win tests, regression guard |
| `shared/botSuggestion.test.js` | Suggestion smoke check | **Modify**: add one assertion that the schmear flows through to the human-suggestion surface |
| `docs/BOTS.md` | Plain-English bot strategy reference | **Modify**: add "Inference Helpers" entries; describe consumer changes |

---

## Tasks

### Task 1: Engine — `crackerId` / `recrackerId` state fields

**Files:**
- Modify: `shared/gameEngine.js` (`dealHand` return literal at lines 105-137; `crack` at lines 428-440; `recrack` at lines 442-452)
- Test: `shared/gameEngine.test.js` (extend the existing `describe('crack / recrack', ...)` block at line 1280; extend `describe('getPlayerView', ...)` at line 1373)

- [ ] **Step 1.1: Write failing tests for engine state fields**

Add to the existing `describe('crack / recrack', ...)` block in `shared/gameEngine.test.js`:

```javascript
it('crack records the cracker userId', () => {
  const next = crack(makeCrackState(), 'p3')
  expect(next.crackerId).toBe('p3')
  expect(next.recrackerId).toBeNull()
})

it('recrack records the recracker userId', () => {
  const cracked = crack(makeCrackState(), 'p3')
  const recracked = recrack(cracked, 'p1')
  expect(recracked.crackerId).toBe('p3')
  expect(recracked.recrackerId).toBe('p1')
})

it('partner recracks — recrackerId is the partner', () => {
  const cracked = crack(makeCrackState(), 'p3')
  const recracked = recrack(cracked, 'p2')
  expect(recracked.recrackerId).toBe('p2')
})
```

Add a new test inside `describe('dealHand', ...)` at line 227:

```javascript
it('initializes crackerId and recrackerId to null', () => {
  const state = dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
  expect(state.crackerId).toBeNull()
  expect(state.recrackerId).toBeNull()
})
```

Add a new test inside `describe('getPlayerView', ...)` at line 1373:

```javascript
it('exposes crackerId and recrackerId unredacted to all players', () => {
  let state = dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
  state = { ...state, phase: 'playing', picker: 'p1', partner: 'p2', goingAlone: false, isLeaster: false, crackState: null, handCrackMultiplier: 1, pickOrder: ['p1','p2','p3','p4','p5'], pickIndex: 0, log: [] }
  state = crack(state, 'p3')
  state = recrack(state, 'p2')
  for (const uid of ['p1','p2','p3','p4','p5']) {
    const view = getPlayerView(state, uid)
    expect(view.crackerId).toBe('p3')
    expect(view.recrackerId).toBe('p2')
  }
})
```

If `crack` / `recrack` / `getPlayerView` aren't already imported in this file, add them to the existing import line at the top.

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `cd shared && npx vitest run gameEngine.test.js -t "crack records|recrack records|partner recracks|initializes crackerId|exposes crackerId"`
Expected: FAIL on `crackerId` / `recrackerId` being undefined.

- [ ] **Step 1.3: Add fields to `dealHand` initial state**

In `shared/gameEngine.js`, add two lines to the return literal in `dealHand` (insert after line 132, alongside `crackState`):

```javascript
    crackState: null,          // null | 'cracked' | 'recracked'
    crackerId: null,           // userId of opponent who cracked, or null
    recrackerId: null,         // userId of picker or partner who recracked, or null
```

- [ ] **Step 1.4: Populate fields in `crack` and `recrack`**

In `crack()` (line 428-440), after `newState.crackState = 'cracked'`:

```javascript
  newState.crackState = 'cracked'
  newState.crackerId = userId
  newState.handCrackMultiplier = 2
```

In `recrack()` (line 442-452), after `newState.crackState = 'recracked'`:

```javascript
  newState.crackState = 'recracked'
  newState.recrackerId = userId
  newState.handCrackMultiplier = 4
```

- [ ] **Step 1.5: Verify `getPlayerView` passes the new fields through unredacted**

`getPlayerView` (line 896) starts with `const view = deepClone(state)` and selectively redacts. Since neither `crackerId` nor `recrackerId` is in any redaction branch, they pass through automatically. No code change needed — the test from Step 1.1 confirms exposure.

- [ ] **Step 1.6: Run all tests**

Run from worktree root: `npm test`
Expected: PASS — new tests pass, all existing tests still pass.

- [ ] **Step 1.7: Commit**

```bash
git add shared/gameEngine.js shared/gameEngine.test.js
git commit -m "feat(engine): record crackerId and recrackerId on state

Adds two fields populated by crack() and recrack() and exposed
unredacted in getPlayerView. Required by the bot inference layer
to deduce partner identity from public information.

Refs #151"
```

---

### Task 2: Helper — `knownNonPartners`

**Files:**
- Modify: `shared/botInference.js` (add new helper near the existing `teammateWinning`)
- Create: `shared/botInference.test.js`

- [ ] **Step 2.1: Create the new test file with failing tests**

Create `shared/botInference.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { knownNonPartners, deducedPartner } from './botInference.js'

const c = (id, suit, rank) => ({ id, suit, rank })

// Minimal view factory. Five players: p1=picker, p2=partner, p3/p4/p5=opponents.
function baseView(overrides = {}) {
  return {
    phase: 'playing',
    picker: 'p1',
    partner: null,         // redacted from opponents until partnerRevealed
    partnerRevealed: false,
    callMode: 'ace',
    calledSuit: 'H',
    calledAce: { aceId: 'AH' },
    calledTen: null,
    calledKing: null,
    crackerId: null,
    recrackerId: null,
    hands: { p1: [], p2: [], p3: [], p4: [], p5: [] },
    tricks: [],
    currentTrick: [],
    isLeaster: false,
    ...overrides,
  }
}

describe('knownNonPartners', () => {
  it('opponent bot with no signals: rules out picker and self', () => {
    const view = baseView()
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set(['p1', 'p3']))
  })

  it('picker-team bot (partner) with view.partner=self: rules out picker and self', () => {
    const view = baseView({ partner: 'p2' })
    const set = knownNonPartners(view, 'p2')
    // Self is the partner, so self is *not* in the rule-out set; only picker.
    expect(set).toEqual(new Set(['p1']))
  })

  it('crack: cracker added to rule-out set', () => {
    const view = baseView({ crackerId: 'p4' })
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set(['p1', 'p3', 'p4']))
  })

  it('called-suit-led trick: non-called play rules out the player', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: c('KH', 'H', 'K') },  // led called suit, not the called card
        { userId: 'p1', card: c('7H', 'H', '7') },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    // p1 (picker), p4 (self), plus p3 who led non-called card on called suit.
    // Note: p1 is also in the trick playing 7H, but p1 is already ruled out as picker.
    expect(set).toEqual(new Set(['p1', 'p3', 'p4']))
  })

  it('called-suit-led trick where called card has been played: stops elimination for that trick', () => {
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p3', card: c('KH', 'H', 'K') },  // non-called → ruled out
          { userId: 'p1', card: c('7H', 'H', '7') },  // picker
          { userId: 'p2', card: c('AH', 'H', 'A') },  // PARTNER played called card
          { userId: 'p4', card: c('9H', 'H', '9') },  // played AFTER called card → not a deduction signal
          { userId: 'p5', card: c('8H', 'H', '8') },  // played AFTER called card → not a deduction signal
        ],
      }],
      partnerRevealed: true,
      partner: 'p2',
    })
    // Even though partnerRevealed is true here, the helper itself should not eagerly
    // rule out p4/p5 from this trick — the called card was already in the trick when
    // they played, so their plays carry no information.
    const set = knownNonPartners(view, 'p3')
    expect(set.has('p4')).toBe(false)
    expect(set.has('p5')).toBe(false)
  })

  it('non-called-suit-led trick: no eliminations from it', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: c('KS', 'S', 'K') },  // led spades (not called suit)
        { userId: 'p1', card: c('7S', 'S', '7') },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    expect(set).toEqual(new Set(['p1', 'p4']))
  })

  it('multiple signals stack (crack + elimination)', () => {
    const view = baseView({
      crackerId: 'p4',
      currentTrick: [
        { userId: 'p3', card: c('KH', 'H', 'K') },
      ],
    })
    const set = knownNonPartners(view, 'p5')
    // p1 picker, p5 self, p4 cracker, p3 played non-called on called-suit lead.
    expect(set).toEqual(new Set(['p1', 'p3', 'p4', 'p5']))
  })

  it('hidden cards in current trick: do not mistake hidden plays for non-called', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: { id: 'HIDDEN', hidden: true } },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    // Hidden card means we can't tell what was played → no deduction from that play.
    expect(set).toEqual(new Set(['p1', 'p4']))
  })

  it('leaster: returns empty set (no picker, no partner concept)', () => {
    const view = baseView({ isLeaster: true, picker: null, callMode: null })
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set())
  })
})
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `cd shared && npx vitest run botInference.test.js`
Expected: FAIL — `knownNonPartners` is not exported from `botInference.js`.

- [ ] **Step 2.3: Implement `knownNonPartners`**

In `shared/botInference.js`, add the helper above the `teammateWinning` function (around line 192). Also export it.

```javascript
// ─── Partner deduction ────────────────────────────────────────────────────────

// Returns the set of userIds known not to be the partner, derived from public
// information available in the view. Used by deducedPartner to identify the
// partner once the rule-out set covers 3 of the 4 non-picker seats.
//
// Signals:
//   - The picker is always ruled out.
//   - The bot itself, if not on the picker team (view.partner !== userId).
//   - The cracker, if view.crackerId is set.
//   - Any player who played a non-called card on a called-suit-led trick before
//     the called card was played in that trick.
//
// Hidden cards in tricks are treated as unknown (no deduction).
// Leasters / no-picker hands return an empty set.
export function knownNonPartners(view, userId) {
  const set = new Set()
  if (!view.picker) return set  // leaster / no-picker hand
  set.add(view.picker)
  if (view.partner !== userId && view.picker !== userId) {
    set.add(userId)
  }
  if (view.crackerId) set.add(view.crackerId)

  const calledCardId =
    view.calledAce?.aceId ?? view.calledTen?.tenId ?? view.calledKing?.kingId
  if (!view.calledSuit || !calledCardId) return set

  const scanTrick = (plays) => {
    if (!plays || plays.length === 0) return
    const first = plays[0]
    if (!first.card || first.card.hidden) return
    const ledSuit = first.declaredSuit ?? effectiveSuit(first.card)
    if (ledSuit !== view.calledSuit) return
    let calledCardSeen = false
    for (const play of plays) {
      if (calledCardSeen) return  // plays after the called card carry no info
      if (!play.card || play.card.hidden) continue
      if (play.card.id === calledCardId) {
        calledCardSeen = true
        continue
      }
      set.add(play.userId)
    }
  }

  for (const trick of (view.tricks ?? [])) scanTrick(trick.plays)
  scanTrick(view.currentTrick ?? [])

  return set
}
```

The helper uses `effectiveSuit` which is already imported at the top of the file (line 5).

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `cd shared && npx vitest run botInference.test.js -t "knownNonPartners"`
Expected: PASS on all `knownNonPartners` tests.

- [ ] **Step 2.5: Run full test suite**

Run from worktree root: `npm test`
Expected: PASS — new tests pass, all existing tests still pass. (`deducedPartner` tests are not yet written; no failures expected from them.)

- [ ] **Step 2.6: Commit**

```bash
git add shared/botInference.js shared/botInference.test.js
git commit -m "feat(bot): add knownNonPartners helper

Pure derivation of the rule-out set from public information:
the picker, the bot itself (if non-picker-team), the cracker,
and players who played non-called on called-suit-led tricks.

Refs #151"
```

---

### Task 3: Helper — `deducedPartner`

**Files:**
- Modify: `shared/botInference.js`
- Modify: `shared/botInference.test.js`

- [ ] **Step 3.1: Write failing tests for `deducedPartner`**

Append to `shared/botInference.test.js`:

```javascript
describe('deducedPartner', () => {
  it('returns view.partner when set (engine-revealed)', () => {
    const view = baseView({ partner: 'p2', partnerRevealed: true })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('returns recracker when non-picker recracked', () => {
    const view = baseView({ recrackerId: 'p2' })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('does not use recracker when picker recracked (falls through)', () => {
    const view = baseView({ recrackerId: 'p1' })  // p1 is picker
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns the unique remaining seat when 3 of 4 non-picker seats ruled out', () => {
    // Picker = p1. Non-picker seats: p2, p3, p4, p5.
    // Bot = p3 (self, ruled out). p4 cracker (ruled out). p5 played non-called on called-suit lead.
    // Only p2 remains → partner.
    const view = baseView({
      crackerId: 'p4',
      currentTrick: [{ userId: 'p5', card: c('KH', 'H', 'K') }],
    })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('returns null when only 2 of 4 non-picker seats ruled out', () => {
    const view = baseView({ crackerId: 'p4' })
    // p1 picker, p3 self, p4 cracker → 2 ruled out (p3, p4 of the 4 non-picker seats); p2 and p5 remain candidates.
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns null when no signals fire', () => {
    const view = baseView()
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns null when picker goes alone (callMode === alone)', () => {
    const view = baseView({ callMode: 'alone', calledSuit: null, calledAce: null, recrackerId: 'p2' })
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns self when bot is the partner (view.partner === userId)', () => {
    const view = baseView({ partner: 'p2' })
    expect(deducedPartner(view, 'p2')).toBe('p2')
  })

  it('leaster: returns null', () => {
    const view = baseView({ isLeaster: true, picker: null, callMode: null })
    expect(deducedPartner(view, 'p3')).toBeNull()
  })
})
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `cd shared && npx vitest run botInference.test.js -t "deducedPartner"`
Expected: FAIL — `deducedPartner` is not exported.

- [ ] **Step 3.3: Implement `deducedPartner`**

In `shared/botInference.js`, add immediately after `knownNonPartners`:

```javascript
// Returns the partner's userId if known, else null. Resolution order:
//   1. view.partner if set (engine-revealed, or bot is on picker team).
//   2. view.recrackerId if set and not the picker (non-picker recrackers are
//      uniquely the partner per the recrack rule in gameEngine.js).
//   3. By elimination via knownNonPartners — if the rule-out set covers exactly
//      3 of the 4 non-picker seats, the remaining seat is the partner.
//   4. Otherwise, null.
//
// Returns null in alone/leaster/no-picker modes regardless of signals.
export function deducedPartner(view, userId) {
  if (!view.picker || view.callMode === 'alone' || view.isLeaster) return null
  if (view.partner) return view.partner
  if (view.recrackerId && view.recrackerId !== view.picker) return view.recrackerId

  const ruled = knownNonPartners(view, userId)
  const allIds = Object.keys(view.hands ?? {})
  const candidates = allIds.filter(id => id !== view.picker && !ruled.has(id))
  if (candidates.length === 1) return candidates[0]
  return null
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `cd shared && npx vitest run botInference.test.js`
Expected: PASS — both `knownNonPartners` and `deducedPartner` test groups.

- [ ] **Step 3.5: Run full test suite**

Run from worktree root: `npm test`
Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add shared/botInference.js shared/botInference.test.js
git commit -m "feat(bot): add deducedPartner helper

Returns the partner's userId if knowable from public information
(view.partner direct, recracker identification, or full elimination
via knownNonPartners), else null.

Refs #151"
```

---

### Task 4: Consumer — `teammateWinning` uses `deducedPartner`

**Files:**
- Modify: `shared/botInference.js` (`teammateWinning` at line 193)
- Modify: `shared/botStrategy.test.js` (add headline schmear unlock test)

- [ ] **Step 4.1: Write failing integration test (the headline schmear unlock)**

Append to `shared/botStrategy.test.js`:

```javascript
describe('decidePlay — opponent schmears via deduced partner from elimination', () => {
  it('schmears 10S onto opp2 trump-in when partner is deduced by elimination', () => {
    // 5 seats: u1=opp1 (led KH), u2=picker, u3=opp2 (trumped in QC), u4=bot (opp3),
    // u5=partner (still to play, holds AH). Ace call on hearts.
    // u4 is void in hearts, holds 10S among other cards.
    // Deductions: u1 played non-called on called-suit lead → not partner;
    //             u3 played non-called → not partner; u2 picker. So u5 is partner,
    //             and u3 is a confirmed teammate currently winning the trick.
    // Expected: schmear 10S (highest fail) onto QC.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('10S', 'S', '10'), c('9S', 'S', '9'),
          c('8C', 'C', '8'), c('7C', 'C', '7'),
          c('AD', 'D', 'A'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('KH', 'H', 'K') },
        { userId: 'u2', card: c('7H', 'H', '7') },
        { userId: 'u3', card: c('QC', 'C', 'Q') },
      ],
      tricks: [],
      picker: 'u2',
      partner: null,
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u4')).toBe('10S')
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `cd shared && npx vitest run botStrategy.test.js -t "schmears 10S onto opp2 trump-in"`
Expected: FAIL — bot plays a low card (probably 7C or 9S), not 10S.

- [ ] **Step 4.3: Update `teammateWinning` in `shared/botInference.js`**

Replace the function (currently around lines 191-209):

```javascript
export function teammateWinning(view, userId) {
  const { currentTrick, picker } = view
  if (!currentTrick || currentTrick.length === 0) return false

  const partner = deducedPartner(view, userId)

  const winner = currentWinner(currentTrick)
  if (!winner) return false
  const winnerId = winner.userId

  const onPickerTeam = userId === picker || userId === partner

  if (onPickerTeam) {
    return winnerId === picker || winnerId === partner
  } else {
    if (partner === null) return false
    return winnerId !== picker && winnerId !== partner
  }
}
```

(Note: `deducedPartner` is defined above `teammateWinning` in the same file, so no import needed.)

- [ ] **Step 4.4: Run the integration test to verify it passes**

Run: `cd shared && npx vitest run botStrategy.test.js -t "schmears 10S onto opp2 trump-in"`
Expected: PASS.

- [ ] **Step 4.5: Run full test suite**

Run from worktree root: `npm test`
Expected: PASS — no regressions in other strategy tests or inference tests.

- [ ] **Step 4.6: Commit**

```bash
git add shared/botInference.js shared/botStrategy.test.js
git commit -m "feat(bot): teammateWinning uses deducedPartner

Opponent bots now correctly identify a teammate winning a trick
when the partner is deducible from public information (crack,
recrack, or called-suit-led elimination), unlocking schmear
behavior across the hand instead of only after partner reveal.

Refs #151"
```

---

### Task 5: Consumer — `threatsRemaining` and `pickerTeamWinning` use `deducedPartner`

**Files:**
- Modify: `shared/botStrategy.js` (lines 482-484 in opponent schmear branch; line 574 in predicted-win branch)
- Modify: `shared/botStrategy.test.js` (add a recrack-based test that exercises both call sites)

- [ ] **Step 5.1: Write failing test for predicted-win identifying the deduced partner as winner**

Append to `shared/botStrategy.test.js`:

```javascript
describe('decidePlay — opponent identifies picker-team winner via deducedPartner', () => {
  it('after recrack, opponent trumps in to contest when deduced partner is winning', () => {
    // Setup: ace call on hearts. u3 recracked → u3 is the deduced partner (picker team).
    // Trick: u1 leads 9♠ (non-called fail). u3 (deduced partner) plays A♠ — picker team
    // is currently winning the trick.
    // Bot is u4 (opponent), void in spades, holds Q♣ (top trump) and other cards.
    // Pre-fix: pickerTeamWinning consults view.partner (null) → false → predicted-win
    //   branch doesn't fire → bot falls to lowestCard = 7C.
    // Post-fix: pickerTeamWinning sees u3 = deducedPartner → true → predicted-win
    //   trump-in branch fires → bot plays QC (top trump) to steal the trick.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('QC', 'C', 'Q'), c('AD', 'D', 'A'),
          c('10C', 'C', '10'), c('7C', 'C', '7'),
          c('KD', 'D', 'K'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9S', 'S', '9') },
        { userId: 'u3', card: c('AS', 'S', 'A') },
      ],
      tricks: [],
      picker: 'u2',
      partner: null,         // not engine-revealed yet
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: 'u1',       // u1 cracked (rules them out as partner)
      recrackerId: 'u3',     // u3 recracked → u3 is the partner
      isLeaster: false,
      lastTrick: [],
    }
    // Post-fix the bot recognizes u3 (deduced partner) is winning for the picker team
    // and plays QC (top trump) to take the trick. Pre-fix the bot played 7C (lowest)
    // because pickerTeamWinning evaluated against view.partner=null was false.
    expect(decidePlay(view, 'u4')).toBe('QC')
  })
})
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `cd shared && npx vitest run botStrategy.test.js -t "after recrack, opponent does not trump in"`
Expected: FAIL — bot likely returns `'QC'` or another trump, not `'10C'`.

- [ ] **Step 5.3: Import `deducedPartner` in `botStrategy.js`**

At the top of `shared/botStrategy.js` (line 9), update the import to include `deducedPartner`:

```javascript
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, trumpRemainingElsewhere, isGuaranteedWinner, cheapestGuaranteedWin, pickBySchmearPriority, deducedPartner } from './botInference.js'
```

- [ ] **Step 5.4: Update `threatsRemaining` in opponent schmear branch (lines 480-484)**

In `shared/botStrategy.js`, locate the block:

```javascript
      const playedIdsOpp = new Set(currentTrick.map(p => p.userId))
      const allIdsOpp = Object.keys(view.hands)
      // From opponent POV, "threats" (could overtake teammate) = picker + partner still to play.
      const threatsRemaining = allIdsOpp.filter(id =>
        !playedIdsOpp.has(id) && id !== userId && (id === picker || id === partner)
      ).length
```

Replace with:

```javascript
      const playedIdsOpp = new Set(currentTrick.map(p => p.userId))
      const allIdsOpp = Object.keys(view.hands)
      // From opponent POV, "threats" (could overtake teammate) = picker + partner still to play.
      const deducedOpp = deducedPartner(view, userId)
      const threatsRemaining = allIdsOpp.filter(id =>
        !playedIdsOpp.has(id) && id !== userId && (id === picker || id === deducedOpp)
      ).length
```

- [ ] **Step 5.5: Update `pickerTeamWinning` in predicted-win branch (line 574)**

Locate:

```javascript
    if (!isTrump(currentTrick[0].card)) {
      const winner = currentWinner(currentTrick)
      const pickerTeamWinning = winner && (winner.userId === picker || winner.userId === partner)
```

Replace the third line:

```javascript
    if (!isTrump(currentTrick[0].card)) {
      const winner = currentWinner(currentTrick)
      const deducedForPredicted = deducedPartner(view, userId)
      const pickerTeamWinning = winner && (winner.userId === picker || winner.userId === deducedForPredicted)
```

The surrounding `calledSuitLedUnrevealed` and `noTrumpPlayedYet` references (which use `partnerRevealed`) **stay unchanged**.

- [ ] **Step 5.6: Run the new test to verify it passes**

Run: `cd shared && npx vitest run botStrategy.test.js -t "after recrack, opponent does not trump in"`
Expected: PASS.

- [ ] **Step 5.7: Run full test suite**

Run from worktree root: `npm test`
Expected: PASS — no regressions.

- [ ] **Step 5.8: Commit**

```bash
git add shared/botStrategy.js shared/botStrategy.test.js
git commit -m "feat(bot): threats and predicted-win checks use deducedPartner

Updates two opponent-bot identity checks (threatsRemaining in the
schmear branch and pickerTeamWinning in the predicted-win branch)
to consult deducedPartner. partnerRevealed-based timing checks
remain unchanged.

Refs #151"
```

---

### Task 6: Consumer — Lead-flush and force-take gates use `deducedPartner`

**Files:**
- Modify: `shared/botStrategy.js` (lines 332-338 lead-flush gate; lines 506-553 force-take gate)
- Modify: `shared/botStrategy.test.js` (add lead-flush skip and force-take skip tests)

- [ ] **Step 6.1: Write failing tests for the two gate skips**

Append to `shared/botStrategy.test.js`:

```javascript
describe('decidePlay — opponent leading after recrack does not lead called suit', () => {
  it('skips lead-called-suit-to-flush when partner is deduced via recrack', () => {
    // Hand has only point-bearing hearts (KH=4pts, 10H=10pts) and zero-point clubs (7C, 8C).
    // Pre-fix: gate fires (!partnerRevealed) → leads lowest heart by lowestCard = KH.
    // Post-fix: deducedPartner non-null (recracker u3) → gate skipped → leads lowest
    //   non-trump overall = 7C (zero-point club beats KH 4pts).
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('KH', 'H', 'K'), c('10H', 'H', '10'),
          c('7C', 'C', '7'), c('8C', 'C', '8'),
          c('AD', 'D', 'A'),
        ],
        u5: [],
      },
      currentTrick: [],
      tricks: [],
      picker: 'u2',
      partner: null,
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: 'u3',     // u3 recracked → partner deduced
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u4')).toBe('7C')
  })
})

describe('decidePlay — force-take-for-lead-back skipped when partner deduced', () => {
  it('does not aggressively take a non-called-led trick after recrack', () => {
    // Setup: u1 leads 8♠ (non-called fail). u4 (bot, opp, void in spades) holds Q♣ and a heart (lead-back card).
    // Pre-fix: !partnerRevealed && hasCalledSuitFailInHand → force-take fires, bot trumps with QC.
    // Post-fix: deducedPartner non-null (recracker), gate skipped, bot falls through to default lowest.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('QC', 'C', 'Q'),
          c('7H', 'H', '7'),    // a called-suit fail card (would enable lead-back)
          c('8C', 'C', '8'), c('7C', 'C', '7'),
          c('AD', 'D', 'A'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('8S', 'S', '8') },
      ],
      tricks: [],
      picker: 'u2',
      partner: null,
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: 'u3',
      isLeaster: false,
      lastTrick: [],
    }
    // Bot is void in spades; with partner deduced, force-take goal is moot.
    // Pre-fix: gate fires → highestTrump(winningSet) = QC (top trump).
    // Post-fix: gate skipped → falls through to lowestCard = 7H (first 0-pt non-trump
    //   in the hand-order tiebreak; 7H is fail because hearts are not trump in ace call).
    expect(decidePlay(view, 'u4')).toBe('7H')
  })
})
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `cd shared && npx vitest run botStrategy.test.js -t "skips lead-called-suit-to-flush|does not aggressively take"`
Expected: FAIL on both — pre-fix the bot leads a heart and the force-take bot plays QC.

- [ ] **Step 6.3: Update lead-flush gate (botStrategy.js:332-338)**

Locate:

```javascript
      // Lead called suit to flush out the unrevealed partner
      const { calledSuit, partnerRevealed } = view
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (!partnerRevealed && calledSuit) {
        const calledSuitCards = nonTrump.filter(c => effectiveSuit(c) === calledSuit)
        if (calledSuitCards.length > 0) return lowestCard(calledSuitCards).id
      }
```

Replace with:

```javascript
      // Lead called suit to flush out the unrevealed partner — skipped if partner
      // has already been deduced from public information (crack/recrack/elimination).
      const { calledSuit } = view
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (deducedPartner(view, userId) === null && calledSuit) {
        const calledSuitCards = nonTrump.filter(c => effectiveSuit(c) === calledSuit)
        if (calledSuitCards.length > 0) return lowestCard(calledSuitCards).id
      }
```

(Removes the now-unused `partnerRevealed` from the destructure to keep lint clean.)

- [ ] **Step 6.4: Update force-take-for-lead-back gate (botStrategy.js around line 506-553)**

Locate the start of the block:

```javascript
    {
      const { calledSuit, partnerRevealed } = view
      const ledThisTrickIsCalled = ledSuit === calledSuit
      // Note: realCards already filters by must-follow rules. If the bot has a called-suit
      // card but is here following a different suit, the called-suit-led card is in `view.hands[userId]`
      // but not in `realCards`. We need to check the bot's full hand for the lead-back card.
      const fullHand = view.hands[userId] ?? []
      const hasCalledSuitFailInHand = !!calledSuit && fullHand.some(card =>
        !card.hidden && !isTrump(card) && effectiveSuit(card) === calledSuit
      )

      if (!partnerRevealed && !ledThisTrickIsCalled && hasCalledSuitFailInHand) {
```

Replace the destructure and gate:

```javascript
    {
      const { calledSuit } = view
      const ledThisTrickIsCalled = ledSuit === calledSuit
      // Note: realCards already filters by must-follow rules. If the bot has a called-suit
      // card but is here following a different suit, the called-suit-led card is in `view.hands[userId]`
      // but not in `realCards`. We need to check the bot's full hand for the lead-back card.
      const fullHand = view.hands[userId] ?? []
      const hasCalledSuitFailInHand = !!calledSuit && fullHand.some(card =>
        !card.hidden && !isTrump(card) && effectiveSuit(card) === calledSuit
      )

      // Skipped if partner has already been deduced from public information —
      // the lead-back goal (flush the unknown partner) is then moot.
      if (deducedPartner(view, userId) === null && !ledThisTrickIsCalled && hasCalledSuitFailInHand) {
```

- [ ] **Step 6.5: Run the new tests to verify they pass**

Run: `cd shared && npx vitest run botStrategy.test.js -t "skips lead-called-suit-to-flush|does not aggressively take"`
Expected: PASS on both.

- [ ] **Step 6.6: Run full test suite**

Run from worktree root: `npm test`
Expected: PASS.

- [ ] **Step 6.7: Commit**

```bash
git add shared/botStrategy.js shared/botStrategy.test.js
git commit -m "feat(bot): lead-flush and force-take gates use deducedPartner

The two gates whose rationale is 'flush the unknown partner' now
skip when the partner has already been deduced from public
information. Behavior when no signals have fired is unchanged.

Refs #151"
```

---

### Task 7: Regression guard — no behavior change without deduction signals

**Files:**
- Modify: `shared/botStrategy.test.js`

- [ ] **Step 7.1: Write the regression guard test**

Append to `shared/botStrategy.test.js`:

```javascript
describe('decidePlay — regression: no behavior change when no deduction signals fired', () => {
  // This pins the contract that deducedPartner returning null leaves all updated
  // call sites behaving exactly as they did pre-fix.

  it('teammateWinning still false for opponent bot with no signals', () => {
    // Reuses the headline scenario but strips the deduction signals: the trick
    // has only the picker's lead and a non-trump play, no called-suit lead, no
    // crack/recrack. teammateWinning must return false → no schmear → bot plays
    // its lowest legal card.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('10S', 'S', '10'), c('9S', 'S', '9'),
          c('8C', 'C', '8'), c('7C', 'C', '7'),
          c('AD', 'D', 'A'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9S', 'S', '9') },        // led spades, NOT the called suit
        { userId: 'u2', card: c('7S', 'S', '7') },        // picker
        { userId: 'u3', card: c('KS', 'S', 'K') },        // u3 currently winning
      ],
      tricks: [],
      picker: 'u2',
      partner: null,
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
    }
    // Bot u4 must follow spades. Pre-fix played 10S only because schmear branch
    // didn't fire (partner null) — but the spec is "no signals → no change."
    // Bot has 10S and 9S in spades; following spades, should play... lowest spade
    // by default (no schmear). Expected: 9S.
    expect(decidePlay(view, 'u4')).toBe('9S')
  })

  it('lead-flush still leads called suit when no signals fired', () => {
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('7H', 'H', '7'), c('9H', 'H', '9'),
          c('8C', 'C', '8'), c('7C', 'C', '7'),
          c('AD', 'D', 'A'),
        ],
        u5: [],
      },
      currentTrick: [],
      tricks: [],
      picker: 'u2',
      partner: null,
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
    }
    // No signals → deducedPartner returns null → flush gate fires →
    // bot leads lowest heart (7H).
    expect(decidePlay(view, 'u4')).toBe('7H')
  })
})
```

- [ ] **Step 7.2: Run the test**

Run: `cd shared && npx vitest run botStrategy.test.js -t "regression: no behavior change"`
Expected: PASS — no fix needed; this only verifies the contract holds.

- [ ] **Step 7.3: Run full test suite**

Run from worktree root: `npm test`
Expected: PASS.

- [ ] **Step 7.4: Commit**

```bash
git add shared/botStrategy.test.js
git commit -m "test(bot): regression guard — no behavior change without signals

Pins the contract that all five updated call sites behave exactly
as they did pre-fix when no deduction signal has fired (no crack,
no recrack, no called-suit-led elimination).

Refs #151"
```

---

### Task 8: `botSuggestion` smoke check

**Files:**
- Modify: `shared/botSuggestion.test.js` (add one assertion)

- [ ] **Step 8.1: Add the smoke check**

`computeBotSuggestion(view, userId)` (from `shared/botSuggestion.js:8`) returns `{ kind: 'play', ids: [cardId] }` in the playing phase. Append to `shared/botSuggestion.test.js`:

```javascript
describe('computeBotSuggestion — deduced-partner schmear unlock', () => {
  it('suggests 10S in the headline scenario (matches decidePlay)', () => {
    // Same view as the decidePlay headline test in botStrategy.test.js.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          { id: '10S', suit: 'S', rank: '10' }, { id: '9S', suit: 'S', rank: '9' },
          { id: '8C', suit: 'C', rank: '8' }, { id: '7C', suit: 'C', rank: '7' },
          { id: 'AD', suit: 'D', rank: 'A' },
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: { id: 'KH', suit: 'H', rank: 'K' } },
        { userId: 'u2', card: { id: '7H', suit: 'H', rank: '7' } },
        { userId: 'u3', card: { id: 'QC', suit: 'C', rank: 'Q' } },
      ],
      tricks: [],
      picker: 'u2',
      partner: null,
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
      reveal_partner: false,
    }
    const result = computeBotSuggestion(view, 'u4')
    expect(result.kind).toBe('play')
    expect(result.ids).toEqual(['10S'])
  })
})
```

- [ ] **Step 8.2: Run the test**

Run: `cd shared && npx vitest run botSuggestion.test.js`
Expected: PASS — confirms deduction propagates through the human-suggestion surface.

- [ ] **Step 8.3: Run full test suite**

Run from worktree root: `npm test`
Expected: PASS.

- [ ] **Step 8.4: Commit**

```bash
git add shared/botSuggestion.test.js
git commit -m "test(bot): suggestion-path smoke check for deduced-partner schmear

Confirms the deduced-partner unlock flows through to the human
play suggestion (suggestion = bot move).

Refs #151"
```

---

### Task 9: Update `docs/BOTS.md`

**Files:**
- Modify: `docs/BOTS.md`

- [ ] **Step 9.1: Add a "Partner Deduction" subsection under "Inference Helpers"**

Open `docs/BOTS.md`. Find the "Inference Helpers (`botInference.js`)" section near the end (around line 165). Add the two new helpers to the table:

| `knownNonPartners` | Returns the set of userIds known not to be the partner from public information: picker, self (if non-picker-team), cracker, players who played non-called on a called-suit-led trick before the called card was played. |
| `deducedPartner` | Returns the partner's userId if known (`view.partner` set, recrack identifies them, or full elimination via `knownNonPartners`), else `null`. Returns `null` in alone/leaster modes regardless of signals. |

- [ ] **Step 9.2: Add a short prose section above the table describing the deduction rule**

Insert above the helpers table:

```markdown
### Partner deduction

For most of a hand, opponent bots see `view.partner` as `null` — the engine
redacts it until the partner plays the called card. But three public events
allow the partner to be deduced earlier:

- **Crack** — only an opponent may crack, so the cracker is not the partner.
- **Recrack** — only the picker or partner may recrack; a non-picker recracker
  is uniquely the partner.
- **Called-suit-led elimination** — the partner is forced to play the called
  card on the first called-suit-led trick. Any seat that plays a non-called
  card on such a trick is not the partner. Once 3 of the 4 non-picker seats
  are ruled out, the remaining seat is the partner.

`deducedPartner(view, userId)` returns the partner if knowable from any of
these signals, else `null`. The strategy code consults it for every "who is
the partner?" identity check; "has the called card been played?" timing checks
continue to use `partnerRevealed`.
```

- [ ] **Step 9.3: Update the consumer descriptions to reflect the deduction**

In the "Following a Trick" → "Opponent bot following" section (around lines 138-155), update the schmear bullet (1) and predicted-win extension to reference deducedPartner where appropriate. Specifically:

- Schmear (item 1): change "a confirmed teammate — partner identity must be known" → "a confirmed teammate — partner identity is known directly or by deduction".
- Force-take (item 2): change the "partner is **not yet revealed**" trigger condition to "partner is **not yet known** (neither revealed nor deducible)".
- Trump-in (item 3): the predicted-win extension's no-trump and forced-ace logic depends on `partnerRevealed` (timing), not partner identity — leave it as-is, but add a sentence noting that the `pickerTeamWinning` identity check uses `deducedPartner`.

Also fix the pre-existing doc drift in the predicted-win extension paragraph (around lines 154 area): the text says "the partner (ace call) or the picker (ten/king call) is forced to play the called ace later this trick." Replace with "the partner is forced to play the called card later this trick." The picker holds no called card in any of the three modes; the partner is forced in all three.

Update the leading bullet about "Lead called suit (lowest card of that suit) if the partner has not yet been revealed" to "if the partner has not yet been deduced".

- [ ] **Step 9.4: Re-read `docs/BOTS.md` and `shared/botInference.js` / `shared/botStrategy.js` together for consistency**

Per the project rule in `CLAUDE.md` ("BOTS Sync"), the doc must reflect the code. Skim both side by side and adjust any mismatches found.

- [ ] **Step 9.5: Run full test suite (no test changes; sanity)**

Run from worktree root: `npm test`
Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add docs/BOTS.md
git commit -m "docs(bot): describe partner-deduction layer

Adds the partner deduction subsection under Inference Helpers,
documents knownNonPartners and deducedPartner, updates consumer
descriptions to reflect deduction-based gating, and fixes a
pre-existing doc drift on the predicted-win extension wording.

Refs #151"
```

---

## Final Verification

- [ ] **Step F.1: Run full test suite once more**

Run from worktree root: `npm test`
Expected: PASS — every test in shared and frontend.

- [ ] **Step F.2: Confirm no stray `view.partner` consultations were missed**

Run: `grep -n "view\.partner\|=== partner\|=== picker || .*=== partner" shared/botStrategy.js shared/botInference.js`
Verify each remaining hit is one of:
- A picker-team-bot self-identity check (within `if (isPickerTeam)` or analogous).
- A `view.partner` consultation that is itself the input to `deducedPartner` (resolution-order step 1).
- A check inside `teammateWinning` after the destructure replacement.

If any hit is in the opponent-bot path and is not the input to `deducedPartner`, file it as a follow-up — do not silently extend scope here.

- [ ] **Step F.3: Sanity-check `docs/BOTS.md` against `shared/botInference.js` / `shared/botStrategy.js`**

Per CLAUDE.md BOTS Sync, the doc and the code must agree. Re-read both, fix any drift inline, commit if needed.

---

## Notes for the implementing engineer

- **Commit cadence:** Each task ends with its own commit. Don't batch.
- **Do not extend scope.** The spec deliberately defers the option-B engine-level reveal (#162) and the ten/king `pickerTeamWillWin` correctness fix (#83). If a related issue is tempting to fix, file a follow-up issue instead.
- **`partnerRevealed` is timing, not identity.** Whenever you see a `partnerRevealed` consultation, ask whether the question is "has the called card been played?" If yes, leave it. If it's actually "do we know who the partner is?", switch to `deducedPartner(view, userId) === null`. The plan flags every place that needs the switch; do not silently flip others.
- **`view.partner` for picker-team bots is set.** The deduction layer's resolution-order step 1 returns it directly, so picker-team behavior is unchanged. Don't add picker-team gating to the helpers themselves.
- **Hand-snapshot tests** in `botStrategy.test.js` are already the convention. If a state field is missing from a test's view literal, add it explicitly — don't rely on defaults from `dealHand` for tests.
