import { json, err, requireUser, AuthError } from '../../_helpers.js'
import { dealHand } from '../../../../shared/gameEngine.js'

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status !== 'waiting') return err('Game is not open for joining.')

    const existingGame = await env.DB.prepare(`
      SELECT g.id, g.name FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.user_id = ? AND g.status IN ('waiting', 'active')
      LIMIT 1
    `).bind(user.user_id).first()
    if (existingGame) {
      return err(`You are already in a game ("${existingGame.name}"). Leave it before joining another.`, 409)
    }

    const { results: players } = await env.DB.prepare(
      'SELECT seat, user_id FROM game_players WHERE game_id = ? ORDER BY seat'
    ).bind(gameId).all()

    if (players.length >= 5) return err('Game is full.')

    const takenSeats = new Set(players.map(p => p.seat))
    let seat = 0
    while (takenSeats.has(seat)) seat++

    await env.DB.prepare(
      'INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)'
    ).bind(gameId, user.user_id, seat).run()

    const newCount = players.length + 1

    if (newCount === 5) {
      const allPlayers = [...players, { user_id: user.user_id, seat }]
        .sort((a, b) => a.seat - b.seat)
        .map(p => String(p.user_id))

      const settings = JSON.parse(game.settings_json)
      const state = dealHand(allPlayers, 0, 1, 1)
      state.reveal_partner = settings.reveal_partner
      state.double_on_bump = settings.double_on_bump

      const { rewindHistory: _dropped, ...stateToStore } = state

      await env.DB.batch([
        env.DB.prepare("INSERT INTO game_state (game_id, state_json, updated_at) VALUES (?, ?, datetime('now'))")
          .bind(gameId, JSON.stringify(stateToStore)),
        env.DB.prepare("UPDATE games SET status = 'active', current_hand = 1, updated_at = datetime('now') WHERE id = ?")
          .bind(gameId),
        env.DB.prepare('INSERT INTO hands (game_id, hand_number) VALUES (?, 1)')
          .bind(gameId),
        env.DB.prepare(
          'INSERT INTO hand_actions (game_id, hand_number, seq, type, user_id, payload_json) VALUES (?, 1, 0, ?, NULL, ?)'
        ).bind(gameId, 'deal', JSON.stringify(stateToStore)),
      ])

      return json({ joined: true, started: true })
    }

    return json({ joined: true, started: false, player_count: newCount })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
