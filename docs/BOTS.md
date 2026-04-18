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

#### Picker-team bot following
1. **Schmear**: If a teammate is currently winning the trick, dump the highest-value non-trump card on it. If only trump are available, play the lowest card instead (don't burn trump to schmear).
2. **Win the trick efficiently**:
   - Prefer the lowest non-trump winning card.
   - If only trump can win:
     - **Trump-led trick**: if no opponents remain to play, use the cheapest winning trump. Otherwise use the highest trump.
     - **Fail-led trick** (bot is void, playing trump):
       - Picker: always play highest trump.
       - Partner with >1 trump: play highest trump.
       - Partner with exactly 1 trump: play it unless the picker already has the trick locked (picker winning and no opponents left).
3. **Can't win**: play the lowest card.

#### Opponent bot following
1. **Schmear**: If a confirmed teammate is winning the trick (partner identity must be known), dump the highest-value non-trump card. If only trump available, play the lowest card.
2. **Trump in on called suit**: If the called suit was led and the picker team is currently winning the trick, play the lowest available trump to contest.
3. **Otherwise**: play the lowest card.

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
