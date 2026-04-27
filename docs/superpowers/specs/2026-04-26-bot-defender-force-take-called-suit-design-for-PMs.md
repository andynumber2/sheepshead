# Bot Defender — Force-Take to Enable Called-Suit Lead-Back (PM Spec)

## What We're Building

A new tactic for defender bots (the players opposing the picker on a hand). The change makes them smarter about *when* to take a trick, not just *which card to play*.

## Why

In Sheepshead, leading the **called suit** — the suit the picker has named when finding a partner — is one of the most powerful plays the defending team has. The first time the called suit is led, the partner is **forced** to play the called card, which reveals their identity to the entire table. Once the defenders know who the partner is, their coordination improves dramatically for the rest of the hand.

There are two halves to this play. First, a defender has to **earn the lead** by winning a trick. Then, on the next trick, that defender leads the called suit. The bots already know how to do the second half: when an opponent bot leads with the partner still unrevealed and has a called-suit card in hand, it leads it. What they don't know how to do is the first half — they don't recognize that *taking a trick they could have won* is worth doing specifically so they can perform the lead-back next time.

Today, defender bots default to "play the lowest legal card." That keeps the bot conservative but leaves a real strategic opportunity unrealized: a bot that holds a winning card *and* a called-suit card to follow up is sitting on a two-trick combo and choosing not to play it.

## What Changes

When a defender bot is following a trick, the bot will check for a specific situation:

- The called suit hasn't been led yet (equivalently, the partner hasn't been identified).
- The bot itself holds a card of the called suit (a non-trump one, so it's leadable next turn).
- The bot can win the trick currently in progress.

When all three are true, the bot will attempt to win this trick — even spending a top trump if needed — so it can lead the called suit on the next trick and force the partner reveal. This is a **deliberate trade**: the bot is trading down on this trick (using a stronger card than strictly necessary) to set up the higher-value strategic play on the next trick.

## How the Bot Decides Which Card to Win With

This is where the rule has nuance, and the nuance was the bulk of the design conversation.

### Why two cases?

There are two situations to handle separately, because in one of them the bot can guarantee the win and in the other it can't.

**Case 1: The bot is "void" in the led suit, or the trick is a trump trick.** This means the bot can play trump. Trump beats everything, so the bot can choose to play a high trump and basically guarantee taking the trick.

**Case 2: The bot has to follow a fail suit (not the called suit).** Sheepshead rules say if you have a card of the led suit, you must play it — you can't trump in. The bot can only "win" using cards of the led suit. This is a weaker position because *any other player still to play* might be void in that suit themselves and could trump over the bot's high fail card.

### How many threats are still to play?

The bot also looks at how many players are still to play in the trick after it. With the partner unrevealed, the bot has to assume any of those remaining players could be the partner — i.e. on the picker's team — and treat each of them as a potential threat that could overtake the trick.

### The four sub-decisions

Combining the two cases above with whether any potential threats remain to play, we get four combinations:

1. **Bot can play trump, threats remain.** Take the trick with the **highest trump** available. This maximizes the chance of holding the win even if a threat trumps over.

2. **Bot can play trump, no threats remain (the bot is last to play, or only confirmed teammates are left).** Take the trick with the cheapest "schmear-friendly" card from a fixed priority list — see below.

3. **Bot must follow a fail suit, threats remain.** **Skip the strategy.** A potential opponent who is void could trump over the bot's high fail and win the trick anyway, wasting the bot's strong card for nothing. Fall back to the default play (lowest card).

4. **Bot must follow a fail suit, no threats remain.** Take the trick using the priority list for fail cards.

### The "schmear-self" priority list

When the bot is *guaranteed* to win the trick (case 2 and case 4 above), it should use this opportunity to dump a high-point card into its own pile rather than waste a tactically valuable card. The order is **rank-based**, not points-based, because raw card points and "how strong is this card to keep" point in different directions. (The Queen, for example, is worth only 3 points, but it's the strongest trump in the game — you don't want to throw it away for 3 points.)

The priority order, played first-to-last:

- **For trump:** Ace, then 10, then King, then 9, 8, 7, then Jack, then Queen.
- **For fail:** Ace, then 10, then King, then 9, 8, 7.

Rationale: cash the high-point cards (Ace = 11 points, 10 = 10 points, King = 4 points) first, then the zero-point middle cards, then the tactically valuable Jacks and Queens last — keeping the strongest trump in reserve as long as possible.

When two cards in the same rank could be played (only possible for Jacks and Queens, since each suit has one), play the **weakest** version. Among Queens, the Queen of Diamonds is weakest in trump rank, then Hearts, then Spades, then Clubs. Same idea for Jacks.

### "Always take" rule

In the no-threats-remaining cases, the bot **always** takes the trick using the priority list — even if that means spending a Queen. The strategic value of leading the called suit back the very first time it can be led is high enough to justify spending a top trump. This was a deliberate decision during design: don't add a "but only if the cost is reasonable" clause, because the lead-back is too valuable.

## What's Already Done vs. What's New

**Already in place:** When a defender bot is on lead and the partner hasn't been revealed yet, the bot already leads the called suit. So the lead-back half of this strategy works automatically — once the bot wins a trick under the new rule, it will lead the called suit next turn without any additional changes.

**New work:** Only the trick-following decision logic. A new branch in the bot's "what to play when following a trick" decision, plus one small helper function for the schmear-self priority list, plus tests, plus an update to the bot's plain-English documentation.

## Bonus Cleanup: Schmear Logic Consolidation

There is existing bot logic for a related-but-different play called **"schmear"** — when a teammate has already won a trick, the bot dumps a high-point card to give them more points. Today, the schmear logic is duplicated in two places (one for picker-team bots, one for defender bots), and both implement essentially the same rule: pick the highest-points non-trump card from your hand.

The new "schmear-self" logic for the trick-winning case turns out to be a generalization of the existing schmear logic — for the **fail-suit case**, the new priority list and the existing rule produce the same result. So as part of this change, we will:

1. Extract the new priority-list logic into a shared helper.
2. Replace both existing schmear sites to call that helper.
3. While we're at it, give the existing schmear a small strategic upgrade: when the bot has multiple non-trump cards of the same rank in different suits (e.g., the Ace of Spades and the Ace of Clubs both in hand), prefer the one in the **shortest non-trump suit** — moving the bot toward voiding a suit, which is strategically valuable.

This is a small intentional behavior change to existing schmear, called out so it's not a surprise.

## Out of Scope

- Behavior changes after the partner has been revealed.
- Any UI work to surface bot reasoning. (One reason the new helper is being placed in the bot inference module rather than a private location is that future debug/replay UI work may surface inference primitives — but that work is not happening here.)

## Success Criteria

- Defender bots holding a winning card and a leadable called-suit card now take the trick and lead the called suit next turn.
- The "always take" rule fires even when the only winning card is the top trump.
- The "skip" rule fires correctly when the bot must follow a fail suit and any threat remains, preventing wasted high cards.
- All existing automated tests continue to pass; new tests cover every branch of the decision table.
- The plain-English bot documentation in `docs/BOTS.md` is updated to match.
