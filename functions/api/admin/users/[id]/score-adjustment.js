import { json, err, requireAdmin, AuthError } from '../../../_helpers.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const _admin = await requireAdmin(request, env.DB)
    const userId = Number(params.id)

    const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
    if (!target) return err('User not found.', 404)

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }

    const { new_lifetime_score } = body
    if (typeof new_lifetime_score !== 'number' || !Number.isInteger(new_lifetime_score))
      return err('new_lifetime_score must be an integer.')

    await env.DB.prepare(`
      INSERT INTO user_scores (user_id, lifetime_score, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        lifetime_score = excluded.lifetime_score,
        updated_at     = datetime('now')
    `).bind(userId, new_lifetime_score).run()

    const updated = await env.DB.prepare(
      'SELECT lifetime_score FROM user_scores WHERE user_id = ?'
    ).bind(userId).first()

    return json({
      id:             userId,
      lifetime_score: updated?.lifetime_score ?? 0,
    })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}
