# Opponent Bot Schmear Fallback Rework — PM Spec (#165)

## What Is Being Built

A smarter default decision for the opponent bot when it is watching a teammate win a trick but isn't sure the teammate will hold on.

## Why This Matters

When an opponent bot confirms a teammate is currently winning a trick — but the picker or partner still hasn't played and could overtake — the bot today panics and dumps its highest-value card (an Ace, Ten, or King of a non-trump suit) onto the trick. This is called schmearing: voluntarily handing high-point cards to a teammate so they score those points.

Schmearing is correct when the teammate's win is guaranteed. It is wrong when the trick is still contested. If the picker team overtakes the teammate, every point the bot just dumped goes straight to the opposing team. The bot is essentially gifting the picker team high-value cards under uncertainty.

## What We Are Changing

The "schmear anyway" fallback is replaced with a tiered decision based on what the bot actually holds:

**Tier 1 — Trump in when it counts.** If the bot is void in the led suit (has no cards to follow with) and holds trump that can beat the current trick winner, it plays the cheapest such trump. This forces the picker to spend a higher trump to retake the trick, or lets the bot steal the trick outright. The bot does not waste a high-value trump on this — it plays the minimum trump needed to apply pressure.

**Tier 2 — Stay quiet otherwise.** In all remaining cases — whether the bot must follow suit with low cards, or is void but has no trump that can win — the bot plays its lowest-value card. It does not donate points to a trick it cannot win.

The one exception already in place (from a previous fix) is preserved: when the game's called suit is led and the partner hasn't yet played their forced card, the bot trumps in aggressively because it knows it will win that trick.

## What Is Out of Scope / Deferred

**Case 4 (filed as #204):** A more nuanced situation where the teammate is already winning with low trump and the bot holds a Jack or Queen — the strongest trump cards. Overtaking your own teammate with a Jack or Queen to force the picker to spend premium cards can be the right play, but only when specific conditions are met (the trick has enough points to justify it, and the Jack/Queen actually forces the picker to spend something comparable). This decision is deferred because it requires additional logic to evaluate those conditions. For now, if the cheapest trump available is a Jack or Queen, the bot plays it without applying the extra gates — those gates will be added in #204.

## Success Criteria

- The bot no longer dumps Aces, Tens, or Kings onto contested tricks.
- When void in the led suit with a winning trump, the bot plays the cheapest trump that can take or threaten the trick.
- In all other contested cases, the bot plays its lowest card.
- No change to behaviour when the teammate's win is already guaranteed — the bot still schmears freely in safe positions.
- Existing tests continue to pass; new tests cover each of the new decision branches.
