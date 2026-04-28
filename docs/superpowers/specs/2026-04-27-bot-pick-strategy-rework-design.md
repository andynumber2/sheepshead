# Bot Pick Strategy Rework — Design

**Date:** 2026-04-27
**Issue:** [#126](https://github.com/andynumber2/sheepshead/issues/126)
**Follow-up issue (deferred items):** [#157](https://github.com/andynumber2/sheepshead/issues/157)

## Problem

Bot pick decisions trigger far too aggressively. The current rule is `handScore >= 24` where `handScore = schwanzerPts × 4 + buriablePoints`. Across five independent bots, at least one almost always meets this bar, making Leaster and Schwanzer hands functionally unreachable through normal play. This was surfaced during QA of the hand-recap feature.

The fix is **not** a QA escape hatch. The goal is to make the bot's pick decision a more accurate model of competent sheepshead play, with Leaster/Schwanzer occurring as a natural side effect.

## Goals

- Bots pick at a game-theoretically defensible rate.
- Target Leaster/Schwanzer frequency: **~15%** (consistent with real-play observation).
- Single shared decision path for bots and the human pick-suggestion.
- Tunable: thresholds discoverable via offline simulation, not guessed.

## Non-goals

- No admin/debug toggles to force Leaster/Schwanzer (would mask the underlying problem).
- No changes to `decideBlitz`, `decideBury`, `decideCall`, or any play-phase logic.
- No changes to game-engine deal logic or scoring rules.

## Design

### 1. New pick-decision formula

```
handScore =
    schwanzerPts × 4
  + 3 × (count of fail aces in hand)
  + 2 × (count of fail tens in hand)
  + 5 if Queen of Clubs in hand
```

Replaces the current `schwanzerPts × 4 + buriablePoints` formula.

**Why each term:**

- **`schwanzerPts × 4`** is retained. It's a reasonable proxy for trump quality (queens, jacks, diamond pips) and continuity matters — calibration is easier when the base term hasn't moved.
- **`3 × failAces`, `2 × failTens`** replaces `buriablePoints`. The old term overweights buriable cards (a single fail ace = +11 raw card points), letting marginal hands clear the threshold on the strength of one card. The replacement values capture the same signal — non-trump point density — but at a weight closer to actual equity.
- **`+5 if QC held`**. The Queen of Clubs is the highest card in the deck. It cannot lose a trump fight. Today the formula treats QC identically to QD; in reality QC is materially stronger. Five is roughly its equity premium.

### 2. Hard veto: trump-count floor

```
if (trumpCount(hand) <= 2) return false
```

Applied before the score check. With 2 or fewer trump, no hand should pick regardless of fail strength. Real players auto-pass these hands. The rule prevents pathological "all aces, no trump" hands from clearing the threshold.

### 3. Position-aware threshold

```
threshold = BASE − DISCOUNT × passesSoFar
```

Where `passesSoFar` is the number of seats that have already been offered the blind in this hand and passed.

- `BASE` and `DISCOUNT` are constants determined by simulation. Initial values to be calibrated against the 15% target.
- Earlier seats face a higher bar (they have less information; more bots remain who could over-pick them). Later seats face a lower bar.
- This is the single biggest reason bots over-pick today: every bot acts as if it were seat 1 with no information.

The `decidePick` signature changes to accept `passesSoFar` (or to read it from `view`, depending on what's already available — implementation detail for the plan).

### 4. Single shared path

Both bot pick decisions and the human pick-suggestion go through the same `decidePick` function with the same formula and threshold. The suggestion shown to the human is the same play a competent bot would make. Humans can override.

No separate "looser human suggestion" mode. A worse model is not a feature.

### 5. Calibration: Monte Carlo simulator

A new CLI tool at `scripts/simulate-pick.js`, wired to `package.json` as `npm run sim:pick`.

**Inputs (CLI args):**
- `--base <N>` — base threshold
- `--discount <N>` — per-pass discount
- `--hands <N>` — number of synthetic hands to simulate (default 10000)
- `--seed <N>` — optional seed for deterministic runs

**Behaviour:**
- Imports the real `dealHand` and `decidePick` from the production code paths. No re-implementation — what is simulated is what is shipped.
- For each synthetic hand, runs the full pick sequence: each seat in turn evaluates `decidePick` with the running `passesSoFar` count. First true → that seat picks. All-false → no-pick.
- Aggregates: total hands, picks per seat (1–5), no-pick rate, average handScore among picks vs passes.

**Seeding:** the existing `shuffle` uses `Math.random`. To support `--seed`, the simulator will need either an injected RNG or a small `seedrandom`-style replacement local to the simulator. The plan should pick the lightest option; falling back to non-deterministic if `--seed` is omitted is acceptable.

**Why a script, not a test:**
Calibration runs are tuning sessions, not pass/fail. A test that asserted "no-pick rate is in [13%, 17%]" would either be flaky from sample variance or assert a number we don't yet trust. Keep this orthogonal to the test suite.

### 6. Post-ship validation

The `hands.variant` column already records each completed hand's variant. After the change ships, query that table to confirm real-play no-pick rate matches the simulation:

```sql
SELECT variant, COUNT(*)
FROM hands
WHERE completed_at IS NOT NULL
GROUP BY variant;
```

No new telemetry needed. If the live rate diverges materially from 15%, retune `BASE` / `DISCOUNT` and re-ship.

### 7. Documentation sync

`docs/BOTS.md` must be updated to describe the new pick logic accurately, per project convention. The "Pick Decision" section is rewritten to cover: the new formula, the trump-count floor, and the position-aware threshold.

## Out of scope (deferred to issue #157)

- Fail-suit-count term (a refined version of "void bonus" that counts distinct fail suits instead of voids).
- A♦/10♦ context-dependent bonus (only a positive in strong hands; liability in weak ones — not a flat term).
- All-three-fail-aces penalty (too rare to justify a special case in v1).

## Success criteria

1. Simulated no-pick rate with chosen `BASE`/`DISCOUNT` lands within ±2% of the 15% target across ≥10,000 simulated hands.
2. The hard veto correctly rejects all hands with ≤2 trump in the simulator.
3. The QC bonus, fail-ace bonus, and fail-ten bonus are observable in unit tests of the new formula.
4. Bots and the human suggestion produce identical pick decisions for identical inputs.
5. `docs/BOTS.md` matches the implemented logic.
6. Post-ship: real-play no-pick rate (queried from `hands.variant`) lands within ±5% of 15% over the first 100+ completed hands. If not, retune.
