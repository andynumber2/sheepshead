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
