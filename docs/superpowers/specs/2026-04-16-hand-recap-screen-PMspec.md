# Hand Recap Screen — PM Overview

**Date:** 2026-04-16
**Related GitHub issue:** #120

---

## What we're building

A way for anyone — a player, a developer, or a friend looking over someone's shoulder — to go back and review a hand of sheepshead after it's finished. Think of it as the game's equivalent of a "watch the replay" button.

When a hand ends, the play history in the game will show a line like **"Hand 1 complete."** The text "Hand 1" becomes a clickable link. Clicking it opens a **recap page** for that hand.

There are two views:

1. **The simple recap** — a single-page summary of the hand. You see who picked, who the partner was, the card they called, what was in the blind, which cards the picker threw away, and a clean table showing every card played in every trick with the winner of each trick clearly marked. At the bottom are the final scores.

2. **The detailed replay** — a step-by-step view where you can walk through the hand one action at a time and see all five players' cards face-up. Useful for learning, dispute-resolution, and especially for our own work debugging the bots (we want to see what the bot was holding when it made a suboptimal play).

The two views connect: every card on the simple recap is itself a link that jumps into the detailed replay at the exact moment that card was played.

---

## Why we're building it

Three audiences benefit:

- **Us, debugging bots.** Today, if a bot plays a strange card, finding out what it was thinking means digging through logs or replaying the game mentally. A visual recap makes misplays immediately obvious.
- **Players learning the game.** Sheepshead is a complex game and players improve by reviewing hands they lost. Today they have no way to go back and look.
- **Dispute resolution.** If someone disagrees about what happened in a hand, they can point to a link and settle it.

The feature is also a **shareable asset**. Anyone with the URL can see a recap — no login needed. That makes it trivial to paste a link into a chat and say "look at what the bot did here."

---

## How it's reached

The only entry point is the play history log inside the game page itself. Every time a hand finishes, "Hand N" in that log becomes a link. There is no separate recaps gallery, no "browse old hands" page, no end-of-game overview. You're always clicking in from a specific hand you just saw complete (or from a link someone sent you).

We specifically decided **not** to build a whole-game recap (all 8 hands at once). It's easy enough to click through each hand individually and it keeps this initial feature small.

---

## Critical logic — anti-cheating

This is the most important piece of plain-English logic in the design.

The simple recap exposes every player's dealt cards and every card played. That information must not leak during a hand in progress — otherwise a player could pop open the recap page in another tab and cheat.

The protection is straightforward: **the back end will refuse to return any recap data for a hand that hasn't finished yet.** Inside the database, each hand has a "completed at" timestamp. If that timestamp is missing, the server responds as if the recap simply doesn't exist. This is checked on every request, not just on the initial page load, so there's no way to sneak in.

Additionally, the "Hand 1" link in the play history only appears on the line that says the hand has ended. A hand that's in progress has no link at all, so there's no clickable path into the recap in the first place.

---

## Critical logic — how the data gets built

The database already stores, for every hand, a full append-only log of every action that happened (cards dealt, passes, picks, calls, plays, etc.). That log was put in place in a prior piece of work specifically to enable this feature. Because the log captures everything, the server can reconstruct any hand at any point in time.

When someone opens the simple recap, the server walks through that log once and summarizes it into a clean structure: who picked, what card they called, who the partner turned out to be, what was in the blind, what the picker discarded, which cards were played in each trick, who won each trick, what the final scores were. That summary is what the simple recap page displays. The raw log is not sent — the summary is small and the page loads fast.

When someone clicks a card to open the detailed replay, the server hands over the raw action log. The replay page then walks through the log step by step, showing the table state at each point.

This split is deliberate: the summary is fast for the common case (someone glancing at the recap), and the heavier raw log only loads when someone actively wants to step through the hand.

---

## Critical logic — variant handling

Sheepshead has three different ways a hand can play out, and the recap has to handle all of them:

- **Normal hand** — someone picks up the blind, calls a partner, and six tricks are played. This is the common case and gets the full layout described above.
- **Leaster** — nobody wanted to pick, so everyone plays for themselves; the player with the fewest card points wins. The recap uses the same layout but drops the picker/partner highlights and hides the blind strip (no pick happened). A "hand winner" callout shows who had the lowest score.
- **Schwanzer** — nobody picked and the game rules say no tricks get played at all; scores are computed from the cards each player was dealt. The recap reuses the same table but collapses the trick dimension away, leaving just a row per player showing their dealt cards. The blind strip is hidden.

---

## What's explicitly not in this version

- **No bot "thought bubble" on the detailed replay.** The right-hand panel on the detailed replay was designed to show what the bot knew and was thinking at each decision point — partner suspicions, trump remaining, etc. Capturing that information is a separate piece of work, already filed as a follow-up GitHub issue (#125). For now, that panel renders a "not captured yet" placeholder. The rest of the detailed replay works fine without it.
- **No mobile-friendly layout.** Desktop only for v1. If we ever want this on mobile, it'll be a separate project.
- **No game-level recap.** Per-hand only, and we have no plans to add a game-level view.
- **No historical hands.** The action log was added very recently and the database is currently empty, so there is nothing old to backfill.

---

## Risks and uncertainties

- **Schwanzer layout is a slight unknown.** The design reuses the Normal layout with the trick dimension collapsed away. This should work visually, but we'll validate during implementation and may need to tweak if it feels awkward.
- **Auto-play speeds** (1x, 2x, 4x) in the detailed replay are a best guess. We'll see in practice whether the defaults feel right.
- **Card-level linking in the simple recap** is a more sophisticated interaction than a single "open replay" button. If users don't discover it despite the hover effect and hint text, we may need to make the clickability more obvious.
