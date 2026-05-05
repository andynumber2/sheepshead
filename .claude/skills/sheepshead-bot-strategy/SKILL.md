---
name: sheepshead-bot-strategy
description: Use when asked anything about Sheepshead bot behavior, strategy analysis, game situation debugging, or why the bot played a specific card
---

# Sheepshead Bot Strategy

## Overview

A meta-tool for interfacing with the bot strategy without requiring the user to understand the code. The user speaks in game terms — you translate to and from code.

**Iron Law: Read the source before reasoning. Invented logic will recommend illegal plays.**

## Required Reading (do this first, every time)

Before analyzing any bot situation, read ALL of these in order:

1. **`shared/CLAUDE.md`** — Terminology definitions. If the user uses a term you're unsure of, check here before asking.
2. **`shared/gameEngine.js`** — The rules as implemented. Determines what plays are legal.
3. **`shared/botStrategy.js`** — The bot's decision tree.
4. **`shared/botInference.js`** — The supporting inference functions the strategy calls.

Then verify consistency:

5. **`docs/BOTS.md`** — Must match `botStrategy.js` / `botInference.js`. If it doesn't, STOP and tell the user before proceeding.

**Do not skip any of these.** Reasoning from training data alone will produce invented branch names, wrong rule assumptions, and illegal play recommendations — as demonstrated in baseline testing.

## Communication Rules

- **Suits: always use letters (H, D, C, S)** — never symbols (♥, ♦, ♣, ♠)
- **Speak the user's language** — they speak in game rules and jargon, not code. Translate bot logic into plain game terms in your response.
- **Unknown terms** — if the user uses a term, rule, or phrase you don't recognize, check CLAUDE.md first. If still unclear, ask before proceeding.
- **No illegal plays** — before suggesting any play, verify it's legal under the rules in `gameEngine.js`. If the user requests something that would violates the rules, flag it and ask for clarification.

## Looking at a Game

When the user asks you to look at a specific game:

| User says | DB flag to use |
|-----------|----------------|
| "prod" / "production" | `--remote` |
| "dev" / "development" / "local" / unspecified | `--local` |

Use the DB helper commands in `CLAUDE.md` to query game state.

## Verifying Legal Plays

Before suggesting any alternative play, check legality explicitly:

1. **Must-follow**: If the bot holds any card of the led suit, it must play one. Off-suit plays while holding a legal follow card are illegal.
2. **Called-card must-play**: If the called suit is led and the bot holds the called card (the called ace, ten, or king depending on call mode), the bot is the partner and is forced to play that card. There is no "saving it for later."
3. **Trump-in restriction**: Bots cannot volunteer trump if they can follow suit.

Verify these before stating what the bot should or could have played.

## Red Flags — Stop and Re-read

| Thought | What it means |
|---------|---------------|
| "I know how sheepshead trump works" | You may be wrong. Read `gameEngine.js`. |
| "The bot could have played X (off-suit)" | Check must-follow first. Off-suit while holding a legal follow is illegal. |
| "I'll reason from the strategy description" | Read the actual code. BOTS.md and code can diverge. |
| "The called card doesn't matter here" | The called-card is a forced play when its suit is led. Check `gameEngine.js`. |
| "The bot could have held the called ace back" | It cannot. Playing the called card when its suit is led is mandatory. |

## Common Mistakes (from baseline testing)

**Recommending illegal plays:** An agent told a user to "play 7S instead of AH." The bot held AH (the called ace) when the called suit (hearts) was led — AH was a forced legal play, and 7S was off-suit while a legal follow card was held. Only read source files prevent this.

**Inventing branch names:** Without reading the code, agents fabricate strategy descriptions that sound plausible but don't match the actual decision tree. This misleads the user about what the bot will actually do.

**Using suit symbols:** The user is reading in a terminal context. H/D/C/S is clearer than ♥/♦/♣/♠.
