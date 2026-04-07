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

    const { no_pick_variant } = body ?? {}
    if (no_pick_variant && !['leasters', 'doublers'].includes(no_pick_variant)) {
      return err('no_pick_variant must be "leasters" or "doublers".')
    }

    if (no_pick_variant) {
      await env.DB.prepare(
        "UPDATE games SET no_pick_variant = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(no_pick_variant, gameId).run()
    }

    return json({ ok: true, no_pick_variant: no_pick_variant ?? game.no_pick_variant })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
