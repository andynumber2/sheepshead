import { json, err } from '../../_helpers.js'
import { buildHandDigest } from '../../../../shared/recapDigest.js'

export async function onRequestGet({ env, params }) {
  const gameId = Number(params.gameId)
  const handNumber = Number(params.handNumber)
  if (!Number.isFinite(gameId) || !Number.isFinite(handNumber)) {
    return err('Invalid gameId or handNumber.', 400)
  }

  const hand = await env.DB.prepare(
    'SELECT * FROM hands WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).first()

  // Anti-cheat: refuse if hand is missing OR still in progress
  if (!hand || !hand.completed_at) return err('Not found.', 404)

  const { results: actions } = await env.DB.prepare(
    'SELECT seq, type, user_id, payload_json FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq ASC'
  ).bind(gameId, handNumber).all()

  const { results: playerRows } = await env.DB.prepare(
    `SELECT gp.user_id, gp.seat, u.username, u.is_bot
     FROM game_players gp JOIN users u ON u.id = gp.user_id
     WHERE gp.game_id = ? ORDER BY gp.seat ASC`
  ).bind(gameId).all()
  const players = playerRows.map(r => ({
    userId: String(r.user_id),
    username: r.username,
    seat: r.seat,
    isBot: !!r.is_bot,
  }))

  const { results: scoreRows } = await env.DB.prepare(
    'SELECT user_id, delta FROM score_events WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).all()
  const scoreEventsByUser = {}
  for (const r of scoreRows) scoreEventsByUser[String(r.user_id)] = r.delta

  const digest = buildHandDigest(actions, players, scoreEventsByUser)
  digest.gameId = gameId
  digest.startedAt = hand.started_at
  digest.completedAt = hand.completed_at

  return json(digest)
}
