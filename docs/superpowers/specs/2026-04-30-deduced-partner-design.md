# Bot Inference — Deduced Partner from Public Information

Tracking issue: [#151](https://github.com/andynumber2/sheepshead/issues/151).

## Problem

Bots currently rely on `view.partner` to identify the partner. `getPlayerView` redacts that field to `null` for non-picker-team players until `partnerRevealed` flips (i.e., until the partner plays the called card). For most of a hand, opponent bots therefore see no partner — `teammateWinning` returns `false`, schmear branches don't fire, and the bots play sub-optimally on what is actually publicly knowable information.

Three signals expose the partner's identity (or rule out candidates) strictly earlier than `partnerRevealed`:

1. **Crack** — only an opponent of the picker may crack (`gameEngine.js:430`). The cracker is not the picker and not the partner.
2. **Recrack** — only the picker or partner may recrack (`gameEngine.js:444`). A non-picker recracker is uniquely the partner.
3. **Called-suit-led elimination** — on a called-suit-led trick before the called card has been played, the partner is forced to play the called card (`gameEngine.js:598-609`). Any seat that plays a non-called card on such a trick cannot be the partner.

This work introduces a deterministic deduction layer in `botInference.js` that combines all three signals, plus consumer-side updates so the bot acts on the deduction.

## Worked Example (Headline Schmear Unlock)

5 seats: `opp1, picker, opp2, opp3 (bot), partner`. Ace call on hearts.

Trick: `opp1` leads `KH`; `picker` plays `7H`; `opp2` plays `QC` (trumps in, void in hearts); bot `opp3` is now acting (void in hearts, holds `10S` and other cards).

Deductions available to `opp3`:
- `opp1` played a non-called card on a called-suit-led trick → not partner.
- `opp2` played a non-called card → not partner.
- `picker` is the picker.
- Therefore the partner is the unplayed seat (seat 5), and `opp2` is a confirmed teammate winning the trick.

`opp3` should schmear `10S` onto `QC`. Today `teammateWinning` returns false (because `view.partner` is null), the schmear branch is skipped, and the bot plays its lowest legal card, leaving the 10 points in hand. After this work the bot schmears correctly.

## Scope

**In scope:**
- New deduction helpers in `shared/botInference.js`.
- New state fields `crackerId` and `recrackerId` in `shared/gameEngine.js`, populated by `crack()` / `recrack()` and exposed unredacted in the player view.
- Consumer updates in `shared/botStrategy.js` and `shared/botInference.js` for every identity check that consumes `view.partner` directly.
- `docs/BOTS.md` updates to describe the new deduction layer and consumer changes.
- Tests at three layers (helper unit tests, engine state-change tests, strategy integration tests).

**Out of scope (tracked elsewhere):**
- Engine-level reveal of the deduced partner to all players in the player view — tracked in [#162](https://github.com/andynumber2/sheepshead/issues/162).
- `pickerTeamWillWin` correctness in ten/king calls (the partner's forced 10/K can lose to a higher called-suit fail) — tracked as a comment on [#83](https://github.com/andynumber2/sheepshead/issues/83).
- Speculative or probabilistic partner inference from play patterns. Only deterministic deductions here.
- Card-counting beyond what `botInference.js` already supports.

## Architecture

A single, narrowly-scoped rule governs all consumer updates:

> **"Who is the partner?"** → use `deducedPartner(view, userId)` (with `view.partner` fallback baked into the helper).
> **"Has the called card been played yet?"** → keep `partnerRevealed`. The forced-play timing is unchanged by deduction.

Engine semantics, `getPlayerView` redaction of `view.partner`, and player-facing UI all remain identical. Only bot decision-making changes.

## New Helpers (`shared/botInference.js`)

### `knownNonPartners(view, userId) → Set<userId>`

Returns the set of player IDs known not to be the partner, derived from public information.

Rules out:
- The picker (always).
- The bot itself, if the bot is not on the picker team — i.e., `view.partner !== userId && view.picker !== userId`. This handles the case where `view.partner` is null (opponent view) but the bot still trivially knows it isn't the partner.
- The cracker, if `view.crackerId` is set.
- Any player who has played a non-called card on a called-suit-led trick before `partnerRevealed` flipped. Computed by scanning `view.tricks` (completed) and `view.currentTrick`: for each trick whose led suit equals `view.calledSuit` and where the called card has not yet been played in that trick, collect the userIds whose plays are non-called cards.

This helper does not consult `view.partner` directly — that resolution lives in `deducedPartner`. It is a pure derivation from public events and is callable independently for any future "is this player known opposition?" check.

### `deducedPartner(view, userId) → userId | null`

Returns the partner's userId if known, else `null`. Resolution order:

1. If `view.partner` is set, return it. (Engine-revealed: `partnerRevealed` flipped, or the bot is on the picker team.)
2. Else if `view.recrackerId` is set and `view.recrackerId !== view.picker`, return `view.recrackerId`. (Direct identification.)
3. Else compute `knownNonPartners(view, userId)`. If it covers exactly 3 of the 4 non-picker seats, return the remaining non-picker seat. (Full elimination.)
4. Else return `null`.

The recrack rule check at step 2 is `recrackerId !== picker` rather than `recrackerId === partner` because `view.partner` may be null at this point. The engine guarantees only the picker or partner can recrack, so a non-picker recracker is the partner by the rules.

### Edge cases

- **Picker goes alone.** When `view.callMode === 'alone'`, there is no partner. `deducedPartner` returns `null` regardless of signals. `knownNonPartners` may still flag players (cracker etc.) but no consumer treats a null partner as a teammate, so behavior is correct without an explicit alone gate. We will still add an explicit alone short-circuit for clarity.
- **Leasters / Schwanzers.** No picker, no partner. Both helpers return `null` / empty set early.
- **Picker recracks** (allowed by the rules — picker recracks against an opponent's crack). `recrackerId === picker` so step 2 doesn't fire; falls through to elimination.
- **`view.partner === userId` (the bot is the partner).** Step 1 returns the bot itself, which is correct.

## Engine State Changes (`shared/gameEngine.js`)

Two new fields on game state, set once and never cleared within a hand.

**Initial state** — added to the literal returned by `dealHand` (`gameEngine.js:105`+, alongside the existing `crackState: null` and `handCrackMultiplier: 1` fields at lines 131-132):

```
crackerId: null,
recrackerId: null,
```

**`crack(state, userId)`**: after `newState.crackState = 'cracked'`, set `newState.crackerId = userId`.

**`recrack(state, userId)`**: after `newState.crackState = 'recracked'`, set `newState.recrackerId = userId`.

**Hand reset.** New hands construct a fresh state via `dealHand` (`gameEngine.js:77`), which returns the initial-state shape. Adding `crackerId: null` and `recrackerId: null` to that returned object initializes both fields per hand. No separate reset path exists — and none needs to.

**`getPlayerView`**: pass through unredacted. The action log already publicizes who cracked and who recracked, so there is no information disclosure beyond what players already see.

**No other engine changes.** Forced-play rules, partner-reveal semantics, and `view.partner` redaction remain identical.

## Consumer Updates (`shared/botStrategy.js` and `shared/botInference.js`)

All five updates change a `view.partner` consultation to use `deducedPartner(view, userId)`. None change a `partnerRevealed` consultation.

### Update 1 — `teammateWinning` (`botInference.js:193`)

Replace the destructured `partner` with `deducedPartner(view, userId)`. The helper's resolution-order step 1 returns `view.partner` when set, so picker-team-bot behavior is unchanged.

### Update 2 — Opponent `threatsRemaining` (`botStrategy.js:482-484`)

The schmear branch in the opponent following section computes "picker-team players still to play" via `id === picker || id === partner`. Switch the `partner` reference to `deducedPartner(view, userId)`. Pre-fix, an opponent bot underestimates threats and may schmear when an unrevealed-but-deducible partner could still overtake; post-fix, the threat count includes the deduced partner.

### Update 3 — `pickerTeamWinning` in predicted-win branch (`botStrategy.js:574`)

Currently: `winner.userId === picker || winner.userId === partner`. Switch to `winner.userId === picker || winner.userId === deducedPartner(view, userId)`. The surrounding `calledSuitLedUnrevealed` (which references `partnerRevealed`) and `noTrumpPlayedYet` gates **stay unchanged** — they govern forced-play timing, which deduction does not affect.

### Update 4 — Lead-called-suit-to-flush gate (`botStrategy.js:332-338`)

Current gate: `!partnerRevealed && calledSuit`. The rationale ("flush an unknown partner") is satisfied once the partner is deduced. New gate: `deducedPartner(view, userId) === null && calledSuit`.

This is a strict tightening: when `partnerRevealed` is true, `view.partner` is set, and `deducedPartner` returns it (non-null), so the new gate matches the old gate's behavior. When `partnerRevealed` is false but the partner is deduced, the new gate skips the flush lead, freeing the bot to make a different (better) lead choice via the existing fallthrough.

### Update 5 — Force-take-for-lead-back gate (`botStrategy.js:506-553`)

Same rationale as Update 4. Switch the `!partnerRevealed` portion of the gate to `deducedPartner(view, userId) === null`. The other gate parts (`!ledThisTrickIsCalled`, `hasCalledSuitFailInHand`) stay unchanged.

### Untouched Identity Checks

The following are *not* changes; called out for sanity:

- Picker-team-bot self-identity checks (`botStrategy.js:287, 293, 309, 374, 441`). `view.partner` is correct on the picker-team view (the partner sees themselves; the picker sees the partner).
- Picker-team `opponentsRemaining` calcs (`botStrategy.js:366, 408, 421`). Same reason — these run inside the `if (isPickerTeam)` branch where `view.partner` is set.
- Predicted-win `calledSuitLedUnrevealed` and `noTrumpPlayedYet` — forced-play timing, stays on `partnerRevealed`.
- Engine forced-play rules in `gameEngine.js`. Deduction does not change game rules.

## Documentation Updates (`docs/BOTS.md`)

Add a section describing the deduction layer (signals, helpers, resolution order). Update the consumer-rule entries that reference `view.partner` semantics. Per the project rule in `CLAUDE.md` ("BOTS Sync"), this must stay in lockstep with the code.

Also fix one pre-existing doc drift the predicted-win extension paragraph claims "the partner (ace call) or the picker (ten/king call) is forced to play the called ace." The picker holds no called card in any mode; the partner is forced in all three modes. Correct the wording while we are in the file.

## Testing Strategy

Three layers, mapped to existing test files. Helper unit tests go into a new `shared/botInference.test.js` (no such file exists today; the inference helpers warrant their own file going forward).

### Layer 1 — Helper unit tests

For `knownNonPartners`:
- Empty initial state: returns `{picker, self}` (opponent bot) or `{picker}` (picker-team bot).
- Crack only: cracker added.
- Recrack only: cracker remains; recracker not in the set (recrack does not directly rule out — it identifies).
- Single called-suit-led non-called play: that player added.
- 3-of-4 elimination via called-suit-led trick: full set returned.
- Partial elimination (1-of-4 or 2-of-4): partial set returned, partner not yet uniquely identified.
- Multiple signals stack (crack + elimination): union returned.

For `deducedPartner`:
- `view.partner` set → returns it (engine-revealed path).
- Recrack by non-picker → returns recracker.
- Recrack by picker → falls through to elimination.
- 3-of-4 elimination → returns the remaining seat.
- 2-of-4 elimination → returns null.
- No signals fired → returns null.
- Picker-goes-alone (`callMode === 'alone'`) → returns null even with signals.
- Leaster / Schwanzer → returns null.

### Layer 2 — Engine state-change tests (`gameEngine.test.js`)

- `crack()` sets `crackerId` to the actor.
- `recrack()` sets `recrackerId` to the actor.
- New-hand boundary clears both fields.
- `getPlayerView` exposes both fields unredacted (one assertion per field).

### Layer 3 — Strategy integration tests (`botStrategy.test.js`)

State-construction tests for the worked scenarios:

1. **Headline schmear unlock.** opp2 trumps in on a called-suit-led trick before partner reveal; opp3 schmears `10S` onto `QC` (post-fix) instead of playing lowest fail (pre-fix).
2. **Recrack schmear unlock.** Non-picker recrack identifies partner; later trick has the deduced partner winning a fail-suit trick; opponent bot schmears.
3. **Lead-flush gate skip.** Opponent bot leading after recrack does not lead the called suit. Covers Update 4.
4. **Force-take gate skip.** After recrack, opponent bot does not aggressively take a non-called-led trick to enable lead-back. Covers Update 5.
5. **Predicted-win identity.** In a partner-led trick post-recrack (or post-elimination), the predicted-win branch's `pickerTeamWinning` correctly identifies picker team. Covers Update 3.
6. **Regression guard.** Ace call on hearts where the partner is unknown and no deduction signals have fired. All five updated call sites must behave exactly as they did pre-fix. Tightens against accidental bypass of `view.partner` in cases where deduction shouldn't apply.

### Layer 4 — `botSuggestion` smoke check

The human-suggestion path runs `decidePlay` for the human player. Add one assertion that the suggestion in the headline scenario produces the schmear card, confirming deduction flows through to the suggestion surface.

## Mobile App Considerations

This work is bot-side only. No view-redaction, UI, or transport changes. The new state fields (`crackerId`, `recrackerId`) are public information already visible in the action log, so they introduce no client-API differentiation between web and mobile clients. No mobile-readiness concerns.

## Success Criteria

- `deducedPartner` returns the correct partner identity in all three signal scenarios; returns `null` only when no deduction is possible.
- The headline schmear unlock test (Layer 3 case 1) shows the bot schmearing post-fix where it played lowest pre-fix.
- All updated consumer call sites pass the regression guard test (Layer 3 case 6) — no behavior change when no deduction signals have fired.
- All existing tests in `gameEngine.test.js`, `botStrategy.test.js`, `botSuggestion.test.js`, and frontend tests continue to pass.
- `docs/BOTS.md` describes the deduction layer and is internally consistent with the code.
- The pre-existing predicted-win doc drift (partner vs. picker forced-play wording) is fixed.

## Open Risks

- **Helper performance.** `knownNonPartners` scans completed tricks each call. For 6-trick hands this is trivial, but if a consumer calls it many times per decision, consider memoizing within a single `decidePlay` invocation. Defer until profiling shows a need.
- **State-shape backwards compatibility.** Any in-flight games at deploy time will lack `crackerId` / `recrackerId`. The helpers must treat missing fields as `null`. Add an explicit guard in `crack` / `recrack` reads to use `?? null`.
- **Frontend / replay.** Frontend currently reads `view.partner` directly. Adding `crackerId` / `recrackerId` to the view does not change `view.partner` semantics, so no frontend impact is expected. Audit during implementation to confirm.
