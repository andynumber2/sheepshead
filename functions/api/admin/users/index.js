import { json, err, requireAdmin, getDayScoreRange, getScoreTimezone, AuthError } from '../../_helpers.js'

export async function onRequestGet({ request, env }) {
  try {
    const _admin = await requireAdmin(request, env.DB)

    const timezone = await getScoreTimezone(env.DB)
    const [dayStart, dayEnd] = getDayScoreRange(timezone)

    const { results } = await env.DB.prepare(
      `SELECT u.id, u.username, u.is_admin, u.is_bot, u.created_at,
         COALESCE(us.lifetime_score, 0) AS lifetime_score,
         COALESCE((
           SELECT SUM(se.delta) FROM score_events se
           WHERE se.user_id = u.id AND se.recorded_at >= ? AND se.recorded_at < ?
         ), 0) AS day_score
       FROM users u
       LEFT JOIN user_scores us ON us.user_id = u.id
       ORDER BY u.is_bot ASC, u.is_admin DESC, u.username ASC`
    ).bind(dayStart, dayEnd).all()

    return json(results)
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}
