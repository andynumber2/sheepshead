import { err, requireUser, AuthError, json } from '../../_helpers.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id
    const userId = user.user_id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status === 'complete') return err('Game is already complete.')

    const membership = await env.DB.prepare(
      'SELECT id FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, userId).first()
    if (!membership) return err('You are not in this game.', 403)

    // Remove the player
    await env.DB.prepare(
      'DELETE FROM game_players WHERE game_id = ? AND user_id = ?'
    ).bind(gameId, userId).run()

    // Check remaining players
    const { results: remaining } = await env.DB.prepare(
      `SELECT gp.id, u.bot_type FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       WHERE gp.game_id = ?`
    ).bind(gameId).all()

    if (remaining.length === 0) {
      // Last player left — end the game
      await env.DB.prepare(
        "UPDATE games SET status = 'complete', updated_at = datetime('now') WHERE id = ?"
      ).bind(gameId).run()
      return json({ left: true, ended: true })
    }

    if (game.status === 'active' && game.is_test_mode) {
      // Test mode: end the game immediately when anyone leaves
      await env.DB.prepare(
        "UPDATE games SET status = 'complete', updated_at = datetime('now') WHERE id = ?"
      ).bind(gameId).run()
      return json({ left: true, ended: true })
    }

    if (game.status === 'active' && remaining.some(p => p.bot_type === 'play')) {
      // Play bot game: end immediately when any human leaves
      await env.DB.prepare(
        "UPDATE games SET status = 'complete', updated_at = datetime('now') WHERE id = ?"
      ).bind(gameId).run()
      return json({ left: true, ended: true })
    }

    return json({ left: true, ended: false, player_count: remaining.length })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
