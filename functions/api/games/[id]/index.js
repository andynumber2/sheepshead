import { json, err, requireUser, getDayScoreRange, AuthError } from '../../_helpers.js'
import { getPlayerView } from '../../../../shared/gameEngine.js'

export async function onRequestGet({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)

    const rawSettings = JSON.parse(game.settings_json)
    // Normalize booleans: json_set may store 1/0 (SQLite integers) instead of true/false
    const settings = {
      ...rawSettings,
      is_test_mode:   !!rawSettings.is_test_mode,
      reveal_partner: !!rawSettings.reveal_partner,
      double_on_bump: !!rawSettings.double_on_bump,
    }

    const { results: players } = await env.DB.prepare(
      `SELECT gp.seat, gp.user_id, u.username, u.is_bot, u.bot_type
       FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       WHERE gp.game_id = ?
       ORDER BY gp.seat`
    ).bind(gameId).all()

    // Lifetime from user_scores cache; game score and day score from bounded score_events queries
    const tzRow = await env.DB.prepare("SELECT value FROM config WHERE key = 'score_timezone'").first()
    const timezone = tzRow?.value ?? 'America/Chicago'
    const [dayStart, dayEnd] = getDayScoreRange(timezone)

    const { results: scoreRows } = await env.DB.prepare(`
      SELECT
        user_id,
        COALESCE(SUM(CASE WHEN game_id = ? THEN delta ELSE 0 END), 0) AS game_score,
        COALESCE(SUM(CASE WHEN recorded_at >= ? AND recorded_at < ? THEN delta ELSE 0 END), 0) AS day_score
      FROM score_events
      WHERE user_id IN (SELECT user_id FROM game_players WHERE game_id = ?)
      GROUP BY user_id
    `).bind(gameId, dayStart, dayEnd, gameId).all()

    const { results: lifetimeRows } = await env.DB.prepare(`
      SELECT user_id, lifetime_score
      FROM user_scores
      WHERE user_id IN (SELECT user_id FROM game_players WHERE game_id = ?)
    `).bind(gameId).all()

    const scoreMap    = Object.fromEntries(scoreRows.map(r => [r.user_id, r]))
    const lifetimeMap = Object.fromEntries(lifetimeRows.map(r => [r.user_id, r.lifetime_score]))

    const adminUserId = game.created_by

    const playersWithScores = players.map(p => ({
      ...p,
      score:          scoreMap[p.user_id]?.game_score  ?? 0,
      day_score:      scoreMap[p.user_id]?.day_score    ?? 0,
      lifetime_score: lifetimeMap[p.user_id]            ?? 0,
      is_game_admin:  p.user_id === adminUserId,
    }))

    let stateView = null
    if (game.status === 'active') {
      const stateRow = await env.DB.prepare(
        'SELECT state_json FROM game_state WHERE game_id = ?'
      ).bind(gameId).first()

      if (stateRow) {
        const state = JSON.parse(stateRow.state_json)
        const userId = String(user.user_id)
        const isTestModeAdmin = settings.is_test_mode && user.is_admin
        stateView = isTestModeAdmin ? state : getPlayerView(state, userId)
      }
    }

    return json({
      id:             game.id,
      name:           game.name,
      status:         game.status,
      is_admin:       game.created_by === user.user_id,
      admin_user_id:  adminUserId,
      settings,
      players:        playersWithScores,
      state:          stateView,
    })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
