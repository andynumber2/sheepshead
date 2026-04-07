import { json, sessionCookie } from '../_helpers.js'

export async function onRequestPost({ request, env }) {
  const { DB } = env
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(/session=([^;]+)/)
  if (match) {
    await DB.prepare('DELETE FROM sessions WHERE id = ?').bind(match[1]).run()
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(null, true),
    },
  })
}
