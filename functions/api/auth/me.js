import { json, err, getUser } from '../_helpers.js'

export async function onRequestGet({ request, env }) {
  const user = await getUser(request, env.DB)
  if (!user) return err('Not authenticated.', 401)

  // Fetch lifetime + today scores
  const lifetime = await env.DB.prepare(
    'SELECT COALESCE(SUM(delta), 0) as total FROM score_events WHERE user_id = ?'
  ).bind(user.user_id).first()

  const today = await env.DB.prepare(
    "SELECT COALESCE(SUM(delta), 0) as total FROM score_events WHERE user_id = ? AND date(recorded_at) = date('now')"
  ).bind(user.user_id).first()

  return json({
    id: user.user_id,
    username: user.username,
    lifetimeScore: lifetime?.total ?? 0,
    todayScore: today?.total ?? 0,
  })
}
