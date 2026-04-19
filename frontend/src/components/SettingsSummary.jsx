import { formatSettingsSummary } from '@shared/settingsSummary.js'

/**
 * Renders the single-line settings summary body. Plain span — the
 * caller controls surrounding layout, labels, and any adjacent
 * controls (e.g. the admin Edit button).
 */
export default function SettingsSummary({ settings, style }) {
  if (!settings) return null
  return (
    <span style={style}>{formatSettingsSummary(settings)}</span>
  )
}
