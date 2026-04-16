import { json, err, requireUser, AuthError } from '../../_helpers.js'
import {
  pick, blitz, pass, discard, callAce, callAceUnknown, callTen, callKing, goAlone, playCard,
  crack, recrack,
  setupLeaster, awardLeasterBlind, resolveLeaster,
  resolveSchwanzer,
  dealHand, currentPlayer,
} from '../../../../shared/gameEngine.js'
import { replayActions } from '../../../../shared/actionReplay.js'
import { finishHand, processBotTurns } from '../../_botHelpers.js'

// Append one action row to hand_actions. seq is auto-computed as MAX(seq)+1.
async function appendAction(DB, gameId, handNumber, type, userId, payload) {
  const row = await DB.prepare(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM hand_actions WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).first()
  await DB.prepare(
    'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(gameId, handNumber, row.next, type, userId ? Number(userId) : null, payload ? JSON.stringify(payload) : null).run()
}

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

    const settings = JSON.parse(game.settings_json)

    const stateRow = await env.DB.prepare(
      'SELECT state_json FROM game_state WHERE game_id = ?'
    ).bind(gameId).first()
    if (!stateRow) return err('Game state not found.')

    let state = JSON.parse(stateRow.state_json)

    const playerRow = await env.DB.prepare(
      'SELECT seat FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, user.user_id).first()
    if (!playerRow) return err('You are not in this game.', 403)

    let userId = String(user.user_id)
    if (actAsRaw) {
      if (!settings.is_test_mode) return err('act_as is only allowed in test mode games.', 403)
      if (!user.is_admin)         return err('Only admins can use act_as.', 403)
      const targetPlayer = await env.DB.prepare(
        `SELECT gp.user_id, u.is_bot FROM game_players gp JOIN users u ON u.id = gp.user_id
         WHERE gp.game_id = ? AND gp.user_id = ?`
      ).bind(gameId, Number(actAsRaw)).first()
      if (!targetPlayer) return err('act_as player is not in this game.', 400)
      userId = String(actAsRaw)
    }

    // Apply action
    switch (type) {
      case 'pick':
        state = pick(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'pick', userId, null)
        break

      case 'blitz':
        state = blitz(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'blitz', userId, null)
        break

      case 'pass': {
        const handNumberBeforePass = state.handNumber
        state = pass(state, userId)
        await appendAction(env.DB, gameId, handNumberBeforePass, 'pass', userId, null)

        if (state.phase === 'no_pick') {
          const freshGame = await env.DB.prepare('SELECT settings_json FROM games WHERE id = ?').bind(gameId).first()
          const freshSettings = JSON.parse(freshGame.settings_json)
          if (freshSettings.no_pick_variant === 'leasters') {
            state = setupLeaster(state)
            await appendAction(env.DB, gameId, handNumberBeforePass, 'setup_leaster', null, null)
          } else if (freshSettings.no_pick_variant === 'schwanzers') {
            const { scores } = resolveSchwanzer(state)
            state.scores = scores
            state.phase = 'scoring'
            state = await finishHand(env.DB, gameId, state)
          } else {
            // Doublers — deal a new hand with doubled multiplier
            const newMultiplier = state.doublerMultiplier * 2
            const { results: players } = await env.DB.prepare(
              'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
            ).bind(gameId).all()
            const playerIds = players.map(p => String(p.user_id))
            const nextDealer = (state.dealerSeat + 1) % 5
            const nextHandNumber = state.handNumber + 1
            const newState = dealHand(playerIds, nextDealer, nextHandNumber, newMultiplier)
            newState.doublerMultiplier = newMultiplier
            newState.reveal_partner = freshSettings.reveal_partner
            newState.double_on_bump = freshSettings.double_on_bump
            newState.log = [...state.log, ...newState.log, `Doubler! Stakes are now ×${newMultiplier}.`]

            await env.DB.batch([
              env.DB.prepare("UPDATE hands SET variant = 'no_pick', completed_at = datetime('now') WHERE game_id = ? AND hand_number = ?").bind(gameId, handNumberBeforePass),
              env.DB.prepare("UPDATE games SET settings_json = json_set(settings_json, '$.doubler_multiplier', ?), updated_at = datetime('now') WHERE id = ?").bind(newMultiplier, gameId),
              env.DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, ?)').bind(gameId, nextHandNumber),
              env.DB.prepare('INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, ?, 0, ?, NULL, ?)').bind(gameId, nextHandNumber, 'deal', JSON.stringify(newState)),
            ])
            state = newState
          }
        }
        break
      }

      case 'discard':
        state = discard(state, userId, payload?.cardIds)
        await appendAction(env.DB, gameId, state.handNumber, 'discard', userId, { cardIds: payload?.cardIds })
        break

      case 'call_ace':
        state = callAce(state, userId, payload?.suit)
        await appendAction(env.DB, gameId, state.handNumber, 'call_ace', userId, { suit: payload?.suit })
        break

      case 'call_ace_unknown':
        state = callAceUnknown(state, userId, payload?.suit, payload?.underCardId)
        await appendAction(env.DB, gameId, state.handNumber, 'call_ace_unknown', userId, { suit: payload?.suit, underCardId: payload?.underCardId })
        break

      case 'call_ten':
        state = callTen(state, userId, payload?.suit)
        await appendAction(env.DB, gameId, state.handNumber, 'call_ten', userId, { suit: payload?.suit })
        break

      case 'call_king':
        state = callKing(state, userId, payload?.suit)
        await appendAction(env.DB, gameId, state.handNumber, 'call_king', userId, { suit: payload?.suit })
        break

      case 'go_alone':
        state = goAlone(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'go_alone', userId, null)
        break

      case 'crack':
        state = crack(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'crack', userId, null)
        break

      case 'recrack':
        state = recrack(state, userId)
        await appendAction(env.DB, gameId, state.handNumber, 'recrack', userId, null)
        break

      case 'play_card': {
        const handNumberBeforePlay = state.handNumber
        state = playCard(state, userId, payload?.cardId)
        await appendAction(env.DB, gameId, handNumberBeforePlay, 'play_card', userId, { cardId: payload?.cardId })

        if (state.isLeaster && state.leasterBlind?.length > 0 && state.tricks.length === 1) {
          state = awardLeasterBlind(state)
        }

        if (state.phase === 'scoring') {
          state = await finishHand(env.DB, gameId, state)
        }
        break
      }

      case 'bot_play': {
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
        // No-op — kept for backward compatibility
        break

      case 'rewind_play': {
        if (!settings.is_test_mode) return err('rewind_play is only allowed in test mode games.', 403)
        if (!user.is_admin)         return err('Only admins can use rewind_play.', 403)

        const lastAction = await env.DB.prepare(
          'SELECT id FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq DESC LIMIT 1'
        ).bind(gameId, state.handNumber).first()

        if (lastAction) {
          await env.DB.prepare('DELETE FROM hand_actions WHERE id = ?').bind(lastAction.id).run()
        }

        const { results: remaining } = await env.DB.prepare(
          'SELECT type, user_id, payload_json FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq ASC'
        ).bind(gameId, state.handNumber).all()
        state = replayActions(remaining)
        break
      }

      case 'rewind_trick': {
        if (!settings.is_test_mode) return err('rewind_trick is only allowed in test mode games.', 403)
        if (!user.is_admin)         return err('Only admins can use rewind_trick.', 403)

        const { results: allActions } = await env.DB.prepare(
          'SELECT id, type FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq DESC'
        ).bind(gameId, state.handNumber).all()

        const playsToRemove = state.currentTrick.length > 0 ? state.currentTrick.length : 5
        let removed = 0
        const idsToDelete = []
        for (const action of allActions) {
          if (action.type === 'play_card') {
            idsToDelete.push(action.id)
            removed++
            if (removed === playsToRemove) break
          }
        }

        if (idsToDelete.length > 0) {
          await env.DB.batch(idsToDelete.map(id =>
            env.DB.prepare('DELETE FROM hand_actions WHERE id = ?').bind(id)
          ))
        }

        const { results: remaining } = await env.DB.prepare(
          'SELECT type, user_id, payload_json FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq ASC'
        ).bind(gameId, state.handNumber).all()
        state = replayActions(remaining)
        break
      }

      default:
        return err(`Unknown action type: ${type}`)
    }

    if ((type !== 'play_card' && type !== 'rewind_play' && type !== 'rewind_trick') || state.phase !== 'playing') {
      state = await processBotTurns(state, gameId, env.DB, game, { allowTrick1Lead: type === 'bot_play' })
    }

    const { rewindHistory: _dropped, ...stateToStore } = state

    await env.DB.prepare(
      "UPDATE game_state SET state_json = ?, updated_at = datetime('now') WHERE game_id = ?"
    ).bind(JSON.stringify(stateToStore), gameId).run()

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
