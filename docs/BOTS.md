# BOTS.md

This file describes the bot's decision-making strategy in plain English.
It is kept in sync with `shared/botStrategy.js` and `shared/botInference.js`.

---

## Overview

Bots operate only on their own player view — they can see their own hand, all played cards, and known game state (picker, partner if revealed, called suit, etc.). They cannot see opponents' hands.

---

## Pick Decision (`decidePick`)

The bot picks if its **hand score** is at least **24**.

Hand score = `(schwanzer points × 4) + buriable points`

- **Schwanzer points**: each card in hand contributes schwanzer card points (queen = 3, jack = 2, trump = 1, ace = 1, ten = 1, etc.)
- **Buriable points**: sum of card points for the top 2 non-trump cards in the hand (0 if fewer than 2 non-trump cards)

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
1. **Cash a fail ace** if opponents are likely trump-exhausted (≤2 trump estimated remaining elsewhere).
2. **Lead highest trump** to win tricks and accumulate card points.
3. If no trump, and the bot is the **partner**:
   - If the last trick had 3 or fewer trump played, lead a called-suit card (lowest of that suit).
   - Otherwise, lead the lowest-point fail card.
4. If no trump and not the partner: lead the **highest-value fail card**.

#### Opponent bot leading
1. **Cash a fail ace** if the picker team has **zero** trump remaining (all 14 trump accounted for in own hand, buried, and played tricks). The fail ace must not be the called card (in practice an opponent never holds the called card, but the code is explicit).
2. **Lead called suit** (lowest card of that suit) if the partner has not yet been revealed and the bot holds at least one fail card of the called suit. This forces the partner to play their called card, revealing their identity.
3. Otherwise, lead the **lowest non-trump card** to avoid burning trump.
4. If no non-trump cards remain, lead the lowest card overall.

### Following a Trick

A recurring concept below is a **guaranteed winner**: a trump card the bot holds such that every higher-rank trump has already been seen (in own hand, completed tricks, current trick, or visible bury). Any unseen higher trump is treated conservatively as still in an opponent's hand. Non-trump cards are never "guaranteed."

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
   - Prefer non-trump winners. Default is the lowest-point non-trump winner, but if the bot is safe from being trumped in (no opponents remaining, OR no trump left elsewhere), play the **highest-point** non-trump winner instead — squeeze the trick for everything it's worth.
   - If only trump can win:
     - **Trump-led trick**: if no opponents remain to play, use the cheapest winning trump. Otherwise, if a guaranteed-winning trump is in the winning set, play the lowest-point one; else play the highest trump.
     - **Fail-led trick, bot is the picker** (void in led suit): lowest-point guaranteed-winning trump if any; else highest trump.
     - **Fail-led trick, bot is the partner** (void in led suit): behaviour splits on whether the picker has already played this trick.
       - **Picker still to play**: with 2+ trump, play the highest winning trump (lead-back insurance — trust picker to cover). With exactly 1 trump, spend it only if it's a guaranteed winner; otherwise play low and defer to the picker.
       - **Picker has already played** (and isn't winning — the schmear branch above handles that case): with 2+ trump, play the lowest-point guaranteed winner if any, else the highest winning trump. With 1 trump, play it.
3. **Can't win**: play the lowest card.

#### Opponent bot following
1. **Schmear** (a confirmed teammate — partner identity must be known — is currently winning):
   - **Safe** (no picker or partner remains to play, or the teammate's winning card is itself a guaranteed winner): dump the highest-priority non-trump per the **schmear priority** (see below). If only trump available, play the lowest card.
   - **Not safe**: if the bot can take the trick with a guaranteed-winning card, play the lowest-point such card. Otherwise schmear anyway — no speculative trump burn when a guaranteed takeover isn't available.
2. **Force-take to enable called-suit lead-back**: When the partner is **not yet revealed**, the current trick is **not** led with the called suit, the bot holds **at least one non-trump card of the called suit** in hand (a card that can be led back next trick), and the bot can take the current trick:
   - Compute **potential opponents remaining** = count of non-self players still to play this trick. With partner unrevealed, no other defender is confirmed as a teammate, so every yet-to-play seat is treated as a picker-team threat.
   - **Bot can play trump** (void in led suit, or trump led):
     - Threats remaining > 0 → take with **highest trump** in the winning set.
     - Threats remaining = 0 → take with the schmear-self pick using the **trump priority** (see below).
   - **Bot must follow a non-called fail suit** (only fail winners available):
     - Threats remaining > 0 → **skip** (an unrevealed opponent could be void and trump over). Fall through to default.
     - Threats remaining = 0 → take with the schmear-self pick using the **fail priority** (see below).
3. **Trump in on called suit**: If the called suit was led and the picker team is currently winning the trick, play the lowest available trump to contest.
4. **Otherwise**: play the lowest card.

**Schmear priority** (used by both the schmear branch above and the force-take branch's 0-threats-remaining cases): walk a rank-priority list and pick the first card found.
- **Trump priority**: A, 10, K, 9, 8, 7, J, Q. Within the same letter (only meaningful for J or Q), prefer the **weakest by trump rank** (e.g. among Qs: Q♦ before Q♥ before Q♠ before Q♣).
- **Fail priority**: A, 10, K, 9, 8, 7. Within the same rank (only meaningful for the schmear branch where the input may span multiple non-trump suits), prefer the card from the **shortest non-trump suit in hand** (move toward voiding); secondary tiebreak by suit alphabetical.

Rationale: cash high-point cards (A=11, 10=10, K=4) first; spend zero-point pip cards next; keep the tactically valuable Js and Qs in reserve.

---

## Inference Helpers (`botInference.js`)

These pure functions support the strategy above but make no decisions themselves.

| Function | Purpose |
|---|---|
| `countTrumpPlayed` | Count visible trump in completed tricks and the current trick |
| `trumpRemainingElsewhere` | Estimate trump still held by other players: `14 − own trump − seen trump − buried trump` |
| `buriablePoints` | Card points of the best 2 non-trump cards for burial |
| `handScore` | Combined pick-quality score: `schwanzerPts × 4 + buriablePoints` |
| `beats` | Returns true if a challenger card beats the current winner given led suit |
| `currentWinner` | Returns the play object currently winning a trick |
| `bestVoidBury` | Finds the best 2-card bury that voids a non-trump suit with ≥11 combined card points |
| `teammateWinning` | Returns true if the current trick leader is on the same team as the bot |
| `isGuaranteedWinner` | For a trump card, returns true iff every higher-rank trump has been seen (own hand, played tricks, current trick, visible bury). Unseen higher trump is treated as opponent-held. Non-trump cards are never guaranteed. |
| `cheapestGuaranteedWin` | From a set of candidate cards, returns the lowest-point card that satisfies `isGuaranteedWinner` (tiebreak: weaker trump first). Returns null if none qualify. |
| `pickBySchmearPriority` | Pick the least-painful winning card to spend, walking a rank-priority list (`A,10,K,9,8,7,J,Q` for trump; `A,10,K,9,8,7` for fail). Trump tiebreak: weakest trump rank. Fail tiebreak: shortest non-trump suit in hand, then alphabetical. |
