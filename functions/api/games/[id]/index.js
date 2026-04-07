import { json, err, requireUser, AuthError } from '../../_helpers.js'
import { getPlayerView } from '../../../../shared/gameEngine.js'

export async function onRequestGet({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    const game = await env.DB.prepare(
      'SELECT * FROM games WHERE id = ?'
    ).bind(gameId).first()
    if (!game) return err('Game not found.', 404)

    const { results: players } = await env.DB.prepare(
      'SELECT gp.seat, gp.user_id, u.username FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.seat'
    ).bind(gameId).all()

    // Score per player for this game
    const { results: gameScores } = await env.DB.prepare(
      'SELECT user_id, SUM(delta) as score FROM score_events WHERE game_id = ? GROUP BY user_id'
    ).bind(gameId).all()
    const scoreMap = Object.fromEntries(gameScores.map(r => [r.user_id, r.score]))

    const playersWithScores = players.map(p => ({
      ...p,
      score: scoreMap[p.user_id] ?? 0,
    }))

    let stateView = null
    if (game.status === 'active') {
      const stateRow = await env.DB.prepare(
        'SELECT state_json FROM game_state WHERE game_id = ?'
      ).bind(gameId).first()

      if (stateRow) {
        const state = JSON.parse(stateRow.state_json)
        // Convert user_id keys from integer to string for lookup
        const userId = String(user.user_id)
        stateView = getPlayerView(state, userId)
      }
    }

    return json({
      ...game,
      players: playersWithScores,
      state: stateView,
    })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
