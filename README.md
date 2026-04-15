# Sheepshead

A web app for playing the card game Sheepshead, built on **Cloudflare Pages** with a React frontend and Cloudflare Workers Functions backend, backed by Cloudflare D1 (SQLite).

## Tech Stack

- **Frontend** — React 18 SPA (Vite), served from `frontend/`
- **Backend** — Cloudflare Pages Functions (`functions/api/`), each file maps to an API route
- **Database** — Cloudflare D1 (SQLite), accessed via the `DB` binding in `wrangler.toml`

## Development

```bash
npm install
npm run db:migrate:local   # apply DB migrations locally
npm run dev          # Vite on :3000 + Wrangler on :8788
```

## Production

```bash
npm install
npm run db:migrate   # apply DB migrations to remote
npm run deploy       # build and deploy to Cloudflare Pages
```

## Rules

See [RULES.md](RULES.md) for the full game rules.
See [BOTS.md](BOTS.md) for a description of the bot strategy.
