# Hand Recap Screen Design

**Date:** 2026-04-16
**Issues addressed:** #120 (game recap)
**Follow-ups:** #125 (bot inference capture — deferred)

---

## Overview

Add a per-hand recap feature built on the action log foundation laid in PR #122 (the `hands` and `hand_actions` tables). Clicking the "Hand N" text in a completed log entry opens a **simple recap page** showing a trick-by-trick table with the blind, picker discards, and final scores. Every card in that table links to a **detailed replay page** that steps through the hand action-by-action with all players' hands visible (intended for bot-debugging).

Recaps are public-by-link. The back end refuses to serve recap data for any hand whose `completed_at` is still null, so in-progress hands cannot be used to peek at opponents' cards.

---

## Scope

**In scope**
- Simple recap page: trick table + meta + blind + discards + final scores
- Detailed replay page: step-through of all recorded actions, all hands face-up, manual step + auto-play (1x / 2x / 4x), scrubber
- "Hand N" link in the play history (`GameLog`)
- Two API endpoints: metadata digest + raw action log
- Variants: Normal, Leaster, Schwanzer
- Anti-cheat: block recap fetch for incomplete hands

**Out of scope**
- Game-level recap (no plans to build this)
- Bot inference snapshot panel — rendered as a "not captured" placeholder, tracked in #125
- Mobile responsive layout (desktop-only)
- Historical hands that predate the action log (not applicable — DB is empty)
- Backfill of any kind

---

## User flows

### Flow 1 — Read the recap of a just-finished hand
1. User is on the game page; a hand completes; log entry `--- Hand 1 complete ---` appears
2. The text "Hand 1" (and only that text) is rendered as a link
3. User clicks → navigates to `/recap/:gameId/:handNumber`
4. Simple recap renders: variant, picker, partner, called card, blind, picker discards, 6-trick table, final scores

### Flow 2 — Inspect a specific card in the replay
1. From the simple recap, user clicks any card in the trick table
2. Navigates to `/recap/:gameId/:handNumber/replay?seq=:afterSeq`
3. Detailed replay loads at the action index **immediately after** the clicked card was played
4. User uses prev/next step, next-trick jump, or auto-play to walk through the hand

### Flow 3 — Share a hand
1. User copies the browser URL (e.g. `https://.../recap/247/4`) and sends it
2. Recipient opens the link; no auth required; they see the same simple recap
3. Detailed replay link works the same way

---

## Routes

| URL | Page | Notes |
|-----|------|-------|
| `/recap/:gameId/:handNumber` | Simple recap | top-level route, shareable |
| `/recap/:gameId/:handNumber/replay` | Detailed replay | optional query `?seq=N` to start at action N |

Both routes fetch server-side data; both are public (no auth check). They return 404 if the hand exists but `completed_at` is null, or if the hand does not exist.

---

## API

### `GET /api/recap/:gameId/:handNumber`

Returns a server-derived digest of the hand. Parses `hand_actions` once server-side and materializes the summary.

**Response** (`200 OK`)
```
{
  gameId: number,
  handNumber: number,
  variant: 'normal' | 'leaster' | 'schwanzer',
  callMode: 'ace' | 'ten' | 'king' | null,   // null for leaster/schwanzer
  startedAt: string,                           // ISO timestamp
  completedAt: string,
  players: [
    { userId, username, seat, isBot }         // all 5 seats, in seat order
  ],
  dealt: {                                    // what each player held at deal time
    [userId]: string[]                        // array of card ids (6 cards)
  },
  blind: string[],                            // 2 cards; null for leaster/schwanzer if no pick phase happened
  picker: { userId } | null,                  // null for leaster/schwanzer
  partner: { userId, revealedOnTrick } | null,
  calledCard: string | null,
  pickerDiscards: string[],                   // 2 cards; null for leaster/schwanzer
  tricks: [                                   // empty array for schwanzer
    {
      trickNumber: number,                    // 1..6
      leaderUserId: number,
      plays: [ { userId, card, seq } ],       // in play order, seq = hand_actions.seq of that play
      winnerUserId: number,
      cardPoints: number
    }
  ],
  scores: [
    { userId, cardPoints, scoreDelta }
  ]
}
```

**Errors**
- `404` — hand not found OR `completed_at IS NULL` (anti-cheat)

### `GET /api/recap/:gameId/:handNumber/actions`

Returns the raw action log. Used only when the detailed replay page loads.

**Response** (`200 OK`)
```
{
  actions: [
    { seq, type, userId, payload, createdAt }
  ]
}
```

`payload` is the parsed JSON object from `hand_actions.payload_json`.

**Errors**
- `404` — same rules as the digest endpoint

---

## Data model

No schema changes. Uses existing tables as-is:

- `hands` — gates access via `completed_at IS NOT NULL`
- `hand_actions` — source of truth; digest endpoint parses these rows server-side
- `games` — seat → user mapping
- `users` — usernames
- `score_events` — read for `scoreDelta` in the digest response

### Digest derivation logic (server-side)

Pseudocode — runs on every `GET /api/recap/:gameId/:handNumber`:

1. Load `hands` row. If missing or `completed_at IS NULL` → 404.
2. Load all `hand_actions` for this `(game_id, hand_number)`, ordered by `seq`.
3. Walk actions once, filling in the digest:
   - `type='deal'` → `dealt`, `blind`
   - `type='pick'` → `picker`
   - `type='call'` → `calledCard`, `callMode`
   - `type='discard'` → `pickerDiscards`
   - `type='play'` → append to the current trick's `plays`; if `revealsPartner` flag in payload, set `partner.revealedOnTrick`
   - Trick boundaries come from `play` count (every 5 plays = end of trick); the trick winner is computed by calling the existing trick-winner logic in `shared/gameEngine.js` over the 5 plays (whether or not an action payload happens to store it)
4. Load `score_events` rows for this hand → `scores[]`.
5. Return.

The digest is computed fresh on each request. D1 latency + 5×6 card plays = negligible. No caching in v1.

---

## Frontend

### New components
- `frontend/src/pages/RecapPage.jsx` — simple recap, renders from digest endpoint
- `frontend/src/pages/DetailedReplayPage.jsx` — step-through, renders from actions endpoint
- `frontend/src/components/recap/TrickTable.jsx` — the 6-row × 5-player card grid
- `frontend/src/components/recap/MetaStrip.jsx` — variant/picker/partner/called row
- `frontend/src/components/recap/BlindStrip.jsx` — blind + discards
- `frontend/src/components/recap/ScoresList.jsx` — final scores
- `frontend/src/components/recap/ReplayControls.jsx` — step/auto-play/scrubber

### Modified components
- `frontend/src/components/GameLog.jsx` — when rendering a log line matching `^--- Hand (\d+) complete ---$`, wrap the "Hand N" substring in a `<Link>` to `/recap/:gameId/:handNumber`. `gameId` comes from a new prop.
- `frontend/src/pages/GamePage.jsx` — pass `gameId` to `<GameLog />`.
- `frontend/src/App.jsx` (or wherever routes live) — register the two new routes.

### Visual design

Per the mockups locked in during brainstorming (saved in `.superpowers/brainstorm/`):

- **Simple recap** — matches `simple-recap-v4.html`. 900px shell, 48×66 card size, yellow inset outline = led, green outline + glow = trick winner, hover lifts card.
- **Detailed replay** — matches `option-a-bot-debug-v2.html`. 5 seats around a central trick zone, all hands shown face-up, played cards dimmed with strikethrough, "now playing" card highlighted, right-side panel with stubbed inference block + engine state.

### Variant handling

- **Normal** — full mockup as drawn.
- **Leaster** — same layout, no picker/partner highlight on meta or column headers, `BlindStrip` hidden (no pick phase), `ScoresList` has a "Hand winner: {lowest-points player}" callout.
- **Schwanzer** — `TrickTable` renders with the trick-row axis collapsed to a single row per player showing their dealt hand (cards), since no tricks are played. `BlindStrip` hidden. Scores computed from dealt cards per Schwanzer rules.

### Detailed replay controls
- Buttons: `⏮ Hand start`, `◀ Prev trick`, `◀ Step`, `▶ Step`, `Next trick ▶`, `End ⏭`, `▶▶ Auto`
- Auto-play toggle adds a speed selector: 1x (1s/action), 2x (500ms), 4x (250ms)
- Scrubber at the bottom reflects `seq` progress through the action log

### Linking from simple → detailed replay
Each card **in the trick table** is an `<a>` that navigates to `/recap/:gameId/:handNumber/replay?seq=${play.seq}`. The replay page reads the `seq` query param and seeks to that index on load. When no `seq` is provided, it starts at the deal.

Cards in the blind strip (the blind itself and the picker's discards) are **not** links — they don't correspond to a single action seq in a meaningful way (the discard action covers both cards at once, and the blind is part of the deal).

---

## Anti-cheat

Single rule, enforced at the API layer: **if `hands.completed_at IS NULL`, return 404 from both endpoints.** Frontend doesn't attempt to enforce — it just renders the error page if it gets a 404.

The `GameLog` link wrapping also only kicks in for the `Hand complete` log line, not the `Hand started` line, so there's no in-UI path to an incomplete recap in the first place.

---

## Testing

- `hand_actions` digest derivation logic gets unit tests for each variant (Normal, Leaster, Schwanzer) with fixture action logs
- API endpoint tests: 200 happy path, 404 for missing hand, 404 for incomplete hand
- Frontend: component tests for `TrickTable` (winner/led styling, card links), `BlindStrip` (hidden for leaster/schwanzer), `MetaStrip` (picker/partner highlights, leaster/schwanzer variants)
- No E2E tests for the recap flow in v1 (can add later)

---

## Open items (tracked, not blocking v1)

- **#125** — Capture bot inference snapshots in `hand_actions.payload_json` to populate the right-side panel on the detailed replay. For v1, that panel shows a "not captured" stub.
