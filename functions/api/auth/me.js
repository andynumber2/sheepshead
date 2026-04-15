import { json, err, getUser, centralDate } from '../_helpers.js'

export async function onRequestGet({ request, env }) {
  const user = await getUser(request, env.DB)
  if (!user) return err('Not authenticated.', 401)

  // Fetch lifetime + today scores
  const lifetime = await env.DB.prepare(
    'SELECT COALESCE(SUM(delta), 0) as total FROM score_events WHERE user_id = ?'
  ).bind(user.user_id).first()

  const today = await env.DB.prepare(
    'SELECT COALESCE(SUM(delta), 0) as total FROM score_events WHERE user_id = ? AND game_date = ?'
  ).bind(user.user_id, centralDate()).first()

  return json({
    id: user.user_id,
    username: user.username,
    is_admin: user.is_admin === 1,
    is_bot:   user.is_bot   === 1,
    lifetimeScore: lifetime?.total ?? 0,
    todayScore:    today?.total    ?? 0,
  })
}
