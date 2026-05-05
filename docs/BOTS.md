# BOTS.md

This file describes the bot's decision-making strategy in plain English.
It is kept in sync with `shared/botStrategy.js` and `shared/botInference.js`.
Each branch is written in conditions-first bullet format: trigger condition → action, with rationale in indented sub-bullets only. Maintain that format when adding or updating sections.

---

## Overview

Bots operate only on their own player view — they can see their own hand, all played cards, and known game state (picker, partner if revealed, called suit, etc.). They cannot see opponents' hands.

---

## Pick Decision (`decidePick`)

The bot picks if **all** of the following hold:

- Trump-count floor: hand contains ≥ 3 trump cards
- Hand score ≥ position-aware threshold: `handScore(hand) ≥ base − discount × passesSoFar`

Both bot decisions and the human pick-suggestion go through this single function.

### Hand Score Formula

```
handScore = (schwanzer points) × 4.4
          + 1.1 × (count of non-trump aces)
          + 1   × (count of non-trump tens)
          + 2   if the Queen of Clubs is held
```

- **Schwanzer points** (Queen=3, Jack=2, non-Q-non-J diamond=1, else=0) — strongest signal of trump quality
- **Queen of Clubs bonus** (+2) — QC is the highest card in the deck and never loses a trump fight
- **Non-trump aces and tens** — capture point density in fail; Ace and Ten of Diamonds are trump, not fail (they contribute via schwanzer points)

### Position-Aware Threshold

The threshold drops by 2 for each seat that has already passed:

| Seat in pick order | Threshold |
|---|---|
| 1 (first to act) | 35 |
| 2 | 33 |
| 3 | 31 |
| 4 | 29 |
| 5 (last) | 27 |

- Each preceding pass is evidence that remaining hands are weaker
- Calibrated against an offline Monte Carlo simulator targeting ~15% Leaster/Schwanzer rate

### Hard Trump-Count Veto

- Hand contains ≤ 2 trump → never pick, regardless of hand score
  - Prevents high-point "all aces, no trump" hands from clearing the threshold

---

## Blitz Decision (`decideBlitz`)

- Hand has ≥ 7 schwanzer points → declare blitz

---

## Bury Decision (`decideBury`)

Priority order:

1. Burying 2 non-trump cards would void a non-trump suit AND the pair is worth > 10 card points combined AND no card is must-hold → bury that pair to void the suit
2. Otherwise → sort non-trump cards to front (by card points descending), bury the top 2 candidates
   - Trump is never buried if avoidable

**Must-hold restriction:**
- Bot holds all three fail aces → no ace may be buried
- Bot holds all three fail aces AND all three fail tens → neither aces nor tens may be buried

---

## Call Decision (`decideCall`)

### Going Alone

- ≥ 6 trump cards AND ≥ 2 queens → go alone
- No valid partner call exists → go alone (fallback)

### Ace Call (`callMode === 'ace'`)

1. **Normal ace call**: suits exist where bot does NOT hold or bury the ace AND holds ≥ 1 fail card of that suit → call the ace of the qualifying suit with the fewest fail cards in hand
   - Fewest fail cards in hand = most likely an opponent holds the ace
2. **Ace-under call**: no normal ace call possible AND suits exist where bot holds neither the ace nor any fail cards → pick an under card (cheapest non-trump; fall back to cheapest trump) and declare ace-under
3. **Fallback** → go alone

### Ten Call (`callMode === 'ten'`)

- Suits exist where bot does not hold or bury the ten → call the ten of the qualifying suit with the fewest fail cards in hand

### King Call (`callMode === 'king'`)

- Same logic as ten call, but target kings

---

## Play Decision (`decidePlay`)

### Under Card

- Under card is the only legal card → play it

### Leaster

- Always → play lowest-value card
  - Goal is to avoid winning tricks

---

### Leading a Trick

#### Picker-team Bot Leading

- Guaranteed non-trump winner available → play highest-value qualifying card
  - "Guaranteed" = every higher same-suit card is seen AND no opponent can trump it
- Partner holds ≥ 2 trump AND strongest trump is not a guaranteed winner AND partner holds ≥ 1 fail card → lead lowest-point fail card instead of trump
  - Preserves trump for later; exception to default lead-trump rule
- Trump available (and fail-lead exception above did not fire) → lead highest trump
- No trump, bot is partner, last trick had ≤ 3 trump played → lead lowest called-suit card
- No trump, bot is partner, last trick had > 3 trump played → lead lowest-point fail card
- No trump, bot is not partner, safe fail suits available → lead highest-value card among safe suits
  - "Safe" = no opponent known void in that suit from completed trick history
- No trump, not partner, all suits risky → lead highest-value fail card overall
- No non-trump cards → lead lowest card overall

#### Opponent Bot Leading

- Guaranteed non-trump winner available (excluding called card before partner reveal) → play highest-value qualifying card
  - "Guaranteed" = every higher same-suit card is seen AND no opponent can trump it
- Partner not yet deduced AND bot holds ≥ 1 called-suit fail card → lead lowest called-suit card
  - Forces partner to play called card, revealing identity
- Picker-team member known void in a fail suit AND bot holds non-trump, non-called-card cards in that suit → lead lowest qualifying card
  - Draws trump cheaply without gifting points to the picker team
- Otherwise → lead lowest non-trump card
- No non-trump cards → lead lowest card overall

---

### Following a Trick

**Guaranteed winner definition:**
- **Trump card**: every higher-rank trump has been seen (own hand, completed tricks, current trick, visible bury) or is known in a teammate's hand via `knownLocations`
- **Non-trump (fail) card**: every higher same-suit card has been seen AND no opponent can trump it (`trumpRemainingElsewhere − knownTeammateTrump === 0`, or all others are deduced trump-void)

#### Picker-team Bot Following

**Branch 1: Schmear (teammate currently winning)**

- Teammate's win is safe (no non-picker-team opponents remain to play OR teammate's card is guaranteed winner):
  - Fail A/10/K available → dump highest-point fail A/10/K
  - No fail A/10/K → dump trump A/10/K (never J or Q)
  - Neither → play lowest card
- Not safe AND bot is the partner → schmear anyway
  - Partner trusts picker's implied trump strength to handle any overtake
- Not safe AND bot is the picker AND guaranteed-winning card exists among trick-winning cards → play lowest-point such card
- Not safe AND bot is the picker AND no guaranteed winner → play highest winning trump
- Not safe AND bot is the picker AND no winning trump → fall back to schmear

**Branch 2: Win efficiently (no teammate winning, bot can win)**

Non-trump winner available:
- Bot is safe (no opponents remain to play OR best non-trump winner is a guaranteed winner) → play highest-point non-trump winner
- Otherwise → play lowest-point non-trump winner

Only trump can win — trump-led trick:
- No opponents remain to play → play cheapest winning trump
- Guaranteed-winning trump exists → play lowest-point guaranteed-winning trump
- No guaranteed winner → play highest trump

Only trump can win — fail-led trick, bot is picker (void in led suit):
- No opponents remain → use trump schmear priority (A, 10, K, …) to maximize points
- Opponents remain AND guaranteed winners exist → use trump schmear priority from guaranteed set
- Opponents remain AND no guaranteed winner → play highest trump (risk reduction)

Only trump can win — fail-led trick, bot is partner (void in led suit), picker still to play:
- ≥ 2 trump → play highest winning trump
  - Lead-back insurance — trust picker to cover
- Exactly 1 trump AND it is a guaranteed winner → spend it
- Exactly 1 trump AND not guaranteed → play low, defer to picker

Only trump can win — fail-led trick, bot is partner (void in led suit), picker has already played (and isn't winning):
- ≥ 2 trump AND guaranteed winner exists → play lowest-point guaranteed winner
- ≥ 2 trump AND no guaranteed winner → play highest winning trump
- 1 trump → play it

**Branch 3: Can't win**

- Trump-led trick → shed weakest trump (highest rank index; points as tiebreak)
- Fail-led trick → play lowest card

---

#### Opponent Bot Following

**Branch 1: Schmear (confirmed teammate winning)**

*Teammate identity rules:*
- Partner identity deduced (via `deducedPartner`) OR picker went alone → any non-picker winner is a teammate
- Partner still unknown in normal call → cannot confirm teammate → skip schmear branch entirely

*Once teammate is confirmed:*
- Safe (no picker or partner remains to play OR teammate's card is guaranteed winner):
  - Fail A/10/K available → dump highest-point fail A/10/K
  - No fail A/10/K → dump trump A/10/K (never J or Q)
  - Neither → play lowest card
- Not safe AND bot can win with a guaranteed card → play lowest-point guaranteed winning card
- Not safe AND picker-team overtake is forced (called suit led AND called card not yet played AND no trump in trick yet) → fall through to trump-in branch
  - Partner is forced to play called card on this trick, overtaking any fail winner; schmearing high points would donate them to the picker team
- Not safe AND bot void in led fail suit AND has trump that beats current winner → trump in with cheapest winning trump
  - Forces picker to spend a higher trump to retake the trick, or steals the trick outright; preserves premium trump (J/Q) for later
- Not safe AND all other cases → play lowest non-trump (lowest card if only trump remain); do not schmear
  - Prevents donating A/10/K to a trick the picker team may still win

**Branch 2: Force-take for called-suit lead-back**

*All conditions must hold:*
- Partner not yet known
- Current trick is NOT led with called suit
- Bot holds ≥ 1 non-trump called-suit card in hand
- Bot can take the current trick

*Potential opponents remaining* = count of non-self players still to play this trick
- When partner unknown, all yet-to-play seats are treated as picker-team threats

Bot can play trump (void in led suit OR trump led):
- Opponents remaining > 0 → take with highest trump in winning set
- Opponents remaining = 0 → take with schmear-self trump priority (A, 10, K, 9, 8, 7, J, Q)

Bot must follow non-called fail (only fail winners available):
- Opponents remaining > 0 → skip, fall through to default
  - An unidentified opponent could be void and trump over
- Opponents remaining = 0 → take with schmear-self fail priority (A, 10, K, 9, 8, 7)

**Branch 3: Trump-in (fail led, picker team winning or predicted to win, bot void in led suit)**

- Trump beats current winner → trump in using trump schmear priority (A, 10, K before pips; J/Q reserved) from the set of trump that beat the current winner
- No trump beats current winner → fall through to lowest card

*Predicted-win extension — treat picker team as winning when:*
- Called suit led AND called card not yet played this trick AND no trump played in this trick
  - Partner is forced to play called card, overtaking any called-suit fail winner
  - No-trump guard skips the case where a fellow opponent has already trumped the lead

**Branch 4: Default**

- Trump-led trick → shed weakest trump (highest rank index; points as tiebreak)
- Fail-led trick → play lowest card

---

### Schmear Priority

Used in schmear branches and force-take (0-threats-remaining) cases.

**Trump priority**: A, 10, K, 9, 8, 7, J, Q
- Same letter (J or Q): prefer weakest by trump rank (e.g., QD before QH before QS before QC)

**Fail priority**: A, 10, K, 9, 8, 7
- Same rank across suits: prefer shortest non-trump suit in hand; tiebreak alphabetical

Rationale: cash high-point cards (A=11, 10=10, K=4) first; spend zero-point pips next; preserve tactically valuable Js and Qs.

---

## Inference Helpers (`botInference.js`)

These pure functions support the strategy above but make no decisions themselves.

### Partner Deduction

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
| `knownCardLocations` | Returns `Map<userId, Array<card>>` of card objects known by public announcement to be in a player's hand. Phase 1: blitzes — black blitz → picker holds QC + QS; red blitz → picker holds QH + QD. Phase 2: ten call → picker holds Ace of called suit. Phase 3: king call → picker holds Ace and Ten of called suit. Phase 4: partner known → partner holds called card (Ace/Ten/King). |
| `resolveView` | Pre-computation wrapper called once per play decision in `decidePlay`. Returns the view enriched with: `knownLocations` (card locations from blitz declarations), `resolvedPartner` (inferred partner userId or null — distinct from engine-set `view.partner`), `resolvedTrumpVoids` (Set of userIds with no trump remaining), `resolvedNonTrumpVoids` (map of userId → Set of fail suits they cannot follow), and `resolvedTrumpRemaining` (integer count of trump still held by other players). All downstream inference calls receive the enriched view. |
| `countTrumpPlayed` | Count visible trump in completed tricks and the current trick |
| `trumpRemainingElsewhere` | Estimate trump still held by other players: `14 − own trump − seen trump − buried trump` |
| `handScore` | Combined pick-quality score: `schwanzerPts × 4.4 + 1.1×(non-trump aces) + 1×(non-trump tens) + 2 if QC held` |
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
