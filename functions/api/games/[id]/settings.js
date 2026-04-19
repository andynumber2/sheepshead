import { json, err, requireUser, AuthError } from '../../_helpers.js'
import { formatSettingsSummary } from '../../../../shared/settingsSummary.js'

export async function onRequestPatch({ request, env, params }) {
  try {
    const user = await requireUser(request, env.DB)
    const gameId = params.id
    const userId = user.user_id

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(gameId).first()
    if (!game) return err('Game not found.', 404)
    if (game.status === 'complete') return err('Game is already complete.')
    if (game.created_by !== userId) return err('Only the game admin can change settings.', 403)

    let body
    try { body = await request.json() } catch { return err('Invalid JSON.') }

    const { no_pick_variant, reveal_partner, double_on_bump, log_change } = body ?? {}

    if (no_pick_variant !== undefined && !['leasters', 'doublers', 'schwanzers'].includes(no_pick_variant)) {
      return err('no_pick_variant must be "leasters", "doublers", or "schwanzers".')
    }
    if (reveal_partner !== undefined && typeof reveal_partner !== 'boolean') {
      return err('reveal_partner must be a boolean.')
    }
    if (double_on_bump !== undefined && typeof double_on_bump !== 'boolean') {
      return err('double_on_bump must be a boolean.')
    }
    if (log_change !== undefined && typeof log_change !== 'boolean') {
      return err('log_change must be a boolean.')
    }

    // Build json_set args for the fields that were provided
    let jsonSetExpr = 'settings_json'
    const bindings = []
    // Note: use json(?) with 'true'/'false' strings to ensure SQLite stores proper
    // JSON booleans rather than integers (D1 binds JS true as SQLite 1 otherwise).
    if (no_pick_variant !== undefined) {
      jsonSetExpr = `json_set(${jsonSetExpr}, '$.no_pick_variant', ?)`
      bindings.push(no_pick_variant)
    }
    if (reveal_partner !== undefined) {
      jsonSetExpr = `json_set(${jsonSetExpr}, '$.reveal_partner', json(?))`
      bindings.push(reveal_partner ? 'true' : 'false')
    }
    if (double_on_bump !== undefined) {
      jsonSetExpr = `json_set(${jsonSetExpr}, '$.double_on_bump', json(?))`
      bindings.push(double_on_bump ? 'true' : 'false')
    }

    if (bindings.length === 0 && log_change !== true) {
      return err('No settings to update.')
    }

    if (bindings.length > 0) {
      bindings.push(gameId)
      await env.DB.prepare(
        `UPDATE games SET settings_json = ${jsonSetExpr}, updated_at = datetime('now') WHERE id = ?`
      ).bind(...bindings).run()
    }

    const updated = await env.DB.prepare('SELECT settings_json FROM games WHERE id = ?').bind(gameId).first()
    const raw = JSON.parse(updated.settings_json)
    const settings = { ...raw, reveal_partner: !!raw.reveal_partner, double_on_bump: !!raw.double_on_bump, is_test_mode: !!raw.is_test_mode }

    if (log_change === true) {
      const stateRow = await env.DB.prepare(
        'SELECT state_json FROM game_state WHERE game_id = ?'
      ).bind(gameId).first()
      if (stateRow) {
        const state = JSON.parse(stateRow.state_json)
        const line = `Next Hand: ${formatSettingsSummary(settings)}`
        state.log = [...(state.log ?? []), line]
        await env.DB.prepare(
          "UPDATE game_state SET state_json = ?, updated_at = datetime('now') WHERE game_id = ?"
        ).bind(JSON.stringify(state), gameId).run()
      }
    }

    return json({ ok: true, settings })
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, 401)
    return err(e.message, 500)
  }
}
