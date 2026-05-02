# Blitz Inference for Bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach partner bots to use public blitz declarations to make smarter play decisions via a new `resolveView` pre-computation layer.

**Architecture:** Add `knownCardLocations(view)` and `resolveView(view, userId)` to `botInference.js`. Extend `isGuaranteedWinner` to read `view.knownLocations` — treating known-teammate trump as accounted for in both the trump and fail-card cases. Wire `resolveView` into `decidePlay` in `botStrategy.js` so all downstream inference calls automatically benefit.

**Tech Stack:** JavaScript (ES modules), Vitest, shared game engine

---

## File Map

| File | Change |
|---|---|
| `shared/botInference.js` | Add `knownCardLocations`, `resolveView`; extend `isGuaranteedWinner` (trump + fail cases) |
| `shared/botInference.test.js` | Add describe blocks for `knownCardLocations`, `resolveView`, blitz-aware `isGuaranteedWinner` |
| `shared/botStrategy.js` | Add `resolveView` to import; add `const rv = resolveView(view, userId)` in `decidePlay`; update all inference calls to pass `rv` |
| `docs/BOTS.md` | Add `knownCardLocations` and `resolveView` rows to Inference Helpers table; update `isGuaranteedWinner` description |

---

## Task 1: Branch setup and design doc commit

**Files:**
- Commit: `docs/superpowers/specs/2026-05-01-blitz-inference-design.md`
- Commit: `docs/superpowers/specs/2026-05-01-blitz-inference-design-for-PMs.md`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/blitz-inference
```

- [ ] **Step 2: Stage and commit design docs**

```bash
git add docs/superpowers/specs/2026-05-01-blitz-inference-design.md docs/superpowers/specs/2026-05-01-blitz-inference-design-for-PMs.md
git commit -m "docs: add blitz inference design docs (issue #150)"
```

---

## Task 2: Add `knownCardLocations` and `resolveView` with tests

**Files:**
- Modify: `shared/botInference.js`
- Modify: `shared/botInference.test.js`

- [ ] **Step 1: Add failing tests for `knownCardLocations`**

Update the import line at the top of `shared/botInference.test.js`:

```javascript
import { knownNonPartners, deducedPartner, deducedTrumpVoids, isGuaranteedWinner, deducedNonTrumpVoids, knownCardLocations, resolveView } from './botInference.js'
```

Append a new describe block at the end of `shared/botInference.test.js`:

```javascript
describe('knownCardLocations', () => {
  it('no blitzes → empty Map', () => {
    const view = { blitzes: [] }
    expect(knownCardLocations(view).size).toBe(0)
  })

  it('black blitz → picker entry contains QC and QS card objects', () => {
    const view = { blitzes: [{ userId: 'p1', type: 'black' }] }
    const result = knownCardLocations(view)
    expect(result.has('p1')).toBe(true)
    const ids = result.get('p1').map(c => c.id)
    expect(ids).toContain('QC')
    expect(ids).toContain('QS')
    expect(ids).toHaveLength(2)
  })

  it('red blitz → picker entry contains QH and QD card objects', () => {
    const view = { blitzes: [{ userId: 'p1', type: 'red' }] }
    const result = knownCardLocations(view)
    expect(result.has('p1')).toBe(true)
    const ids = result.get('p1').map(c => c.id)
    expect(ids).toContain('QH')
    expect(ids).toContain('QD')
    expect(ids).toHaveLength(2)
  })

  it('missing blitzes field → empty Map', () => {
    expect(knownCardLocations({}).size).toBe(0)
  })
})

describe('resolveView', () => {
  it('returns view with knownLocations populated from blitzes', () => {
    const view = { blitzes: [{ userId: 'p1', type: 'black' }], hands: { p1: [], p2: [] } }
    const rv = resolveView(view, 'p2')
    expect(rv.knownLocations).toBeDefined()
    expect(rv.knownLocations.has('p1')).toBe(true)
    const ids = rv.knownLocations.get('p1').map(c => c.id)
    expect(ids).toContain('QC')
    expect(ids).toContain('QS')
  })

  it('other view fields are unchanged', () => {
    const view = { blitzes: [], hands: { p1: [], p2: [] }, picker: 'p1' }
    const rv = resolveView(view, 'p2')
    expect(rv.picker).toBe('p1')
    expect(rv.hands).toBe(view.hands)
  })

  it('no blitzes → knownLocations is an empty Map', () => {
    const view = { blitzes: [], hands: {} }
    const rv = resolveView(view, 'p1')
    expect(rv.knownLocations.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run shared/botInference.test.js
```

Expected: FAIL — `knownCardLocations is not a function` and `resolveView is not a function`.

- [ ] **Step 3: Implement `knownCardLocations` and `resolveView` in `shared/botInference.js`**

Add the following block immediately before the `// ─── Trump tracking ───` section (at the very top of the file body, after the import):

```javascript
// ─── Public knowledge ─────────────────────────────────────────────────────────

// Card objects for each blitz type. Blitz publicly reveals which queens the picker holds.
const BLITZ_CARDS = {
  black: [{ id: 'QC', rank: 'Q', suit: 'C' }, { id: 'QS', rank: 'Q', suit: 'S' }],
  red:   [{ id: 'QH', rank: 'Q', suit: 'H' }, { id: 'QD', rank: 'Q', suit: 'D' }],
}

// Returns Map<userId, Array<card>> of cards known by public announcement to be in a player's hand.
// Phase 1: populated from view.blitzes only.
export function knownCardLocations(view) {
  const map = new Map()
  for (const { userId, type } of (view.blitzes ?? [])) {
    map.set(userId, [...(BLITZ_CARDS[type] ?? [])])
  }
  return map
}

// Pre-computation wrapper. Returns { ...view, knownLocations } for use by all inference calls
// in a single play decision. _userId is unused in Phase 1; included for Phase 2 API symmetry.
export function resolveView(view, _userId) {
  return { ...view, knownLocations: knownCardLocations(view) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run shared/botInference.test.js
```

Expected: all existing tests pass, all new `knownCardLocations` and `resolveView` tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/botInference.js shared/botInference.test.js
git commit -m "feat(inference): add knownCardLocations and resolveView (#150)"
```

---

## Task 3: Extend `isGuaranteedWinner` — trump case with blitz inference

**Files:**
- Modify: `shared/botInference.js`
- Modify: `shared/botInference.test.js`

- [ ] **Step 1: Add failing tests**

Append a new describe block at the end of `shared/botInference.test.js`:

```javascript
describe('isGuaranteedWinner – blitz inference (trump case)', () => {
  it('partner holds QH; picker black-blitzed (QC+QS); neither played → true with resolveView', () => {
    // Without blitz inference: QC and QS are unaccounted for → false.
    // With resolveView: QC and QS are known to be in teammate's (picker's) hand → true.
    const qh = { id: 'QH', rank: 'Q', suit: 'H' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }],
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p2: [qh],
        p3: [], p4: [], p5: [],
      },
      tricks: [],
      currentTrick: [],
      buried: [],
      isLeaster: false,
    }
    // Plain view: QC (rank 0) and QS (rank 1) unseen → false
    expect(isGuaranteedWinner(qh, view, 'p2')).toBe(false)
    // Enriched view: QC and QS known in teammate's hand → true
    const rv = resolveView(view, 'p2')
    expect(isGuaranteedWinner(qh, rv, 'p2')).toBe(true)
  })

  it('opponent bot does NOT benefit from blitz: QH is false for p3 regardless of resolveView', () => {
    const qh = { id: 'QH', rank: 'Q', suit: 'H' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }],
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p2: [], p3: [qh], p4: [], p5: [],
      },
      tricks: [],
      currentTrick: [],
      buried: [],
      isLeaster: false,
    }
    const rv = resolveView(view, 'p3')
    // p3 is an opponent; picker's blitzed queens are opponent threats → still false
    expect(isGuaranteedWinner(qh, rv, 'p3')).toBe(false)
  })

  it('picker holds QS; partner red-blitzed (QH+QD in partner hand); QH+QD unseen in tricks → QS true for picker', () => {
    // Picker (p1) holds QS. Partner (p2) declared red blitz (QH + QD in p2's hand).
    // QC (rank 0) still unaccounted for → QS still false even with blitz inference.
    // This tests that only higher-ranked trump in teammate's hand count, and QC is not there.
    const qs = { id: 'QS', rank: 'Q', suit: 'S' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p2', type: 'red' }],
      hands: {
        p1: [qs],
        p2: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p3: [], p4: [], p5: [],
      },
      tricks: [],
      currentTrick: [],
      buried: [],
      isLeaster: false,
    }
    const rv = resolveView(view, 'p1')
    // QC (rank 0) still unaccounted for → false
    expect(isGuaranteedWinner(qs, rv, 'p1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run shared/botInference.test.js
```

Expected: FAIL — new tests fail because `isGuaranteedWinner` ignores `view.knownLocations`.

- [ ] **Step 3: Extend `isGuaranteedWinner` for the trump case in `shared/botInference.js`**

In the trump branch of `isGuaranteedWinner` (the section starting with `const myRank = trumpRank(card)`), add the following block immediately after the four existing `noteIfHigherTrump` loops and before the final `for (let r = 0; r < myRank; r++)` loop:

```javascript
  // Also treat trump in a known teammate's hand as accounted for
  if (view.knownLocations) {
    const onPickerTeam = userId === view.picker || userId === view.partner
    if (onPickerTeam) {
      const teammateId = userId === view.picker ? view.partner : view.picker
      if (teammateId) {
        for (const c of (view.knownLocations.get(teammateId) ?? [])) {
          if (isTrump(c)) seenRanks.add(trumpRank(c))
        }
      }
    }
  }
```

The surrounding context for placement (the full trump branch after the change):

```javascript
  const myRank = trumpRank(card)
  if (myRank === 0) return true  // highest trump (Queen of Clubs)

  const seenRanks = new Set()
  const noteIfHigherTrump = (c) => {
    if (!c || c.hidden) return
    if (!isTrump(c)) return
    seenRanks.add(trumpRank(c))
  }

  for (const c of (view.hands[userId] ?? [])) noteIfHigherTrump(c)
  for (const trick of (view.tricks ?? [])) {
    for (const play of trick.plays) noteIfHigherTrump(play.card)
  }
  for (const play of (view.currentTrick ?? [])) noteIfHigherTrump(play.card)
  for (const c of (view.buried ?? [])) noteIfHigherTrump(c)

  // Also treat trump in a known teammate's hand as accounted for
  if (view.knownLocations) {
    const onPickerTeam = userId === view.picker || userId === view.partner
    if (onPickerTeam) {
      const teammateId = userId === view.picker ? view.partner : view.picker
      if (teammateId) {
        for (const c of (view.knownLocations.get(teammateId) ?? [])) {
          if (isTrump(c)) seenRanks.add(trumpRank(c))
        }
      }
    }
  }

  // Every rank strictly lower than myRank must be seen somewhere.
  for (let r = 0; r < myRank; r++) {
    if (!seenRanks.has(r)) return false
  }
  return true
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run shared/botInference.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/botInference.js shared/botInference.test.js
git commit -m "feat(inference): extend isGuaranteedWinner trump case with blitz inference (#150)"
```

---

## Task 4: Extend `isGuaranteedWinner` — fail case (condition 2) with blitz inference

**Files:**
- Modify: `shared/botInference.js`
- Modify: `shared/botInference.test.js`

- [ ] **Step 1: Add failing test**

Append to `shared/botInference.test.js`:

```javascript
describe('isGuaranteedWinner – blitz inference (fail case, condition 2)', () => {
  it('partner holds AH; 1 trump unaccounted for but known to be in picker\'s hand via blitz → true', () => {
    // Setup: 13 of 14 trump accounted for in tricks/hand/buried; the 14th (QC) is the
    // picker's black-blitzed card. trumpRemainingElsewhere = 1, but it's a teammate's card.
    // Condition 1 (no higher same-suit card): AH is the ace → always satisfied.
    // Condition 2 with blitz: knownTeammateTrump = 1, so 1 - 1 = 0 opponent trump → true.
    const ah = { id: 'AH', rank: 'A', suit: 'H' }
    const qs = { id: 'QS', rank: 'Q', suit: 'S' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }], // QC + QS known to p1
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }],
        p2: [ah, qs],  // p2 holds AH (the card being tested) and QS (1 own trump)
        p3: [], p4: [], p5: [],
      },
      tricks: [
        {
          plays: [
            { userId: 'p3', card: { id: 'QH', rank: 'Q', suit: 'H' } },
            { userId: 'p4', card: { id: 'QD', rank: 'Q', suit: 'D' } },
            { userId: 'p5', card: { id: 'JC', rank: 'J', suit: 'C' } },
            { userId: 'p1', card: { id: 'JS', rank: 'J', suit: 'S' } },
            { userId: 'p2', card: { id: 'JH', rank: 'J', suit: 'H' } },
          ],
        },
        {
          plays: [
            { userId: 'p3', card: { id: 'JD', rank: 'J', suit: 'D' } },
            { userId: 'p4', card: { id: 'AD', rank: 'A', suit: 'D' } },
            { userId: 'p5', card: { id: '10D', rank: '10', suit: 'D' } },
            { userId: 'p1', card: { id: 'KD', rank: 'K', suit: 'D' } },
            { userId: 'p2', card: { id: '9D', rank: '9', suit: 'D' } },
          ],
        },
      ],
      // Trump accounting:
      // own (p2): QS = 1. Tricks: QH, QD, JC, JS, JH, JD, AD, 10D, KD, 9D = 10. Buried: 8D, 7D = 2.
      // trumpRemainingElsewhere = 14 - 1 - 10 - 2 = 1 (that 1 is QC, in p1's hand via blitz)
      currentTrick: [],
      buried: [{ id: '8D', rank: '8', suit: 'D' }, { id: '7D', rank: '7', suit: 'D' }],
      isLeaster: false,
    }
    // Plain view: 1 trump remaining, not all others trump-void → false
    expect(isGuaranteedWinner(ah, view, 'p2')).toBe(false)
    // Enriched view: that 1 trump is in teammate's hand → 0 opponent trump → true
    const rv = resolveView(view, 'p2')
    expect(isGuaranteedWinner(ah, rv, 'p2')).toBe(true)
  })

  it('opponent bot does NOT benefit: same scenario, p3 holding AH → false even with resolveView', () => {
    const ah = { id: 'AH', rank: 'A', suit: 'H' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }],
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }],
        p2: [],
        p3: [ah, { id: 'QS', rank: 'Q', suit: 'S' }],
        p4: [], p5: [],
      },
      tricks: [
        {
          plays: [
            { userId: 'p3', card: { id: 'QH', rank: 'Q', suit: 'H' } },
            { userId: 'p4', card: { id: 'QD', rank: 'Q', suit: 'D' } },
            { userId: 'p5', card: { id: 'JC', rank: 'J', suit: 'C' } },
            { userId: 'p1', card: { id: 'JS', rank: 'J', suit: 'S' } },
            { userId: 'p2', card: { id: 'JH', rank: 'J', suit: 'H' } },
          ],
        },
        {
          plays: [
            { userId: 'p3', card: { id: 'JD', rank: 'J', suit: 'D' } },
            { userId: 'p4', card: { id: 'AD', rank: 'A', suit: 'D' } },
            { userId: 'p5', card: { id: '10D', rank: '10', suit: 'D' } },
            { userId: 'p1', card: { id: 'KD', rank: 'K', suit: 'D' } },
            { userId: 'p2', card: { id: '9D', rank: '9', suit: 'D' } },
          ],
        },
      ],
      currentTrick: [],
      buried: [{ id: '8D', rank: '8', suit: 'D' }, { id: '7D', rank: '7', suit: 'D' }],
      isLeaster: false,
    }
    const rv = resolveView(view, 'p3')
    // p3 is an opponent; QC is in an opponent's (picker's) hand → still a threat → false
    expect(isGuaranteedWinner(ah, rv, 'p3')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run shared/botInference.test.js
```

Expected: FAIL — the new fail-case tests fail.

- [ ] **Step 3: Extend condition 2 in `isGuaranteedWinner` in `shared/botInference.js`**

Replace the existing condition 2 block (the lines starting `// ── Condition 2` through the closing `if (!allOthersVoid) return false`) with:

```javascript
    // ── Condition 2: no opponent can trump it ─────────────────────────────────
    let knownTeammateTrump = 0
    if (view.knownLocations) {
      const onPickerTeam = userId === view.picker || userId === view.partner
      if (onPickerTeam) {
        const teammateId = userId === view.picker ? view.partner : view.picker
        if (teammateId) {
          knownTeammateTrump = (view.knownLocations.get(teammateId) ?? []).filter(c => isTrump(c)).length
        }
      }
    }
    const noTrumpElsewhere = trumpRemainingElsewhere(view, userId) - knownTeammateTrump === 0
    if (!noTrumpElsewhere) {
      const voids = deducedTrumpVoids(view)
      const otherPlayerIds = Object.keys(view.hands).filter(id => id !== userId)
      const allOthersVoid = otherPlayerIds.length > 0 && otherPlayerIds.every(id => voids.has(id))
      if (!allOthersVoid) return false
    }
```

- [ ] **Step 4: Run all botInference tests**

```bash
npx vitest run shared/botInference.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/botInference.js shared/botInference.test.js
git commit -m "feat(inference): extend isGuaranteedWinner fail case with blitz inference (#150)"
```

---

## Task 5: Wire `resolveView` into `decidePlay` in `botStrategy.js`

**Files:**
- Modify: `shared/botStrategy.js`

- [ ] **Step 1: Add `resolveView` to the import**

Update line 9 of `shared/botStrategy.js`. Current:

```javascript
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, isGuaranteedWinner, cheapestGuaranteedWin, pickBySchmearPriority, deducedPartner, deducedNonTrumpVoids } from './botInference.js'
```

New:

```javascript
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, isGuaranteedWinner, cheapestGuaranteedWin, pickBySchmearPriority, deducedPartner, deducedNonTrumpVoids, resolveView } from './botInference.js'
```

- [ ] **Step 2: Add `resolveView` call at the top of `decidePlay`**

In `decidePlay`, add `const rv = resolveView(view, userId)` immediately after the `if (realCards.length === 0)` guard (before the leaster check). The top of `decidePlay` should become:

```javascript
export function decidePlay(view, userId) {
  const legal = getLegalCards(view, userId)
  if (legal.length === 0) throw new Error(`Bot ${userId} has no legal cards to play`)

  const realCards = legal.filter(c => !c.isUnderCard)

  // Under card is the only option
  if (realCards.length === 0) return 'UNDER_CARD'

  const rv = resolveView(view, userId)

  const { currentTrick, picker, partner, isLeaster } = view
```

- [ ] **Step 3: Replace inference calls throughout `decidePlay` to use `rv`**

Run these sed commands from the repo root. They target the specific function-call patterns; function declarations are not affected.

```bash
sed -i '' 's/isGuaranteedWinner(\([^,]*\), view, userId)/isGuaranteedWinner(\1, rv, userId)/g' shared/botStrategy.js
sed -i '' 's/cheapestGuaranteedWin(\([^,]*\), view, userId)/cheapestGuaranteedWin(\1, rv, userId)/g' shared/botStrategy.js
sed -i '' 's/deducedNonTrumpVoids(view)/deducedNonTrumpVoids(rv)/g' shared/botStrategy.js
sed -i '' 's/deducedPartner(view, userId)/deducedPartner(rv, userId)/g' shared/botStrategy.js
sed -i '' 's/teammateWinning(view, userId)/teammateWinning(rv, userId)/g' shared/botStrategy.js
```

- [ ] **Step 4: Verify the replacements**

```bash
grep -n "isGuaranteedWinner\|cheapestGuaranteedWin\|deducedNonTrumpVoids\|deducedPartner\|teammateWinning" shared/botStrategy.js
```

Expected output: all inference calls inside `decidePlay` now use `rv`; function declarations (`decidePlay(view, userId)` etc.) are unchanged. Confirm no line still shows `, view, userId)` or `(view)` or `(view, userId)` for these five functions.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (existing and new).

- [ ] **Step 6: Commit**

```bash
git add shared/botStrategy.js
git commit -m "feat(strategy): wire resolveView into decidePlay for blitz-aware inference (#150)"
```

---

## Task 6: Update `docs/BOTS.md`

**Files:**
- Modify: `docs/BOTS.md`

- [ ] **Step 1: Add `knownCardLocations` and `resolveView` rows to the Inference Helpers table**

The Inference Helpers table starts at line 195 of `docs/BOTS.md`. Add two rows and update the `isGuaranteedWinner` row. Find the existing table block ending at the `deducedPartner` row and replace it with:

```markdown
| Function | Purpose |
|---|---|
| `knownCardLocations` | Returns `Map<userId, Array<card>>` of card objects known by public announcement to be in a player's hand. Phase 1: populated from `view.blitzes` — black blitz → picker holds QC + QS; red blitz → picker holds QH + QD. |
| `resolveView` | Pre-computation wrapper called once per play decision in `decidePlay`. Returns `{ ...view, knownLocations }`. All downstream inference calls receive the enriched view. Phase 2 (#176) will add more pre-computed fields. |
| `countTrumpPlayed` | Count visible trump in completed tricks and the current trick |
| `trumpRemainingElsewhere` | Estimate trump still held by other players: `14 − own trump − seen trump − buried trump` |
| `handScore` | Combined pick-quality score: `schwanzerPts × 4 + 3×(non-trump aces) + 2×(non-trump tens) + 5 if QC held` |
| `beats` | Returns true if a challenger card beats the current winner given led suit |
| `currentWinner` | Returns the play object currently winning a trick |
| `bestVoidBury` | Finds the best 2-card bury that voids a non-trump suit with ≥11 combined card points |
| `teammateWinning` | Returns true if the current trick leader is on the same team as the bot |
| `deducedTrumpVoids` | Returns the set of players known to be void in trump, based on completed trick history. A player is trump-void if they played a non-trump card on a trick where trump was led. |
| `deducedNonTrumpVoids` | Returns a map of `{ [userId]: Set<suit> }` — the fail suits each player is known void in, deduced from completed trick history. A player is void in a fail suit if, on a trick where that fail suit was led, they played a card of a different suit (including trump). Only scans completed tricks. |
| `isGuaranteedWinner` | Returns true iff a card cannot be beaten by any opponent. For trump: every higher-rank trump has been seen (own hand, played tricks, current trick, visible bury) or is known to be in a teammate's hand via `knownLocations`. For non-trump: every higher same-suit card has been seen AND no opponent can trump (all trump accounted for after subtracting known teammate trump from `trumpRemainingElsewhere`, or all others are deduced trump-void). |
| `cheapestGuaranteedWin` | From a set of candidate cards, returns the lowest-point card that satisfies `isGuaranteedWinner` (tiebreak: weaker trump first). Returns null if none qualify. |
| `pickBySchmearPriority` | Pick the least-painful winning card to spend, walking a rank-priority list (`A,10,K,9,8,7,J,Q` for trump; `A,10,K,9,8,7` for fail). Trump tiebreak: weakest trump rank. Fail tiebreak: shortest non-trump suit in hand, then alphabetical. |
| `knownNonPartners` | Returns the set of userIds known not to be the partner from public information: picker, self (if non-picker-team), cracker, players who played non-called on a called-suit-led trick before the called card was played. |
| `deducedPartner` | Returns the partner's userId if known (`view.partner` set, recrack identifies them, or full elimination via `knownNonPartners`), else `null`. Returns `null` in alone/leaster modes regardless of signals. |
```

- [ ] **Step 2: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add docs/BOTS.md
git commit -m "docs: update BOTS.md with blitz inference helpers (#150)"
```
