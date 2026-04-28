# Bot Pick Strategy Rework — PM Summary

**Date:** 2026-04-27
**Issue:** [#126](https://github.com/andynumber2/sheepshead/issues/126)

## What we're changing

How the computer-controlled players decide whether to "pick" — the central commitment in a sheepshead hand, where one player takes on the risk of capturing more than half the points in exchange for the chance to call a partner.

## Why

Today, the bots pick on almost any hand. Across five bots evaluating each hand independently, at least one of them almost always meets the (low) bar for picking. Two consequences:

1. **Two of the game's variants — Leaster and Schwanzer — almost never happen.** These variants only occur when *every* player passes. With our current bots, this is functionally impossible. Real players see these hands sometimes; our players don't.
2. **The bots feel less like skilled opponents.** A confident pick on a weak hand is a losing strategy in real sheepshead, and the bots make this mistake routinely.

The fix is to make the bots' pick decision a more honest model of how a competent human player would decide.

## What "competent picking" actually looks like

A few principles drive a real player's pick decision:

- **Trump count matters most.** With 2 or fewer trump in your hand, you almost never pick — period.
- **Top trumps are not all equal.** The Queen of Clubs in particular is the highest card in the deck and never loses a trump fight. Holding it is meaningfully different from holding any other queen.
- **Position matters.** If three other players have already passed before it's your turn, that tells you something — those hands were weak, so by comparison, your hand is relatively stronger. Real players lower their threshold a bit with each pass that has happened in front of them.
- **Side cards (non-trump aces and tens) help, but not as much as the current formula assumes.** A single ace can capture a lot of points if it survives, but it doesn't always survive. The current logic treats it as if it always does.

We are folding all four of these into the new pick decision.

## What stays the same

- Game rules don't change.
- How the picker buries cards, calls a partner, or plays out tricks doesn't change. This is **only** the pick / pass decision.
- The blitz, partner call, and bury logic are untouched.

## How we know the new logic is right

This kind of change is easy to over-correct (bots that never pick is just as broken as bots that always pick). To avoid guessing, we are building an offline simulator: a small command-line tool that deals tens of thousands of synthetic hands and reports how often a no-pick occurs under any given setting. We tune the parameters until the simulated no-pick rate lands near the **target of ~15%**, which is consistent with how often Leaster/Schwanzer occurs in real human games.

After shipping, we will also check the live game database — every completed hand records its variant, so we can confirm that real play matches the simulation. If it diverges, we retune.

## What's intentionally *not* in this change

Three additional refinements were considered and deferred (logged as a separate follow-up). They are real, but each is either too rare or too context-dependent to justify in a first pass:

- A bonus for being short or void in fail suits.
- Treating the Ace and Ten of Diamonds specially (they are valuable in strong hands and a liability in weak ones — needs more nuance than a flat bonus).
- A penalty for the rare case of holding all three fail aces.

We will revisit these once we see the new logic in action.

## Success criteria

- Simulated no-pick rate lands within ±2% of 15%.
- Real-play no-pick rate (measured after launch from the hands database) lands within ±5% of 15% over the first 100+ completed hands.
- Bots and the human-player suggestion use the same logic — players see the same advice a competent bot would make.
