import { json, err, hashPassword, randomHex, sessionCookie } from '../_helpers.js'

export async function onRequestPost({ request, env }) {
  const { DB } = env
  let body
  try { body = await request.json() } catch { return err('Invalid JSON.') }

  const { username, password } = body ?? {}
  if (!username || !password) return err('Username and password are required.')
  if (username.length < 2 || username.length > 32) return err('Username must be 2–32 characters.')
  if (password.length < 6) return err('Password must be at least 6 characters.')
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return err('Username may only contain letters, numbers, _ and -.')

  const existing = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()
  if (existing) return err('Username already taken.', 409)

  const salt = randomHex(16)
  const passwordHash = await hashPassword(password, salt)

  const result = await DB.prepare(
    'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)'
  ).bind(username, passwordHash, salt).run()

  const userId = result.meta.last_row_id
  const token = randomHex(32)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, userId, expiresAt).run()

  return new Response(JSON.stringify({ id: userId, username, is_admin: false }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token),
    },
  })
}
