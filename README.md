# Sheepshead

A web app for playing the card game Sheepshead, built on **Cloudflare Pages** with a React frontend and Cloudflare Workers Functions backend, backed by Cloudflare D1 (SQLite).

## Tech Stack

- **Frontend** — React 18 SPA (Vite), served from `frontend/`
- **Backend** — Cloudflare Pages Functions (`functions/api/`), each file maps to an API route
- **Database** — Cloudflare D1 (SQLite), accessed via the `DB` binding in `wrangler.toml`

## Development

```bash
npm install
npm run dev          # Vite on :3000 + Wrangler on :8788
npm run db:migrate:local   # apply DB migrations locally
npm run deploy       # build and deploy to Cloudflare Pages
```

## Rules

Sheepshead is a trick-taking card game for 5 players using a 32-card deck (7–A in four suits). All Queens and Jacks are permanent trump, as are all Diamonds, making trump a 14-card suit.

### Trump Order (highest → lowest)

Queen of Clubs, Queen of Spades, Queen of Hearts, Queen of Diamonds,
Jack of Clubs, Jack of Spades, Jack of Hearts, Jack of Diamonds,
Ace of Diamonds, 10 of Diamonds, King of Diamonds, 9 of Diamonds, 8 of Diamonds, 7 of Diamonds

### Non-Trump Suit Rank (highest → lowest)

Ace, 10, King, 9, 8, 7. Note that the 10 outranks the King.

### Card Point Values

| Card | Points |
|------|--------|
| Ace  | 11     |
| 10   | 10     |
| King | 4      |
| Queen | 3     |
| Jack | 2      |
| 9, 8, 7 | 0  |

Total points in the deck: 120.

### Phases of a Hand

#### 1. Picking

Two blind cards are dealt face-down. Starting left of the dealer, each player may **pick** (take the blind and become the picker) or **pass**. If all five players pass, what happens depends on the game's no-pick variant: the hand is played as a **Leaster**, the stakes double (**Doublers**), or the hand is scored immediately as a **Schwanzer**.

**Blitzing**

A player holding both black queens (Queen of Clubs + Queen of Spades) or both red queens (Queen of Hearts + Queen of Diamonds) may **blitz** when it is their turn to pick. Blitzing forces the player to pick (they take the blind and proceed to discarding), and doubles the hand's final payout (×2 on top of all other multipliers).

#### 2. Discarding

The picker adds the 2 blind cards to their hand (8 total) and buries 2 cards face-down. The buried cards count toward the picker's point pile at scoring. The picker may not bury cards required for the partner call (see below).

#### 3. Calling (Partner Selection)

After discarding, the picker calls a partner using one of three modes determined by their hand, or goes alone.

**Call Mode: Ace** (default)

The picker calls the Ace of a non-trump suit they neither hold nor buried.

- *Normal call* — the picker holds at least one fail card of the called suit. The holder of the called Ace is the partner; the partner is revealed when the called suit is led and the partner plays the Ace.
- *Unknown call* — the picker holds **no** fail card of the called suit (only available when no normal ace call exists). The picker places one card face-down from their hand as an **under card**. The picker must play the under card whenever the called suit is led; it is revealed only to the trick winner.

**Call Mode: Ten** (picker holds all 3 fail Aces)

The picker calls the Ten of a fail suit whose Ten they neither hold nor buried. The picker is forced to play the Ace of the called suit when the called suit is led.

**Call Mode: King** (picker holds all 3 fail Aces and all 3 fail Tens)

The picker calls the King of any fail suit. The picker is forced to play the Ace and Ten of the called suit (in either order) when the called suit is led.

**Going Alone**

Available in any call mode. The picker plays solo against all four opponents.

#### 4. Playing

The player left of the dealer leads the first trick. Players must follow suit if possible (trump counts as one suit). The highest trump wins a trump trick; the highest card of the led suit wins a non-trump trick. The winner of each trick leads the next.

**Partner reveal** — the partner is identified to all players the moment they play the called card (Ace, Ten, or King) in response to the called suit being led.

**Partner restrictions before reveal:**
- The partner may not lead the called suit unless they lead with the called card.
- The partner must play the called card when the called suit is led and they hold it.
- The called card may not be played by the partner in any other situation (unless it is their last card).

**Under card rules:**
- The under card has no trick-taking power (it cannot win a trick).
- The picker must play the under card when the called suit is led.
- The picker may also lead with the under card (this declares the called suit as the led suit).

**Crack / Recrack**

Before the first card is played, opponents who did not pass at picking may **crack** to double the hand's stakes. The picker or partner may then **recrack** to double again (×4 total on top of any other multiplier). Cracking is unavailable during a Leaster.

#### 5. Scoring

The picker team needs **61 or more points** out of 120 to win.

| Condition | Base Multiplier |
|-----------|----------------|
| Normal win/loss | ×1 |
| Schneider (winner ≥91 pts, or loser ≤29 pts) | ×2 |
| Schwarz (one side takes all 6 tricks) | ×3 |

The final multiplier is: `base × doubler × crack × blitz`.

**Picker wins:**
- With partner: picker earns 2 points, partner earns 1 point; each opponent loses 1 point (all × multiplier).
- Going alone: picker earns 4 points; each opponent loses 1 point (all × multiplier).

**Picker loses:**
- With partner: picker loses 2 points, partner loses 1 point; each opponent gains 1 point (all × multiplier).
- Going alone: picker loses 4 points; each opponent gains 1 point (all × multiplier).

### Leaster

When all five players pass and the no-pick variant is Leasters, a Leaster is played. There is no picker or partner — everyone plays for themselves. The blind cards are awarded to the winner of the first trick. The player who takes at least one trick and ends with the **fewest points** wins. **Tie-break:** if two or more eligible players are tied on points, the one who took the fewest tricks wins. The winner gains 4 points; all others lose 1 point.

### Doubler

When all five players pass and the no-pick variant is Doublers, no hand is played. Instead, the session-wide stakes multiplier doubles (×2, stacking on each successive no-pick), a new hand is dealt, and play continues until someone picks. The accumulated doubler multiplier applies to the final payout of the next played hand, then resets to ×1.

### Schwanzer

When all five players pass and the no-pick variant is set to Schwanzers, hands are scored immediately — no tricks are played. Each player's dealt hand is scored using the following point scheme:

| Card | Schwanzer Points |
|------|-----------------|
| Queen (any suit) | 3 |
| Jack (any suit) | 2 |
| Diamond pip (Ace, 10, King, 9, 8, 7 of Diamonds) | 1 |
| All other cards | 0 |

Note: the Queen of Diamonds scores as a queen (3 points), and the Jack of Diamonds scores as a jack (2 points) — not as diamond pips.

The player with the **most** Schwanzer points in their hand is the Schwanzer: they lose 4 points, and all other players gain 1 point.

**Tie-break:** If two or more players are tied for the most points, the player holding the most powerful trump card (Queen of Clubs > Queen of Spades > … > 7 of Diamonds) loses. If all tied players hold no trump, the first tied player in pick order loses.

The blind cards are not scored — only each player's 6 dealt cards count.

---

> **Maintainer note:** When rules change in `shared/gameEngine.js`, update the Rules section of this file to match.
