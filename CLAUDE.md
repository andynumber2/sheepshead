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

## Architecture

- **`frontend/`** — React 18 SPA built with Vite. Dev server runs on port 3000 and proxies `/api/*` to the Wrangler local server on port 8788.
- **`functions/api/`** — Cloudflare Pages Functions. Each file under `functions/` maps directly to an API route (e.g. `functions/api/hello.js` → `/api/hello`). The `context` object provides access to the D1 database via `context.env.DB`.
- **`migrations/`** — SQL migration files applied via Wrangler to the D1 database named `sheepshead-db`.
- **`wrangler.toml`** — Cloudflare config: D1 binding (`DB`), Pages build output dir (`frontend/dist`).

## Branching Rules

Direct pushes to `main` are blocked by a pre-push hook (`.githooks/pre-push`). Always work on a feature branch and open a PR. After merging, local branches tracking deleted remotes are auto-deleted by the post-merge hook.

## README Sync

`README.md` contains a plain-English description of the game rules. **Whenever you change game rules in `shared/gameEngine.js`, also update the Rules section of `README.md` to match.**

When implementing any new game feature in `gameEngine.js`, write corresponding tests in `gameEngine.test.js` — unit tests for pure functions, state-construction tests for stateful functions.
