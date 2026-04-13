# Game Engine Tests Design

**Date:** 2026-04-12
**Issue:** #57

## Goal

Write tests for existing game engine features and update CLAUDE.md to require tests alongside any future game feature work.

## Scope

1. Add tests to `shared/gameEngine.test.js`
2. Update `CLAUDE.md` with a test-writing requirement

Auto-run / CI is out of scope for this iteration.

## Test File Structure

All tests live in a single file: `shared/gameEngine.test.js`, organized into `describe` blocks. The existing `schwanzerCardPoints` and `resolveSchwanzer` blocks remain unchanged; new blocks are added around them.

```
describe('trump helpers')      → isTrump, trumpRank, effectiveSuit
describe('card points')        → cardPoints
describe('dealHand')           → deck composition, hand sizes, blind
describe('pick / pass / blitz')→ phase transitions, error cases
describe('discard')            → card absorption, validation
describe('partner calling')    → callAce, goAlone, callTen, callKing
describe('playCard')           → suit-following rules, trick resolution, winner
describe('computeScores')      → picker win/loss, point thresholds
describe('resolveLeaster')     → winner selection, scoring, tie-break
describe('schwanzerCardPoints')→ (existing)
describe('resolveSchwanzer')   → (existing)
```

## Testing Strategy

**Pure unit tests** for stateless helper functions — single input, assert output, no state construction needed:

- `isTrump` — queens, jacks, and diamonds are trump; other suit cards are not
- `trumpRank` — correct ordering: QC > QS > QH > QD > JC > JS > JH > JD > AD > ... > 7D
- `effectiveSuit` — trump cards return `'D'`; fail cards return their actual suit
- `cardPoints` — A=11, 10=10, K=4, Q=3, J=2, 9/8/7=0

**State-construction tests** for stateful functions — build a minimal `state` object, call the function, assert the resulting state or return value:

- `dealHand` — 5 players each get 6 cards, blind has 2, no duplicate cards in the deck
- `pick` / `pass` / `blitz` — correct phase transitions; errors thrown for wrong phase or wrong player
- `discard` — picker absorbs blind and ends with 6 cards; invalid discard count rejected
- `callAce` — partner suit recorded; calling a suit you hold in hand is rejected
- `goAlone` — no partner assigned; solo modifier set on state
- `callTen` / `callKing` — partner-calling variants set correct state fields
- `playCard` — must follow led suit when able; can play any card when void; trick resolves to correct winner; trump beats fail; higher trump beats lower trump
- `computeScores` — picker with 61+ points wins; picker with ≤30 points loses double; schneider/blitz thresholds applied correctly
- `resolveLeaster` — player with fewest points and at least one trick wins; tie-breaks to correct player; scoring applied

## CLAUDE.md Update

Add to the existing **README Sync** section:

> When implementing any new game feature in `gameEngine.js`, write corresponding tests in `gameEngine.test.js` — unit tests for pure functions, state-construction tests for stateful functions.
