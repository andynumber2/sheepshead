import { json, err, requireAdmin, AuthError } from '../../_helpers.js'

export async function onRequest({ request, env }) {
  try {
    if (request.method === 'GET')   return await getConfig({ request, env })
    if (request.method === 'PATCH') return await updateConfig({ request, env })
    return err('Method not allowed.', 405)
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.message === 'Admin access required.' ? 403 : 401)
    return err(e.message, 500)
  }
}

async function getConfig({ request, env }) {
  await requireAdmin(request, env.DB)

  const { results } = await env.DB.prepare('SELECT key, value FROM config').all()
  const config = Object.fromEntries(results.map(r => [r.key, r.value]))

  return json({
    max_active_games: parseInt(config.max_active_games ?? '5', 10),
  })
}

async function updateConfig({ request, env }) {
  await requireAdmin(request, env.DB)

  let body
  try { body = await request.json() } catch { return err('Invalid JSON.') }

  if (body.max_active_games !== undefined) {
    const val = parseInt(body.max_active_games, 10)
    if (!Number.isInteger(val) || val < 1 || val > 100) {
      return err('max_active_games must be an integer between 1 and 100.')
    }
    await env.DB.prepare(
      "INSERT INTO config (key, value, updated_at) VALUES ('max_active_games', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind(String(val)).run()
  }

  return getConfig({ request, env })
}
