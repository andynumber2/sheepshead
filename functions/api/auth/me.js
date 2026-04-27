import { json, err, getUser, getDayScoreRange, getScoreTimezone } from '../_helpers.js'

export async function onRequestGet({ request, env }) {
  const user = await getUser(request, env.DB)
  if (!user) return err('Not authenticated.', 401)

  const timezone = await getScoreTimezone(env.DB)
  const [dayStart, dayEnd] = getDayScoreRange(timezone)

  const lifetimeRow = await env.DB.prepare(
    'SELECT lifetime_score FROM user_scores WHERE user_id = ?'
  ).bind(user.user_id).first()

  const todayRow = await env.DB.prepare(
    'SELECT COALESCE(SUM(delta), 0) as total FROM score_events WHERE user_id = ? AND recorded_at >= ? AND recorded_at < ?'
  ).bind(user.user_id, dayStart, dayEnd).first()

  return json({
    id:            user.user_id,
    username:      user.username,
    is_admin:      user.is_admin === 1,
    is_bot:        user.is_bot   === 1,
    lifetimeScore: lifetimeRow?.lifetime_score ?? 0,
    todayScore:    todayRow?.total ?? 0,
  })
}
