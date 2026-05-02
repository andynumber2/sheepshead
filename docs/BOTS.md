# BOTS.md

This file describes the bot's decision-making strategy in plain English.
It is kept in sync with `shared/botStrategy.js` and `shared/botInference.js`.

---

## Overview

Bots operate only on their own player view — they can see their own hand, all played cards, and known game state (picker, partner if revealed, called suit, etc.). They cannot see opponents' hands.

---

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

The threshold drops by `discount` (currently `2`) for each seat that has already passed in this hand. With the base set to `35`, the per-seat thresholds are:

| Seat in pick order | Threshold |
|---|---|
| 1 (first to act) | 35 |
| 2 | 33 |
| 3 | 31 |
| 4 | 29 |
| 5 (last) | 27 |

This reflects real sheepshead strategy: each preceding pass is evidence that the remaining hands are weaker, so a later seat can pick on a marginally weaker hand. Calibrated against an offline Monte Carlo simulator (`scripts/simulate-pick.mjs`) targeting a ~15% Leaster/Schwanzer rate.

### Hard trump-count veto

If the hand contains 2 or fewer trump, the bot never picks regardless of `handScore`. Real players auto-pass these hands. This veto prevents pathological "all aces, no trump" hands from clearing the threshold.

---

## Blitz Decision (`decideBlitz`)

Only considered when a potential blitz is available. The bot declares blitz if its hand has **7 or more schwanzer points** — indicating a very strong hand.

---

## Bury Decision (`decideBury`)

After picking up the blind, the bot buries 2 cards using this priority:

1. **Void a suit**: If burying 2 non-trump cards can void a non-trump suit and the pair is worth more than 10 card points combined, do that (respecting must-hold restrictions).
2. **Otherwise**: Sort non-trump cards to the front (trump is never buried if avoidable), then by card points descending. Bury the top 2 candidates.

**Must-hold restriction**: If the bot holds all three fail aces, it cannot bury any of them (they must stay in hand for the "ace" call rules). If it also holds all three fail tens, neither aces nor tens can be buried.

---

## Call Decision (`decideCall`)

### Going Alone
The bot goes alone if it has **6 or more trump cards** AND **2 or more queens**. This also serves as the fallback when no valid partner call exists.

### Ace Call (`callMode === 'ace'`)
1. **Normal ace call**: Find suits where the bot does not hold or have buried the ace, and does hold at least one fail card of that suit. Among qualifying suits, pick the one with the fewest fail cards (most likely the opponent holds the ace). Call that suit's ace.
2. **Ace-under call**: If no normal ace call is possible, look for suits where the bot holds neither the ace nor any fail cards of that suit. Pick an under card (cheapest non-trump; fall back to cheapest trump) and declare an ace-under call.
3. **Fallback**: Go alone.

### Ten Call (`callMode === 'ten'`)
Find suits where the bot does not hold or bury the ten. Among qualifying suits, pick the one with the fewest fail cards. Call that suit's ten.

### King Call (`callMode === 'king'`)
Same logic as ten call, but for kings.

---

## Play Decision (`decidePlay`)

### Under Card
If the under card is the only legal card, play it.

### Leaster
Play the **lowest-value card** always, to avoid winning tricks.

### Leading a Trick

#### Picker-team bot leading
1. **Cash any guaranteed non-trump winner** (any rank, not just aces): every higher same-suit card must be accounted for AND no opponent can trump it (all trump exhausted, or every other player is known trump-void). The highest-value qualifying card is played first.
2. **Lead highest trump** to win tricks and accumulate card points. Exception for the **partner** holding 2 or more trump: if the strongest trump is not a guaranteed winner (higher-rank trump may still be in opponents' hands) AND the partner holds at least one fail card, lead the lowest-point fail card instead to preserve trump for later. If the partner has only 1 trump, or no fail cards to defer to, lead trump unconditionally.
3. If no trump, and the bot is the **partner**:
   - If the last trick had 3 or fewer trump played, lead a called-suit card (lowest of that suit).
   - Otherwise, lead the lowest-point fail card.
4. If no trump and not the partner: lead the **highest-value fail card**, avoiding suits where an opponent is known void (they could trump in). Specifically, check which fail suits are **safe** (no opponent is known void in that suit based on completed trick history). If any safe-suit fail cards are available, prefer the highest-value card among them. If all suits are risky, fall back to the highest-value fail card overall.

#### Opponent bot leading
1. **Cash any guaranteed non-trump winner** (excluding the called card, which cannot be led before reveal): every higher same-suit card must be accounted for AND no opponent can trump it (all trump exhausted, or every other player is known trump-void). The highest-value qualifying card is played first.
2. **Lead called suit** (lowest card of that suit) if the partner has not yet been deduced and the bot holds at least one fail card of the called suit. This forces the partner to play their called card, revealing their identity.
3. **Lead into a picker-team void** if the partner identity is known (via crack/recrack/elimination): if a picker-team member (picker or partner) is known to be void in a fail suit and the bot holds non-trump, non-called-card cards in that suit, lead the **lowest-value** card among all qualifying void-suit candidates to draw trump cheaply without gifting points to the picker team.
4. Otherwise, lead the **lowest non-trump card** to avoid burning trump.
5. If no non-trump cards remain, lead the lowest card overall.

### Following a Trick

A recurring concept below is a **guaranteed winner**: a card the bot holds that cannot be beaten by any opponent.

- **Trump card**: every higher-rank trump must have been seen (in own hand, completed tricks, current trick, or visible bury). Any unseen higher trump is treated conservatively as still in an opponent's hand.
- **Non-trump (fail) card**: two conditions must both hold: (1) every same-suit card of higher rank has been seen in the same sources, AND (2) no opponent can trump it — meaning either all 14 trump are accounted for, or every other player is known to be void in trump (they played fail on a trump-led trick in history).

#### Picker-team bot following
1. **Schmear** (teammate is currently winning):
   - First check whether the teammate's win is **safe**: either no non-picker-team opponents remain to play, or the teammate's winning card is itself a guaranteed winner.
   - **Safe**: dump the highest-value non-trump card. If only trump are available, play the lowest card (don't burn trump to schmear).
   - **Not safe, bot is the partner**: schmear anyway. The partner trusts the picker's implied trump strength to clean up any overtake.
   - **Not safe, bot is the picker**: try to secure the trick instead:
     1. If the hand contains a guaranteed-winning card among the cards that would win the trick, play the lowest-point such card.
     2. Else play the highest winning trump as risk reduction.
     3. Else fall back to a normal schmear.
2. **Win the trick efficiently** (no teammate winning, bot can win):
   - Prefer non-trump winners. Default is the lowest-point non-trump winner, but if the bot is safe (no opponents remaining, OR the best non-trump winner is itself a guaranteed winner — every higher same-suit card is accounted for and no opponent can trump in), play the **highest-point** non-trump winner instead — squeeze the trick for everything it's worth.
   - If only trump can win:
     - **Trump-led trick**: if no opponents remain to play, use the cheapest winning trump. Otherwise, if a guaranteed-winning trump is in the winning set, play the lowest-point one; else play the highest trump.
     - **Fail-led trick, bot is the picker** (void in led suit): lowest-point guaranteed-winning trump if any; else highest trump.
     - **Fail-led trick, bot is the partner** (void in led suit): behaviour splits on whether the picker has already played this trick.
       - **Picker still to play**: with 2+ trump, play the highest winning trump (lead-back insurance — trust picker to cover). With exactly 1 trump, spend it only if it's a guaranteed winner; otherwise play low and defer to the picker.
       - **Picker has already played** (and isn't winning — the schmear branch above handles that case): with 2+ trump, play the lowest-point guaranteed winner if any, else the highest winning trump. With 1 trump, play it.
3. **Can't win**: on a trump-led trick, shed the *weakest* trump (highest rank index — least future utility), using points as a secondary tiebreak. On a fail-led trick where no card can win, play the lowest card.

#### Opponent bot following
1. **Schmear** (a confirmed teammate is currently winning):
   - Teammate identity rules: (a) if a partner identity has been deduced from public information, any non-picker-team winner is a teammate; (b) if the **picker went alone** (`goingAlone === true`), any non-picker winner is automatically a teammate (there is no partner to flush out); (c) if the partner is still unknown in a normal call, teammate status cannot be confirmed — skip the schmear branch.

   - **Safe** (no picker or partner remains to play, or the teammate's winning card is itself a guaranteed winner): dump the highest-priority non-trump per the **schmear priority** (see below). If only trump available, play the lowest card.
   - **Not safe**: if the bot can take the trick with a guaranteed-winning card, play the lowest-point such card. Else, if the **picker-team overtake is forced** (called suit led, called card not yet played this trick, no trump played in this trick yet), fall through to the trump-in branch below — the partner's forced called card will overtake any current fail-suit winner, so schmearing high points just donates them to the picker team. Otherwise schmear anyway — no speculative trump burn when a guaranteed takeover isn't available.
2. **Force-take to enable called-suit lead-back**: When the partner is **not yet known** (neither revealed nor deducible), the current trick is **not** led with the called suit, the bot holds **at least one non-trump card of the called suit** in hand (a card that can be led back next trick), and the bot can take the current trick:
   - Compute **potential opponents remaining** = count of non-self players still to play this trick. With partner identity not yet deduced, no other defender is confirmed as a teammate, so every yet-to-play seat is treated as a picker-team threat.
   - **Bot can play trump** (void in led suit, or trump led):
     - Threats remaining > 0 → take with **highest trump** in the winning set.
     - Threats remaining = 0 → take with the schmear-self pick using the **trump priority** (see below).
   - **Bot must follow a non-called fail suit** (only fail winners available):
     - Threats remaining > 0 → **skip** (an unidentified opponent could be void and trump over). Fall through to default.
     - Threats remaining = 0 → take with the schmear-self pick using the **fail priority** (see below).
3. **Trump in to contest a picker-team-winning fail-led trick**: If a fail card was led, the picker team is winning (or *will* win — see the predicted-win extension below), and the bot is void in the led suit, trump in. The picker-team-winning gate naturally excludes the case where another opponent has already trumped in (then a teammate would be winning and the schmear branch above would have fired). Card choice splits on the partner-reveal state:
   - **Partner-revealing called-suit lead** (called suit led and called card not yet played this trick): use the **trump schmear priority** (A, 10, K before pip cards; Js/Qs reserved). The partner is forced to play the called card on this trick, so cashing high trump captures both those points and the partner's high card.
   - **Otherwise**: play the **highest trump that can beat the current winner**. If no trump in hand can beat the current winner (e.g., the picker already played Q♣), fall through to the lowest card — avoid donating high trump to the picker's trick.

   **Predicted-win extension**: when the called suit is led, the called card has not yet been played in this trick (`partnerRevealed` engine flag), and **no trump has been played in this trick**, treat the picker team as if they were already winning. Rationale: the partner is forced to play the called card on this trick, which will take it over any called-suit fail. The partner cannot trump out of the obligation because they must follow the called suit by playing the called card. (Note: in ace calls the called ace is the highest fail card, so the picker team is essentially guaranteed to win the trick. In ten/king calls the partner's forced 10 or K can lose to a higher called-suit fail held by an opponent — see issue #83.) The no-trump guard skips the case where a fellow opponent has already trumped the lead — there the trumpor beats the forced card and the picker team does not win the trick, so the bot should not burn a trump on top. The `pickerTeamWinning` identity check uses `deducedPartner` to gate this behavior.
4. **Otherwise**: on a trump-led trick, shed the *weakest* trump (highest rank index — least future utility). On a fail-led trick, play the lowest card.

**Schmear priority** (used by both the schmear branch above and the force-take branch's 0-threats-remaining cases): walk a rank-priority list and pick the first card found.
- **Trump priority**: A, 10, K, 9, 8, 7, J, Q. Within the same letter (only meaningful for J or Q), prefer the **weakest by trump rank** (e.g. among Qs: Q♦ before Q♥ before Q♠ before Q♣).
- **Fail priority**: A, 10, K, 9, 8, 7. Within the same rank (only meaningful for the schmear branch where the input may span multiple non-trump suits), prefer the card from the **shortest non-trump suit in hand** (move toward voiding); secondary tiebreak by suit alphabetical.

Rationale: cash high-point cards (A=11, 10=10, K=4) first; spend zero-point pip cards next; keep the tactically valuable Js and Qs in reserve.

---

## Inference Helpers (`botInference.js`)

These pure functions support the strategy above but make no decisions themselves.

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
these signals, else `null`. Opponent-bot identity checks consult it for "who
is the partner?" questions; picker-team-bot checks continue to use
`view.partner` directly because that field is unredacted on the picker-team
view. "Has the called card been played?" timing checks (e.g., the predicted-win
extension's no-trump-played gate) continue to use `partnerRevealed` regardless
of bot team.

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
| `isGuaranteedWinner` | Returns true iff a card cannot be beaten by any opponent. For trump: every higher-rank trump has been seen (own hand, played tricks, current trick, visible bury) or is known to be in a teammate's hand via `knownLocations`. For non-trump: every higher same-suit card has been seen AND no opponent can trump (`trumpRemainingElsewhere − knownTeammateTrump === 0` after subtracting known unplayed teammate trump, or all others are deduced trump-void). |
| `cheapestGuaranteedWin` | From a set of candidate cards, returns the lowest-point card that satisfies `isGuaranteedWinner` (tiebreak: weaker trump first). Returns null if none qualify. |
| `pickBySchmearPriority` | Pick the least-painful winning card to spend, walking a rank-priority list (`A,10,K,9,8,7,J,Q` for trump; `A,10,K,9,8,7` for fail). Trump tiebreak: weakest trump rank. Fail tiebreak: shortest non-trump suit in hand, then alphabetical. |
| `knownNonPartners` | Returns the set of userIds known not to be the partner from public information: picker, self (if non-picker-team), cracker, players who played non-called on a called-suit-led trick before the called card was played. |
| `deducedPartner` | Returns the partner's userId if known (`view.partner` set, recrack identifies them, or full elimination via `knownNonPartners`), else `null`. Returns `null` in alone/leaster modes regardless of signals. |
