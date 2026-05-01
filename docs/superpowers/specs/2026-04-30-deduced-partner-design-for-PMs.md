# Bot Inference — Deduced Partner from Public Information (PM-readable)

Tracking issue: [#151](https://github.com/andynumber2/sheepshead/issues/151).

## What this is

When a hand of sheepshead is played, the picker calls a partner secretly — the partner is whoever holds a specific card the picker names. From the moment the hand starts, neither the partner's identity nor the picker's full strategy is publicly known. The partner is officially "revealed" only when they play the called card.

A skilled human watching the table can often figure out who the partner is *before* that reveal, by paying attention to what other players do. Bots in our system currently cannot. This work gives bots that same observational skill.

## Why we are doing this

Today, opponent bots in our game refuse to cooperate effectively for most of a hand because they do not know who their teammates are. Specifically: when a teammate is winning a trick and the opponent bot could throw high-value cards onto that trick to help (a move called a "schmear"), the bot does nothing — it plays a low card and the points stay in its own hand instead of being captured for the team. This makes opponent bots noticeably worse partners for one another than human players are.

Three publicly-observable events let an attentive human deduce the partner well before the official reveal:

1. **A "crack" happened.** Only an opponent of the picker is allowed to crack (a doubling action that increases the stakes). So whoever cracked is definitely not the partner.
2. **A "recrack" happened.** Only the picker or the partner is allowed to recrack (a counter-doubling action). The picker is publicly known, so anyone other than the picker who recracks must be the partner.
3. **The called suit got led for the first time.** The rules force the partner to play the called card on the first trick where the called suit is led. So anyone who plays a non-called card on that trick is definitely not the partner. Once enough non-partners are ruled out, the last remaining seat must be the partner.

Each signal is deterministic — there is no guessing or probability involved. The information is sitting in plain sight, and a thoughtful player would use it.

## Scope of this change

This change is bot-side only. The user interface, the rules of the game, and the experience for human players are all unchanged. We are not surfacing the deduced partner to humans on the screen earlier than today (a separate, future enhancement is already filed for that — issue #162). We are only making the bots smarter.

The change has three parts:

1. **A new "deduction layer."** A small piece of code that the bot consults whenever it asks "who is the partner?" The layer combines the three signals above and returns the partner's identity if it is publicly knowable, or "unknown" otherwise.

2. **Two new pieces of game state.** When someone cracks or recracks, we now record *who* did it. Today the system records *that* a crack happened but not who acted. Recording the actor is necessary to feed the deduction layer cleanly, and the action is already publicly visible in the on-screen log, so this introduces no new information disclosure.

3. **Bot decisions consult the deduction layer.** Five places in the bot's play logic currently ask "who is the partner?" by reading the system's redacted view (which says "unknown" until the official reveal). All five are updated to ask through the deduction layer instead. The strict line we are drawing: "who is the partner?" goes through the new layer; "has the called card been played yet?" does not — that question is about timing, not identity, and the existing flag answers it correctly.

## What the bots will do differently

The headline change: opponent bots will now schmear correctly when a teammate is winning a trick, even before the partner is officially revealed. Concrete example: an opponent has just trumped in on a trick led with the called suit. By the rules, that opponent cannot be the partner. The bot to act next, having ruled out the picker, the cracker (if any), and the previous players, knows the partner must be the last unplayed seat — and therefore knows the trumping opponent is on its team. It throws a high-value card onto the trick to help capture the points, instead of playing a low card and leaving the points unclaimed.

Two related changes follow from the same deduction:

- **Lead choice after recrack.** When an opponent bot is leading and a recrack has already identified the partner, the bot stops leading the called suit purely "to flush out the unknown partner" — that goal is already achieved. The bot picks a more useful lead.
- **Aggressive take-the-trick to enable lead-back.** A previous improvement gave opponent bots a behavior of taking certain tricks aggressively so they could lead the called suit on the next trick (again, to flush the unknown partner). Once the partner is deduced, that aggressive take is no longer warranted; the bot reverts to its default low-cost play.

## What the bots will not do differently

- **Picker-team bots are unchanged.** The picker and partner already know each other; the deduction layer changes nothing for them.
- **No change when no deduction is possible.** If none of the three signals has fired, the deduction layer returns "unknown" and the bot behaves exactly as it does today. We are tightening the regression test to enforce this.
- **No change to forced-play timing.** The rule that forces the partner to play the called card on a called-suit-led trick is unchanged. Deduction only changes the bot's understanding of *who* the partner is, not *when* anything happens.
- **No change to leaster, schwanzer, or "picker goes alone" hands.** None of those have a partner; the deduction layer returns "unknown" and behavior is identical to today.

## Critical logic worth understanding

**Why deduction needs both a "rule-out set" and a "final identification."** The three signals do different work. Crack and the called-suit-led signal each *rule out* a single seat at a time — they shrink the candidate pool. Once three of the four non-picker seats are ruled out, the fourth is identified by elimination. Recrack is special: it directly identifies a seat as the partner in one step. The deduction layer expresses both shapes — partial knowledge ("seat X is not the partner") and full identification ("seat Y is the partner").

**Why we draw the timing-vs-identity line carefully.** It would be tempting to treat "the partner is deduced" as the same thing as "the called card has been played." They are not the same. The called card being played is a hard event in time that affects what cards different players are forced to play next. Deducing the partner is an observational fact that has no effect on play obligations. Conflating them by reusing the same flag would either change forced-play timing in unintended ways or expose deduced identity to humans on screen — both side-effects we explicitly want to avoid in this work.

**Why ten/king calls have a separate concern.** In an ace-call hand, the partner's forced card (the called ace) is the highest card of its suit, so the picker team is essentially guaranteed to win any trick where the called suit is led. The bot already uses this fact to decide whether to "trump in" against such a trick. In ten- and king-call hands, the partner's forced 10 or king is *not* the highest card of the suit — an opponent could already be winning the trick before the partner ever plays. The bot's existing assumption is wrong in those cases. We have flagged this concern as a comment on issue #83 and are not addressing it here, because the fix is independent and should be considered with the broader ten/king call review.

## Out of scope (deferred or tracked elsewhere)

- **Showing the deduced partner to humans on screen.** Tracked as #162. Worth doing eventually but a separate product question.
- **Ten/king call correctness in the "predicted picker-team will win" heuristic.** Tracked as a comment on #83.
- **Speculative or probabilistic deductions** based on lead choices, schmear behavior, or other soft signals. We are only doing deterministic deductions here.

## Mobile app implications

None. This work is bot-side only — no user-interface changes, no client/server protocol changes, no information flowing out of the system that was not already there. The eventual mobile app will inherit the smarter bots automatically.

## Success criteria

- Bot opponents schmear correctly in scenarios where the partner has been deduced, where today they fail to do so. A specific test scenario captures the headline case.
- Bot behavior is byte-for-byte identical to today in scenarios where no deduction signal has fired. A regression test enforces this.
- The plain-English bot strategy document (`docs/BOTS.md`) accurately reflects the new deduction layer and the bot's updated decisions.
- All existing tests continue to pass.
