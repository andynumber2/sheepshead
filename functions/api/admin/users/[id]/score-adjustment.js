import { json, err, requireAdmin, AuthError, centralDate } from '../../../_helpers.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const _admin = await requireAdmin(request, env.DB)
    const userId = Number(params.id)

    const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
    if (!target) return err('User not found.', 404)

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }

    const { new_day_score, new_lifetime_score } = body
    if (typeof new_day_score !== 'number' || !Number.isInteger(new_day_score))
      return err('new_day_score must be an integer.')
    if (typeof new_lifetime_score !== 'number' || !Number.isInteger(new_lifetime_score))
      return err('new_lifetime_score must be an integer.')

    const today = centralDate()

    // Read current values
    const lifetimeRow = await env.DB.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS total FROM score_events WHERE user_id = ?'
    ).bind(userId).first()
    const dayRow = await env.DB.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS total FROM score_events WHERE user_id = ? AND game_date = ?'
    ).bind(userId, today).first()

    const current_lifetime = lifetimeRow?.total ?? 0
    const current_day = dayRow?.total ?? 0

    const day_delta = new_day_score - current_day
    const lifetime_only_delta = new_lifetime_score - (current_lifetime + day_delta)

    const stmts = []

    if (day_delta !== 0) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO score_events (user_id, game_id, hand_number, delta, game_date, is_adjustment) VALUES (?, 0, 0, ?, ?, 1)'
        ).bind(userId, day_delta, today)
      )
    }

    if (lifetime_only_delta !== 0) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO score_events (user_id, game_id, hand_number, delta, game_date, is_adjustment) VALUES (?, 0, 0, ?, NULL, 1)'
        ).bind(userId, lifetime_only_delta)
      )
    }

    if (stmts.length > 0) await env.DB.batch(stmts)

    // Return updated scores
    const updatedLifetime = await env.DB.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS total FROM score_events WHERE user_id = ?'
    ).bind(userId).first()
    const updatedDay = await env.DB.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS total FROM score_events WHERE user_id = ? AND game_date = ?'
    ).bind(userId, today).first()

    return json({
      id: userId,
      day_score: updatedDay?.total ?? 0,
      lifetime_score: updatedLifetime?.total ?? 0,
    })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}
