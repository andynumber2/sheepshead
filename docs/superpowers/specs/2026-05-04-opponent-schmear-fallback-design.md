# Opponent Bot Schmear Fallback Rework (#165)

## Context

When an opponent bot confirms a teammate is winning the current trick but the win is "not safe" (picker or deduced partner still to play and the teammate's card is not a guaranteed winner), the bot today falls through to `schmearOpp()` — which dumps the highest-point non-trump fail (A/10/K) onto the trick. If the picker team then overtakes the teammate, those schmeared points go to the picker team. This is the "schmear anyway" fallback that issue #165 identifies as too aggressive.

The narrow deterministic case (called suit led, partner forced to play called card, no trump yet) was fixed in #163 by falling through to the trump-in branch. This rework generalises that fix.

## Scope

This design covers issues #165 cases 2 and 3. Case 4 (bot overtakes own teammate's low trump using J/Q) is explicitly deferred and filed separately.

## What Changes

The `schmearOpp()` call in the unsafe fallback path (`shared/botStrategy.js`, opponent following section) is replaced with a tiered decision. After the existing safe-schmear check and guaranteed-takeover check, the sequence becomes:

### Check 1 — #163 fall-through (unchanged)
**Condition:** Called suit led AND called card not yet played this trick AND no trump played in this trick yet.

**Action:** Fall through to the trump-in branch below. The picker-team partner is forced to play the called card, which cannot beat trump. The trump-in branch uses `pickBySchmearPriority` to maximise points captured on a guaranteed win.

### Check 2 — Void in led fail with winning trump (new)
**Condition:** Led suit is non-trump AND `realCards` contains trump that beats every card currently in the trick (bot is void in led suit, has trump that can take the trick).

**Action:** Play `lowestCard(winningTrump)` — the cheapest trump that beats the current winner. Rationale: if the picker-team threats were going to overtake the teammate's fail anyway, this either steals the trick outright or forces the picker to spend more trump than they would have needed to beat the fail. Using the cheapest winning trump preserves premium trump (J/Q) for later tricks.

Note: if the cheapest winning trump happens to be J or Q, this still fires. The case 4 issue will introduce gates that evaluate whether burning J/Q is worth it given trick points and picker strength.

### Check 3 — Universal low-card fallback (new, replaces `schmearOpp()`)
**Condition:** Everything else — bot must follow with led-suit fail cards, bot is void with no winning trump, or no other check fired.

**Action:** Play `lowestCard(nonTrump)` from `realCards` if any non-trump exists, else `lowestCard(realCards)`. Do not schmear.

This replaces `schmearOpp(safe=false)` in all remaining unsafe cases, including must-follow scenarios where the bot holds high fail in the led suit. The A/10/K of fail are preserved rather than donated to a trick the picker team may win.

## BOTS.md Update

Replace the final bullet in the "Once teammate is confirmed" block (currently: "Not safe AND above conditions not met → schmear anyway") with:

- Not safe AND bot void in led fail suit AND has trump that beats current winner → trump in with cheapest winning trump
- Not safe AND all other cases → play lowest non-trump (lowest card if only trump remain); do not schmear

## What Is NOT Changing

- Safe schmear path (`teammateSafe = true`) — unchanged, still dumps A/10/K freely.
- Guaranteed-takeover path — unchanged, still plays `cheapestGuaranteedWin`.
- `calledSuitLedUnrevealed` fall-through (#163) — unchanged, still falls to trump-in branch.
- `schmearOpp(safe=true)` — unchanged, used by the safe path only.

## Tests Required

- Teammate winning with fail, bot void in led suit with winning trump + high fail in hand → plays cheapest winning trump (not the high fail)
- Teammate winning with trump, bot void in led suit with winning trump → plays cheapest winning trump
- Teammate winning with high trump, bot void with non-winning trump → plays lowest non-trump from another suit
- Bot must-follow fail (not void), teammate winning unsafe → plays lowest fail in led suit (not A/10/K)
- Regression: `calledSuitLedUnrevealed && noTrumpPlayedYet` still falls through to trump-in branch (existing #163 tests pass)
- Regression: safe schmear still fires when `teammateSafe = true` (existing tests pass)

## Success Criteria

- Bot no longer dumps high-value fail (A/10/K) when a teammate is winning and a picker-team threat remains, unless a guaranteed takeover or safe schmear path applies.
- Void-in-fail-with-winning-trump cases trump in with the cheapest winning trump.
- All other unsafe fallback cases play the lowest available non-trump card.
- BOTS.md updated to match.
- No regressions in existing opponent-following tests.

## Related

- #165 — parent issue
- #163 — narrow fix this generalises (closed)
- #204 — J/Q overtake-own-teammate decision (filed separately, deferred)
