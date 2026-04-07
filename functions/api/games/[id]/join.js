import { json, err, requireUser, AuthError } from '../../_helpers.js'
import { dealHand } from '../../../../shared/gameEngine.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id
    const userId = String(user.user_id)

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status !== 'waiting') return err('Game is not open for joining.')

    const { results: players } = await env.DB.prepare(
      'SELECT seat, user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()

    if (players.some(p => String(p.user_id) === userId)) return err('Already in this game.')
    if (players.length >= 5) return err('Game is full.')

    // Find next open seat
    const takenSeats = new Set(players.map(p => p.seat))
    let seat = 0
    while (takenSeats.has(seat)) seat++

    await env.DB.prepare(
      'INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)'
    ).bind(gameId, user.user_id, seat).run()

    const newCount = players.length + 1

    if (newCount === 5) {
      // Start the game — deal first hand
      const allPlayers = [...players, { user_id: user.user_id, seat }]
        .sort((a, b) => a.seat - b.seat)
        .map(p => String(p.user_id))

      const dealerSeat = 0
      const state = dealHand(allPlayers, dealerSeat, 1, 1)

      await env.DB.prepare(
        'INSERT INTO game_state (game_id, state_json, updated_at) VALUES (?, ?, datetime(\'now\'))'
      ).bind(gameId, JSON.stringify(state)).run()

      await env.DB.prepare(
        'UPDATE games SET status = \'active\', updated_at = datetime(\'now\') WHERE id = ?'
      ).bind(gameId).run()

      return json({ joined: true, started: true })
    }

    return json({ joined: true, started: false, player_count: newCount })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
