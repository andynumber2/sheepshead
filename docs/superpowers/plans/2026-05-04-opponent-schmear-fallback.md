# Opponent Bot Schmear Fallback Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "schmear anyway" unsafe fallback in the opponent bot's following logic with a tiered decision: trump in with cheapest winning trump when void, otherwise play lowest non-trump.

**Architecture:** All changes are in `shared/botStrategy.js` in the opponent-following section (~lines 495–508). Two new branches replace the `schmearOpp()` unsafe fallback call: (1) void in led fail with winning trump → `lowestCard(winningTrump)`; (2) all other cases → `lowestCard(nonTrump)`. The `#163` fall-through for `calledSuitLedUnrevealed` is preserved unchanged before these new branches.

**Tech Stack:** JavaScript (ES modules), Vitest for tests. Run tests with `npm test` (full suite) or `npx vitest run shared/botStrategy.test.js` (strategy tests only).

---

### Task 1: Write failing tests — case 2 (void in led fail + winning trump → lowest winning trump)

**Files:**
- Modify: `shared/botStrategy.test.js` (append new describe block at end of file)

These tests verify that when the opponent bot is void in the led fail suit and holds trump that can beat the current trick winner, it plays the cheapest such trump rather than schmearing high fail.

- [ ] **Step 1: Append the new test block**

Add at the end of `shared/botStrategy.test.js`:

```js
describe('decidePlay — opponent bot: void in led fail + winning trump → trump in with cheapest winner (#165)', () => {
  // When a confirmed teammate is winning but not safe (picker still to play),
  // and the bot is void in the led suit with trump that can beat the current winner,
  // the bot plays the cheapest winning trump rather than schmearing high fail.

  it('plays cheapest winning trump (not high fail) when void in led fail with pip trump available', () => {
    // u1 leads 9S (spades, fail). Teammate u3 plays KS. Bot u4 void in S.
    // Bot holds 8D (0-pt trump that beats KS) and 10H (10-pt fail from another suit).
    // Picker u2 still to play. Partner deduced by recrack (u3 recracked → u3 is partner...
    // wait, u3 is opp here). Let's use: ace call on hearts, u5 recracked → u5 is partner.
    // u4 deduced: u1 cracked, u5 recracked → u5 is partner; u1, u3, u4 are opponents.
    // u3 (teammate confirmed) wins with KS. u2 (picker) and u5 (partner) still to play.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [],
        u3: [],
        u4: [
          c('8D', 'D', '8'),   // trump, 0 pts — beats KS (trump > fail)
          c('10H', 'H', '10'), // fail, 10 pts
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9S', 'S', '9') },
        { userId: 'u3', card: c('KS', 'S', 'K') },
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
      crackerId: 'u1',     // u1 cracked
      recrackerId: 'u5',   // u5 recracked → u5 is partner (picker team)
      isLeaster: false,
      lastTrick: [],
    }
    // u5 recracked → u5 is partner (picker team). u1 cracked → confirmed non-partner.
    // u3 is current winner → confirmed teammate.
    // Threats: u2 (picker) + u5 (partner, deduced via recrack) still to play → not safe.
    // winningTrump = [8D] (beats KS, not guaranteed). cheapestGuaranteedWin = null.
    // Case 2: play lowestCard([8D]) = 8D, not 10H (old schmear).
    expect(decidePlay(view, 'u4')).toBe('8D')
  })

  it('plays cheapest winning trump when teammate is winning with trump (not only fail)', () => {
    // u1 leads 9S. Teammate u3 trumps in with 7D (lowest trump). Bot u4 void in S.
    // Bot holds 9D (0-pt trump, beats 7D) and KH (4-pt fail).
    // Picker u2 and partner (deduced u5) still to play.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [],
        u3: [],
        u4: [
          c('9D', 'D', '9'),  // trump, 0 pts, beats 7D
          c('KH', 'H', 'K'),  // fail, 4 pts
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9S', 'S', '9') },
        { userId: 'u3', card: c('7D', 'D', '7') },
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
      crackerId: 'u1',
      recrackerId: 'u5',
      isLeaster: false,
      lastTrick: [],
    }
    // u3 winning with 7D (trump). 9D beats 7D. Not guaranteed (picker has higher trump).
    // Case 2: play 9D, not KH.
    expect(decidePlay(view, 'u4')).toBe('9D')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run shared/botStrategy.test.js
```

Expected: the two new tests FAIL (currently the code schmears instead of trumping in).

---

### Task 2: Write failing tests — case 3 (unsafe fallback → lowest non-trump, not schmear)

**Files:**
- Modify: `shared/botStrategy.test.js` (append after Task 1's describe block)

These tests verify that in all remaining unsafe cases (must-follow fail, void with non-winning trump), the bot plays lowest non-trump rather than schmearing A/10/K.

- [ ] **Step 1: Append the new test block**

Add after the Task 1 block:

```js
describe('decidePlay — opponent bot: unsafe fallback plays lowest non-trump, not schmear (#165)', () => {

  it('plays lowest fail (not A) when must-follow in led suit and teammate winning unsafe', () => {
    // u1 leads 9H (hearts, fail). Teammate u3 plays KH. Bot u4 must follow hearts.
    // Bot holds AH (11 pts) and 7H (0 pts). Picker u2 and deduced partner u5 still to play.
    // Old: schmear AH. New: play 7H.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [],
        u3: [],
        u4: [
          c('AH', 'H', 'A'),  // must-follow, 11 pts
          c('7H', 'H', '7'),  // must-follow, 0 pts
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9H', 'H', '9') },
        { userId: 'u3', card: c('KH', 'H', 'K') },
      ],
      tricks: [],
      picker: 'u2',
      partner: null,
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'S',      // called suit is spades — hearts lead is NOT a called-suit lead
      calledAce: { aceId: 'AS' },
      calledTen: null,
      calledKing: null,
      crackerId: 'u1',
      recrackerId: 'u5',    // u5 is partner (picker team)
      isLeaster: false,
      lastTrick: [],
    }
    // KH is not a guaranteed winner (picker can trump). u5 still to play.
    // Bot must follow hearts → realCards = [AH, 7H]. No trump in realCards.
    // Case 2 doesn't fire (no trump in realCards). Case 3: lowest non-trump = 7H.
    expect(decidePlay(view, 'u4')).toBe('7H')
  })

  it('plays lowest non-trump from another suit when void in led fail but no winning trump', () => {
    // u1 leads 9S. Teammate u3 trumps in with JC (near-top trump). Bot u4 void in S.
    // Bot holds 7D (lowest trump, cannot beat JC) and 7H (0-pt fail from another suit).
    // Old: schmear 7H (no high fail, falls to lowestCard anyway) — this tests the point
    // that even if a high fail like KH were present, case 3 plays lowest non-trump.
    // Use KH instead of 7H to demonstrate old vs new clearly.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [],
        u3: [],
        u4: [
          c('7D', 'D', '7'),  // trump, 0 pts — but does NOT beat JC
          c('KH', 'H', 'K'),  // fail, 4 pts
          c('7H', 'H', '7'),  // fail, 0 pts
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9S', 'S', '9') },
        { userId: 'u3', card: c('JC', 'C', 'J') },
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
      crackerId: 'u1',
      recrackerId: 'u5',
      isLeaster: false,
      lastTrick: [],
    }
    // JC is second-strongest trump. 7D (rank 13) cannot beat JC (rank 2). winningTrump = [].
    // Case 2 doesn't fire. Case 3: nonTrump = [KH, 7H]. lowestCard = 7H (0 pts). 
    expect(decidePlay(view, 'u4')).toBe('7H')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run shared/botStrategy.test.js
```

Expected: the two new case-3 tests FAIL (the must-follow test may or may not fail depending on current behaviour; verify both).

---

### Task 3: Update existing test whose expected value changes under #165

**Files:**
- Modify: `shared/botStrategy.test.js` (~line 226)

The "schmears 10S onto opp2 trump-in" test documents old unsafe-schmear behaviour that #165 intentionally removes. Update it to reflect the new expected play.

- [ ] **Step 1: Find the test**

It is in the describe block starting around line 226:
```
describe('decidePlay — opponent schmears via deduced partner from elimination', () => {
  it('schmears 10S onto opp2 trump-in when partner is deduced by elimination', () => {
```

- [ ] **Step 2: Update the test description and expected value**

Change the `it(...)` description and `expect(...)`:

```js
// Before:
it('schmears 10S onto opp2 trump-in when partner is deduced by elimination', () => {
  // ...
  // Expected: schmear 10S (highest fail) onto QC.
  // ...
  expect(decidePlay(view, 'u4')).toBe('10S')
})

// After:
it('plays lowest non-trump (not high fail) when void in led suit, no winning trump, partner deduced by elimination (#165)', () => {
  // 5 seats: u1=opp1 (led KH), u2=picker, u3=opp2 (trumped in QC), u4=bot (opp3),
  // u5=partner (still to play, holds AH). Ace call on hearts.
  // u4 is void in hearts, holds [10S, 9S, 8C, 7C, AD].
  // Deductions: u1 played non-called → not partner; u3 played non-called → not partner;
  //             u2 is picker. So u5 is partner (deduced by elimination), u3 is teammate.
  // u3 won with QC (trump). u4's AD (rank 8) does NOT beat QC (rank 7). winningTrump = [].
  // Old (#165 pre-fix): schmear 10S (highest fail).
  // New: case 3 fires → lowest non-trump. nonTrump = [10S, 9S, 8C, 7C]. lowestCard = 9S.
  expect(decidePlay(view, 'u4')).toBe('9S')
})
```

Leave the view object unchanged — only the `it(...)` string, the comment block above `expect`, and the `expect(...)` itself change.

- [ ] **Step 3: Run to confirm this test now fails (expected '9S', getting '10S')**

```
npx vitest run shared/botStrategy.test.js
```

Expected: this test fails with "expected '10S' to be '9S'".

---

### Task 4: Implement the code change

**Files:**
- Modify: `shared/botStrategy.js` (~lines 495–508)

Replace the current fallback block (the `calledSuitLedUnrevealed` guard and `schmearOpp()` call) with the tiered decision.

- [ ] **Step 1: Replace the fallback block**

Find this block in `shared/botStrategy.js` (starting around line 495):

```js
      // Predicted-win override (#163): when the called suit was led by a fellow
      // opponent, the called card has not yet been played this trick
      // (`partnerRevealed` engine flag), and no trump has been played in this
      // trick, the picker-team partner is forced to play the called card later
      // this trick and will overtake any current fail-suit winner. Schmearing
      // high points to the current leader just donates them to the picker team.
      // Fall through to the predicted-win trump-in branch below (which trumps
      // in via the trump schmear priority, or returns the lowest card if no
      // trump is held).
      const calledSuitLedUnrevealed = !view.partnerRevealed && !!view.calledSuit && ledSuit === view.calledSuit
      if (!(calledSuitLedUnrevealed && noTrumpPlayedYet)) {
        return schmearOpp()
      }
      // else fall through to predicted-win / lead-back branches below
```

Replace it with:

```js
      // #163: called suit led + partner forced to play called card + no trump yet →
      // fall through to trump-in branch (guaranteed win; pickBySchmearPriority applies).
      const calledSuitLedUnrevealed = !view.partnerRevealed && !!view.calledSuit && ledSuit === view.calledSuit
      if (calledSuitLedUnrevealed && noTrumpPlayedYet) {
        // fall through to predicted-win / lead-back branches below
      } else {
        // #165 case 2: void in led fail + winning trump available → trump in with cheapest winner.
        // Forces picker to spend more trump or steals the trick outright.
        const voidInFail = !isTrump(currentTrick[0].card) && realCards.some(c => isTrump(c))
        if (voidInFail) {
          const winningTrump = realCards.filter(c =>
            isTrump(c) && currentTrick.every(play => beats(c, play.card, ledSuit))
          )
          if (winningTrump.length > 0) return lowestCard(winningTrump).id
        }
        // #165 case 3: universal safe fallback — play lowest non-trump regardless of suit.
        // Do not schmear high-point fail onto a trick the picker team may win.
        const nonTrump = realCards.filter(c => !isTrump(c))
        return nonTrump.length > 0 ? lowestCard(nonTrump).id : lowestCard(realCards).id
      }
```

- [ ] **Step 2: Run the tests**

```
npx vitest run shared/botStrategy.test.js
```

Expected: all tests pass, including the four new ones and the updated elimination test.

- [ ] **Step 3: Run the full test suite**

```
npm test
```

Expected: all tests pass.

---

### Task 5: Update BOTS.md

**Files:**
- Modify: `docs/BOTS.md` (~line 215)

- [ ] **Step 1: Find and replace the final bullet in the "Once teammate is confirmed" block**

Find (around line 215):
```
- Not safe AND above conditions not met → schmear anyway
```

Replace with:
```
- Not safe AND bot void in led fail suit AND has trump that beats current winner → trump in with cheapest winning trump
- Not safe AND all other cases → play lowest non-trump (lowest card if only trump remain); do not schmear
```

- [ ] **Step 2: Verify the surrounding context looks right**

The full "Once teammate is confirmed" block should now read:
```
*Once teammate is confirmed:*
- Safe (no picker or partner remains to play OR teammate's card is guaranteed winner):
  - Fail A/10/K available → dump highest-point fail A/10/K
  - No fail A/10/K → dump trump A/10/K (never J or Q)
  - Neither → play lowest card
- Not safe AND bot can win with a guaranteed card → play lowest-point guaranteed winning card
- Not safe AND picker-team overtake is forced (called suit led AND called card not yet played AND no trump in trick yet) → fall through to trump-in branch
  - Partner is forced to play called card on this trick, overtaking any fail winner; schmearing high points would donate them to the picker team
- Not safe AND bot void in led fail suit AND has trump that beats current winner → trump in with cheapest winning trump
- Not safe AND all other cases → play lowest non-trump (lowest card if only trump remain); do not schmear
```

- [ ] **Step 3: Run full test suite one more time to confirm nothing broke**

```
npm test
```

Expected: all tests pass.

---

### Task 6: Commit

**Files:** All modified files.

- [ ] **Step 1: Stage and commit**

```
git add shared/botStrategy.js shared/botStrategy.test.js docs/BOTS.md
git commit -m "feat(botStrategy): replace unsafe schmear fallback with trump-in / lowest-card (#165)

Opponent bot following: when a confirmed teammate is winning but the trick
is not safe (picker-team threats remain), replace the 'schmear anyway'
fallback with a tiered decision:

- Void in led fail + has winning trump → lowestCard(winningTrump)
- All other unsafe cases → lowest non-trump (or lowest card)

The #163 calledSuitLedUnrevealed fall-through is preserved unchanged.
Updates existing elimination-deduction test whose expected card changed."
```
