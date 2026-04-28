# Bot Pick Strategy Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the bot pick decision so Leaster/Schwanzer hands occur at a realistic ~15% rate, by replacing the current `handScore` formula, adding a trump-count hard veto, making the threshold position-aware, and adding an offline calibration simulator.

**Architecture:** All pick logic lives in `shared/botStrategy.js` and `shared/botInference.js`. Both bot decisions (`functions/api/_botHelpers.js`) and the human pick-suggestion (`shared/botSuggestion.js`) already call `decidePick(view, userId)` — the rework happens entirely inside that function plus its helper `handScore`. Position information is already in `view.pickIndex` (set by `dealHand` / `pass` in `gameEngine.js`), so no signature plumbing is needed across callers.

**Tech Stack:** Node.js (ES modules), Vitest for tests, plain Node CLI for the simulator.

**Spec:** [`docs/superpowers/specs/2026-04-27-bot-pick-strategy-rework-design.md`](../specs/2026-04-27-bot-pick-strategy-rework-design.md)
**Related issues:** [#126](https://github.com/andynumber2/sheepshead/issues/126), [#157](https://github.com/andynumber2/sheepshead/issues/157)

---

## File Map

- **Modify** `shared/botInference.js` — replace the `handScore` implementation.
- **Modify** `shared/botStrategy.js` — add `pickThreshold`, `decidePickWith`; rewrite `decidePick`.
- **Modify** `shared/gameEngine.test.js` — replace existing `decidePick` tests (3) with new tests covering the new formula, trump-count veto, and position threshold; add `handScore` and `pickThreshold` tests.
- **Create** `scripts/simulate-pick.js` — Monte Carlo CLI simulator.
- **Modify** `package.json` — add `sim:pick` script.
- **Modify** `docs/BOTS.md` — sync the "Pick Decision" section with the new logic.

Tests in `shared/botSuggestion.labels.test.js` mock `decidePick`, so they should not need changes — verify in Task 7.

---

## Task 1: Rewrite `handScore` formula

**Files:**
- Modify: `shared/botInference.js:45-50`
- Test: `shared/gameEngine.test.js` (new `describe('handScore', …)` block)

The new formula is:
```
handScore = schwanzerPts × 4
          + 3 × (count of non-trump aces)
          + 2 × (count of non-trump tens)
          + 5 if Queen of Clubs held
```

`schwanzerPts` and `schwanzerCardPoints` already exist in `shared/gameEngine.js` and are reused. `isTrump` is also already exported from there.

- [ ] **Step 1: Add a failing test for the new `handScore`**

In `shared/gameEngine.test.js`, add this `describe` block immediately above the existing `describe('decidePick', …)` block:

```js
import { handScore } from './botInference.js'

describe('handScore', () => {
  it('returns schwanzerPts × 4 for an all-trump-no-QC hand', () => {
    // QH=3, QD=3, JS=2, JH=2, JD=2, 9D=1 → schwanzer 13 → 13*4 = 52
    // No QC, no fail aces, no fail tens
    const hand = [c('Q','H'), c('Q','D'), c('J','S'), c('J','H'), c('J','D'), c('9','D')]
    expect(handScore(hand)).toBe(52)
  })

  it('adds 5 when QC is held', () => {
    // QC=3, JS=2, JH=2, 7C=0, 8C=0, 9C=0 → schwanzer 7 → 7*4 = 28; +5 QC = 33
    const hand = [c('Q','C'), c('J','S'), c('J','H'), c('7','C'), c('8','C'), c('9','C')]
    expect(handScore(hand)).toBe(33)
  })

  it('adds 3 per non-trump ace', () => {
    // QH=3, JH=2, AC=0, AH=0, 7S=0, 8S=0 → schwanzer 5 → 20; +3*2 fail aces = 26
    // No QC, no tens
    const hand = [c('Q','H'), c('J','H'), c('A','C'), c('A','H'), c('7','S'), c('8','S')]
    expect(handScore(hand)).toBe(26)
  })

  it('adds 2 per non-trump ten', () => {
    // QH=3, JH=2, 10C=0, 10H=0, 7S=0, 8S=0 → schwanzer 5 → 20; +2*2 fail tens = 24
    const hand = [c('Q','H'), c('J','H'), c('10','C'), c('10','H'), c('7','S'), c('8','S')]
    expect(handScore(hand)).toBe(24)
  })

  it('does not count A♦ or 10♦ as a fail ace/ten (they are trump)', () => {
    // AD and 10D are diamonds → trump. They contribute schwanzerPts=1 each (diamond pips)
    // but are NOT fail aces/tens.
    // QH=3, JH=2, AD=1, 10D=1, 7S=0, 8S=0 → schwanzer 7 → 28; no QC, no fail A/10 → 28
    const hand = [c('Q','H'), c('J','H'), c('A','D'), c('10','D'), c('7','S'), c('8','S')]
    expect(handScore(hand)).toBe(28)
  })

  it('combines all terms', () => {
    // QC=3, QS=3, JC=2, AC=0, AH=0, 10S=0 → schwanzer 8 → 32; +5 QC; +3*2 aces; +2*1 ten = 45
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('A','C'), c('A','H'), c('10','S')]
    expect(handScore(hand)).toBe(45)
  })

  it('ignores hidden cards', () => {
    // Only QC visible: schwanzer 3 → 12; +5 QC = 17
    const hand = [c('Q','C'), { id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }]
    expect(handScore(hand)).toBe(17)
  })
})
```

If `handScore` is not yet imported at the top of the test file, add it to the existing import line. Check the top of the file — there is already a line `import { ... } from './botStrategy.js'`; add a new import line for `handScore`:

```js
import { handScore } from './botInference.js'
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npx vitest run shared/gameEngine.test.js -t "handScore"`
Expected: most cases FAIL (the current formula returns different numbers — e.g., the QC bonus does not exist, fail-ace weighting is via `buriablePoints` not a count).

- [ ] **Step 3: Replace `handScore` in `shared/botInference.js`**

Replace the existing implementation (lines around 45-50). The new function:

```js
// Combined hand quality score for the pick decision.
// schwanzerPts × 4 + 3 × failAces + 2 × failTens + (5 if QC).
// Hidden cards are ignored — handScore is called from decidePick on the bot's own hand,
// but the hidden filter mirrors the prior implementation for safety.
export function handScore(hand) {
  const visible = hand.filter(c => !c.hidden)
  const schwanzerPts = visible.reduce((sum, c) => sum + schwanzerCardPoints(c), 0)
  const failAces = visible.filter(c => !isTrump(c) && c.rank === 'A').length
  const failTens = visible.filter(c => !isTrump(c) && c.rank === '10').length
  const hasQC = visible.some(c => c.id === 'QC')
  return schwanzerPts * 4 + 3 * failAces + 2 * failTens + (hasQC ? 5 : 0)
}
```

`isTrump` is already imported at the top of `botInference.js` from `./gameEngine.js`. The unused export `buriablePoints` (currently above `handScore`) is no longer referenced by `handScore` — search the codebase for other consumers:

```bash
grep -rn "buriablePoints" --include="*.js"
```

If `buriablePoints` has no other consumers, delete it and remove it from the export list. If it does, leave it as-is (unused-by-pick code is acceptable to keep).

- [ ] **Step 4: Run all `handScore` tests and verify they pass**

Run: `npx vitest run shared/gameEngine.test.js -t "handScore"`
Expected: all 7 tests PASS.

- [ ] **Step 5: Run the full test suite to catch any regressions**

Run: `npx vitest run`
Expected: only pre-existing `decidePick` tests fail (those are rewritten in Task 3). Make a note of which tests fail so Task 3 catches them all.

- [ ] **Step 6: Commit**

```bash
git add shared/botInference.js shared/gameEngine.test.js
git commit -m "feat(bot): rewrite handScore with QC bonus, fail-ace/ten counts (#126)"
```

---

## Task 2: Add `pickThreshold` and position-aware `decidePick`

**Files:**
- Modify: `shared/botStrategy.js:134-138`
- Test: `shared/gameEngine.test.js` (new `describe('pickThreshold', …)` block)

Introduce two new exported names: `PICK_THRESHOLD_BASE`, `PICK_THRESHOLD_DISCOUNT` (constants, *placeholder values* — calibrated in Task 5), and a new function `pickThreshold(passesSoFar)` that computes the threshold for that seat. `decidePick` is rewritten to use it, plus the trump-count hard veto.

The simulator (Task 4) needs to vary the threshold without changing module state. To support that, also export `decidePickWith(view, userId, base, discount)` — the parameterized core. Production `decidePick` is a thin wrapper.

- [ ] **Step 1: Add a failing test for `pickThreshold`**

In `shared/gameEngine.test.js`, immediately above the existing `describe('decidePick', …)` block, add:

```js
import { pickThreshold, PICK_THRESHOLD_BASE, PICK_THRESHOLD_DISCOUNT } from './botStrategy.js'

describe('pickThreshold', () => {
  it('returns BASE at passesSoFar = 0', () => {
    expect(pickThreshold(0)).toBe(PICK_THRESHOLD_BASE)
  })

  it('subtracts DISCOUNT per pass', () => {
    expect(pickThreshold(1)).toBe(PICK_THRESHOLD_BASE - PICK_THRESHOLD_DISCOUNT)
    expect(pickThreshold(4)).toBe(PICK_THRESHOLD_BASE - 4 * PICK_THRESHOLD_DISCOUNT)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails (import error)**

Run: `npx vitest run shared/gameEngine.test.js -t "pickThreshold"`
Expected: FAIL — `pickThreshold` and the constants do not yet exist.

- [ ] **Step 3: Implement `pickThreshold`, `decidePickWith`, and rewrite `decidePick` in `shared/botStrategy.js`**

Replace the existing block (lines 134-138):

```js
// ─── decidePick ───────────────────────────────────────────────────────────────
export function decidePick(view, userId) {
  const hand = view.hands[userId]
  return handScore(hand) >= 24
}
```

with:

```js
// ─── decidePick ───────────────────────────────────────────────────────────────
// Placeholder calibration values; tuned in scripts/simulate-pick.js (issue #126).
export const PICK_THRESHOLD_BASE = 30
export const PICK_THRESHOLD_DISCOUNT = 2

export function pickThreshold(passesSoFar) {
  return PICK_THRESHOLD_BASE - PICK_THRESHOLD_DISCOUNT * passesSoFar
}

// Parameterized core — used by the simulator to sweep base/discount values.
export function decidePickWith(view, userId, base, discount) {
  const hand = view.hands[userId]
  const visible = hand.filter(c => !c.hidden)

  // Hard veto: too few trump → never pick.
  const trumpCount = visible.filter(c => isTrump(c)).length
  if (trumpCount <= 2) return false

  const passesSoFar = view.pickIndex ?? 0
  return handScore(hand) >= base - discount * passesSoFar
}

export function decidePick(view, userId) {
  return decidePickWith(view, userId, PICK_THRESHOLD_BASE, PICK_THRESHOLD_DISCOUNT)
}
```

Add `isTrump` to the import line at the top of `shared/botStrategy.js` (it currently imports from `gameEngine.js` — extend that import):

```js
import { ... existing imports ..., isTrump } from './gameEngine.js'
```

(Look at the existing import line and append `isTrump` to the destructuring list.)

- [ ] **Step 4: Run `pickThreshold` tests and verify they pass**

Run: `npx vitest run shared/gameEngine.test.js -t "pickThreshold"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(bot): add pickThreshold and decidePickWith (#126)"
```

---

## Task 3: Rewrite `decidePick` tests for new behavior

**Files:**
- Modify: `shared/gameEngine.test.js:1754-1772` (existing `describe('decidePick', …)` block)

The three existing tests assume the old formula and the absence of a trump-count veto. Replace them with tests that cover: pick when strong, pass when weak, hard veto on low trump, position discount.

- [ ] **Step 1: Replace the existing `describe('decidePick', …)` block**

Locate the existing block (around line 1754) and replace its body entirely:

```js
describe('decidePick', () => {
  it('picks a strong hand at seat 0', () => {
    // QC=3, QS=3, JC=2, JS=2, AD=1, 10D=1 → schwanzer 12 → 48; +5 QC; trump 6 → score 53
    // Threshold at pickIndex=0 = BASE (30). Picks.
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','S'), c('A','D'), c('10','D')]
    expect(decidePick({ hands: { p1: hand }, pickIndex: 0 }, 'p1')).toBe(true)
  })

  it('passes a weak hand at seat 0', () => {
    // QH=3, JH=2, 7C=0, 8C=0, 9S=0, 8S=0 → schwanzer 5 → 20; trump 2 → HARD VETO → pass
    const hand = [c('Q','H'), c('J','H'), c('7','C'), c('8','C'), c('9','S'), c('8','S')]
    expect(decidePick({ hands: { p1: hand }, pickIndex: 0 }, 'p1')).toBe(false)
  })

  it('hard veto: never picks with trumpCount ≤ 2 even if score is high', () => {
    // QH=3, QD=3, AC=0, AH=0, AS=0, 10C=0 → schwanzer 7 → 28; +3*3 aces = 37
    // But trump count = 2 (QH, QD) → hard veto → false.
    const hand = [c('Q','H'), c('Q','D'), c('A','C'), c('A','H'), c('A','S'), c('10','C')]
    expect(decidePick({ hands: { p1: hand }, pickIndex: 0 }, 'p1')).toBe(false)
  })

  it('position-aware: a marginal hand passes early-seat but picks late-seat', () => {
    // Construct a hand whose handScore equals BASE - 2*DISCOUNT (picks at pickIndex=2 only).
    // We use the exported constants so this stays consistent if calibration changes,
    // as long as the relationship handScore ≈ BASE - 2*DISCOUNT is preserved.
    //
    // Hand: QC=3, QH=3, JS=2, JD=2, 9D=1, AC(fail ace) → schwanzer 11 → 44
    //       +5 QC + 3*1 fail ace = 52; trump 5 (QC,QH,JS,JD,9D).
    // This hand picks at any seat — verify pickIndex=0 picks.
    // For position contrast, build a marginal hand:
    //   QH=3, JH=2, JD=2, 9D=1, AC, 7S → schwanzer 8 → 32; +3*1 = 35; trump 4 (QH,JH,JD,9D).
    // If BASE=30, discount=2: thresholds are 30, 28, 26, 24, 22 across seats. Score 35 picks at all seats.
    //
    // To make a true position-sensitive case, target score < BASE but ≥ BASE - 2*DISCOUNT:
    //   QH=3, JH=2, 9D=1, 7C, 8C, 9S → schwanzer 6 → 24; trump 3 (QH, JH, 9D); no QC, no fail A/10 → score 24.
    //   At pickIndex=0 (threshold 30): 24 < 30 → pass.
    //   At pickIndex=3 (threshold 24): 24 ≥ 24 → pick.
    const hand = [c('Q','H'), c('J','H'), c('9','D'), c('7','C'), c('8','C'), c('9','S')]
    expect(decidePick({ hands: { p1: hand }, pickIndex: 0 }, 'p1')).toBe(false)
    expect(decidePick({ hands: { p1: hand }, pickIndex: 3 }, 'p1')).toBe(true)
  })

  it('defaults pickIndex to 0 when undefined', () => {
    // Same marginal hand as above; without pickIndex, behaves as seat 0 → pass.
    const hand = [c('Q','H'), c('J','H'), c('9','D'), c('7','C'), c('8','C'), c('9','S')]
    expect(decidePick({ hands: { p1: hand } }, 'p1')).toBe(false)
  })
})
```

**Note:** The "position-aware" test asserts specific behavior that depends on the placeholder values `BASE=30, DISCOUNT=2`. After calibration (Task 5), if either constant changes such that the score-24 hand no longer straddles seat-0-vs-seat-3, this test must be updated to use a new hand that does. The note is in Task 5.

- [ ] **Step 2: Run the new `decidePick` tests and verify they pass**

Run: `npx vitest run shared/gameEngine.test.js -t "decidePick"`
Expected: all 5 tests PASS.

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npx vitest run`
Expected: all tests PASS (frontend tests are not part of this scope; if `npm test -w frontend` runs anything related to bot logic, double-check).

- [ ] **Step 4: Commit**

```bash
git add shared/gameEngine.test.js
git commit -m "test(bot): rewrite decidePick tests for new formula (#126)"
```

---

## Task 4: Build the Monte Carlo simulator

**Files:**
- Create: `scripts/simulate-pick.js`
- Modify: `package.json` (add `sim:pick` script)

Standalone Node script. Imports the production `dealHand` and `decidePickWith`. Iterates N hands, walks each pick order, records whether any seat picked. Outputs aggregate stats. Supports a seeded PRNG so runs are reproducible.

- [ ] **Step 1: Create `scripts/simulate-pick.js`**

```js
#!/usr/bin/env node
// Monte Carlo simulator for the bot pick decision.
// Calibrates BASE and DISCOUNT against a target no-pick (Leaster/Schwanzer) rate.
//
// Usage:
//   npm run sim:pick -- --base 30 --discount 2 --hands 10000 [--seed 42]

import { dealHand } from '../shared/gameEngine.js'
import { decidePickWith } from '../shared/botStrategy.js'

function parseArgs(argv) {
  const args = { base: 30, discount: 2, hands: 10000, seed: undefined }
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]
    const next = argv[i + 1]
    if (tok === '--base')      { args.base = Number(next); i++ }
    else if (tok === '--discount') { args.discount = Number(next); i++ }
    else if (tok === '--hands')    { args.hands = Number(next); i++ }
    else if (tok === '--seed')     { args.seed = Number(next); i++ }
    else if (tok === '--help' || tok === '-h') {
      console.log('Usage: npm run sim:pick -- --base N --discount N --hands N [--seed N]')
      process.exit(0)
    } else {
      console.error(`Unknown arg: ${tok}`)
      process.exit(1)
    }
  }
  if (Number.isNaN(args.base) || Number.isNaN(args.discount) || Number.isNaN(args.hands)) {
    console.error('--base, --discount, and --hands must all be numbers')
    process.exit(1)
  }
  return args
}

// mulberry32: tiny seeded PRNG. Deterministic for a given seed.
function makeMulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function simulate({ base, discount, hands, seed }) {
  // dealHand uses Math.random internally via shuffle. Override for deterministic runs.
  if (seed !== undefined) {
    Math.random = makeMulberry32(seed)
  }

  const playerIds = ['p0', 'p1', 'p2', 'p3', 'p4']
  const picksBySeat = [0, 0, 0, 0, 0]
  let noPick = 0
  let pickedHandScoreSum = 0
  let pickedCount = 0
  let passedHandScoreSum = 0
  let passedCount = 0

  for (let h = 0; h < hands; h++) {
    const state = dealHand(playerIds, 0, 1, 1)
    let picked = false
    for (let i = 0; i < state.pickOrder.length; i++) {
      const userId = state.pickOrder[i]
      const view = { hands: state.hands, pickIndex: i }
      if (decidePickWith(view, userId, base, discount)) {
        picksBySeat[i]++
        picked = true
        break
      }
    }
    // Tally handScore stats for the picker (or final passer if no pick).
    // We don't import handScore directly here to keep this file decoupled;
    // skip score stats for v1.
    if (!picked) noPick++
  }

  const total = hands
  return {
    total,
    picksBySeat,
    pickedTotal: picksBySeat.reduce((a, b) => a + b, 0),
    noPick,
    noPickRate: noPick / total,
  }
}

const args = parseArgs(process.argv)
const r = simulate(args)

const pct = (x) => (x * 100).toFixed(2) + '%'
console.log('=== Pick Simulation ===')
console.log(`base=${args.base} discount=${args.discount} hands=${args.hands}` +
            (args.seed !== undefined ? ` seed=${args.seed}` : ' (random seed)'))
console.log(`Total hands:        ${r.total}`)
console.log(`Picked total:       ${r.pickedTotal} (${pct(r.pickedTotal / r.total)})`)
for (let i = 0; i < 5; i++) {
  console.log(`  Seat ${i + 1} picks: ${r.picksBySeat[i]} (${pct(r.picksBySeat[i] / r.total)})`)
}
console.log(`No-pick (Leaster):  ${r.noPick} (${pct(r.noPickRate)})`)
console.log(`Target ~15%; current delta: ${((r.noPickRate - 0.15) * 100).toFixed(2)}%`)
```

- [ ] **Step 2: Add the `sim:pick` script to `package.json`**

Edit `package.json` and add a new key inside `"scripts"`:

```json
"sim:pick": "node scripts/simulate-pick.js"
```

The full `"scripts"` block becomes (preserve existing keys):

```json
"scripts": {
  "dev": "concurrently -n frontend,wrangler -c cyan,yellow \"npm run dev:frontend\" \"npm run dev:wrangler\"",
  "dev:frontend": "npm run dev -w frontend",
  "dev:wrangler": "wrangler pages dev --port 8788",
  "build": "npm run build -w frontend",
  "deploy": "npm run build && wrangler pages deploy frontend/dist",
  "db:migrate:local": "wrangler d1 migrations apply sheepshead-db --local",
  "db:migrate": "wrangler d1 migrations apply sheepshead-db --remote",
  "test": "vitest run && npm test -w frontend",
  "sim:pick": "node scripts/simulate-pick.js",
  "postinstall": "git config core.hooksPath .githooks"
}
```

- [ ] **Step 3: Smoke-test the simulator**

Run: `npm run sim:pick -- --base 30 --discount 2 --hands 1000 --seed 42`
Expected: prints stats; no-pick rate is *some* number (likely far from 15% with placeholder values — that's fine, this step just verifies the simulator runs end-to-end). Re-run the same command twice with `--seed 42` and verify identical output (deterministic).

- [ ] **Step 4: Commit**

```bash
git add scripts/simulate-pick.js package.json
git commit -m "feat(bot): add Monte Carlo pick-decision simulator (#126)"
```

---

## Task 5: Calibrate `BASE` and `DISCOUNT`

**Files:**
- Modify: `shared/botStrategy.js` (the `PICK_THRESHOLD_BASE` and `PICK_THRESHOLD_DISCOUNT` constants)
- Possibly modify: `shared/gameEngine.test.js` (the position-aware `decidePick` test, if calibration shifts the relevant boundary)

Goal: pick `BASE`/`DISCOUNT` so that the simulated no-pick rate over 10,000 hands lands within ±2% of 15%.

- [ ] **Step 1: Sweep candidate values**

Run the simulator across a coarse grid. Each run with `--seed 42` for reproducibility, `--hands 10000` for stable estimates.

```bash
for base in 28 30 32 34 36 38 40; do
  for discount in 1 2 3; do
    npm run sim:pick -- --base $base --discount $discount --hands 10000 --seed 42 2>&1 \
      | grep -E "base=|No-pick"
  done
done
```

Pick the (base, discount) pair whose `No-pick` rate is closest to 15%. Note that runs with very small `--hands` will have noticeable variance; 10,000 hands gives an SE of ~0.4 percentage points on a 15% rate, which is enough.

- [ ] **Step 2: Confirm with a different seed**

Run the chosen pair against 2-3 different seeds with `--hands 10000` and confirm the no-pick rate lands within ±2% of 15% in each. This guards against seed-fitting.

```bash
npm run sim:pick -- --base <chosen> --discount <chosen> --hands 10000 --seed 1
npm run sim:pick -- --base <chosen> --discount <chosen> --hands 10000 --seed 2
npm run sim:pick -- --base <chosen> --discount <chosen> --hands 10000 --seed 3
```

- [ ] **Step 3: Update the constants in `shared/botStrategy.js`**

Replace:
```js
export const PICK_THRESHOLD_BASE = 30
export const PICK_THRESHOLD_DISCOUNT = 2
```
with the calibrated values.

- [ ] **Step 4: Re-run the test suite**

Run: `npx vitest run`
Expected: all tests PASS.

If the position-aware `decidePick` test now fails — the test hand was constructed for `BASE=30, DISCOUNT=2` to straddle seat 0 vs seat 3 — adjust the hand or the seat indices in that test so the assertion still demonstrates "passes early seat, picks late seat" with the new constants. Pick a hand whose `handScore` equals `NEW_BASE - K × NEW_DISCOUNT` for some `K ∈ {2, 3, 4}`. Concrete recipe:

1. Compute `target = NEW_BASE - 3 × NEW_DISCOUNT`.
2. Construct a 6-card hand (3+ trump, no QC, no fail aces, no fail tens) whose `schwanzerPts × 4 = target`. For example, if `target = 24`, you need schwanzerPts = 6: e.g., `Q♥(3) + J♥(2) + 9♦(1) + 3 fail blanks`.
3. Re-run the test with seat 0 → pass and seat 3 → pick.

- [ ] **Step 5: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat(bot): calibrate pick threshold to ~15% Leaster rate (#126)"
```

---

## Task 6: Update `docs/BOTS.md`

**Files:**
- Modify: `docs/BOTS.md` (Pick Decision section)

Sync the documentation with the new pick logic.

- [ ] **Step 1: Replace the "Pick Decision" section**

Locate the current "Pick Decision (`decidePick`)" section (around line 14) and replace it with:

```markdown
## Pick Decision (`decidePick`)

The bot picks if **all** of the following hold:

1. **Trump-count floor:** the hand contains at least 3 trump cards.
2. **Hand score meets a position-aware threshold:** `handScore(hand) >= base − discount × passesSoFar`.

Both bot decisions and the human pick-suggestion go through this single function — the suggestion shown to a human is the same play a competent bot would make.

### Hand score formula

```
handScore = (schwanzer points) × 4
          + 3 × (count of non-trump aces)
          + 2 × (count of non-trump tens)
          + 5  if the Queen of Clubs is held
```

- **Schwanzer points** (defined in `gameEngine.js`): Queen=3, Jack=2, non-Q-non-J diamond=1, else=0. This term is the strongest signal of trump quality.
- **Queen of Clubs bonus:** the QC is the highest card in the deck and never loses a trump fight; it is materially stronger than other queens, so it gets a flat +5.
- **Non-trump aces and tens** capture point density in fail. Counted as `+3` and `+2` respectively. Note that the Ace and Ten of Diamonds are *trump*, not fail — they contribute via the schwanzer-points term, not here.

### Position-aware threshold

The threshold drops by `discount` (currently `<DISCOUNT_VALUE>`) for each seat that has already passed in this hand. With the base set to `<BASE_VALUE>`, the per-seat thresholds are:

| Seat in pick order | Threshold |
|---|---|
| 1 (first to act) | `<BASE>` |
| 2 | `<BASE - DISCOUNT>` |
| 3 | `<BASE - 2*DISCOUNT>` |
| 4 | `<BASE - 3*DISCOUNT>` |
| 5 (last) | `<BASE - 4*DISCOUNT>` |

This reflects real sheepshead strategy: each preceding pass is evidence that the remaining hands are weaker, so a later seat can pick on a marginally weaker hand.

### Hard trump-count veto

If the hand contains 2 or fewer trump, the bot never picks regardless of `handScore`. Real players auto-pass these hands. This veto prevents pathological "all aces, no trump" hands from clearing the threshold.
```

Replace `<BASE_VALUE>` and `<DISCOUNT_VALUE>` with the calibrated numbers from Task 5, and fill in the table likewise.

- [ ] **Step 2: Confirm RULES.md and other docs do not reference the old `>= 24` threshold**

Run:
```bash
grep -n "24" docs/BOTS.md docs/RULES.md
grep -n "schwanzerPts \* 4 + buriablePoints\|handScore" docs/BOTS.md
```
Resolve any stale references.

- [ ] **Step 3: Commit**

```bash
git add docs/BOTS.md
git commit -m "docs(bots): sync BOTS.md with new pick decision (#126)"
```

---

## Task 7: Final verification

**Files:** none modified — just running checks.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 2: Run frontend tests**

Run: `npm test -w frontend`
Expected: all PASS (this rework should not affect the frontend).

- [ ] **Step 3: Confirm `botSuggestion.labels.test.js` still works**

That file mocks `decidePick` directly (`vi.fn()`), so it should be unaffected. The above suite run covers it; this step is just a callout in case the mock surface needs updating.

- [ ] **Step 4: Spot-check via `npm run dev`** (optional but recommended)

Start the dev server and play through a few hands, watching for:
- Bots passing on weak hands (clearly weaker hands than before should now pass).
- The pick suggestion (when toggled on) producing the same call a bot would.

If the human-suggestion UI surfaces a pick recommendation visibly differently, double-check that `botSuggestion.js` is wired to the new `decidePick` (it already is, per Task 0 exploration — no change needed).

- [ ] **Step 5: Run the simulator one more time and record the result in the PR description**

```bash
npm run sim:pick -- --base <BASE> --discount <DISCOUNT> --hands 50000 --seed 42
```

Paste the output into the PR description as evidence of the calibration.

- [ ] **Step 6: Final commit if anything was tweaked, then push for review**

```bash
git status
# If clean, no commit needed.
```

---

## Out of scope (logged in #157)

- Fail-suit-count term (count of distinct fail suits in hand)
- A♦ / 10♦ context-dependent bonus
- All-three-fail-aces penalty
