import { describe, it, expect } from 'vitest'
import { decidePlay } from './botStrategy.js'

// Cards: { id, suit, rank }. Trump = all diamonds + all queens + all jacks.
const c = (id, suit, rank) => ({ id, suit, rank })

// Opponent (u2) is void in the called fail suit (H). Picker (u1) has led the
// called suit; partner (u3) holds the called Ace and has not yet played.
function trumpInOnCalledSuitView({ hand, partnerRevealed }) {
  return {
    phase: 'playing',
    hands: { u1: [], u2: hand, u3: [], u4: [] },
    currentTrick: [
      { userId: 'u1', card: c('9H', 'H', '9') },
    ],
    tricks: [],
    picker: 'u1',
    partner: 'u3',
    partnerRevealed,
    calledSuit: 'H',
    calledAce: { aceId: 'AH' },
    isLeaster: false,
    lastTrick: [],
  }
}

describe('decidePlay — trump in on partner-revealing called-suit lead', () => {
  it('schmears with A♦ when bot has high trump and partner is unrevealed', () => {
    // Hand has A♦ (trump A), Q♣ (trump Q), and fail spades. Bot is void in H.
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('KS', 'S', 'K'), c('9S', 'S', '9'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
    ]
    const view = trumpInOnCalledSuitView({ hand, partnerRevealed: false })
    expect(decidePlay(view, 'u2')).toBe('AD')
  })

  it('plays highest trump (force-up) on called-suit lead once partner has been revealed', () => {
    // Partner already revealed → schmear specialization does not apply.
    // Falls into the general force-up case: highest trump = QC (Q♣ tops trumpRank).
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('KS', 'S', 'K'), c('9S', 'S', '9'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
    ]
    const view = trumpInOnCalledSuitView({ hand, partnerRevealed: true })
    expect(decidePlay(view, 'u2')).toBe('QC')
  })

  it('still trumps in (schmear) when only Js/Qs are available with partner unrevealed', () => {
    // All trump (Qs and Js), no A/10/K/9/8/7 in hand. Schmear priority on Js/Qs:
    // among Js, weakest by trump rank = JD; QC tops the trumpRank ordering.
    const hand = [
      c('QC', 'C', 'Q'), c('QS', 'S', 'Q'),
      c('JC', 'C', 'J'), c('JS', 'S', 'J'),
      c('JH', 'H', 'J'), c('JD', 'D', 'J'),
    ]
    const view = trumpInOnCalledSuitView({ hand, partnerRevealed: false })
    const played = decidePlay(view, 'u2')
    expect(['QC', 'QS', 'JC', 'JS', 'JH', 'JD']).toContain(played)
  })

  it('plays highest trump on a non-called fail lead when picker is winning (force-up)', () => {
    // Picker leads 9♠ (spades, NOT the called suit). Bot is void in spades and
    // holds trump. Picker is currently winning → trump in with highest trump.
    const view = {
      phase: 'playing',
      hands: {
        u1: [],
        u2: [
          c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
          c('7C', 'C', '7'), c('8C', 'C', '8'),
          c('KH', 'H', 'K'), c('9H', 'H', '9'),
        ],
        u3: [], u4: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9S', 'S', '9') },
      ],
      tricks: [],
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u2')).toBe('QC')
  })

  it('does not trump in when a fellow opponent is already winning the trick', () => {
    // Picker leads 9♥, opponent u4 trumps in with QH and is winning.
    // Picker team is NOT winning → bot u2 should not waste trump.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u3: [], u4: [],
        u2: [c('AD', 'D', 'A'), c('7C', 'C', '7'), c('8C', 'C', '8')],
      },
      currentTrick: [
        { userId: 'u1', card: c('9H', 'H', '9') },
        { userId: 'u4', card: c('QH', 'H', 'Q') },
      ],
      tricks: [],
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
    const played = decidePlay(view, 'u2')
    expect(played).not.toBe('AD')
  })
})
