# Bot Suggestion Highlight — For PMs

Tracks https://github.com/andynumber2/sheepshead/issues/123.

## What we're building

A new, optional visual cue that shows each human player what the game's bot would choose on their turn. When the cue is turned on, the recommended card (or action button) is outlined in red in the player's own view. The player is still free to do whatever they want — the red outline is a hint, nothing more.

Alongside this, the in-game "Options" panel is being reworked so every player — not just the game's admin — can open it. Non-admins see the active game rules as read-only information, and they get one personal toggle: **Show Bot Suggestion**.

## Why we're building it

The feature serves two audiences at once:

- **Developers and testers debugging the bot.** We're actively iterating on the bot's strategy, and today the only way to notice a bad bot decision is to watch a bot play and catch the moment. With this feature, the bot's recommendation is on-screen during every human turn — so any human player (the developer, a tester, an opinionated friend) can immediately compare it against what they think the right play is. Misplays that used to require a post-game replay to find can be spotted live.
- **Newer or less experienced human players.** Sheepshead has a steep learning curve — pick/pass decisions, partner calls, and trump management are hard to reason about at first. The same highlight that helps us find bot bugs doubles as a learning scaffold: a player who turns it on sees a plausible, competent play every turn and can learn the game by comparing their intuition against the bot's recommendation. The bot is not always optimal, but it is consistently reasonable, which is exactly what a new player benefits from.

This dual framing is intentional. The implementation is the same either way; we just get to serve two audiences with one feature.

**Where this could eventually go.** The hint in this feature is voluntary and static. A natural extension is a proper **tutorial mode**: guided play, forced decisions, explanatory text, scenarios designed to illustrate specific concepts (e.g. "when to pass a marginal hand," "how to call on a short partner"). That would build on top of the same underlying machinery introduced here — the ability to surface what a competent player would do at any decision point. The tutorial mode is explicitly out of scope for this issue, but nothing in this design forecloses it.

The Options-panel rework is necessary plumbing: the toggle needs a home, and the natural home is the existing settings modal. Giving non-admins read-only visibility into game options is a nice side effect — it closes an information gap from the prior iteration where non-admins couldn't see things like the Double-on-Bump or Partner-visibility rules without asking the admin.

## How it behaves

- **Scope of the hint.** The hint covers all four decision points a player hits during a hand:
  - **Pick, pass, or blitz** (during the picking phase, including the optional "Black/Red Blitz" action when the player qualifies)
  - **Bury** (once the picker has taken the blind and must tuck away two cards)
  - **Call** (the picker's choice of which partner card to call)
  - **Play** (every normal trick-taking decision)
- **Visual treatment.** A red outline on the recommended card in the player's hand, or a red outline on the recommended button. The outline is always additive — a card can still show its normal "legal to play" highlight, and the bot hint layers on top. Red was chosen to be visually distinct from the existing green "playable" highlight.
- **When it appears.** Only when it is the player's turn and the player has the toggle switched on. Other players' turns show nothing — the hint is purely a personal view.
- **Who sees it.** Any seated human player. Spectators (a feature not yet built) are not covered. In admin test mode, where the admin can act on behalf of a bot, the hint works too — which is actually the most useful debugging scenario.

## How the Options panel changes

- Today, only the game's admin sees an "Edit" button on the options panel. The button is renamed "⚙ Options" and shown to all players.
- When an admin opens it, nothing changes — they still have full control of the game settings.
- When a non-admin opens it, the three game settings (no-pick variant, partner visibility, double-on-bump) appear as a plain read-only list. We deliberately avoided showing disabled form controls — seeing grayed-out radio buttons is confusing and suggests a broken UI.
- Regardless of role, a new "Your preferences" section appears at the bottom of the modal, separated from the game settings. For this feature it contains one checkbox: **Show Bot Suggestion**. The section is a natural home for future personal toggles (theme, sound, etc.), though none are planned right now.

## Where the preference is stored

The Show Bot Suggestion toggle is stored in the browser locally — **not on the server**. This means:

- Turning it on persists across page reloads on the same browser.
- Opening the app on a different device (phone, laptop) starts with the toggle off until you turn it on there.
- The server does not know or care what the toggle's value is — it is a pure client-side visual aid.

This was an intentional choice. The toggle is a personal debugging preference, nobody else needs to know about it, and keeping it out of the database avoids a schema migration and new API endpoints for what is essentially an optional UI setting. If we later decide to store a meaningful set of per-user preferences (e.g., theme, notification settings), we'd move this toggle to that system then.

## Critical logic the spec captures

### Where the bot recommendation comes from

The bot's decision code already exists in the project as a shared module — it is the same code the server runs when a bot takes its turn. This feature imports that module into the browser and calls it directly against the game state the player already sees. There is no new server endpoint, no API round-trip per turn, and no risk of the client and server disagreeing about what the bot would choose (because it's literally the same code).

One consequence to flag: importing the bot strategy in the browser means the full strategy logic gets shipped to every player's browser as part of the app bundle. A curious player could read it in their browser's developer tools. We accept this exposure because the strategy is already publicly documented in the project's `BOTS.md` file — nothing is being revealed that wasn't already readable from the repo.

### When the hint is computed

The hint recomputes automatically whenever the game state changes or the toggle is flipped. The computation is lazy and memoized, so it doesn't run repeatedly in the background — only when something relevant has actually changed. If an unexpected error ever occurs inside the bot code, the hint silently disappears for that turn (and a developer-only warning goes into the browser console). The game itself is never affected by a bad hint.

### No impact on authoritative gameplay

Nothing about this feature changes what actions are legal, what the server accepts, what other players see, or how scoring works. A player who disables the hint sees exactly the same game as they do today. A player who enables it and follows the bot's advice plays the same cards they would have been allowed to play anyway — the server validates every action independently.

## Success criteria

We'll consider this shipped successfully when:

1. With the toggle on, a human player sees red outlines on their screen identifying exactly what the bot would do — across all four phases of a hand.
2. Toggling the preference takes effect on the current turn and persists across reloads on the same browser.
3. Any player can open the Options modal. Admins still fully control the game settings; non-admins see those settings as read-only and have their personal toggle.
4. No server-side code, database schema, or API endpoints need to change.
5. The existing bot test suite continues to pass with no modifications — a small set of targeted frontend tests covers the new wiring without duplicating strategy coverage.

## Out of scope / deferred

- **Showing *why* the bot chose a given card.** Hovering the highlighted card could show an explanation like "leading highest trump as picker team." This was identified as valuable but deferred to a separate issue (https://github.com/andynumber2/sheepshead/issues/140) because it requires refactoring the entire bot-decision code to emit reason tags alongside each decision. Delivering the visual highlight first means that follow-up work has somewhere to attach.
- **Cross-device sync of the toggle.** If you enable the hint on your laptop, it stays off on your phone until you enable it there too.
- **Showing hints to spectators.** Spectator mode isn't fully implemented in the product today; it is tracked separately at https://github.com/andynumber2/sheepshead/issues/75 and will be considered then.
- **Showing alternative candidate plays the bot considered.** Not requested; would add significant complexity for marginal debug value.
- **A tooltip/callout explaining the bot's belief state** (what it thinks the partner might hold, trump count remaining, etc.). Tracked as part of the recap/replay feature at https://github.com/andynumber2/sheepshead/issues/125 — that feature is a historical/post-hoc view; this feature is a live view.

## Relationships

- **Blocks** https://github.com/andynumber2/sheepshead/issues/140 (live bot-reasoning tooltip), which attaches to the highlight this feature introduces.
- **Builds on** https://github.com/andynumber2/sheepshead/issues/114 (game-mode visibility for non-admins), which is extended here from a one-line summary into a full read-only Options view.
