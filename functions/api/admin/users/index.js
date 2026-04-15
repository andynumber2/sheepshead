import { json, err, requireAdmin, AuthError, centralDate } from '../../_helpers.js'

export async function onRequestGet({ request, env }) {
  try {
    const _admin = await requireAdmin(request, env.DB)

    const today = centralDate()
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.username, u.is_admin, u.is_bot, u.created_at,
         COALESCE((SELECT SUM(se.delta) FROM score_events se WHERE se.user_id = u.id), 0) AS lifetime_score,
         COALESCE((SELECT SUM(se.delta) FROM score_events se WHERE se.user_id = u.id AND se.game_date = ?), 0) AS day_score
       FROM users u
       ORDER BY u.is_bot ASC, u.is_admin DESC, u.username ASC`
    ).bind(today).all()

    return json(results)
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}
