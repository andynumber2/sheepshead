# Request Optimization (Smart Polling) — Overview for PMs

**Issue:** [#145](https://github.com/andynumber2/sheepshead/issues/145)
**Related:** [#149](https://github.com/andynumber2/sheepshead/issues/149) (long-term replacement)
**Date:** 2026-04-26

## What we're building

A small, focused change to how the web app talks to the server. Today, every game page asks the server "anything new?" twice per second — forever — even when the game is over, the player has switched browser tabs, or no one is doing anything. We're making the app smart enough to stop asking when nothing can change, and to slow down when changes are infrequent.

## Why we're doing this

Internal traffic monitoring (Cloudflare dashboard) shows the app generating roughly **345,000 server requests per week from a single user**. The vast majority is wasted — the app is checking for updates constantly even when there is nothing to check. This number does not scale: as we add real users, costs climb linearly with this baseline, and the picture gets dramatically worse when a mobile app enters the picture (battery and cellular data are spent on each useless check).

This spec is the "stop the bleeding" pass. A separate, larger initiative (issue #149) re-architects the system to push updates instead of poll for them, eliminating the question entirely. That work is in the future; this one ships now.

## What changes for the user

Nothing visible. The game still feels live during play, the lobby still shows new games as they appear, and player actions (picking up the blind, playing a card, etc.) still reflect immediately on screen. The improvements are all internal — the app simply stops asking pointless questions.

## What changes behind the scenes

Four behavioral rules:

1. **When the game is over, stop checking.** Today, even after a hand is scored and the game is marked complete, the app continues asking the server for updates. After this change, polling halts as soon as the game ends.
2. **When the browser tab is not visible, stop checking.** If a player switches to another tab or minimizes the browser, polling pauses. When they come back to the tab, the app does one immediate refresh and resumes.
3. **Slow down when waiting.** While a game is in the lobby state (waiting for the next hand to be dealt or for players to join), the app checks every five seconds instead of every two. Less urgency, less waste.
4. **Skip a small repeated server lookup.** A specific configuration value — the time zone used for daily score totals — is re-fetched from the database on every single request. It never changes during operation. We cache it in memory once and reuse it. Trivial code change, but it eliminates one database query per page check.

## Critical logic to be aware of

The single most important property of this change is that the app must never end up with multiple polling timers running at once, and it must never leave a timer running after the page that started it has gone away. Today's bug is essentially that polling is started but never properly stopped under certain conditions; the fix encapsulates start/stop into one place that owns the rule. The unit tests verify this for every state transition (game becomes active, game ends, tab hides, tab returns, page closes, game ID changes).

The change is also designed to make the future #149 migration cheap. The web app will route all of its game-state-fetching through a single, replaceable component. When #149 lands and switches the underlying mechanism from polling to a live server-push connection, only that one component needs to change — the rest of the app does not know or care which mechanism is in use.

## Out of scope (deferred or covered elsewhere)

- **Caching unchanged responses.** A possible optimization where the server says "nothing has changed since you last asked" without doing the full database work. This was considered, but it adds code that the larger #149 work would throw away. Logged on #149 ([comment](https://github.com/andynumber2/sheepshead/issues/149#issuecomment-4323677349)).
- **Reducing the number of database queries per request beyond the one cache.** Same reason — #149 rewrites this code path.
- **Push-based updates (server tells client when something changes).** This is exactly what #149 is.
- **Mobile app implementation.** The design records considerations for mobile (notably: don't poll every two seconds on cellular) but does not implement anything mobile-specific.
- **Lobby page becoming push-based.** Out of scope for #149's first cut, and out of scope here.

## Success criteria

The change is "done" when **all** of the following hold:

1. Automated unit tests pass for every behavior listed above (game ends, tab hides, etc.).
2. Manual verification in a real browser confirms: idle on lobby = one request every 5 s, mid-game = one request every 2 s, both stop when the tab is hidden, and game-over halts polling entirely.
3. After one week of real-world traffic, the Cloudflare dashboard shows:
   - **Total Worker requests below 50,000 per week** (down from ~345,000 — an ~85% reduction).
   - **Idle baseline below 100 requests per hour** during any one-hour window with no active gameplay (down from ~1,800).
   - One fewer database query per game-page check (down from 7 to 6).
4. No user-visible regressions in gameplay, lobby, or action responsiveness.

The week-long traffic check is the real gate. If smart polling alone does not close the gap to the 50K target, that is the signal to revisit the deferred caching work earlier than #149 — handled as a follow-up issue, not as a re-open of this design.

## Rollout

A single pull request, a single deploy, no feature flag. The changes are entirely behavior-shaping (the web app behaves more politely; the server is unchanged except for one in-memory cache). If anything goes wrong, a one-click revert removes the change cleanly with no database migration to undo.
