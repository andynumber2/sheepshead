import { json, err, requireUser, AuthError } from '../../_helpers.js'
import {
  pick, pass, discard, callAce, playCard,
  setupLeaster, awardLeasterBlind, resolveLeaster,
  currentPicker, currentPlayer,
} from '../../../../shared/gameEngine.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id
    const userId = String(user.user_id)

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }
    const { type, payload } = body ?? {}

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status !== 'active') return err('Game is not active.')

    const stateRow = await env.DB.prepare(
      'SELECT state_json FROM game_state WHERE game_id = ?'
    ).bind(gameId).first()
    if (!stateRow) return err('Game state not found.')

    let state = JSON.parse(stateRow.state_json)

    // Verify player is in this game
    const player = await env.DB.prepare(
      'SELECT seat FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, user.user_id).first()
    if (!player) return err('You are not in this game.', 403)

    // Apply action
    switch (type) {
      case 'pick':
        state = pick(state, userId)
        break

      case 'pass':
        state = pass(state, userId)
        // Check for no-pick situation
        if (state.phase === 'no_pick') {
          if (game.no_pick_variant === 'leasters') {
            state = setupLeaster(state)
          } else {
            // Doublers: redeal with doubled multiplier
            const newMultiplier = state.doublerMultiplier * 2
            const { results: players } = await env.DB.prepare(
              'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
            ).bind(gameId).all()
            const playerIds = players.map(p => String(p.user_id))
            const nextDealer = (state.dealerSeat + 1) % 5
            state = dealHand(playerIds, nextDealer, state.handNumber + 1, newMultiplier)
            state.doublerMultiplier = newMultiplier
            state.log.push(`Doubler! Stakes are now ×${newMultiplier}.`)

            await env.DB.prepare(
              'UPDATE games SET doubler_multiplier = ?, updated_at = datetime(\'now\') WHERE id = ?'
            ).bind(newMultiplier, gameId).run()
          }
        }
        break

      case 'discard':
        state = discard(state, userId, payload?.cardIds)
        break

      case 'call_ace':
        state = callAce(state, userId, payload?.suit)
        break

      case 'play_card': {
        const wasLeaster = state.isLeaster
        state = playCard(state, userId, payload?.cardId)

        // In leasters, award blind to trick 1 winner
        if (state.isLeaster && state.leasterBlind?.length > 0 && state.tricks.length === 1) {
          state = awardLeasterBlind(state)
        }

        if (state.phase === 'scoring') {
          await finishHand(env.DB, gameId, game, state)
        }
        break
      }

      case 'next_hand':
        // Transition from scoring phase to the next hand
        if (state.phase !== 'scoring') return err('Not in scoring phase.')
        if (!state.nextHandState) return err('No next hand state available.')
        state = state.nextHandState
        break

      default:
        return err(`Unknown action type: ${type}`)
    }

    // Persist updated state
    await env.DB.prepare(
      'UPDATE game_state SET state_json = ?, updated_at = datetime(\'now\') WHERE game_id = ?'
    ).bind(JSON.stringify(state), gameId).run()

    await env.DB.prepare(
      'UPDATE games SET updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(gameId).run()

    return json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    console.error(e)
    return err(e.message, 400)
  }
}

async function finishHand(DB, gameId, game, state) {
  let scores = state.scores

  // Handle leaster scoring
  if (state.isLeaster) {
    const { scores: leasterScores } = resolveLeaster(state)
    scores = leasterScores
    state.scores = scores
  }

  // Write score events
  const stmts = Object.entries(scores).map(([userId, delta]) =>
    DB.prepare(
      'INSERT INTO score_events (user_id, game_id, hand_number, delta) VALUES (?, ?, ?, ?)'
    ).bind(Number(userId), gameId, state.handNumber, delta)
  )
  await DB.batch(stmts)

  // Start next hand
  const { results: players } = await DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
  ).bind(gameId).all()
  const playerIds = players.map(p => String(p.user_id))
  const nextDealer = (state.dealerSeat + 1) % 5
  const nextState = dealHand(playerIds, nextDealer, state.handNumber + 1, 1)

  // Carry log summary
  nextState.log.unshift(`--- Hand ${state.handNumber} complete. New hand starting. ---`)

  // Store the scoring state briefly so clients can see results, then the new hand
  // We keep scoring phase visible — client transitions after seeing scores
  state.nextHandState = nextState
  state.phase = 'scoring'

  // Reset doubler multiplier
  await DB.prepare(
    'UPDATE games SET doubler_multiplier = 1, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(gameId).run()
}
