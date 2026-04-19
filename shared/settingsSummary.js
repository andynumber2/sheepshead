const VARIANT_LABELS = {
  leasters: 'Leasters',
  doublers: 'Doublers',
  schwanzers: 'Schwanzers',
}

/**
 * Returns a single-line summary of the game settings, used both in the
 * play-history log line and as the on-screen settings summary. Every
 * setting is always rendered — callers rely on the body being a full
 * snapshot, not a diff.
 *
 * Example: "Leasters · Partner: shown · DOB: on"
 */
export function formatSettingsSummary(settings) {
  const variant = VARIANT_LABELS[settings.no_pick_variant] ?? settings.no_pick_variant
  const partner = settings.reveal_partner ? 'shown' : 'hidden'
  const dob = settings.double_on_bump ? 'on' : 'off'
  return `${variant} · Partner: ${partner} · DOB: ${dob}`
}
