import { json, err, requireUser, AuthError } from '../_helpers.js'
import { dealHand } from '../../../shared/gameEngine.js'

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
    SELECT g.id, g.name, g.status, g.no_pick_variant, g.is_test_mode,
           u.username as created_by_username,
           g.created_by,
           COUNT(gp.id) as player_count,
           MAX(CASE WHEN gp.user_id = ? THEN 1 ELSE 0 END) as is_member
    FROM games g
    JOIN users u ON u.id = g.created_by
    LEFT JOIN game_players gp ON gp.game_id = g.id
    WHERE g.status IN ('waiting', 'active')
    GROUP BY g.id
    ORDER BY g.created_at DESC
    LIMIT 50
  `).bind(user.user_id).all()

  return json(results.map(g => ({
    ...g,
    is_member:    g.is_member === 1,
    is_admin:     g.created_by === user.user_id,
    is_test_mode: g.is_test_mode === 1,
  })))
}

async function createGame({ request, env }) {
  const user = await requireUser(request, env.DB)

  let body
  try { body = await request.json() } catch { return err('Invalid JSON.') }

  // Block if user is already in a game
  const existingGame = await env.DB.prepare(`
    SELECT g.id, g.name FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = ? AND g.status IN ('waiting', 'active')
    LIMIT 1
  `).bind(user.user_id).first()
  if (existingGame) {
    return err(`You are already in a game ("${existingGame.name}"). Leave it before creating a new one.`, 409)
  }

  const name         = body?.name?.trim() || `${user.username}'s game`
  const noPickVariant = body?.no_pick_variant === 'doublers' ? 'doublers' : 'leasters'
  const testMode     = !!(body?.test_mode && user.is_admin)

  if (testMode) {
    // Only admins can create test games, and only one at a time
    const existingTest = await env.DB.prepare(
      "SELECT id FROM games WHERE is_test_mode = 1 AND status IN ('waiting', 'active') LIMIT 1"
    ).first()
    if (existingTest) return err('A test mode game is already active. Only one test game can exist at a time.', 409)
  }

  const result = await env.DB.prepare(
    'INSERT INTO games (name, no_pick_variant, is_test_mode, created_by) VALUES (?, ?, ?, ?)'
  ).bind(name, noPickVariant, testMode ? 1 : 0, user.user_id).run()

  const gameId = result.meta.last_row_id

  // Creator joins as seat 0
  await env.DB.prepare(
    'INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)'
  ).bind(gameId, user.user_id, 0).run()

  if (testMode) {
    // Auto-join bot accounts as seats 1-4
    const { results: bots } = await env.DB.prepare(
      'SELECT id FROM users WHERE is_bot = 1 ORDER BY username LIMIT 4'
    ).all()

    if (bots.length < 4) return err('Not enough bot accounts found. Run migrations to seed bots.', 500)

    const botStmts = bots.map((bot, i) =>
      env.DB.prepare('INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)')
        .bind(gameId, bot.id, i + 1)
    )
    await env.DB.batch(botStmts)

    // All 5 seats filled — start the game immediately
    const allPlayers = [user.user_id, ...bots.map(b => b.id)]
    const state = dealHand(allPlayers.map(String), 0, 1, 1)

    await env.DB.prepare(
      "INSERT INTO game_state (game_id, state_json, updated_at) VALUES (?, ?, datetime('now'))"
    ).bind(gameId, JSON.stringify(state)).run()

    await env.DB.prepare(
      "UPDATE games SET status = 'active', updated_at = datetime('now') WHERE id = ?"
    ).bind(gameId).run()

    return json({ id: gameId, name, no_pick_variant: noPickVariant, is_test_mode: true, started: true }, 201)
  }

  return json({ id: gameId, name, no_pick_variant: noPickVariant, is_test_mode: false, player_count: 1 }, 201)
}
