import { json, err } from '../../../_helpers.js'

export async function onRequestGet({ env, params }) {
  const gameId = Number(params.gameId)
  const handNumber = Number(params.handNumber)
  if (!Number.isFinite(gameId) || !Number.isFinite(handNumber)) {
    return err('Invalid gameId or handNumber.', 400)
  }

  const hand = await env.DB.prepare(
    'SELECT completed_at FROM hands WHERE game_id = ? AND hand_number = ?'
  ).bind(gameId, handNumber).first()
  if (!hand || !hand.completed_at) return err('Not found.', 404)

  const { results } = await env.DB.prepare(
    'SELECT seq, type, user_id, payload_json, created_at FROM hand_actions WHERE game_id = ? AND hand_number = ? ORDER BY seq ASC'
  ).bind(gameId, handNumber).all()

  const actions = results.map(r => ({
    seq: r.seq,
    type: r.type,
    userId: r.user_id != null ? String(r.user_id) : null,
    payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    createdAt: r.created_at,
  }))

  return json({ actions })
}
