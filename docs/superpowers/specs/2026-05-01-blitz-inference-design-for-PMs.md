# Blitz Inference for Bots — PM Design (Issue #150)

## What We're Building

When a player declares a blitz in Sheepshead, they publicly announce which two queens they're holding before play begins. This is public information — all players at the table can see it. Currently the game's bots ignore this announcement entirely.

This feature teaches bots to use blitz declarations to make smarter play decisions.

## Why It Matters

Without this feature, a bot in the "partner" role (on the same team as the picker who blitzed) doesn't realize its teammate is holding those two queens. This leads to suboptimal play: the partner bot may avoid leading a card it should confidently win with, or play defensively when it should commit, simply because it can't reason about cards its teammate publicly declared.

The fix is targeted: we're not overhauling how bots think — we're adding one piece of public knowledge they were previously ignoring.

## What Changes

We're introducing a pre-processing step in the bot's reasoning pipeline called `resolveView`. Before making any play decision, the bot now packages up everything it publicly knows — starting with blitz declarations — into a structured summary. This summary (`knownLocations`) tells the bot which cards are confirmed to be in a specific player's hand, based on public announcements made at the start of the hand.

With this in place, two key improvements follow:

**1. Stronger trump recognition**

A partner bot can now correctly identify cards it holds as guaranteed winners when the missing stronger cards are known to be in a teammate's hand. For example: if the picker declared a black blitz (holding QC + QS), the partner holding QH should recognize QH as the highest trump available to any opponent — because QC and QS are locked in a teammate's hand. Previously the bot would incorrectly assume those queens might be held by an opponent, causing it to undervalue QH.

**2. Safer fail-card leads**

When evaluating whether a non-trump card is safe to lead, the bot discounts trump held by a teammate. If the only unaccounted-for trump is in the picker's hand (and the picker is on the bot's team), there is no opponent trump threat — and the bot now correctly recognizes that.

## Who Benefits

Only **picker-team bots** (specifically the partner) benefit from this change. For opponent-team bots, blitzed queens are in an opponent's hand — the existing logic already treats them correctly as threats.

## Architecture Note: Built for Extension

The `resolveView` wrapper is deliberately designed as a foundation. In a follow-up task (#176), we'll move additional pre-computations (partner identity, trump-void deductions) into this same layer. The bot will get faster and more consistent reasoning across all inference functions, with no change to the external calling interface.

## Out of Scope

- Opponent bot behavior is unchanged.
- No UI changes — this is purely internal bot reasoning.
- Leasters cannot follow a blitz (game rule), so no edge case handling is needed there.
- The #176 pre-computation migration is tracked separately.

## Success Criteria

- The partner bot correctly uses blitz declarations when deciding which cards it can safely lead or commit to winning tricks.
- No change in opponent bot behavior.
- All existing automated tests continue to pass; new tests verify the three main functions added by this feature.
- The bot strategy documentation is updated to reflect the new reasoning layer.
