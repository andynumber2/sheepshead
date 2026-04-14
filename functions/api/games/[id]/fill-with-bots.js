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

    // Requester must already be in the game
    const membership = await env.DB.prepare(
      'SELECT id FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, user.user_id).first()
    if (!membership) return err('You are not in this game.', 403)

    const { results: currentPlayers } = await env.DB.prepare(
      'SELECT seat, user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()

    const emptyCount = 5 - currentPlayers.length
    if (emptyCount === 0) return err('Game is already full.')

    // Allocate play bots for empty seats
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

    // All 5 seats are now filled — deal and start
    const { results: allPlayers } = await env.DB.prepare(
      'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()
    const playerIds = allPlayers.map(p => String(p.user_id))

    let state = dealHand(playerIds, 0, 1, 1)
    state.reveal_partner = game.reveal_partner === 1
    state.double_on_bump = game.double_on_bump === 1

    await env.DB.prepare(
      "INSERT INTO game_state (game_id, state_json, updated_at) VALUES (?, ?, datetime('now'))"
    ).bind(gameId, JSON.stringify(state)).run()

    await env.DB.prepare(
      "UPDATE games SET status = 'active', updated_at = datetime('now') WHERE id = ?"
    ).bind(gameId).run()

    // Advance through any bot turns that precede the human's first action
    state = await processBotTurns(state, gameId, env.DB, game)

    return json({ ok: true, started: true })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    console.error(e)
    return err(e.message, 500)
  }
}
