import { describe, it, expect, vi } from 'vitest'
import { computeBotSuggestion } from './botSuggestion.js'

// Stub view factories — minimal shapes sufficient for dispatch.
// Real decision correctness is covered by the botStrategy test suite.
function playingView({ hands, currentTrick = [] }) {
  return {
    phase: 'playing',
    hands,
    currentTrick,
    tricks: [],
    picker: 'u1',
    partner: 'u2',
    calledSuit: 'H',
    partnerRevealed: false,
    lastTrick: [],
    isLeaster: false,
    reveal_partner: false,
  }
}

describe('computeBotSuggestion', () => {
  it('returns { kind: "play", ids: [cardId] } in playing phase', () => {
    const view = playingView({ hands: { u1: [{ id: 'QC', suit: 'C', rank: 'Q' }] } })
    const result = computeBotSuggestion(view, 'u1')
    expect(result.kind).toBe('play')
    expect(result.ids).toEqual(['QC'])
    expect(result.actionLabel).toBeUndefined()
  })

  it('returns { kind: "bury", ids: [a, b] } in burying phase', () => {
    const view = {
      phase: 'burying',
      hands: {
        u1: [
          { id: 'AC', suit: 'C', rank: 'A' }, { id: 'KC', suit: 'C', rank: 'K' },
          { id: '9C', suit: 'C', rank: '9' }, { id: '8C', suit: 'C', rank: '8' },
          { id: '7C', suit: 'C', rank: '7' }, { id: 'AS', suit: 'S', rank: 'A' },
          { id: 'KS', suit: 'S', rank: 'K' }, { id: '9S', suit: 'S', rank: '9' },
        ],
      },
      picker: 'u1',
      blind: [],
      calledSuit: null,
    }
    const result = computeBotSuggestion(view, 'u1')
    expect(result.kind).toBe('bury')
    expect(result.ids).toHaveLength(2)
  })

  it('returns { kind: "pick", actionLabel: "pick"|"pass" } in picking phase', () => {
    const view = {
      phase: 'picking',
      hands: { u1: [
        { id: 'QC', suit: 'C', rank: 'Q' }, { id: 'QS', suit: 'S', rank: 'Q' },
        { id: 'QH', suit: 'H', rank: 'Q' }, { id: 'JC', suit: 'C', rank: 'J' },
        { id: 'AD', suit: 'D', rank: 'A' }, { id: '10D', suit: 'D', rank: '10' },
      ]},
      potentialBlitzes: [],
      pickOrder: ['u1'], pickIndex: 0,
    }
    const result = computeBotSuggestion(view, 'u1')
    expect(result.kind).toBe('pick')
    expect(['pick', 'pass', 'blitz']).toContain(result.actionLabel)
    expect(result.ids).toEqual([])
  })

  it('returns { kind: "call", actionLabel: "ace:X"|"ten:X"|"king:X"|"go_alone" } in calling phase', () => {
    const view = {
      phase: 'calling',
      hands: { u1: [
        { id: 'QC', suit: 'C', rank: 'Q' }, { id: 'QS', suit: 'S', rank: 'Q' },
        { id: 'JC', suit: 'C', rank: 'J' }, { id: 'AD', suit: 'D', rank: 'A' },
        { id: '9S', suit: 'S', rank: '9' }, { id: '9H', suit: 'H', rank: '9' },
      ]},
      picker: 'u1',
      buried: [],
    }
    const result = computeBotSuggestion(view, 'u1')
    expect(result.kind).toBe('call')
    expect(result.actionLabel).toMatch(/^(ace:[CHS]|ten:[CHS]|king:[CHS]|go_alone)$/)
  })

  it('throws on unknown phase', () => {
    expect(() => computeBotSuggestion({ phase: 'scoring', hands: { u1: [] } }, 'u1'))
      .toThrow(/unknown phase/i)
  })
})
