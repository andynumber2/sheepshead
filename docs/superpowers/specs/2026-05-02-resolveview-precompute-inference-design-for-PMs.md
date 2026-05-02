# Pre-compute Shared Inference State in resolveView (Issue #176)

## What We're Building

Every time a bot makes a play decision, it currently re-calculates the same four pieces of information — who the partner likely is, which players can't follow trump, which players can't follow non-trump suits, and how much trump is left — on every branch of a 400-line decision function. Some of these calculations are repeated 5–7 times in a single decision.

This work pre-computes all four results once, upfront, and makes them available as simple property reads throughout the rest of the decision logic.

## Why It Matters

**Efficiency:** In late-game scenarios (5+ tricks played), each inference helper scans the full trick history. Pre-computing reduces approximately 14–15 trick-history scans per play decision to one scan each. The absolute time savings are small, but the savings compound as bot strategy grows more sophisticated.

**Code clarity:** The `decidePlay` function is already ~400 lines. Removing 10+ scattered inference calls and replacing them with property lookups makes the decision logic significantly easier to read and audit. Intent becomes clearer when a condition reads `rv.resolvedPartner !== null` instead of `deducedPartner(rv, userId) !== null`.

**Future strategy improvements:** Currently, adding an inference check at a new decision point inside `decidePlay` implicitly adds a full trick-history scan. That cost discourages using these signals in more places. Once pre-computed, they are free to read anywhere — which opens the door to richer bot decisions without architectural friction.

## What Changes

A single function, `resolveView`, acts as the bot's "prepare to think" step. It already pre-computes one field (card locations from blitz declarations, added in a prior release). This work adds four more:

- **Who the partner likely is** — computed once via elimination logic instead of 4–5 times during the decision
- **Which players have no trump left** — computed once instead of being re-derived inside every guaranteed-winner check
- **Which players can't follow specific non-trump suits** — computed once instead of twice in leading-play branches
- **How much trump remains elsewhere** — computed once instead of multiple inline calls

All existing helper functions remain unchanged and available. This is purely an architectural improvement — bot decision-making behavior is identical.

## What Does Not Change

- Bot play decisions — no strategy logic is altered
- Game rules or scoring
- Any UI or player-facing behavior

## Out of Scope

- Expanding what the bot *knows* from inference (e.g., using crack/recrack patterns to deduce card locations) — tracked separately in issue #180
- Cleanup of the inference module's public API — tracked separately in issue #181

## Success Criteria

1. All existing bot strategy tests continue to pass without modification
2. Two new tests verify that `resolveView` correctly wires the pre-computed fields
3. Bot documentation (`docs/BOTS.md`) is updated to reflect the new output shape of `resolveView`
