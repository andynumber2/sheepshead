import { json, err, requireAdmin, hashPassword, randomHex, getDayScoreRange, getScoreTimezone, AuthError } from '../../../_helpers.js'

export async function onRequest({ request, env, params }) {
  try {
    if (request.method === 'GET')    return await getUser({ request, env, params })
    if (request.method === 'PATCH')  return await updateUser({ request, env, params })
    if (request.method === 'DELETE') return await deleteUser({ request, env, params })
    return err('Method not allowed.', 405)
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}

async function getUser({ request, env, params }) {
  const _admin = await requireAdmin(request, env.DB)
  const userId = params.id

  const user = await env.DB.prepare(
    'SELECT id, username, is_admin, is_bot, created_at FROM users WHERE id = ?'
  ).bind(userId).first()
  if (!user) return err('User not found.', 404)

  const timezone = await getScoreTimezone(env.DB)
  const [dayStart, dayEnd] = getDayScoreRange(timezone)

  const lifetimeRow = await env.DB.prepare(
    'SELECT lifetime_score FROM user_scores WHERE user_id = ?'
  ).bind(userId).first()

  const todayRow = await env.DB.prepare(
    'SELECT COALESCE(SUM(delta), 0) as total FROM score_events WHERE user_id = ? AND recorded_at >= ? AND recorded_at < ?'
  ).bind(userId, dayStart, dayEnd).first()

  return json({
    ...user,
    lifetimeScore: lifetimeRow?.lifetime_score ?? 0,
    todayScore:    todayRow?.total ?? 0,
  })
}

async function updateUser({ request, env, params }) {
  const admin = await requireAdmin(request, env.DB)
  const userId = Number(params.id)

  let body
  try { body = await request.json() } catch { return err('Invalid JSON.') }

  const target = await env.DB.prepare(
    'SELECT id, username, is_admin, is_bot FROM users WHERE id = ?'
  ).bind(userId).first()
  if (!target) return err('User not found.', 404)

  const fields = []
  const values = []

  // Username
  if (body.username !== undefined) {
    const u = body.username.trim()
    if (u.length < 2 || u.length > 32)       return err('Username must be 2–32 characters.')
    if (!/^[a-zA-Z0-9_-]+$/.test(u))          return err('Username may only contain letters, numbers, _ and -.')
    if (u !== target.username) {
      const taken = await env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(u, userId).first()
      if (taken) return err('Username already taken.', 409)
    }
    fields.push('username = ?')
    values.push(u)
  }

  // is_admin
  if (body.is_admin !== undefined) {
    fields.push('is_admin = ?')
    values.push(body.is_admin ? 1 : 0)
  }

  // is_bot
  if (body.is_bot !== undefined) {
    fields.push('is_bot = ?')
    values.push(body.is_bot ? 1 : 0)
  }

  // Password reset
  if (body.password) {
    if (body.password.length < 6) return err('Password must be at least 6 characters.')
    const salt = randomHex(16)
    const hash = await hashPassword(body.password, salt)
    fields.push('password_hash = ?', 'salt = ?')
    values.push(hash, salt)
  }

  if (fields.length === 0) return err('No fields to update.')

  values.push(userId)
  await env.DB.prepare(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...values).run()

  const updated = await env.DB.prepare(
    'SELECT id, username, is_admin, is_bot, created_at FROM users WHERE id = ?'
  ).bind(userId).first()

  // Flag if the admin just removed their own admin access
  const removedOwnAdmin = userId === admin.user_id && body.is_admin === false

  return json({ ...updated, removedOwnAdmin })
}

async function deleteUser({ request, env, params }) {
  const admin = await requireAdmin(request, env.DB)
  const userId = Number(params.id)

  if (userId === admin.user_id) return err('You cannot delete your own account.', 403)

  const target = await env.DB.prepare(
    'SELECT id FROM users WHERE id = ?'
  ).bind(userId).first()
  if (!target) return err('User not found.', 404)

  // Block deletion if user is in an active or waiting game
  const activeGame = await env.DB.prepare(`
    SELECT g.name FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = ? AND g.status IN ('waiting', 'active')
    LIMIT 1
  `).bind(userId).first()
  if (activeGame) return err(`Cannot delete: user is currently in game "${activeGame.name}".`, 409)

  // Clean up related rows (sessions will cascade, but clean others explicitly)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM game_players WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM score_events WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_scores WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ])

  return json({ deleted: true, id: userId })
}
