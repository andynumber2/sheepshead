import { json, err, hashPassword, randomHex, sessionCookie } from '../_helpers.js'

export async function onRequestPost({ request, env }) {
  const { DB } = env
  let body
  try { body = await request.json() } catch { return err('Invalid JSON.') }

  const { username, password } = body ?? {}
  if (!username || !password) return err('Username and password are required.')

  const user = await DB.prepare(
    'SELECT id, username, password_hash, salt, is_bot FROM users WHERE username = ?'
  ).bind(username).first()

  if (!user) return err('Invalid username or password.', 401)
  if (user.is_bot) return err('Bot accounts cannot log in.', 403)

  const hash = await hashPassword(password, user.salt)
  if (hash !== user.password_hash) return err('Invalid username or password.', 401)

  const token = randomHex(32)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, user.id, expiresAt).run()

  return new Response(JSON.stringify({ id: user.id, username: user.username }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token),
    },
  })
}
