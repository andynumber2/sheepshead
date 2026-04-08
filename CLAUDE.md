# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sheepshead is a card game web app built on **Cloudflare Pages** with a **React** frontend and **Cloudflare Workers Functions** backend, backed by **Cloudflare D1** (SQLite).

## Commands

All commands run from the repo root unless noted.

```bash
# Install dependencies
npm install

# Run full dev environment (Vite on :3000, Wrangler on :8788)
npm run dev

# Build frontend only
npm run build

# Apply DB migrations locally
npm run db:migrate:local

# Apply DB migrations to remote (production)
npm run db:migrate

# Query the local D1 database
npx wrangler d1 execute sheepshead-db --local --command "SELECT * FROM games;"

# List all tables in the local D1 database
npx wrangler d1 execute sheepshead-db --local --command "SELECT name FROM sqlite_master WHERE type='table';"

# Describe a table's schema in the local D1 database
npx wrangler d1 execute sheepshead-db --local --command "PRAGMA table_info(games);"

# Deploy to Cloudflare Pages
npm run deploy
```

## Architecture

- **`frontend/`** — React 18 SPA built with Vite. Dev server runs on port 3000 and proxies `/api/*` to the Wrangler local server on port 8788.
- **`functions/api/`** — Cloudflare Pages Functions. Each file under `functions/` maps directly to an API route (e.g. `functions/api/hello.js` → `/api/hello`). The `context` object provides access to the D1 database via `context.env.DB`.
- **`migrations/`** — SQL migration files applied via Wrangler to the D1 database named `sheepshead-db`.
- **`wrangler.toml`** — Cloudflare config: D1 binding (`DB`), Pages build output dir (`frontend/dist`).

## Branching Rules

Direct pushes to `main` are blocked by a pre-push hook (`.githooks/pre-push`). Always work on a feature branch and open a PR. After merging, local branches tracking deleted remotes are auto-deleted by the post-merge hook.

## Partner Call Rules (Call an Ace + Under Card)

After the picker discards, the engine picks one of three **call modes** based on
their 8-card hand (`shared/gameEngine.js` `discard()`). The picker must then call
a partner card according to that mode (or invoke `goAlone` instead):

- **`callMode: 'ace'`** (default) — picker calls a fail ace they neither hold nor
  buried. Two sub-paths per suit:
  - *Normal call* (`callAce`) — picker holds at least one fail card of the called
    suit. Standard partner reveal: when the called suit is led, the partner must
    play the called ace.
  - *Ace Unknown* (`callAceUnknown`) — picker holds **no** fail card of the
    called suit. They pick any card from hand to place face-down as the **under
    card**. The under card lives in `state.underCard` (off-hand). It has no
    trick-taking power. The picker is **forced** to play it whenever the called
    suit is led (by anyone, including themselves leading via the under card,
    which declares the called suit as the led suit). It's revealed only to the
    trick winner. Math: picker has 5 hand cards + 1 under card = 6 plays, so
    the under card is naturally played by trick 6 at the latest.

- **`callMode: 'ten'`** (`callTen`) — picker holds all 3 fail aces. Calls the
  10 of a fail suit whose 10 they don't hold and didn't bury. Picker is forced
  to play the Ace of the called suit when the called suit is led
  (`pickerForcedPlays = ['A{suit}']`). `discard()` rejects burying any fail ace.

- **`callMode: 'king'`** (`callKing`) — picker holds all 3 fail aces *and* all
  3 fail tens. By card-count math (6 cards in hand post-discard = exactly 3
  aces + 3 tens) the picker holds zero fail kings, so any fail king is callable.
  Picker is forced to play A and 10 of the called suit (in either order) when
  the called suit is led (`pickerForcedPlays = ['A{suit}','10{suit}']`).
  `discard()` rejects burying any fail ace or ten.

- **Going alone** (`goAlone`) — picker-initiated alternative to calling a
  partner, available in any call mode. Sets `state.goingAlone = true`, clears
  all called-card fields, and the picker plays solo against the other four.

**Why "Unknown" exists**: without the under card mechanic, a picker who held no
fail card of any callable suit could never lead the called suit, so the
partnership could never be revealed organically. The under card gives the
picker a face-down "card of the called suit" they can play (or lead with) to
keep that mechanic intact.

**Key invariants** (do not break when refactoring):
- Calls of any suit whose target card (A/10/K) is in `state.discard` must be
  rejected — the "partner" would be nobody.
- The picker can see `state.discard` (they buried it); other players cannot.
- The under card is hidden from everyone except the picker (who placed it) and
  the trick winner of the trick where it's played. Hidden plays in tricks have
  `faceDown: true`.
- `resolveTrick()` and `beats()` take a `ledSuit` argument and skip face-down
  plays when determining the winner. Face-down cards still contribute their
  point value to the trick winner's pile.
- When the under card is the lead, the trick entry has `declaredSuit` set to
  the called suit; `getLedSuit()` honors this over the (hidden) card's real suit.
- `state.calledSuit` is the unifying field across ace/ten/king calls — prefer
  it over `state.calledAce?.suit` when checking "is the called suit being led."
