import { json, err, requireAdmin, AuthError } from '../../_helpers.js'

export async function onRequestGet({ request, env }) {
  try {
    const _admin = await requireAdmin(request, env.DB)

    const { results } = await env.DB.prepare(
      `SELECT id, username, is_admin, is_bot, created_at
       FROM users
       ORDER BY is_bot ASC, is_admin DESC, username ASC`
    ).all()

    return json(results)
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}
