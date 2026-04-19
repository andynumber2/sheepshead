import { describe, it, expect } from 'vitest'
import { formatSettingsSummary } from './settingsSummary.js'

describe('formatSettingsSummary', () => {
  it('renders leasters, partner shown, DOB on', () => {
    expect(formatSettingsSummary({
      no_pick_variant: 'leasters',
      reveal_partner: true,
      double_on_bump: true,
    })).toBe('Leasters · Partner: shown · DOB: on')
  })

  it('renders doublers, partner hidden, DOB off', () => {
    expect(formatSettingsSummary({
      no_pick_variant: 'doublers',
      reveal_partner: false,
      double_on_bump: false,
    })).toBe('Doublers · Partner: hidden · DOB: off')
  })

  it('renders schwanzers, partner shown, DOB off', () => {
    expect(formatSettingsSummary({
      no_pick_variant: 'schwanzers',
      reveal_partner: true,
      double_on_bump: false,
    })).toBe('Schwanzers · Partner: shown · DOB: off')
  })

  it('always shows DOB state (not conditional)', () => {
    const off = formatSettingsSummary({
      no_pick_variant: 'leasters',
      reveal_partner: true,
      double_on_bump: false,
    })
    expect(off).toContain('DOB: off')
  })
})
