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

`pickBySchmearPriority(winningCards, kind)` where `kind ∈ {'trump', 'fail'}`.

- Walks the appropriate rank-priority list.
- For each rank, finds candidates in `winningCards` matching that rank.
- If multiple candidates exist (only possible for J/Q in the trump case), returns the weakest by trump rank.
- Returns `null` if `winningCards` is empty.

Placed in `botInference.js` rather than as a file-local helper in `botStrategy.js` because (a) it's a pure card-selection primitive in the same family as `cheapestGuaranteedWin` and `cheapestWinningTrump`, and (b) future debug/replay UI work may surface inference primitives, and consistent placement makes that easier.

No refactor of the existing two `schmear()` / `schmearOpp()` closures (lines 333, 450). They implement a different rule (highest-points non-trump for "dump on teammate") and consolidating would force a false generalization. That is out of scope.

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

Also add a small unit test file (or section) for `pickBySchmearPriority`:

- Trump kind, winning set covers all ranks → returns A.
- Trump kind, winning set is {Q♣, Q♦, J♥} → returns J♥ (J before Q in priority).
- Trump kind, winning set is {Q♣, Q♦} → returns Q♦ (weakest Q).
- Fail kind, winning set is {A♠, K♠, 8♠} → returns A♠.
- Empty winning set → returns null.

## Documentation Sync

Update `docs/BOTS.md` "Opponent bot following" section. Add the new branch as item 2 (between current schmear and trump-in-on-called-suit), with prose covering the trigger conditions, the void-vs-must-follow split, the >0 vs 0 opps split, and the schmear-self priority lists.

## Out of Scope

- Refactoring the existing duplicated `schmear()` / `schmearOpp()` closures.
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
7. No changes to existing schmear closures, leading logic, or trump-in-on-called-suit branch.
