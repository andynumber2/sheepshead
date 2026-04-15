# Bot Trump Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the picker and partner bots to spend the cheapest trump that guarantees a trick rather than wasting strong Jacks/Queens when weaker diamond trump would do.

**Architecture:** Add `cheapestWinningTrump()` helper in `botStrategy.js`. Replace the single `lowestCard(winning)` call in the picker-team "try to win" path with branched logic that selects trump by tier (point diamonds → pip diamonds → Jacks/Queens) and adjusts for position (opponents remaining, picker vs partner, trump-in-hand count). `lowestCard()` is not changed — it remains correct for non-trump follows and the "can't win, dump low" path.

**Tech Stack:** Vanilla JS (ES modules), Vitest for tests.

---

### Trump rank reference

```
QC(0) QS(1) QH(2) QD(3) JC(4) JS(5) JH(6) JD(7) AD(8) 10D(9) KD(10) 9D(11) 8D(12) 7D(13)
```

Lower index = stronger trump. `beats(challenger, current)` for two trump returns `trumpRank(challenger) < trumpRank(current)`. So KD (rank 10) **beats** 9D (rank 11) because 10 < 11, but KD does **not** beat JD (rank 7) because 10 > 7.

---

### Task 1: Trump trick scenarios (Scenario 1)

**Files:**
- Modify: `shared/gameEngine.test.js` (append new `describe` block at end of file)
- Modify: `shared/botStrategy.js` (add `cheapestWinningTrump` helper + update `decidePlay`)

---

- [ ] **Step 1: Write failing tests for Scenario 1**

Append to the end of `shared/gameEngine.test.js`:

```js
describe('decidePlay trump efficiency — trump trick (Scenario 1)', () => {
  // All 5 player IDs must appear in hands so Object.keys(view.hands) returns
  // the full player list — required for opponents-remaining computation.
  function makeView({ userId, picker, partner, hand, trick }) {
    const ALL = ['p1', 'p2', 'p3', 'p4', 'p5']
    const hands = Object.fromEntries(ALL.map(id => [id, id === userId ? hand : []]))
    return {
      hands,
      currentTrick: trick,
      tricks: [],
      picker,
      partner,
      isLeaster: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      underCard: null,
      pickerForcedPlays: [],
      lastTrick: [],
    }
  }

  it('uses point diamond over Queen when 0 opponents remain', () => {
    // Trump trick (7D led by p3). Played: p3(7D), p4(8D), p5(9D), p2(AC — void in trump).
    // Current winner: p5 (9D, rank 11). All opponents (p3,p4,p5) and partner (p2) played.
    // Picker (p1) hand: KD(rank10), QS(rank1). Both beat 9D(rank11).
    //   KD beats 9D: trumpRank(KD)=10 < trumpRank(9D)=11 ✓
    //   QS beats 9D: trumpRank(QS)=1  < trumpRank(9D)=11 ✓
    // Old lowestCard([KD, QS]): QS=3pts < KD=4pts → picks QS. Bug: wastes strong Queen.
    // New cheapestWinningTrump: tier1=[KD] → return KD.
    const view = makeView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('Q','S')],
      trick: [
        { userId: 'p3', card: c('7','D') },
        { userId: 'p4', card: c('8','D') },
        { userId: 'p5', card: c('9','D') },
        { userId: 'p2', card: c('A','C') },  // p2 void in trump, plays off-suit
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('KD')
  })

  it('uses point diamond over pip diamond when 0 opponents remain', () => {
    // Trump trick (7D led by p2). Played: p2(7D), p3(AC), p4(KC), p5(8D).
    // p5 plays 8D (rank 12) which beats 7D (rank 13). Current winner: p5 (8D, rank 12).
    // 0 opponents remain (p3,p4,p5 all played; p2=partner played).
    // Picker (p1) hand: 10D(rank9), 9D(rank11). Both beat 8D(rank12).
    //   10D: trumpRank(10D)=9 < 12 ✓   9D: trumpRank(9D)=11 < 12 ✓
    // Old lowestCard: 9D=0pts < 10D=10pts → picks 9D. Bug: discards 10pts from pile.
    // New: tier1=[10D] → return 10D.
    const view = makeView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('10','D'), c('9','D')],
      trick: [
        { userId: 'p2', card: c('7','D') },
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p5', card: c('8','D') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('10D')
  })

  it('uses weakest point diamond when multiple options and 0 opponents remain', () => {
    // Trump trick (7D led by p3). All opponents + partner played. Current winner p5(9D, rank11).
    // Picker (p1) hand: AD(rank8), 10D(rank9), KD(rank10), JD(rank7).
    // All four beat 9D(rank11): AD(8<11), 10D(9<11), KD(10<11), JD(7<11).
    // Old lowestCard: JD=2pts (lowest) → picks JD. Bug: wastes the Jack.
    // New cheapestWinningTrump: tier1=[AD,10D,KD], weakest in tier1 = KD (rank10, highest index).
    const view = makeView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('A','D'), c('10','D'), c('K','D'), c('J','D')],
      trick: [
        { userId: 'p3', card: c('7','D') },
        { userId: 'p4', card: c('8','D') },
        { userId: 'p5', card: c('9','D') },
        { userId: 'p2', card: c('A','C') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('KD')
  })

  it('plays highest winning trump when opponents remain on trump trick', () => {
    // Trump trick (8D led by p3). Only p3 has played. p4 and p5 (opponents) still to play.
    // Current winner: p3 (8D, rank 12). Picker (p1) hand: KD(rank10), JD(rank7), QS(rank1).
    // All three beat 8D(rank12): KD(10<12), JD(7<12), QS(1<12).
    // Old lowestCard: JD=2pts → picks JD. Bug: should commit strongest against future opponents.
    // New: opponentsRemaining=2 → highestTrump(winning) = QS (rank 1).
    const view = makeView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('J','D'), c('Q','S')],
      trick: [
        { userId: 'p3', card: c('8','D') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('QS')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "trump efficiency — trump trick"
```

Expected: 4 failures (tests 1 and 4 definitely fail with current code; 2 and 3 also fail).

- [ ] **Step 3: Add `cheapestWinningTrump` helper to `botStrategy.js`**

In `shared/botStrategy.js`, insert this function after the `highestValueCard` function (just before the `// ─── decidePick` comment):

```js
function cheapestWinningTrump(cards) {
  const POINT_DIAMONDS = new Set(['AD', '10D', 'KD'])
  const PIP_DIAMONDS = new Set(['9D', '8D', '7D'])
  const pointD = cards.filter(c => POINT_DIAMONDS.has(c.id))
  const pipD = cards.filter(c => PIP_DIAMONDS.has(c.id))
  const highTrump = cards.filter(c => c.rank === 'Q' || c.rank === 'J')
  const group = pointD.length > 0 ? pointD : pipD.length > 0 ? pipD : highTrump
  return group.reduce((best, c) => trumpRank(c) > trumpRank(best) ? c : best)
}
```

- [ ] **Step 4: Replace the picker-team "try to win" block in `decidePlay`**

In `shared/botStrategy.js`, find this block (around line 296):

```js
    // Try to win with the lowest winning card
    const winning = realCards.filter(c => {
      for (const play of currentTrick) {
        if (!beats(c, play.card, ledSuit)) return false
      }
      return true
    })
    if (winning.length > 0) return lowestCard(winning).id
```

Replace it with:

```js
    // Try to win with the most efficient card
    const winning = realCards.filter(c => {
      for (const play of currentTrick) {
        if (!beats(c, play.card, ledSuit)) return false
      }
      return true
    })
    if (winning.length > 0) {
      const nonTrumpWins = winning.filter(c => !isTrump(c))
      if (nonTrumpWins.length > 0) return lowestCard(nonTrumpWins).id

      // Trump wins only — compute how many opposing players have yet to play
      const playedIds = new Set(currentTrick.map(p => p.userId))
      const allPlayerIds = Object.keys(view.hands)
      const opponentsRemaining = allPlayerIds.filter(id =>
        !playedIds.has(id) && id !== userId && id !== picker && id !== partner
      ).length

      if (ledSuit === 'T') {
        // Scenario 1: Trump trick
        if (opponentsRemaining === 0) return cheapestWinningTrump(winning).id
        return highestTrump(winning).id
      }

      // Scenario 2: Fail trick, bot is void — implemented in Task 2
      return lowestCard(winning).id
    }
```

Note: the `return lowestCard(winning).id` at the bottom is a temporary placeholder — Task 2 replaces it. The code is fully functional between tasks; it just doesn't yet apply the new void-trick logic.

- [ ] **Step 5: Run Scenario 1 tests to verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "trump efficiency — trump trick"
```

Expected: 4 passing.

- [ ] **Step 6: Run full test suite to verify no regressions**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat: use cheapest winning trump on guaranteed trump tricks"
```

---

### Task 2: Fail trick void scenarios (Scenario 2)

**Files:**
- Modify: `shared/gameEngine.test.js` (append new `describe` block at end of file)
- Modify: `shared/botStrategy.js` (replace Scenario 2 placeholder)

---

- [ ] **Step 1: Write failing tests for Scenario 2**

Append to the end of `shared/gameEngine.test.js`:

```js
describe('decidePlay trump efficiency — fail trick, bot void (Scenario 2)', () => {
  function makeView({ userId, picker, partner, hand, trick }) {
    const ALL = ['p1', 'p2', 'p3', 'p4', 'p5']
    const hands = Object.fromEntries(ALL.map(id => [id, id === userId ? hand : []]))
    return {
      hands,
      currentTrick: trick,
      tricks: [],
      picker,
      partner,
      isLeaster: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      underCard: null,
      pickerForcedPlays: [],
      lastTrick: [],
    }
  }

  it('picker plays highest trump to get the lead on a void fail trick', () => {
    // Clubs led. Picker (p1) void in clubs. p3(AC), p4(KC), p5(9C), p2(7S — void in clubs).
    // Current winner: p3 (AC). Picker hand: KD(rank10), JD(rank7), QS(rank1).
    // All trump beat AC: KD(trump vs non-trump) ✓, JD ✓, QS ✓.
    // Old lowestCard([KD,JD,QS]): JD=2pts → JD. Bug: picker wants the lead, play strongest.
    // New: userId===picker → highestTrump(winning) = QS (rank1, lowest index).
    const view = makeView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('J','D'), c('Q','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p5', card: c('9','C') },
        { userId: 'p2', card: c('7','S') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('QS')
  })

  it('partner with >1 trump plays highest trump (point diamond) to win and lead back', () => {
    // Spades led. Partner (p2) void in spades. p3(AS), p4(KS), p5(9S). p1(picker) not yet played.
    // Current winner: p3 (AS). Partner hand: AD(rank8), KD(rank10), 8H.
    // Trump in hand: AD and KD (count=2 > 1) → play highest trump.
    // Old lowestCard([AD,KD]): KD=4pts < AD=11pts → picks KD. Bug: should lead back AD (strongest).
    // New: myTrumpCount=2 > 1 → highestTrump([AD,KD]) = AD (rank8 < rank10).
    const view = makeView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('A','D'), c('K','D'), c('8','H')],
      trick: [
        { userId: 'p3', card: c('A','S') },
        { userId: 'p4', card: c('K','S') },
        { userId: 'p5', card: c('9','S') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('AD')
  })

  it('partner with 1 trump plays that trump when picker is not winning the trick', () => {
    // Clubs led. Partner (p2) void in clubs. p3(AC), p4(KC). Current winner: p3(AC, opponent).
    // Partner hand: JD (only trump), 8H, KS. myTrumpCount=1.
    // Picker (p1) not in trick. pickerCurrentlyWinning=false → play the trump.
    // Both old and new code return JD here; this test guards against regression.
    const view = makeView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('J','D'), c('8','H'), c('K','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('JD')
  })

  it('partner with 1 trump plays low when picker has the trick locked', () => {
    // Clubs led. Partner (p2) void in clubs.
    // p3(AC), p4(KC), p5(9C), p1(AD — picker trumped in, currently winning).
    // All 3 opponents (p3,p4,p5) already played. 0 opponents remaining.
    // pickerCurrentlyWinning=true AND opponentsRemaining=0 → play low.
    // Partner hand: 9D(only trump), AH(11pts), KS(4pts).
    // lowestCard([9D,AH,KS]): prefer non-trump; KS=4pts < AH=11pts → KS.
    // Old code: lowestCard([9D]) = 9D. Bug: wastes trump when picker has it locked.
    const view = makeView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('9','D'), c('A','H'), c('K','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p5', card: c('9','C') },
        { userId: 'p1', card: c('A','D') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('KS')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (or identify which are new)**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "fail trick, bot void"
```

Expected: tests 1 (picker→QS), 2 (partner AD), and 4 (partner low KS) fail with current code. Test 3 (partner JD) passes with both old and new — it is a regression guard.

- [ ] **Step 3: Replace the Scenario 2 placeholder in `decidePlay`**

In `shared/botStrategy.js`, find and replace the placeholder comment block:

```js
      // Scenario 2: Fail trick, bot is void — implemented in Task 2
      return lowestCard(winning).id
```

With:

```js
      // Scenario 2: Fail trick, bot is void, playing trump to contest the lead
      if (userId === picker) return highestTrump(winning).id

      // Partner: play highest trump only when there is another trump to lead back
      const myTrumpCount = realCards.filter(c => isTrump(c)).length
      if (myTrumpCount > 1) return highestTrump(winning).id

      // Partner with exactly 1 trump: play it unless the picker has the trick locked
      const pickerCurrentlyWinning = currentWinner(currentTrick)?.userId === picker
      if (pickerCurrentlyWinning && opponentsRemaining === 0) return lowestCard(realCards).id
      return highestTrump(winning).id
```

For copy-paste clarity, the complete updated `if (winning.length > 0)` block now reads:

```js
    if (winning.length > 0) {
      const nonTrumpWins = winning.filter(c => !isTrump(c))
      if (nonTrumpWins.length > 0) return lowestCard(nonTrumpWins).id

      const playedIds = new Set(currentTrick.map(p => p.userId))
      const allPlayerIds = Object.keys(view.hands)
      const opponentsRemaining = allPlayerIds.filter(id =>
        !playedIds.has(id) && id !== userId && id !== picker && id !== partner
      ).length

      if (ledSuit === 'T') {
        if (opponentsRemaining === 0) return cheapestWinningTrump(winning).id
        return highestTrump(winning).id
      }

      if (userId === picker) return highestTrump(winning).id

      const myTrumpCount = realCards.filter(c => isTrump(c)).length
      if (myTrumpCount > 1) return highestTrump(winning).id

      const pickerCurrentlyWinning = currentWinner(currentTrick)?.userId === picker
      if (pickerCurrentlyWinning && opponentsRemaining === 0) return lowestCard(realCards).id
      return highestTrump(winning).id
    }
```

- [ ] **Step 4: Run Scenario 2 tests to verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "fail trick, bot void"
```

Expected: all 4 passing.

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add shared/botStrategy.js shared/gameEngine.test.js
git commit -m "feat: picker team plays strongest trump to gain lead on void fail tricks"
```
