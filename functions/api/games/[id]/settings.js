import { json, err, requireUser, AuthError } from '../../_helpers.js'

export async function onRequestPatch({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id
    const userId = user.user_id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status === 'complete') return err('Game is already complete.')

    // Only admin (creator) may change settings
    if (game.created_by !== userId) return err('Only the game admin can change settings.', 403)

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }

    const { no_pick_variant, reveal_partner, double_on_bump } = body ?? {}

    if (no_pick_variant !== undefined && !['leasters', 'doublers', 'schwanzers'].includes(no_pick_variant)) {
      return err('no_pick_variant must be "leasters", "doublers", or "schwanzers".')
    }
    if (reveal_partner !== undefined && typeof reveal_partner !== 'boolean') {
      return err('reveal_partner must be a boolean.')
    }
    if (double_on_bump !== undefined && typeof double_on_bump !== 'boolean') {
      return err('double_on_bump must be a boolean.')
    }

    const fields = []
    const values = []
    if (no_pick_variant !== undefined) { fields.push('no_pick_variant = ?'); values.push(no_pick_variant) }
    if (reveal_partner  !== undefined) { fields.push('reveal_partner = ?');  values.push(reveal_partner ? 1 : 0) }
    if (double_on_bump !== undefined) { fields.push('double_on_bump = ?'); values.push(double_on_bump ? 1 : 0) }

    if (fields.length === 0) return err('No settings to update.')

    values.push(gameId)
    await env.DB.prepare(
      `UPDATE games SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).bind(...values).run()

    const updated = await env.DB.prepare(
      'SELECT no_pick_variant, reveal_partner, double_on_bump FROM games WHERE id = ?'
    ).bind(gameId).first()

    return json({ ok: true, ...updated, reveal_partner: updated.reveal_partner === 1, double_on_bump: updated.double_on_bump === 1 })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
