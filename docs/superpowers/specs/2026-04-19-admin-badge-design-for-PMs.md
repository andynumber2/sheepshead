# Admin Badge — Product Spec

**Date:** 2026-04-19
**Issue:** #113
**Related:** #137 (transfer the admin role to another player — separate follow-up)

## What we're building

Every game has one player who acts as its **admin** — the player with elevated control over that specific game (changing options, filling empty seats with bots, and so on). Today there is no visual indicator of who that person is. Other players have no way to know who to ask for a settings change, and even the admin themselves has no quick reminder of their role from inside the game.

This change adds a small, consistent visual badge — a star — placed next to the admin player's name everywhere players appear in the app. After this ships, anyone glancing at the lobby, the pre-game waiting room, or the active game table will be able to identify the game admin at a glance.

## Where the badge appears

1. **Lobby game list** — for every game listed, the admin badge appears next to the name of the player who is currently that game's admin. This replaces a smaller existing indicator that only marked games *you* created — the new badge does the same job but for everyone, not just you.

2. **In-game waiting room** — while players are still gathering and the game hasn't started, the player list shows the admin badge next to the admin's name.

3. **Active gameplay** — once the game is in progress, the admin badge appears next to the admin's name in their seat at the table, alongside other existing badges (dealer, picker, partner, and so on).

The badge is intentionally **not** shown on the post-game recap screen, because at that point the role has no remaining meaning for that hand and the badge would be visual clutter.

## Why we're being careful with the design

Right now the admin role is implicit: whoever creates a game is the admin for as long as that game exists. We're already discussing a follow-up feature — issue #137 — where a player can transfer the admin role to someone else. That feature is intentionally **not** part of this work, so this issue stays small and shippable.

The careful part: the structure we expose to the app today doesn't bake in the assumption that "admin = creator." Instead, the app simply asks the server "who is the admin of this game?" and renders a badge next to that person. Today the server answers based on who created the game; tomorrow, when transfer is implemented, the server can answer based on the most recent transfer instead. Importantly, **the screens and badges built in this issue won't need to change** when the transfer feature ships — only the answer behind the curtain changes.

This is a small upfront design discipline that avoids tearing up UI work later.

## What this change is *not* doing

- It is not adding any way to transfer or change the admin role. (That's #137.)
- It is not changing what the admin is allowed to do. The set of admin privileges is unchanged.
- It is not changing anything on the post-game recap screen.
- It is not changing the existing site-wide "admin" indicator (the one that marks accounts with system-level privileges in the lobby header). That's a separate concept and stays as-is.

## How we'll know it's done

A user opening the app should be able to immediately answer "who is the admin of this game?" by looking at the lobby, the waiting room, or the table — without clicking anything, asking another player, or checking a settings menu.
