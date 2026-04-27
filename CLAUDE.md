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

# Deploy to Cloudflare Pages
npm run deploy
```

## Helper Commands

These commands might help a human debugging the application.

```bash
# Query the local D1 database
npx wrangler d1 execute sheepshead-db --local --command "SELECT * FROM games;"

# List all tables in the local D1 database
npx wrangler d1 execute sheepshead-db --local --command "SELECT name FROM sqlite_master WHERE type='table';"

# Describe a table's schema in the local D1 database
npx wrangler d1 execute sheepshead-db --local --command "PRAGMA table_info(games);"
```

### Deleting a problem game

Use when a stuck/corrupted game needs to be cleared from the local DB. Most child tables cascade from `games`, but `score_events` does NOT have `ON DELETE CASCADE` — always delete from it first. Only target non-complete games so finished history is preserved.

```bash
# Delete a single game by id (replace 4)
npx wrangler d1 execute sheepshead-db --local --command "DELETE FROM score_events WHERE game_id = 4; DELETE FROM games WHERE id = 4;"

# Delete all in-progress games (status != 'complete')
npx wrangler d1 execute sheepshead-db --local --command "DELETE FROM score_events WHERE game_id IN (SELECT id FROM games WHERE status != 'complete'); DELETE FROM games WHERE status != 'complete';"
```

Cascade handles `game_players`, `game_state`, `hands`, `hand_actions`, `hand_players`. For remote, swap `--local` for `--remote` — confirm with the user before running against production.

## Architecture

- **`frontend/`** — React 18 SPA built with Vite. Dev server runs on port 3000 and proxies `/api/*` to the Wrangler local server on port 8788.
- **`functions/api/`** — Cloudflare Pages Functions. Each file under `functions/` maps directly to an API route (e.g. `functions/api/hello.js` → `/api/hello`). The `context` object provides access to the D1 database via `context.env.DB`.
- **`migrations/`** — SQL migration files applied via Wrangler to the D1 database named `sheepshead-db`.
- **`wrangler.toml`** — Cloudflare config: D1 binding (`DB`), Pages build output dir (`frontend/dist`).

## Mobile App

Eventually, there will be a mobile app created which will be able to connect alongside the React frontend. Do not make design decisions that will make it difficult to eventually implement this mobile app. Be sure to point out any tradeoffs about this during any development work in this project.

## Branching Rules

Direct pushes to `main` are blocked by a pre-push hook (`.githooks/pre-push`). Always work on a feature branch and open a PR. After merging, local branches tracking deleted remotes are auto-deleted by the post-merge hook.

## Brainstorming ##

When using the brainstorming skill, also do the following:
When you write the design doc, you will also output a second design document, that a PM or high level manager could read and understand. It should have no or extremely minimal code or function names in it -- they wouldn't understand anyway. It should focus on what is being built and why. Be appropriately verbose about any critical logic that is being implemented. Do not explain algorithms with code. Name this document in the same format as the design/spec, but substitute PMspec, ex: `spec` becomes `PMspec`.

## Github

- When creating, editing, or posting comments on issues, make sure to:
  - Specify that you did the work.
  - Use existing tags as appropriate. Do not add new tags unless the user approves.

## RULES Sync

`docs/RULES.md` contains a plain-English description of the game rules. **Whenever you change game rules in `shared/gameEngine.js`, also update `docs/RULES.md` to match.**

## BOTS Sync
`docs/BOTS.md` contains a plain-English description of the bot's strategy. **Whenever you change bot strategy in `shared/botStrategy.js` or `shared/botInference.js`, also update `docs/BOTS.md` to match.** When you are asked to work on bot strategy, read `docs/BOTS.md` first for context. Always compare `docs/BOTS.md` to the code before working on strategy and make sure they are consistent with each other. If they are not, STOP, and let the user know there is an inconsistency so they can decide whether to fix it or not.

## General Rules

When implementing any new game feature in `gameEngine.js`, write corresponding tests in `gameEngine.test.js` — unit tests for pure functions, state-construction tests for stateful functions.

## Game Terminology

When reading instructions or discussing this project, check for terminology inconsistencies using the definitions below. If something is referred to imprecisely, ask for clarification before proceeding.

### Users & Players
- **User** — An account in the system, identified by `user_id` in the database. A User can be human or a bot. When seated in a game, a User becomes a Player.
- **Player** — A User occupying a seat in a game. Use **Bot Player** or **Human Player** for clarity. 
  - User and Player are easily confused. If there is any doubt about which is being referred to in a discussion about this project, ask for clarification.

### Table & Seats
- **Table** — The playing field in which gameplay takes place. A table contains seats.
- **Seat** — A position at the table that contains a player. Refer to specific seats by their code names. If a seat is referenced imprecisely, ask for clarification.
  - `seat-bottom` is where the Human Player sits.

### Game Flow
- **Game** — A construct inside which hands are played by players. Game is an abstract construct in the context of sheepshead. No data needs to be kept aggregated at the game level.
- **Blind** — The 2 cards set aside from the deal, available for the picker to take into their hand.
- **Bury** — The act of the picker placing 2 cards face-down after picking up the blind. Buried cards count toward the picker's point pile at scoring; they are not discarded. The picker may not bury cards required for the partner call.
- **Hand** — A single round of play within a game, from deal through scoring. Each hand begins with 6 cards dealt to each player plus a 2-card blind, proceeds through a picking phase, and ends with scores awarded. How a hand resolves depends on the picking phase outcome:
  - **Normal hand** — a picker is found, calls a partner (or goes alone), and 6 tricks are played
  - **Leaster** — no one picks; 6 tricks are played, but the player with the fewest card points wins
  - **Schwanzer** — no one picks (Schwanzer variant active); no tricks are played — scores are based on cards in each player's dealt hand
- **Trick** — 5 cards played, one by each player.

### Roles
- **Picker** — The player who picked up the blind.
- **Partner** — The player who holds the card called by the picker. Depending on the call mode, this may be the Ace, Ten, or King of the called suit.
- **Picker Team** — The Picker plus the Partner. If the Picker goes alone, the Picker Team is just the Picker.
- **Opponent Team** — All players who are not on the Picker Team.

### Points & Scores
- **Score** — A signed integer delta awarded to each player at the end of a hand (e.g. +2, -1). Accumulates into game, day, and lifetime totals.
- **Card Points** — 120 total per hand. Used to determine the hand outcome in all variants except Schwanzer.
- **Schwanzer Points** — Used in the Schwanzer no-pick variant to determine the loser.
