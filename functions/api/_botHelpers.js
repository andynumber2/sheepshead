// ─── Bot helpers ─────────────────────────────────────────────────────────────
// Shared utilities for play bot allocation and server-side bot turn processing.

import {
  currentPicker, currentPlayer,
  pick, blitz, pass, discard,
  callAce, callAceUnknown, callTen, callKing, goAlone,
  playCard, crack, recrack,
  setupLeaster, awardLeasterBlind, resolveLeaster,
  resolveSchwanzer,
  dealHand, getPlayerView,
} from '../../shared/gameEngine.js'

import {
  decidePick, decideBlitz, decideDiscard, decideCall, decidePlay,
} from '../../shared/botStrategy.js'

// ─── finishHand ───────────────────────────────────────────────────────────────
// Called when the hand reaches scoring phase. Writes score events, deals the
// next hand, and returns the fresh state. Shared by action.js and processBotTurns.
export async function finishHand(DB, gameId, state) {
  let scores = state.scores

  if (state.isLeaster) {
    const { scores: leasterScores } = resolveLeaster(state)
    scores = leasterScores
    state.scores = scores
  }

  const stmts = Object.entries(scores).map(([userId, delta]) =>
    DB.prepare(
      'INSERT INTO score_events (user_id, game_id, hand_number, delta) VALUES (?, ?, ?, ?)'
    ).bind(Number(userId), gameId, state.handNumber, delta)
  )
  await DB.batch(stmts)

  const { results: players } = await DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
  ).bind(gameId).all()
  const playerIds = players.map(p => String(p.user_id))
  const nextDealer = (state.dealerSeat + 1) % 5
  const nextState = dealHand(playerIds, nextDealer, state.handNumber + 1, 1)

  nextState.log = [...state.log, `--- Hand ${state.handNumber} complete ---`]
  nextState.lastTrick = state.lastTrick

  await DB.prepare(
    "UPDATE games SET doubler_multiplier = 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(gameId).run()

  return nextState
}

// ─── getAvailablePlayBots ─────────────────────────────────────────────────────
// Returns `count` play bot user rows that are not currently in an active game.
// Creates new bot accounts if the pool is exhausted.
export async function getAvailablePlayBots(DB, count) {
  const { results: available } = await DB.prepare(`
    SELECT u.id, u.username FROM users u
    WHERE u.bot_type = 'play'
      AND u.id NOT IN (
        SELECT gp.user_id FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        WHERE g.status IN ('waiting', 'active')
      )
    LIMIT ?
  `).bind(count).all()

  if (available.length >= count) return available.slice(0, count)

  // Pool exhausted — create new play bot accounts on demand
  const needed = count - available.length
  const newBots = await createPlayBots(DB, needed)
  return [...available, ...newBots]
}

async function createPlayBots(DB, count) {
  // Find the highest existing play-salt index to generate new unique salts
  const { results: existing } = await DB.prepare(
    "SELECT salt FROM users WHERE bot_type = 'play'"
  ).all()

  const maxIdx = existing.reduce((max, r) => {
    const m = r.salt?.match(/^play-salt-(\d+)$/)
    return m ? Math.max(max, parseInt(m[1], 10)) : max
  }, 0)

  const EXTRA_NAMES = [
    'Lucas', 'Mia', 'Liam', 'Harper', 'Ethan', 'Lily', 'Noah', 'Grace',
    'Mason', 'Chloe', 'Logan', 'Zoey', 'Elijah', 'Nora', 'Aiden', 'Riley',
  ]

  const newBots = []
  for (let i = 0; i < count; i++) {
    const idx = maxIdx + i + 1
    const saltPadded = String(idx).padStart(2, '0')
    // Cycle through extra names; append index suffix if needed
    const baseName = EXTRA_NAMES[i % EXTRA_NAMES.length]
    const suffix = Math.floor(i / EXTRA_NAMES.length) > 0 ? String(Math.floor(i / EXTRA_NAMES.length) + 1) : ''
    const username = `${baseName}${suffix}`

    const result = await DB.prepare(
      'INSERT INTO users (username, password_hash, salt, is_bot, bot_type) VALUES (?, ?, ?, 1, ?)'
    ).bind(username, 'bot-no-login', `play-salt-${saltPadded}`, 'play').run()

    newBots.push({ id: result.meta.last_row_id, username })
  }

  return newBots
}

// ─── processBotTurns ─────────────────────────────────────────────────────────
// Advances the game state through consecutive bot turns with two modes:
//
//   Non-playing phases (picking, discarding, calling): loop freely — these
//   resolve instantly because there's nothing visible to animate.
//
//   Playing phase: execute exactly ONE card play then stop. The frontend
//   detects the new state, waits a short delay, and fires a bot_play action
//   to trigger the next bot card — giving the appearance of sequential play.
//
// Saves state to the DB after each bot action and returns the final state.
export async function processBotTurns(state, gameId, DB, game, { allowTrick1Lead = false } = {}) {
  // Fetch bot-type for every player in this game once upfront
  const { results: players } = await DB.prepare(
    'SELECT gp.user_id, u.bot_type FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ?'
  ).bind(gameId).all()
  const botTypeMap = Object.fromEntries(players.map(p => [String(p.user_id), p.bot_type]))

  let current = state
  // canLeadTrick1 starts true only for bot_play; resets to false on each hand
  // boundary so that subsequent hands always get the full 5s crack window.
  let canLeadTrick1 = allowTrick1Lead
  const MAX_ITERS = 60  // safety cap; one full hand is ~37 actions

  for (let i = 0; i < MAX_ITERS; i++) {
    // Handle scoring phase entered when a bot plays the final card of a hand
    if (current.phase === 'scoring') {
      current = await finishHand(DB, gameId, current)
      canLeadTrick1 = false  // new hand — trick-1 delay applies again
      await persistState(DB, gameId, current)
      continue
    }

    const nextActorId = getNextActor(current)
    if (!nextActorId) break
    if (botTypeMap[nextActorId] !== 'play') break  // human's turn

    const wasPlayingPhase = current.phase === 'playing'

    // Stop before leading trick 1 — frontend needs 5s for the crack window.
    // canLeadTrick1 is only true for the current hand's initial bot_play lead.
    if (wasPlayingPhase && !canLeadTrick1 &&
        (current.tricks?.length ?? 0) === 0 &&
        (current.currentTrick?.length ?? 0) === 0) {
      break
    }

    const view = getPlayerView(current, nextActorId)
    current = applyBotDecision(current, nextActorId, view)

    // Resolve no-pick (all players passed)
    if (current.phase === 'no_pick') {
      current = await resolveNoPick(current, game, DB, gameId)
    }

    if (wasPlayingPhase) {
      // Award leaster blind after trick 1 (must happen before scoring check)
      if (current.isLeaster && current.leasterBlind?.length > 0 && current.tricks.length === 1) {
        current = awardLeasterBlind(current)
      }
      // If the bot played the last card of the hand, score and deal the next hand.
      if (current.phase === 'scoring') {
        current = await finishHand(DB, gameId, current)
        canLeadTrick1 = false  // new hand — trick-1 delay applies again
      }
      await persistState(DB, gameId, current)
      // If still in playing phase, stop — the frontend drives the next bot card.
      // If a new hand was dealt (picking phase), continue so picking-phase bots run.
      if (current.phase === 'playing') break
      continue
    }

    // Award leaster blind after trick 1 (non-playing-phase path)
    if (current.isLeaster && current.leasterBlind?.length > 0 && current.tricks.length === 1) {
      current = awardLeasterBlind(current)
    }

    await persistState(DB, gameId, current)
  }

  return current
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getNextActor(state) {
  switch (state.phase) {
    case 'picking':    return currentPicker(state)
    case 'discarding': return state.picker
    case 'calling':    return state.picker
    case 'playing':    return currentPlayer(state)
    default:           return null
  }
}

function applyBotDecision(state, userId, view) {
  switch (state.phase) {
    case 'picking': {
      const potentialBlitz = (view.potentialBlitzes ?? []).find(b => b.userId === userId)
      if (potentialBlitz && decideBlitz(view, userId)) {
        return blitz(state, userId)
      }
      const shouldPick = decidePick(view, userId)
      return shouldPick ? pick(state, userId) : pass(state, userId)
    }

    case 'discarding': {
      const cardIds = decideDiscard(view, userId)
      return discard(state, userId, cardIds)
    }

    case 'calling': {
      const decision = decideCall(view, userId)
      switch (decision.type) {
        case 'ace':         return callAce(state, userId, decision.suit)
        case 'ace_unknown': return callAceUnknown(state, userId, decision.suit, decision.underCardId)
        case 'ten':         return callTen(state, userId, decision.suit)
        case 'king':        return callKing(state, userId, decision.suit)
        default:            return goAlone(state, userId)
      }
    }

    case 'playing': {
      const cardId = decidePlay(view, userId)
      return playCard(state, userId, cardId)
    }

    default:
      return state
  }
}

async function resolveNoPick(state, game, DB, gameId) {
  if (game.no_pick_variant === 'leasters') {
    return setupLeaster(state)
  }

  if (game.no_pick_variant === 'schwanzers') {
    const { scores } = resolveSchwanzer(state)
    state.scores = scores
    state.phase = 'scoring'
    return finishHand(DB, gameId, state)
  }

  // Doublers: deal a new hand with doubled multiplier
  const newMultiplier = state.doublerMultiplier * 2
  const { results: players } = await DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
  ).bind(gameId).all()
  const playerIds = players.map(p => String(p.user_id))
  const nextDealer = (state.dealerSeat + 1) % 5
  const newState = dealHand(playerIds, nextDealer, state.handNumber + 1, newMultiplier)
  newState.doublerMultiplier = newMultiplier
  newState.log = [...state.log, ...newState.log, `Doubler! Stakes are now ×${newMultiplier}.`]

  await DB.prepare(
    "UPDATE games SET doubler_multiplier = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newMultiplier, gameId).run()

  return newState
}

async function persistState(DB, gameId, state) {
  await DB.prepare(
    "UPDATE game_state SET state_json = ?, updated_at = datetime('now') WHERE game_id = ?"
  ).bind(JSON.stringify(state), gameId).run()
  await DB.prepare(
    "UPDATE games SET updated_at = datetime('now') WHERE id = ?"
  ).bind(gameId).run()
}
