# Bot Strategy: Smarter Use of Card Counting

**Date:** 2026-04-18
**Related issues:** #92, #121
**Follow-up scope:** #132

## The Problem

Our bots currently make trump-play decisions using only two pieces of information: how many trump cards have been played in total, and which players have yet to act in the current trick. This is blunt. Two common situations expose its limits:

1. **Wasted trump.** A bot sitting on its last trump will often burn it trying to win a trick that the picker has *already* locked up — because the current rule only recognizes "lock" when there are literally no opponents left to play. It doesn't notice when every trump card that could beat the picker's winning card has already been seen and accounted for.

2. **Counterproductive schmears.** When a bot's teammate is winning a trick, the bot "schmears" (plays its highest-value side card onto the pile) to pack points into the teammate's win. But if an opponent who hasn't played yet could still trump over the teammate, the schmear hands the opponent a big pile of points. The bot never checks for this before schmearing.

Both problems boil down to the same missing question: *given everything I've already seen, can the card currently winning this trick actually be beaten?*

## The Change

The bot gains one new inference: for any card on the table, it can now ask "is there any card left in the deck that could still beat this?" If no such card is unaccounted for, the win is locked. If even one is unseen, the bot assumes an opponent has it and plays defensively.

This single new capability gets wired into several existing decision points:

**Saving the last trump.** The partner bot, holding its final trump while the picker is winning a trick, now checks whether the picker's win is locked by card count. If yes, the partner plays a throwaway card and keeps the trump for later. This extends the current rule — which only kicked in when everyone else had already played — to cover mid-trick situations where the answer is just as certain.

**Smarter schmearing.** Before dumping a points-heavy card onto a teammate's trick, the bot now checks whether the teammate's card is safe from being overtaken. If it is, the schmear proceeds as before. If it isn't, the bot's next move depends on its role:

- **If the bot is the partner** and the picker is the one winning, the bot schmears anyway. The picker picked because they had a strong hand, so the bot trusts the picker to recover if the current trick slips away. Burning trump here is unnecessary worry.
- **If the bot is the picker** and the partner is winning, the bot does not extend the same trust — partners are dealt randomly and may have nothing. Instead, the picker tries to take over the trick with its own trump if it can guarantee a win, and otherwise plays a high trump purely to reduce the risk of losing the trick to an opponent trumping in.
- **Opponent-team bots** follow the same "take over only if guaranteed" logic but without the asymmetry — opponents don't have a role-based strength prior to trust.

**Partner bot when the picker is still to play.** A new situation the old logic didn't address specifically: the partner bot is considering whether to trump in, and the picker hasn't played yet. The partner now leans toward playing low, deferring to the picker's likely trump strength. The exception: if the partner holds two or more trump cards (so they have a "spare" to lead back later if needed), they'll contest the trick aggressively. With only one trump, they only contest if they're sure to win.

**Maximizing point capture.** When a bot is guaranteed to win a trick with a non-trump card (because all trump holders have played or no trump remains outside its hand), it now plays its highest-point winning card instead of its lowest, banking more points into the pile. The conservative "play low to protect against an opponent trumping in" behavior is preserved whenever a trump-in is actually possible.

## The Reasoning

The clearest motivation for building this is that the two tracked issues (#92, #121) both reduce to the same missing check. Implementing the check once and wiring it into both sites — plus two or three adjacent decisions that share the same underlying structural weakness — costs only modestly more than solving either issue alone, and bundles the work into a single coherent shift in how the bot reasons about the current trick.

The role asymmetry in schmear logic reflects a real strategic fact about sheepshead: the picker, by definition, took the hand because they evaluated their cards as strong enough to hold up against the rest of the table. A partner carries no such guarantee. Treating them identically in defensive decisions has been a known source of poor plays.

The "conservative on unseen cards" policy — always assuming an unseen higher trump is in an opponent's hand — is a deliberate simplification. In reality, that trump might be in the partner's hand or face-down in the bury. A more sophisticated inference could distribute probability across those possibilities, but the conservative version is correct wherever it triggers, and the cases where it misses a save are less severe than the cases where an optimistic version would get burned. A future pass can add probability-weighted reasoning.

## What This Does Not Change

- Bot decisions during the picking and calling phases.
- Bot decisions about what suit to call.
- Bot burying strategy.
- Bot decisions while leading a trick (other than the non-trump-win case above, which is technically a following decision).
- Any game-engine rules or UI.

## What Gets Deferred

Several other decisions in the bot codebase could benefit from the same kind of per-card-rank reasoning — precise triggers for cashing an ace, opponent-team decisions about when to trump in on a called suit, and tracking which players are void in which non-trump suits. These are logged under issue #132 for a follow-up pass once the current change is in and we can measure whether it moves bot win rates in the expected direction.
