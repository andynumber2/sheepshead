# Bot Defender — Force-Take to Enable Called-Suit Lead-Back

## Problem

When a defender bot is following a trick early in a hand (before the called suit has been led), it currently plays the lowest legal card by default. This misses a strategically powerful move: take the trick now, then lead the called suit on the next trick to flush out the picker's partner.

The leading-side logic for this play is already in place — at `shared/botStrategy.js:312-318`, an opponent leading with the partner unrevealed already leads the lowest non-trump called-suit card. What is missing is the corresponding **force-take** behavior on the following side: the bot needs to actually win a trick first to earn the next lead.

## Trigger Conditions

The new branch fires only when **all** of the following hold:

1. Bot is on the defense (not picker, not partner). This is guaranteed structurally by being in the opponent-following branch — `isPickerTeam = userId === picker || userId === partner` is already false here, regardless of `partnerRevealed`.
2. Partner is **not yet revealed**. (Equivalent: the called suit has not yet been led — the partner is forced to play the called card whenever the called suit is led, so partner reveal and called-suit-led are equivalent events in normal play.)
3. Bot holds at least one **non-trump** card of the called suit (i.e. has a card to lead back next trick).
4. Bot has at least one card in its legal play set that beats the current trick winner ("can take the trick").
5. The current trick was **not** led with the called suit (the existing trump-in-on-called-suit branch at line 480 handles that case).

If any condition fails, fall through to existing default behavior.

## Decision

Define **`potentialOpponentsRemaining`** = count of players still to play in the current trick, excluding the bot itself. With partner unrevealed, no other defender is confirmed as a teammate, so every yet-to-play seat is treated as a potential picker-team threat.

Behavior splits on (a) whether the bot can play trump (void in led suit, or trump was led) vs. must follow a non-called fail, and (b) `potentialOpponentsRemaining > 0` vs `=== 0`.

| Case | Potential opps remaining | Action |
|---|---|---|
| Void in led suit, or trump led | > 0 | Take with **highest trump** in winning set. Even if an opponent overtrumps, this maximizes the chance of holding the trick. |
| Void in led suit, or trump led | 0 | Take with the first card found in winning set by **trump schmear priority** (see below). |
| Must-follow non-called fail, has winners in that fail | > 0 | **Skip** — opponent could be void in led suit and trump over. Fall through to default lowest card. |
| Must-follow non-called fail, has winners in that fail | 0 | Take with the first card found in winning set by **fail schmear priority** (see below). |

### Schmear-self priority order

The principle: when guaranteed to win the trick, "schmear to self" — cash high-point cards while keeping your strongest trump as residual control. The order is **rank-based**, not points-based, because points (K=4 vs Q=3) and game-strength (Q is the top trump) point in opposite directions and we want to keep strength in reserve.

**Trump priority** (used when winning set is trump): `A, 10, K, 9, 8, 7, J, Q`

**Fail priority** (used when winning set is fail in led suit): `A, 10, K, 9, 8, 7`

For each rank in priority order, pick any winning card of that rank and return it. Since A/10/K/9/8/7 each have only one trump representative (the diamond version), within-rank tiebreak only matters for J and Q. The tiebreak rule:

- **Within a trump rank, prefer the weakest by trump rank order.** Among Q's: Q♦, then Q♥, then Q♠, then Q♣. Among J's: J♦, then J♥, then J♠, then J♣. (Reasoning: dump the weakest member first; keep your absolute top trump in reserve.)

For fail priority, the winning set is restricted to the led-suit cards, so all candidates share a suit and no within-rank tiebreak is needed.

### Always take, even at high cost

In the 0-opps-remaining cases, the bot **must** take the trick using the priority list — even if the only winning card is a Q. The strategic value of leading the called suit back the first time is high enough to justify spending a top trump.

## Code Placement

A new branch in `decidePlay`'s opponent-following section in `shared/botStrategy.js`, inserted **between** the existing schmear-on-confirmed-teammate block (around line 449) and the existing trump-in-on-called-suit block (around line 480).

Ordering rationale:

1. **Schmear on confirmed teammate** (existing) — only fires when partner is revealed; the new branch requires partner unrevealed, so they never co-fire.
2. **NEW: force-take to enable called-suit lead-back**.
3. **Trump-in on called-suit-led trick** (existing) — fires only when the current trick was led with the called suit; the new branch is gated to non-called-suit-led tricks, so they never co-fire.
4. **Default lowest card** (existing) — unchanged.

The new branch is therefore independent of every existing branch in the opponent-following section.

## Lead-Back

No changes needed. The existing leading logic at `shared/botStrategy.js:312-318` already leads the lowest non-trump called-suit card when an opponent bot leads with `partnerRevealed === false`. After the new force-take wins the trick, the bot will be on lead next trick and will execute this existing behavior.

## New Helper

A single new pure helper in `shared/botInference.js`:

`pickBySchmearPriority(candidates, kind, hand)` where `kind ∈ {'trump', 'fail'}` and `hand` is the bot's full hand of remaining cards.

- Walks the appropriate rank-priority list (`A, 10, K, 9, 8, 7, J, Q` for trump; `A, 10, K, 9, 8, 7` for fail).
- For each rank, finds candidates in `candidates` matching that rank.
- If multiple candidates share the rank, applies the within-rank tiebreak rule for that `kind` (see below).
- Returns `null` if `candidates` is empty or contains no card of any priority-list rank.

### Within-rank tiebreaks

- **`kind: 'trump'`** → return the **weakest by trump rank**. Among Q's: Q♦ < Q♥ < Q♠ < Q♣. Among J's: J♦ < J♥ < J♠ < J♣. Reasoning: dump the weakest member of the rank first; keep the absolute top trump in reserve. (For other ranks in the trump priority list, only one card exists per rank since the diamond is the only trump representative — A♦, 10♦, K♦, 9♦, 8♦, 7♦ — so no tiebreak is reachable.)
- **`kind: 'fail'`** → return the card whose **suit is shortest in `hand`** (counting non-trump cards only). Reasoning: voiding a non-trump suit is strategically valuable (enables future trump-ins). Move toward voiding by playing from the shortest suit you hold.
  - Secondary tiebreak (multiple suits tied for shortest length, each contributing a card of the target rank): pick deterministically by suit alphabetical order. This is a degenerate case that rarely arises and the deeper choice has minimal strategic weight.

### Placement rationale

In `botInference.js` rather than as a file-local helper in `botStrategy.js` because (a) it's a pure card-selection primitive in the same family as `cheapestGuaranteedWin` and `cheapestWinningTrump`, and (b) future debug/replay UI work may surface inference primitives, and consistent placement makes that easier.

## Refactor: existing schmear closures

The two existing closures `schmear()` (line 333) and `schmearOpp()` (line 450) currently use `highestValueCard(nonTrump)` to pick the highest-points non-trump card from the bot's hand, falling back to `lowestCard(realCards)` when no non-trump exists.

The fail-priority list (`A, 10, K, 9, 8, 7`) is exactly the highest-points-first ordering for non-trump cards (A=11, 10=10, K=4, 9/8/7=0). Calling `pickBySchmearPriority(nonTrump, 'fail', realCards)` produces the same ranking, with two improvements:

1. **Defined tiebreak among 0-pointers** (9 vs 8 vs 7 — previously whichever `cardPoints` reduce returned first).
2. **Strategic shortest-suit tiebreak** for same-rank multi-suit candidates (e.g., A♠ vs A♣ when both in hand) — moves the bot toward voiding a suit.

Both existing closures collapse to a single shared form:

```
schmear() = (pickBySchmearPriority(realCards.filter(c => !isTrump(c)), 'fail', realCards)
              ?? lowestCard(realCards)).id
```

Net effect: ~6 lines of duplicated body removed; the new helper has 3 call sites (existing schmear, existing schmearOpp, new branch's 0-opps cases) instead of 2.

### Behavior change disclosure

The refactor introduces a small intentional behavior change to existing schmear:

- When the bot's non-trump hand contains multiple non-trump aces (or 10's, K's, etc.) of different suits, schmear will now pick the one in the **shortest non-trump suit in hand** rather than whatever `highestValueCard` happens to return. This is a deliberate strategic improvement (move toward voiding), not a bug fix.
- Existing tests that depend on the prior tiebreak behavior may need to be updated. The implementation plan should review existing schmear tests and update assertions where they would break.

## Tests

Add cases to the existing bot strategy test file. Required scenarios:

- **Void in led, opps remain → highest trump.** Bot is void in led fail, holds Q♣ and J♦ (both winning), picker still to play. Expect Q♣.
- **Void in led, 0 opps, A♦ in winning set → A♦.** Bot is void, last to play, winning set includes A♦ and a low trump. Expect A♦.
- **Void in led, 0 opps, only Q's in winning set → weakest Q.** Winning set is {Q♥, Q♣}. Expect Q♥.
- **Trump led, 0 opps, K♦ and J♥ both winning → K♦.** K beats J in trump priority.
- **Must-follow fail, opps remain → strategy skipped.** Bot has high spades that would win, but picker still to play. Expect lowest card (default behavior).
- **Must-follow fail, 0 opps, A♠ and K♠ winning → A♠.**
- **Bot has no called-suit non-trump → strategy skipped entirely.** Expect default behavior (lowest card).
- **Partner already revealed → strategy skipped entirely.** Expect default behavior.
- **Bot has no winning cards → strategy skipped entirely.** Expect lowest card.
- **Current trick led with called suit → existing trump-in branch fires, new branch does not.** Verify existing behavior unchanged.

Also add a unit test file (or section) for `pickBySchmearPriority`:

- Trump kind, candidates cover all ranks → returns A♦.
- Trump kind, candidates are {Q♣, Q♦, J♥} → returns J♥ (J before Q in priority).
- Trump kind, candidates are {Q♣, Q♦} → returns Q♦ (weakest Q).
- Fail kind, candidates {A♠, K♠, 8♠}, hand contains those plus other suits → returns A♠.
- Fail kind, candidates {A♠, A♣}, hand has 3 spades and 1 club → returns A♣ (clubs is shorter in hand).
- Fail kind, candidates {A♠, A♣}, hand has 2 spades and 2 clubs → returns A♣ (alphabetical secondary tiebreak).
- Fail kind, candidates {9♠, 9♣}, hand has 1 spade and 3 clubs → returns 9♠ (move toward voiding spades).
- Empty candidates → returns null.

Plus regression / behavior-change tests for refactored existing schmear:

- Existing schmear, hand has {A♠, K♣, 7♥} → picks A♠ (highest-priority rank, only one suit has it). Same result as before.
- Existing schmear, hand has {A♠, A♣}, plus more spades than clubs → now picks A♣ (was: implementation-dependent). Document this as the intended new behavior.
- Existing schmear, hand has only trump → returns lowest card overall (helper returns null, fallback fires). Unchanged.

## Documentation Sync

Update `docs/BOTS.md` "Opponent bot following" section. Add the new branch as item 2 (between current schmear and trump-in-on-called-suit), with prose covering the trigger conditions, the void-vs-must-follow split, the >0 vs 0 opps split, and the schmear-self priority lists.

## Out of Scope

- Adjusting the existing leading logic at line 312-318.
- Adjusting the existing trump-in-on-called-suit branch at line 480.
- Bot debug/replay UI surfaces for inference outputs (mentioned as future motivation for placing the helper in `botInference.js`, but no work here).
- Behavior when `partnerRevealed === true`. Once partner is revealed, the strategy does not apply; existing behavior governs.

## Success Criteria

1. New branch fires only under the five trigger conditions above.
2. Decision table is implemented exactly: highest trump for trump-side >0 opps; priority list for both 0-opps cases; skip-and-fall-through for must-follow-fail >0 opps.
3. Within-rank tiebreak prefers weakest trump rank for J and Q.
4. Lead-back behavior is observed in integration: bot wins trick via new branch → next trick, bot leads called suit (via existing leading logic).
5. All existing tests continue to pass; new tests cover all listed scenarios.
6. `docs/BOTS.md` updated and consistent with code.
7. Existing `schmear()` / `schmearOpp()` closures refactored to call the shared helper; intentional shortest-suit tiebreak documented and tested. No changes to leading logic or trump-in-on-called-suit branch.
