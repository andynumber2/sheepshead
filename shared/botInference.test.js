import { describe, it, expect } from 'vitest'
import { knownNonPartners, deducedPartner } from './botInference.js'

const c = (id, suit, rank) => ({ id, suit, rank })

// Minimal view factory. Five players: p1=picker, p2=partner, p3/p4/p5=opponents.
function baseView(overrides = {}) {
  return {
    phase: 'playing',
    picker: 'p1',
    partner: null,         // redacted from opponents until partnerRevealed
    partnerRevealed: false,
    callMode: 'ace',
    calledSuit: 'H',
    calledAce: { aceId: 'AH' },
    calledTen: null,
    calledKing: null,
    crackerId: null,
    recrackerId: null,
    hands: { p1: [], p2: [], p3: [], p4: [], p5: [] },
    tricks: [],
    currentTrick: [],
    isLeaster: false,
    ...overrides,
  }
}

describe('knownNonPartners', () => {
  it('opponent bot with no signals: rules out picker and self', () => {
    const view = baseView()
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set(['p1', 'p3']))
  })

  it('picker-team bot (partner) with view.partner=self: rules out picker and self', () => {
    const view = baseView({ partner: 'p2' })
    const set = knownNonPartners(view, 'p2')
    // Self is the partner, so self is *not* in the rule-out set; only picker.
    expect(set).toEqual(new Set(['p1']))
  })

  it('crack: cracker added to rule-out set', () => {
    const view = baseView({ crackerId: 'p4' })
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set(['p1', 'p3', 'p4']))
  })

  it('called-suit-led trick: non-called play rules out the player', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: c('KH', 'H', 'K') },
        { userId: 'p1', card: c('7H', 'H', '7') },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    expect(set).toEqual(new Set(['p1', 'p3', 'p4']))
  })

  it('called-suit-led trick where called card has been played: stops elimination for that trick', () => {
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p3', card: c('KH', 'H', 'K') },
          { userId: 'p1', card: c('7H', 'H', '7') },
          { userId: 'p2', card: c('AH', 'H', 'A') },
          { userId: 'p4', card: c('9H', 'H', '9') },
          { userId: 'p5', card: c('8H', 'H', '8') },
        ],
      }],
      partnerRevealed: true,
      partner: 'p2',
    })
    const set = knownNonPartners(view, 'p3')
    expect(set.has('p4')).toBe(false)
    expect(set.has('p5')).toBe(false)
  })

  it('non-called-suit-led trick: no eliminations from it', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: c('KS', 'S', 'K') },
        { userId: 'p1', card: c('7S', 'S', '7') },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    expect(set).toEqual(new Set(['p1', 'p4']))
  })

  it('multiple signals stack (crack + elimination)', () => {
    const view = baseView({
      crackerId: 'p4',
      currentTrick: [
        { userId: 'p3', card: c('KH', 'H', 'K') },
      ],
    })
    const set = knownNonPartners(view, 'p5')
    expect(set).toEqual(new Set(['p1', 'p3', 'p4', 'p5']))
  })

  it('hidden cards in current trick: do not mistake hidden plays for non-called', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: { id: 'HIDDEN', hidden: true } },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    expect(set).toEqual(new Set(['p1', 'p4']))
  })

  it('leaster: returns empty set (no picker, no partner concept)', () => {
    const view = baseView({ isLeaster: true, picker: null, callMode: null })
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set())
  })
})

describe('deducedPartner', () => {
  it('returns view.partner when set (engine-revealed)', () => {
    const view = baseView({ partner: 'p2', partnerRevealed: true })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('returns recracker when non-picker recracked', () => {
    const view = baseView({ recrackerId: 'p2' })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('does not use recracker when picker recracked (falls through)', () => {
    const view = baseView({ recrackerId: 'p1' })  // p1 is picker
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns the unique remaining seat when 3 of 4 non-picker seats ruled out', () => {
    // Picker = p1. Non-picker seats: p2, p3, p4, p5.
    // Bot = p3 (self, ruled out). p4 cracker (ruled out). p5 played non-called on called-suit lead.
    // Only p2 remains → partner.
    const view = baseView({
      crackerId: 'p4',
      currentTrick: [{ userId: 'p5', card: c('KH', 'H', 'K') }],
    })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('returns null when only 2 of 4 non-picker seats ruled out', () => {
    const view = baseView({ crackerId: 'p4' })
    // p1 picker, p3 self, p4 cracker → 2 ruled out (p3, p4 of the 4 non-picker seats); p2 and p5 remain candidates.
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns null when no signals fire', () => {
    const view = baseView()
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns null when picker goes alone (callMode === alone)', () => {
    const view = baseView({ callMode: 'alone', calledSuit: null, calledAce: null, recrackerId: 'p2' })
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns self when bot is the partner (view.partner === userId)', () => {
    const view = baseView({ partner: 'p2' })
    expect(deducedPartner(view, 'p2')).toBe('p2')
  })

  it('leaster: returns null', () => {
    const view = baseView({ isLeaster: true, picker: null, callMode: null })
    expect(deducedPartner(view, 'p3')).toBeNull()
  })
})
