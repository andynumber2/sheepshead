# Game Mode Visibility & Change Logging — PM Spec

**Date:** 2026-04-18
**Issue:** https://github.com/andynumber2/sheepshead/issues/114

## What we're building

Two small, related improvements so every player at the table — not just the game admin — can see and keep up with the active game settings.

### 1. Everyone can see the current game settings

Today, only the admin who created the game sees the current settings summary (no-pick variant, whether the partner is shown, double-on-the-bump). Other players have no way to know what variant is active once the game begins.

After this change, all players see the same compact summary line in the two places it already lives: the pre-game waiting screen and the right-side panel during active play. Non-admin players see it read-only — no edit button.

### 2. When the admin changes settings, everyone is told

Today, the admin can toggle settings mid-game and no one else knows until the next hand begins with surprising new rules. After this change, when the admin finishes editing settings, a single line appears in the Play History chat for everyone:

> **Next Hand:** Leasters · Partner: shown · DOB

Every setting is listed, whether it changed or not. The "Next Hand" prefix makes clear to everyone that the rules aren't shifting mid-hand — they take effect at the start of the next hand.

## How it behaves

**Nothing saves until the admin presses Done.** The settings modal becomes a staging area. The admin can toggle options freely; nothing is persisted and no other player sees anything until they commit with Done. This is a change from today's behavior, where each individual toggle saved immediately.

**Done commits, Escape cancels.** Pressing Done saves all the admin's changes in one go and emits the log line. Pressing Escape, or clicking outside the modal, discards the edits entirely — no save, no log line, no visible change to anyone else. The modal behaves like most modern "edit" dialogs: you commit or you cancel.

**One log line per editing session.** Whatever mix of changes the admin made inside the modal, committing them produces exactly one log line summarizing the resulting settings. No spam, no line per toggle.

**No log line if nothing actually changed.** If the admin opens the modal, presses Done without changing anything — or changes a setting and reverts it to the original before pressing Done — no log entry is created. The log only speaks up when the committed settings differ from what the admin started with.

**Waiting screen is quiet.** The log isn't visible before a game starts, so no log line is emitted during the waiting screen phase. Non-admin players still see the summary display there — that's how they learn the starting settings.

## Why this design is forward-compatible

The app will grow over time — new game settings will be added, and a mobile app is likely. The design anticipates both.

**New settings are cheap to add.** The summary line is built in one place on the server from the current settings. When a new setting is added, updating that one formatter automatically updates: the in-game display for all players, the log line wording, and the wording on both the waiting screen and active-play views.

**Mobile-friendly.** Web and any future mobile app share the same flow: edit freely in the modal, commit all changes in one go on Done, cancel on Escape/backdrop. The backend accepts a single save per editing session with an "announce it" flag attached, which keeps the implementation identical across platforms.

## Out of scope

- **When settings apply.** Settings still take effect at the start of the next hand — unchanged from today.
- **What settings exist.** No new settings are being added in this work. This is about making existing settings visible.
- **Other notification channels.** No push notifications, toasts, or banners — just the existing play-history log and the existing on-screen summary panel.

## Success criteria

- A non-admin player can open a game and, at any point, know what variant is being played and what the other current settings are.
- When the admin changes settings, every player — admin and non-admin — sees a single clear line in the play history indicating what the settings will be for the next hand.
- No log noise: opening and closing the settings modal without making a change has no visible effect.
- The design supports adding a fourth or fifth setting later without revisiting the feature.
