import { json, err, requireUser, AuthError } from '../../_helpers.js'
import { dealHand } from '../../../../shared/gameEngine.js'
import { getAvailablePlayBots, processBotTurns } from '../../_botHelpers.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status !== 'waiting') return err('Game is not open for joining.')

    const membership = await env.DB.prepare(
      'SELECT id FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, user.user_id).first()
    if (!membership) return err('You are not in this game.', 403)

    const { results: currentPlayers } = await env.DB.prepare(
      'SELECT seat, user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()

    const emptyCount = 5 - currentPlayers.length
    if (emptyCount === 0) return err('Game is already full.')

    const bots = await getAvailablePlayBots(env.DB, emptyCount)
    const takenSeats = new Set(currentPlayers.map(p => p.seat))
    const insertStmts = []
    let seatCursor = 0
    for (const bot of bots) {
      while (takenSeats.has(seatCursor)) seatCursor++
      insertStmts.push(
        env.DB.prepare('INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)')
          .bind(gameId, bot.id, seatCursor)
      )
      takenSeats.add(seatCursor)
      seatCursor++
    }
    await env.DB.batch(insertStmts)

    const { results: allPlayers } = await env.DB.prepare(
      'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()
    const playerIds = allPlayers.map(p => String(p.user_id))

    const settings = JSON.parse(game.settings_json)
    let state = dealHand(playerIds, 0, 1, 1)
    state.reveal_partner = settings.reveal_partner
    state.double_on_bump = settings.double_on_bump

    const { rewindHistory: _dropped, ...stateToStore } = state

    await env.DB.batch([
      env.DB.prepare("INSERT INTO game_state (game_id, state_json, updated_at) VALUES (?, ?, datetime('now'))")
        .bind(gameId, JSON.stringify(stateToStore)),
      env.DB.prepare("UPDATE games SET status = 'active', current_hand = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(gameId),
      env.DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, 1)')
        .bind(gameId),
      env.DB.prepare(
        'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, 1, 0, ?, NULL, ?)'
      ).bind(gameId, 'deal', JSON.stringify(stateToStore)),
      env.DB.prepare(
        `INSERT INTO hand_players (game_id, hand_number, seat, user_id)
         SELECT ?, ?, seat, user_id FROM game_players WHERE game_id = ?`
      ).bind(gameId, 1, gameId),
    ])

    state = await processBotTurns(stateToStore, gameId, env.DB, game)

    return json({ ok: true, started: true })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    console.error(e)
    return err(e.message, 500)
  }
}
