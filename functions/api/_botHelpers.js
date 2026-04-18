// ─── Bot helpers ─────────────────────────────────────────────────────────────
// Shared utilities for play bot allocation and server-side bot turn processing.

import {
  currentPicker, currentPlayer,
  pick, blitz, pass, bury,
  callAce, callAceUnknown, callTen, callKing, goAlone,
  playCard, crack, recrack,
  setupLeaster, awardLeasterBlind, resolveLeaster,
  resolveSchwanzer,
  dealHand, getPlayerView,
} from '../../shared/gameEngine.js'

import {
  decidePick, decideBlitz, decideBury, decideCall, decidePlay,
} from '../../shared/botStrategy.js'

async function appendAction(DB, gameId, handNumber, type, userId, payload) {
  const row = await DB.prepare(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM hand_actions WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).first()
  await DB.prepare(
    'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(gameId, handNumber, row.next, type, userId ? Number(userId) : null, payload ? JSON.stringify(payload) : null).run()
}

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

  const variant = state.isLeaster ? 'leaster' : (state.picker === null ? 'schwanzer' : 'normal')

  // Insert score_events (one per player)
  const scoreStmts = Object.entries(scores).map(([userId, delta]) =>
    DB.prepare(
      'INSERT INTO score_events (user_id, game_id, hand_number, delta) VALUES (?, ?, ?, ?)'
    ).bind(Number(userId), gameId, state.handNumber, delta)
  )

  // Upsert user_scores (increment lifetime totals)
  const upsertStmts = Object.entries(scores).map(([userId, delta]) =>
    DB.prepare(`
      INSERT INTO user_scores (user_id, lifetime_score, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        lifetime_score = lifetime_score + excluded.lifetime_score,
        updated_at = datetime('now')
    `).bind(Number(userId), delta)
  )

  // Complete the current hands row
  const completeHandStmt = DB.prepare(
    "UPDATE hands SET variant = ?, completed_at = datetime('now') WHERE game_id = ? AND hand_number = ?"
  ).bind(variant, gameId, state.handNumber)

  // Deal the next hand
  const { results: players } = await DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
  ).bind(gameId).all()
  const playerIds = players.map(p => String(p.user_id))
  const nextDealer = (state.dealerSeat + 1) % 5
  const nextHandNumber = state.handNumber + 1
  const nextState = dealHand(playerIds, nextDealer, nextHandNumber, 1)
  nextState.doublerMultiplier = 1

  const gameRow = await DB.prepare('SELECT settings_json FROM games WHERE id = ?').bind(gameId).first()
  const settings = JSON.parse(gameRow.settings_json)
  nextState.reveal_partner = settings.reveal_partner
  nextState.double_on_bump = settings.double_on_bump

  nextState.log = [...state.log, `--- Hand ${state.handNumber} complete ---`]
  nextState.lastTrick = state.lastTrick

  // Reset doubler_multiplier in settings_json
  const gameUpdateStmt = DB.prepare(
    "UPDATE games SET settings_json = json_set(settings_json, '$.doubler_multiplier', 1), updated_at = datetime('now') WHERE id = ?"
  ).bind(gameId)

  // Insert next hands row + deal action (seq is always 0 for the first action of a new hand)
  const nextHandStmt = DB.prepare(
    'INSERT INTO hands (game_id, hand_number) VALUES (?, ?)'
  ).bind(gameId, nextHandNumber)

  const dealActionStmt = DB.prepare(
    'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, 0, ?, NULL, ?)'
  ).bind(gameId, nextHandNumber, 'deal', JSON.stringify(nextState))

  await DB.batch([...scoreStmts, ...upsertStmts, completeHandStmt, gameUpdateStmt, nextHandStmt, dealActionStmt])

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
//   Non-playing phases (picking, burying, calling): loop freely — these
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
    const handNumberBeforeAction = current.handNumber
    const { state: newState, actionType, payload } = applyBotDecision(current, nextActorId, view)
    current = newState
    if (actionType) {
      await appendAction(DB, gameId, handNumberBeforeAction, actionType, nextActorId, payload)
    }

    // Resolve no-pick (all players passed)
    if (current.phase === 'no_pick') {
      const noPickHandNumber = current.handNumber
      current = await resolveNoPick(current, game, DB, gameId)
      const noPickSettings = JSON.parse(game.settings_json)
      if (noPickSettings.no_pick_variant === 'leasters') {
        await appendAction(DB, gameId, noPickHandNumber, 'setup_leaster', null, null)
      }
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
    case 'burying':    return state.picker
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
        return { state: blitz(state, userId), actionType: 'blitz', payload: null }
      }
      const shouldPick = decidePick(view, userId)
      if (shouldPick) {
        return { state: pick(state, userId), actionType: 'pick', payload: null }
      }
      return { state: pass(state, userId), actionType: 'pass', payload: null }
    }

    case 'burying': {
      const cardIds = decideBury(view, userId)
      return { state: bury(state, userId, cardIds), actionType: 'bury', payload: { cardIds } }
    }

    case 'calling': {
      const decision = decideCall(view, userId)
      switch (decision.type) {
        case 'ace':
          return { state: callAce(state, userId, decision.suit), actionType: 'call_ace', payload: { suit: decision.suit } }
        case 'ace_unknown':
          return { state: callAceUnknown(state, userId, decision.suit, decision.underCardId), actionType: 'call_ace_unknown', payload: { suit: decision.suit, underCardId: decision.underCardId } }
        case 'ten':
          return { state: callTen(state, userId, decision.suit), actionType: 'call_ten', payload: { suit: decision.suit } }
        case 'king':
          return { state: callKing(state, userId, decision.suit), actionType: 'call_king', payload: { suit: decision.suit } }
        default:
          return { state: goAlone(state, userId), actionType: 'go_alone', payload: null }
      }
    }

    case 'playing': {
      const cardId = decidePlay(view, userId)
      return { state: playCard(state, userId, cardId), actionType: 'play_card', payload: { cardId } }
    }

    default:
      return { state, actionType: null, payload: null }
  }
}

async function resolveNoPick(state, game, DB, gameId) {
  const settings = JSON.parse(game.settings_json)

  if (settings.no_pick_variant === 'leasters') {
    return setupLeaster(state)
  }

  if (settings.no_pick_variant === 'schwanzers') {
    const { scores } = resolveSchwanzer(state)
    state.scores = scores
    state.phase = 'scoring'
    await appendAction(DB, gameId, state.handNumber, 'schwanzer_score', null, JSON.stringify({ scores }))
    return finishHand(DB, gameId, state)
  }

  // Doublers: deal a new hand with doubled multiplier
  const newMultiplier = state.doublerMultiplier * 2
  const { results: players } = await DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
  ).bind(gameId).all()
  const playerIds = players.map(p => String(p.user_id))
  const nextDealer = (state.dealerSeat + 1) % 5
  const nextHandNumber = state.handNumber + 1
  const newState = dealHand(playerIds, nextDealer, nextHandNumber, newMultiplier)
  newState.doublerMultiplier = newMultiplier
  newState.reveal_partner = settings.reveal_partner
  newState.double_on_bump = settings.double_on_bump
  newState.log = [...state.log, ...newState.log, `Doubler! Stakes are now ×${newMultiplier}.`]

  // Complete current hand, update multiplier, and insert next hand + deal action atomically
  // seq is always 0 for the first action of a new hand
  await DB.batch([
    DB.prepare("UPDATE hands SET variant = 'no_pick', completed_at = datetime('now') WHERE game_id = ? AND hand_number = ?").bind(gameId, state.handNumber),
    DB.prepare("UPDATE games SET settings_json = json_set(settings_json, '$.doubler_multiplier', ?), updated_at = datetime('now') WHERE id = ?").bind(newMultiplier, gameId),
    DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, ?)').bind(gameId, nextHandNumber),
    DB.prepare('INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, 0, ?, NULL, ?)').bind(gameId, nextHandNumber, 'deal', JSON.stringify(newState)),
  ])

  return newState
}

async function persistState(DB, gameId, state) {
  const { rewindHistory: _dropped, ...stateToStore } = state
  await DB.prepare(
    "UPDATE game_state SET state_json = ?, updated_at = datetime('now') WHERE game_id = ?"
  ).bind(JSON.stringify(stateToStore), gameId).run()
  await DB.prepare(
    "UPDATE games SET updated_at = datetime('now') WHERE id = ?"
  ).bind(gameId).run()
}
