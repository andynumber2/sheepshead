# resolveView Pre-compute Inference State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `resolveView` to pre-compute `resolvedPartner`, `trumpVoids`, `nonTrumpVoids`, and `resolvedTrumpRemaining` once per play decision, then replace all redundant inline calls in `botStrategy.js` and `isGuaranteedWinner` with property reads.

**Architecture:** `resolveView` in `botInference.js` calls the four helpers once and attaches results to the view object. `isGuaranteedWinner` reads `view.trumpVoids` and `view.resolvedTrumpRemaining` directly instead of calling the helpers internally. `botStrategy.js` reads `rv.resolvedPartner` and `rv.nonTrumpVoids` instead of calling helpers inline.

**Tech Stack:** JavaScript (ES modules), Vitest

---

## File Map

- **Modify:** `shared/botInference.js` — extend `resolveView` (lines 28–30), update `isGuaranteedWinner` internals (lines 302–307)
- **Modify:** `shared/botInference.test.js` — add 5 new `resolveView` tests; wrap ~11 Group 1 plain-view `isGuaranteedWinner` calls with `resolveView`; delete 4 Group 2 "without resolveView" first-assertions (now unrepresentable)
- **Modify:** `shared/botStrategy.js` — replace 5 `deducedPartner` calls + 2 `deducedNonTrumpVoids` calls with `rv.*` reads; clean imports
- **Modify:** `docs/BOTS.md` — update `resolveView` entry at line 200

---

## Task 1: Extend `resolveView` with the four new pre-computed fields

**Files:**
- Modify: `shared/botInference.js:28-30`
- Modify: `shared/botInference.test.js` (after the existing `resolveView` describe block at line 765)

- [ ] **Step 1: Add `trumpRemainingElsewhere` to the import in `botInference.test.js`**

Current line 2:
```js
import { knownNonPartners, deducedPartner, deducedTrumpVoids, isGuaranteedWinner, deducedNonTrumpVoids, knownCardLocations, resolveView } from './botInference.js'
```

Replace with:
```js
import { knownNonPartners, deducedPartner, deducedTrumpVoids, isGuaranteedWinner, deducedNonTrumpVoids, knownCardLocations, resolveView, trumpRemainingElsewhere } from './botInference.js'
```

- [ ] **Step 2: Write the failing tests for the new resolveView fields**

Add this new `describe` block immediately after the closing `})` of the existing `describe('resolveView', ...)` block (currently ending around line 788):

```js
describe('resolveView pre-computed inference fields', () => {
  const buildView = () => ({
    blitzes: [],
    picker: 'p1',
    goingAlone: false,
    isLeaster: false,
    partner: null,
    recrackerId: null,
    hands: { p1: [], p2: [], p3: [], p4: [], p5: [] },
    tricks: [],
    currentTrick: [],
    buried: [],
  })

  it('resolvedPartner equals deducedPartner(view, userId)', () => {
    const view = buildView()
    const rv = resolveView(view, 'p2')
    expect(rv.resolvedPartner).toBe(deducedPartner(view, 'p2'))
  })

  it('trumpVoids equals deducedTrumpVoids(view)', () => {
    const view = buildView()
    const rv = resolveView(view, 'p2')
    expect(rv.trumpVoids).toEqual(deducedTrumpVoids(view))
  })

  it('nonTrumpVoids equals deducedNonTrumpVoids(view)', () => {
    const view = buildView()
    const rv = resolveView(view, 'p2')
    expect(rv.nonTrumpVoids).toEqual(deducedNonTrumpVoids(view))
  })

  it('resolvedTrumpRemaining equals trumpRemainingElsewhere(view, userId)', () => {
    const view = buildView()
    const rv = resolveView(view, 'p2')
    expect(rv.resolvedTrumpRemaining).toBe(trumpRemainingElsewhere(view, 'p2'))
  })

  it('resolvedTrumpRemaining is userId-sensitive — differs between two userIds with different hand contents', () => {
    const view = {
      ...buildView(),
      hands: {
        p1: [{ id: 'QC', rank: 'Q', suit: 'C', hidden: false }],
        p2: [],
        p3: [],
        p4: [],
        p5: [],
      },
    }
    const rv1 = resolveView(view, 'p1')
    const rv2 = resolveView(view, 'p2')
    expect(rv1.resolvedTrumpRemaining).toBe(trumpRemainingElsewhere(view, 'p1'))
    expect(rv2.resolvedTrumpRemaining).toBe(trumpRemainingElsewhere(view, 'p2'))
    expect(rv1.resolvedTrumpRemaining).not.toBe(rv2.resolvedTrumpRemaining)
  })
})
```

- [ ] **Step 3: Run the new tests to confirm they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A 3 "pre-computed inference"
```

Expected: 5 failures with messages like `expected undefined to be null` for `resolvedPartner`, etc.

- [ ] **Step 4: Implement the `resolveView` change in `botInference.js`**

Current code (lines 28–30):
```js
export function resolveView(view, _userId) {
  return { ...view, knownLocations: knownCardLocations(view) }
}
```

Replace with:
```js
export function resolveView(view, userId) {
  return {
    ...view,
    knownLocations: knownCardLocations(view),
    resolvedPartner: deducedPartner(view, userId),
    trumpVoids: deducedTrumpVoids(view),
    nonTrumpVoids: deducedNonTrumpVoids(view),
    resolvedTrumpRemaining: trumpRemainingElsewhere(view, userId),
  }
}
```

- [ ] **Step 5: Run the new tests to confirm they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A 3 "pre-computed inference"
```

Expected: 5 passing tests.

- [ ] **Step 6: Run all tests to confirm no regressions**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add shared/botInference.js shared/botInference.test.js
git commit -m "feat(inference): pre-compute resolvedPartner, trumpVoids, nonTrumpVoids, resolvedTrumpRemaining in resolveView"
```

---

## Task 2: Update `isGuaranteedWinner` to read from resolved view

**Files:**
- Modify: `shared/botInference.js:302-307`
- Modify: `shared/botInference.test.js` (14 plain-view call sites)

- [ ] **Step 1: Change the two internal calls in `isGuaranteedWinner`**

In `shared/botInference.js`, find lines 302–307 (inside the fail-card Condition 2 block):

```js
    const noTrumpElsewhere = trumpRemainingElsewhere(view, userId) - knownTeammateTrump === 0
    if (!noTrumpElsewhere) {
      const voids = deducedTrumpVoids(view)
      const otherPlayerIds = Object.keys(view.hands).filter(id => id !== userId)
      const allOthersVoid = otherPlayerIds.length > 0 && otherPlayerIds.every(id => voids.has(id))
      if (!allOthersVoid) return false
    }
```

Replace with:
```js
    const noTrumpElsewhere = view.resolvedTrumpRemaining - knownTeammateTrump === 0
    if (!noTrumpElsewhere) {
      const voids = view.trumpVoids
      const otherPlayerIds = Object.keys(view.hands).filter(id => id !== userId)
      const allOthersVoid = otherPlayerIds.length > 0 && otherPlayerIds.every(id => voids.has(id))
      if (!allOthersVoid) return false
    }
```

- [ ] **Step 2: Run all tests to identify which ones now fail**

```bash
npm test 2>&1 | grep "FAIL\|×\|✗" | head -30
```

Expected: 14 tests in `botInference.test.js` fail — these are the tests that pass a plain view (without `resolveView`) to `isGuaranteedWinner`. The failing tests are located at approximately these lines:

**Group 1 — non-trump/trump guaranteed-winner tests (lines ~282–564):**
- ~352: "fail ace, all other players trump-void → returns true"
- ~364: "fail ace, trump still unaccounted for and not all void → returns false"
- ~384: "fail ace, trumpRemainingElsewhere === 0 → returns true even without void deduction"
- ~418: "fail 10 where ace has been played, all others trump-void → returns true"
- ~440: "fail 10 where ace NOT yet played → returns false"
- ~451: "QC (rank 0) is always a guaranteed winner"
- ~463: "lower trump returns false when higher trump unseen"
- ~486: "buried higher same-suit card satisfies condition 1"
- ~520: "fail King — false when only AC played"
- ~545: "fail King — true when both AC and 10C played and all others trump-void"
- ~562: "degenerate view with no other players in hands → returns false"

**Group 2 — blitz inference tests (first assertion in pairs, lines ~790–1108):**
- ~810: first assertion "partner holds QH; picker black-blitzed → false without resolveView"
- ~928: first assertion "partner holds AH; → false without resolveView"
- ~1057: first assertion "picker holds fail ace; → false without resolveView"
- ~1102: first assertion "blitzed queen played in currentTrick → false without resolveView"

- [ ] **Step 3: Fix Group 1 plain-view calls — wrap with `resolveView`**

For each Group 1 failing test (~11 tests at lines ~352, ~364, ~384, ~418, ~440, ~451, ~463, ~486, ~520, ~545, ~562), the fix is the same. Find the call:
```js
isGuaranteedWinner(someCard, someView, someUserId)
```
and replace it with:
```js
isGuaranteedWinner(someCard, resolveView(someView, someUserId), someUserId)
```

The expected values (`true`/`false`) do not change — these tests don't involve blitzes, so `knownLocations` stays empty and `trumpVoids`/`resolvedTrumpRemaining` are computed from the same trick data as before.

- [ ] **Step 4: Fix Group 2 blitz-test first assertions — delete them**

For the 4 Group 2 tests (~lines ~810, ~928, ~1057, ~1102), the first assertion in each pair tests the plain-view baseline (expected `false`), and the second uses `resolveView` (expected `true`). **Do not wrap the first assertion.** Instead, delete it.

Reason: wrapping the first assertion with `resolveView` would populate `knownLocations` with blitz data, causing `isGuaranteedWinner` to return `true` — making it a duplicate of the second assertion. The "without blitz accounting" baseline is no longer representable once `isGuaranteedWinner` requires a resolved view.

After deletion, each pair becomes a single assertion using `resolveView` with the expected `true` result. The test name and the second assertion are unchanged.

- [ ] **Step 5: Run all tests to confirm all pass**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add shared/botInference.js shared/botInference.test.js
git commit -m "refactor(inference): isGuaranteedWinner reads trumpVoids/resolvedTrumpRemaining from resolved view"
```

---

## Task 3: Replace inline helper calls in `botStrategy.js`

**Files:**
- Modify: `shared/botStrategy.js`

- [ ] **Step 1: Replace the 5 `deducedPartner` call sites**

Make each substitution in `shared/botStrategy.js`:

**Line ~370:**
```js
// Before:
if (deducedPartner(rv, userId) === null && calledSuit) {
// After:
if (rv.resolvedPartner === null && calledSuit) {
```

**Line ~380:**
```js
// Before:
const knownPartner = deducedPartner(rv, userId)
// After:
const knownPartner = rv.resolvedPartner
```

**Line ~546:**
```js
// Before:
const deducedOpp = deducedPartner(rv, userId)
// After:
const deducedOpp = rv.resolvedPartner
```

**Line ~599:**
```js
// Before:
if (deducedPartner(rv, userId) === null && !ledThisTrickIsCalled && hasCalledSuitFailInHand) {
// After:
if (rv.resolvedPartner === null && !ledThisTrickIsCalled && hasCalledSuitFailInHand) {
```

**Line ~657:**
```js
// Before:
const deducedForPredicted = deducedPartner(rv, userId)
// After:
const deducedForPredicted = rv.resolvedPartner
```

- [ ] **Step 2: Replace the 2 `deducedNonTrumpVoids` call sites**

**Line ~347:**
```js
// Before:
const nonTrumpVoids = deducedNonTrumpVoids(rv)
// After:
const nonTrumpVoids = rv.nonTrumpVoids
```

**Line ~382:**
```js
// Before:
const nonTrumpVoids = deducedNonTrumpVoids(rv)
// After:
const nonTrumpVoids = rv.nonTrumpVoids
```

- [ ] **Step 3: Remove now-unused imports from `botStrategy.js`**

Current import line (line 9):
```js
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, isGuaranteedWinner, cheapestGuaranteedWin, pickBySchmearPriority, deducedPartner, deducedNonTrumpVoids, resolveView } from './botInference.js'
```

Replace with (removing `deducedPartner` and `deducedNonTrumpVoids`):
```js
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, isGuaranteedWinner, cheapestGuaranteedWin, pickBySchmearPriority, resolveView } from './botInference.js'
```

- [ ] **Step 4: Run all tests to confirm no behavioral change**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/botStrategy.js
git commit -m "refactor(strategy): replace inline deducedPartner/deducedNonTrumpVoids calls with rv.* reads"
```

---

## Task 4: Update `docs/BOTS.md`

**Files:**
- Modify: `docs/BOTS.md`

- [ ] **Step 1: Update the `resolveView` entry**

Find the current `resolveView` row (around line 200) in the inference helpers table:

```
| `resolveView` | Pre-computation wrapper called once per play decision in `decidePlay`. Returns `{ ...view, knownLocations }`. All downstream inference calls receive the enriched view. Phase 2 (#176) will add more pre-computed fields. |
```

Replace with:
```
| `resolveView` | Pre-computation wrapper called once per play decision in `decidePlay`. Returns the view enriched with: `knownLocations` (card locations from blitz declarations), `resolvedPartner` (inferred partner userId or null — distinct from engine-set `view.partner`), `trumpVoids` (Set of userIds with no trump remaining), `nonTrumpVoids` (map of userId → Set of fail suits they cannot follow), and `resolvedTrumpRemaining` (integer count of trump still held by other players). All downstream inference calls receive the enriched view. |
```

- [ ] **Step 2: Run all tests one final time to confirm clean state**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add docs/BOTS.md
git commit -m "docs(bots): update resolveView entry with all five pre-computed fields"
```
