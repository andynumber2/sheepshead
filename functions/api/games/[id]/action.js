import { json, err, requireUser, AuthError } from '../../_helpers.js'
import {
  pick, blitz, pass, discard, callAce, callAceUnknown, callTen, callKing, goAlone, playCard,
  crack, recrack,
  setupLeaster, awardLeasterBlind, resolveLeaster,
  resolveSchwanzer,
  dealHand, currentPlayer,
  rewindPlay, rewindTrick,
} from '../../../../shared/gameEngine.js'
import { finishHand, processBotTurns } from '../../_botHelpers.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }
    const { type, payload, act_as: actAsRaw } = body ?? {}

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status !== 'active') return err('Game is not active.')

    const stateRow = await env.DB.prepare(
      'SELECT state_json FROM game_state WHERE game_id = ?'
    ).bind(gameId).first()
    if (!stateRow) return err('Game state not found.')

    let state = JSON.parse(stateRow.state_json)

    // Verify requesting user is in this game
    const playerRow = await env.DB.prepare(
      'SELECT seat FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, user.user_id).first()
    if (!playerRow) return err('You are not in this game.', 403)

    // Resolve the effective userId for this action
    // In test mode, an admin can pass act_as to play on behalf of another player
    let userId = String(user.user_id)
    if (actAsRaw) {
      if (!game.is_test_mode)  return err('act_as is only allowed in test mode games.', 403)
      if (!user.is_admin)       return err('Only admins can use act_as.', 403)

      const targetPlayer = await env.DB.prepare(
        'SELECT gp.user_id, u.is_bot FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? AND gp.user_id = ?'
      ).bind(gameId, Number(actAsRaw)).first()
      if (!targetPlayer) return err('act_as player is not in this game.', 400)

      userId = String(actAsRaw)
    }

    // Apply action
    switch (type) {
      case 'pick':
        state = pick(state, userId)
        break

      case 'blitz':
        state = blitz(state, userId)
        break

      case 'pass':
        state = pass(state, userId)
        if (state.phase === 'no_pick') {
          // Re-read no_pick_variant from DB in case admin changed it mid-session
          const freshGame = await env.DB.prepare('SELECT no_pick_variant FROM games WHERE id = ?').bind(gameId).first()
          if (freshGame.no_pick_variant === 'leasters') {
            state = setupLeaster(state)
          } else if (freshGame.no_pick_variant === 'schwanzers') {
            const { scores } = resolveSchwanzer(state)
            state.scores = scores
            state.phase = 'scoring'
            state = await finishHand(env.DB, gameId, state)
          } else {
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
              "UPDATE games SET doubler_multiplier = ?, updated_at = datetime('now') WHERE id = ?"
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

      case 'call_ace_unknown':
        state = callAceUnknown(state, userId, payload?.suit, payload?.underCardId)
        break

      case 'call_ten':
        state = callTen(state, userId, payload?.suit)
        break

      case 'call_king':
        state = callKing(state, userId, payload?.suit)
        break

      case 'go_alone':
        state = goAlone(state, userId)
        break

      case 'crack':
        state = crack(state, userId)
        break

      case 'recrack':
        state = recrack(state, userId)
        break

      case 'play_card': {
        state = playCard(state, userId, payload?.cardId)

        if (state.isLeaster && state.leasterBlind?.length > 0 && state.tricks.length === 1) {
          state = awardLeasterBlind(state)
        }

        if (state.phase === 'scoring') {
          state = await finishHand(env.DB, gameId, state)
        }
        break
      }

      case 'bot_play': {
        // Triggered by the frontend when it detects a play bot's turn.
        // Validate the current player is actually a play bot, then let
        // processBotTurns execute the single card play below.
        if (state.phase !== 'playing') return err('Game is not in playing phase.')
        const botId = currentPlayer(state)
        if (!botId) return err('No current player.')
        const botRow = await env.DB.prepare(
          `SELECT u.bot_type FROM game_players gp
           JOIN users u ON u.id = gp.user_id
           WHERE gp.game_id = ? AND gp.user_id = ?`
        ).bind(gameId, Number(botId)).first()
        if (!botRow || botRow.bot_type !== 'play') return err('Current player is not a play bot.', 400)
        break
      }

      case 'next_hand':
        // No-op — hands now auto-advance; kept for backward compatibility
        break

      case 'rewind_play': {
        if (!game.is_test_mode) return err('rewind_play is only allowed in test mode games.', 403)
        if (!user.is_admin)     return err('Only admins can use rewind_play.', 403)
        state = rewindPlay(state)
        break
      }

      case 'rewind_trick': {
        if (!game.is_test_mode) return err('rewind_trick is only allowed in test mode games.', 403)
        if (!user.is_admin)     return err('Only admins can use rewind_trick.', 403)
        state = rewindTrick(state)
        break
      }

      default:
        return err(`Unknown action type: ${type}`)
    }

    // After a card play that leaves us in the playing phase, skip processBotTurns —
    // the frontend's bot_play trigger applies the same 700 ms delay for bots as for
    // the human who just played. If the hand ended (new picking phase), still run
    // processBotTurns so bot picks/passes resolve instantly as normal.
    if ((type !== 'play_card' && type !== 'rewind_play' && type !== 'rewind_trick') || state.phase !== 'playing') {
      state = await processBotTurns(state, gameId, env.DB, game, { allowTrick1Lead: type === 'bot_play' })
    }

    await env.DB.prepare(
      "UPDATE game_state SET state_json = ?, updated_at = datetime('now') WHERE game_id = ?"
    ).bind(JSON.stringify(state), gameId).run()

    await env.DB.prepare(
      "UPDATE games SET updated_at = datetime('now') WHERE id = ?"
    ).bind(gameId).run()

    return json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    console.error(e)
    return err(e.message, 400)
  }
}
