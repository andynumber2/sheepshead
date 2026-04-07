import { json, err, requireUser, AuthError } from '../_helpers.js'

export async function onRequest({ request, env }) {
  try {
    if (request.method === 'GET') return await listGames({ request, env })
    if (request.method === 'POST') return await createGame({ request, env })
    return err('Method not allowed.', 405)
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}

async function listGames({ request, env }) {
  const user = await requireUser(request, env.DB)

  const { results } = await env.DB.prepare(`
    SELECT g.id, g.name, g.status, g.no_pick_variant,
           u.username as created_by_username,
           COUNT(gp.id) as player_count
    FROM games g
    JOIN users u ON u.id = g.created_by
    LEFT JOIN game_players gp ON gp.game_id = g.id
    WHERE g.status IN ('waiting', 'active')
    GROUP BY g.id
    ORDER BY g.created_at DESC
    LIMIT 50
  `).all()

  return json(results)
}

async function createGame({ request, env }) {
  const user = await requireUser(request, env.DB)

  let body
  try { body = await request.json() } catch { return err('Invalid JSON.') }

  const name = body?.name?.trim() || `${user.username}'s game`
  const noPickVariant = body?.no_pick_variant === 'doublers' ? 'doublers' : 'leasters'

  const result = await env.DB.prepare(
    'INSERT INTO games (name, no_pick_variant, created_by) VALUES (?, ?, ?)'
  ).bind(name, noPickVariant, user.user_id).run()

  const gameId = result.meta.last_row_id

  // Creator joins as seat 0
  await env.DB.prepare(
    'INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)'
  ).bind(gameId, user.user_id, 0).run()

  return json({ id: gameId, name, no_pick_variant: noPickVariant, player_count: 1 }, 201)
}
