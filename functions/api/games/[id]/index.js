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
      `SELECT gp.seat, gp.user_id, u.username, u.is_bot, u.bot_type
       FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       WHERE gp.game_id = ?
       ORDER BY gp.seat`
    ).bind(gameId).all()

    // Game score + day score + lifetime score for each player in one query
    const { results: scoreRows } = await env.DB.prepare(`
      SELECT
        user_id,
        COALESCE(SUM(CASE WHEN game_id = ? THEN delta ELSE 0 END), 0)                        AS game_score,
        COALESCE(SUM(CASE WHEN date(recorded_at) = date('now') THEN delta ELSE 0 END), 0)    AS day_score,
        COALESCE(SUM(delta), 0)                                                               AS lifetime_score
      FROM score_events
      WHERE user_id IN (SELECT user_id FROM game_players WHERE game_id = ?)
      GROUP BY user_id
    `).bind(gameId, gameId).all()

    const scoreMap = Object.fromEntries(scoreRows.map(r => [r.user_id, r]))

    const playersWithScores = players.map(p => {
      const s = scoreMap[p.user_id] ?? {}
      return {
        ...p,
        score:           s.game_score     ?? 0,
        day_score:       s.day_score      ?? 0,
        lifetime_score:  s.lifetime_score ?? 0,
      }
    })

    let stateView = null
    if (game.status === 'active') {
      const stateRow = await env.DB.prepare(
        'SELECT state_json FROM game_state WHERE game_id = ?'
      ).bind(gameId).first()

      if (stateRow) {
        const state = JSON.parse(stateRow.state_json)
        const userId = String(user.user_id)
        const isTestModeAdmin = game.is_test_mode && user.is_admin

        // In test mode the admin sees all hands unredacted
        stateView = isTestModeAdmin ? state : getPlayerView(state, userId)
      }
    }

    return json({
      ...game,
      is_test_mode:   game.is_test_mode   === 1,
      reveal_partner: game.reveal_partner === 1,
      is_admin:       game.created_by     === user.user_id,
      players:        playersWithScores,
      state:          stateView,
    })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
