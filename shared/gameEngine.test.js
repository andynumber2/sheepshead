import { describe, it, expect, beforeEach } from 'vitest'
import {
  isTrump, trumpRank, suitRank, effectiveSuit, cardPoints,
  schwanzerCardPoints, resolveSchwanzer,
  dealHand, pick, pass, blitz,
  discard, callAce, goAlone, callTen, callKing,
  playCard, computeScores, resolveLeaster,
} from './gameEngine.js'

const c = (rank, suit) => ({ id: `${rank}${suit}`, rank, suit })

describe('isTrump', () => {
  it('returns true for all queens', () => {
    expect(isTrump(c('Q','C'))).toBe(true)
    expect(isTrump(c('Q','S'))).toBe(true)
    expect(isTrump(c('Q','H'))).toBe(true)
    expect(isTrump(c('Q','D'))).toBe(true)
  })
  it('returns true for all jacks', () => {
    expect(isTrump(c('J','C'))).toBe(true)
    expect(isTrump(c('J','S'))).toBe(true)
    expect(isTrump(c('J','H'))).toBe(true)
    expect(isTrump(c('J','D'))).toBe(true)
  })
  it('returns true for diamond pip cards', () => {
    expect(isTrump(c('A','D'))).toBe(true)
    expect(isTrump(c('10','D'))).toBe(true)
    expect(isTrump(c('K','D'))).toBe(true)
    expect(isTrump(c('9','D'))).toBe(true)
  })
  it('returns false for non-trump fail cards', () => {
    expect(isTrump(c('A','C'))).toBe(false)
    expect(isTrump(c('10','H'))).toBe(false)
    expect(isTrump(c('K','S'))).toBe(false)
    expect(isTrump(c('9','C'))).toBe(false)
  })
})

describe('trumpRank', () => {
  it('assigns rank 0 to QC (strongest trump)', () => {
    expect(trumpRank(c('Q','C'))).toBe(0)
  })
  it('assigns rank 13 to 7D (weakest trump)', () => {
    expect(trumpRank(c('7','D'))).toBe(13)
  })
  it('ranks queens before jacks before diamond pips', () => {
    expect(trumpRank(c('Q','C'))).toBeLessThan(trumpRank(c('J','C')))
    expect(trumpRank(c('J','C'))).toBeLessThan(trumpRank(c('A','D')))
    expect(trumpRank(c('A','D'))).toBeLessThan(trumpRank(c('10','D')))
  })
  it('returns -1 for non-trump cards (not in TRUMP_ORDER)', () => {
    expect(trumpRank(c('A','C'))).toBe(-1)
    expect(trumpRank(c('K','S'))).toBe(-1)
  })
})

describe('suitRank', () => {
  it('ranks A as 0 (highest)', () => {
    expect(suitRank(c('A','C'))).toBe(0)
  })
  it('ranks 7 as 5 (lowest)', () => {
    expect(suitRank(c('7','C'))).toBe(5)
  })
  it('ranks in order: A > 10 > K > 9 > 8 > 7', () => {
    expect(suitRank(c('A','C'))).toBeLessThan(suitRank(c('10','C')))
    expect(suitRank(c('10','C'))).toBeLessThan(suitRank(c('K','C')))
    expect(suitRank(c('K','C'))).toBeLessThan(suitRank(c('9','C')))
    expect(suitRank(c('9','C'))).toBeLessThan(suitRank(c('8','C')))
    expect(suitRank(c('8','C'))).toBeLessThan(suitRank(c('7','C')))
  })
})

describe('effectiveSuit', () => {
  it('returns "T" for trump cards (queens, jacks, diamonds)', () => {
    expect(effectiveSuit(c('Q','C'))).toBe('T')
    expect(effectiveSuit(c('J','S'))).toBe('T')
    expect(effectiveSuit(c('A','D'))).toBe('T')
    expect(effectiveSuit(c('9','D'))).toBe('T')
  })
  it('returns the card suit for non-trump fail cards', () => {
    expect(effectiveSuit(c('A','C'))).toBe('C')
    expect(effectiveSuit(c('10','H'))).toBe('H')
    expect(effectiveSuit(c('K','S'))).toBe('S')
  })
})

describe('cardPoints', () => {
  it('returns 11 for aces', () => {
    expect(cardPoints(c('A','C'))).toBe(11)
    expect(cardPoints(c('A','D'))).toBe(11)
  })
  it('returns 10 for tens', () => {
    expect(cardPoints(c('10','C'))).toBe(10)
    expect(cardPoints(c('10','H'))).toBe(10)
  })
  it('returns 4 for kings', () => {
    expect(cardPoints(c('K','C'))).toBe(4)
  })
  it('returns 3 for queens', () => {
    expect(cardPoints(c('Q','C'))).toBe(3)
  })
  it('returns 2 for jacks', () => {
    expect(cardPoints(c('J','C'))).toBe(2)
  })
  it('returns 0 for 9, 8, 7', () => {
    expect(cardPoints(c('9','C'))).toBe(0)
    expect(cardPoints(c('8','H'))).toBe(0)
    expect(cardPoints(c('7','S'))).toBe(0)
  })
})

describe('schwanzerCardPoints', () => {
  it('returns 3 for any queen', () => {
    expect(schwanzerCardPoints(c('Q', 'C'))).toBe(3)
    expect(schwanzerCardPoints(c('Q', 'S'))).toBe(3)
    expect(schwanzerCardPoints(c('Q', 'H'))).toBe(3)
    expect(schwanzerCardPoints(c('Q', 'D'))).toBe(3)  // QD is a queen, not a diamond pip
  })

  it('returns 2 for any jack', () => {
    expect(schwanzerCardPoints(c('J', 'C'))).toBe(2)
    expect(schwanzerCardPoints(c('J', 'S'))).toBe(2)
    expect(schwanzerCardPoints(c('J', 'H'))).toBe(2)
    expect(schwanzerCardPoints(c('J', 'D'))).toBe(2)  // JD is a jack, not a diamond pip
  })

  it('returns 1 for diamond pip cards (non-Q, non-J diamonds)', () => {
    expect(schwanzerCardPoints(c('A',  'D'))).toBe(1)
    expect(schwanzerCardPoints(c('10', 'D'))).toBe(1)
    expect(schwanzerCardPoints(c('K',  'D'))).toBe(1)
    expect(schwanzerCardPoints(c('9',  'D'))).toBe(1)
    expect(schwanzerCardPoints(c('8',  'D'))).toBe(1)
    expect(schwanzerCardPoints(c('7',  'D'))).toBe(1)
  })

  it('returns 0 for non-trump fail cards', () => {
    expect(schwanzerCardPoints(c('A',  'C'))).toBe(0)
    expect(schwanzerCardPoints(c('10', 'H'))).toBe(0)
    expect(schwanzerCardPoints(c('K',  'S'))).toBe(0)
    expect(schwanzerCardPoints(c('9',  'C'))).toBe(0)
    expect(schwanzerCardPoints(c('8',  'H'))).toBe(0)
    expect(schwanzerCardPoints(c('7',  'S'))).toBe(0)
  })
})

// ─── helpers for resolveSchwanzer tests ──────────────────────────────────────
function makeState(hands, pickOrder) {
  return { hands, pickOrder, log: [] }
}

describe('resolveSchwanzer', () => {
  it('identifies the player with the most schwanzer points as the loser', () => {
    const hands = {
      p1: [c('Q','C'), c('7','C'), c('8','C'), c('9','C'), c('A','C'), c('10','C')],  // 3 pts
      p2: [c('Q','S'), c('Q','H'), c('7','S'), c('8','S'), c('9','S'), c('A','S')],   // 6 pts → loses
      p3: [c('J','C'), c('7','H'), c('8','H'), c('9','H'), c('A','H'), c('10','H')],  // 2 pts
      p4: [c('7','C'), c('8','C'), c('9','S'), c('A','S'), c('10','S'), c('K','S')],  // 0 pts
      p5: [c('K','C'), c('A','H'), c('10','C'), c('K','H'), c('A','C'), c('K','S')],  // 0 pts
    }
    const { loser, scores } = resolveSchwanzer(makeState(hands, ['p1','p2','p3','p4','p5']))
    expect(loser).toBe('p2')
    expect(scores.p2).toBe(-4)
    expect(scores.p1).toBe(1)
    expect(scores.p3).toBe(1)
    expect(scores.p4).toBe(1)
    expect(scores.p5).toBe(1)
  })

  it('tie-break: tied player with the most powerful trump loses', () => {
    // p1 has QC (TRUMP_ORDER index 0) — most powerful trump → loses
    // p2 has QS (TRUMP_ORDER index 1) — less powerful
    // both have 3 schwanzer points
    const hands = {
      p1: [c('Q','C'), c('7','S'), c('8','S'), c('9','S'), c('A','S'), c('10','S')],  // 3 pts, trump=QC(idx 0)
      p2: [c('Q','S'), c('7','H'), c('8','H'), c('9','H'), c('A','H'), c('10','H')],  // 3 pts, trump=QS(idx 1)
      p3: [c('K','C'), c('A','C'), c('10','C'), c('K','H'), c('A','H'), c('K','S')],  // 0 pts
      p4: [c('7','C'), c('8','C'), c('9','C'), c('K','H'), c('A','S'), c('10','S')],  // 0 pts
      p5: [c('8','H'), c('9','H'), c('10','H'), c('7','S'), c('9','S'), c('K','S')],  // 0 pts
    }
    const { loser } = resolveSchwanzer(makeState(hands, ['p1','p2','p3','p4','p5']))
    expect(loser).toBe('p1')  // QC is more powerful than QS
  })

  it('fallback tie-break: when tied players hold no trump, first in pickOrder loses', () => {
    // All players have 0 schwanzer points — no Q, J, or D cards in any hand
    const noTrumpHand = [c('A','C'), c('10','C'), c('K','C'), c('A','H'), c('10','H'), c('K','H')]
    const hands = {
      p1: noTrumpHand,
      p2: noTrumpHand,
      p3: noTrumpHand,
      p4: noTrumpHand,
      p5: noTrumpHand,
    }
    // p2 is first in pickOrder → p2 loses
    const { loser } = resolveSchwanzer(makeState(hands, ['p2','p1','p3','p4','p5']))
    expect(loser).toBe('p2')
  })

  it('pushes a log entry naming the loser and listing point totals', () => {
    const hands = {
      p1: [c('Q','C'), c('7','C'), c('8','C'), c('9','C'), c('A','C'), c('10','C')],  // 3 pts
      p2: [c('7','S'), c('8','S'), c('9','S'), c('A','S'), c('10','S'), c('K','S')],  // 0 pts
      p3: [c('7','H'), c('8','H'), c('9','H'), c('A','H'), c('10','H'), c('K','H')],  // 0 pts
      p4: [c('K','C'), c('A','H'), c('10','C'), c('K','H'), c('9','C'), c('8','H')],  // 0 pts
      p5: [c('8','C'), c('9','S'), c('K','S'), c('A','C'), c('10','H'), c('K','C')],  // 0 pts
    }
    const state = makeState(hands, ['p1','p2','p3','p4','p5'])
    resolveSchwanzer(state)
    expect(state.log.length).toBe(1)
    expect(state.log[0]).toContain('p1')
    expect(state.log[0]).toContain('loses')
  })
})

describe('dealHand', () => {
  const playerIds = ['p1','p2','p3','p4','p5']

  it('deals 6 cards to each of 5 players', () => {
    const state = dealHand(playerIds, 0, 1, 1)
    for (const pid of playerIds) {
      expect(state.hands[pid]).toHaveLength(6)
    }
  })

  it('puts 2 cards in the blind', () => {
    const state = dealHand(playerIds, 0, 1, 1)
    expect(state.blind).toHaveLength(2)
  })

  it('deals all 32 cards with no duplicates', () => {
    const state = dealHand(playerIds, 0, 1, 1)
    const allCards = [
      ...state.blind,
      ...Object.values(state.hands).flat(),
    ]
    expect(allCards).toHaveLength(32)
    expect(new Set(allCards.map(cd => cd.id)).size).toBe(32)
  })

  it('sets pick order starting left of dealer', () => {
    // dealerSeat=2 → dealer is p3, first picker is p4
    const state = dealHand(playerIds, 2, 1, 1)
    expect(state.pickOrder).toEqual(['p4','p5','p1','p2','p3'])
  })

  it('starts in picking phase with pickIndex 0', () => {
    const state = dealHand(playerIds, 0, 1, 1)
    expect(state.phase).toBe('picking')
    expect(state.pickIndex).toBe(0)
  })
})

describe('pick / pass / blitz', () => {
  function makePickingState() {
    return dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
  }

  describe('pick', () => {
    it('transitions to discarding phase', () => {
      const state = makePickingState()
      const next = pick(state, state.pickOrder[0])
      expect(next.phase).toBe('discarding')
    })

    it('gives the picker 8 cards (hand + blind)', () => {
      const state = makePickingState()
      const picker = state.pickOrder[0]
      const next = pick(state, picker)
      expect(next.hands[picker]).toHaveLength(8)
    })

    it('clears the blind after picking', () => {
      const state = makePickingState()
      const next = pick(state, state.pickOrder[0])
      expect(next.blind).toHaveLength(0)
    })

    it('throws if it is not the player\'s turn', () => {
      const state = makePickingState()
      expect(() => pick(state, state.pickOrder[1])).toThrow()
    })

    it('throws if called outside picking phase', () => {
      const state = { ...makePickingState(), phase: 'playing' }
      expect(() => pick(state, state.pickOrder[0])).toThrow()
    })
  })

  describe('pass', () => {
    it('advances pickIndex', () => {
      const state = makePickingState()
      const next = pass(state, state.pickOrder[0])
      expect(next.pickIndex).toBe(1)
    })

    it('transitions to no_pick phase when all 5 players pass', () => {
      let state = makePickingState()
      for (let i = 0; i < 5; i++) {
        state = pass(state, state.pickOrder[state.pickIndex])
      }
      expect(state.phase).toBe('no_pick')
    })

    it('throws if it is not the player\'s turn', () => {
      const state = makePickingState()
      expect(() => pass(state, state.pickOrder[1])).toThrow()
    })
  })

  describe('blitz', () => {
    it('transitions to discarding phase', () => {
      const state = makePickingState()
      const firstPicker = state.pickOrder[0]
      const stateWithBlitz = {
        ...state,
        potentialBlitzes: [{ userId: firstPicker, type: 'black' }],
      }
      const next = blitz(stateWithBlitz, firstPicker)
      expect(next.phase).toBe('discarding')
    })

    it('records the blitz in state.blitzes', () => {
      const state = makePickingState()
      const firstPicker = state.pickOrder[0]
      const stateWithBlitz = {
        ...state,
        potentialBlitzes: [{ userId: firstPicker, type: 'red' }],
      }
      const next = blitz(stateWithBlitz, firstPicker)
      expect(next.blitzes).toEqual([{ userId: firstPicker, type: 'red' }])
    })

    it('throws if player is not in potentialBlitzes', () => {
      const state = { ...makePickingState(), potentialBlitzes: [] }
      expect(() => blitz(state, state.pickOrder[0])).toThrow('Cannot blitz')
    })
  })
})

describe('discard', () => {
  function makeDiscardingState() {
    const state = dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
    return pick(state, state.pickOrder[0])
    // picker now has 8 cards; phase = 'discarding'
  }

  it('transitions to calling phase', () => {
    const state = makeDiscardingState()
    const cardIds = state.hands[state.picker].slice(-2).map(cd => cd.id)
    const next = discard(state, state.picker, cardIds)
    expect(next.phase).toBe('calling')
  })

  it('picker ends with 6 cards', () => {
    const state = makeDiscardingState()
    const cardIds = state.hands[state.picker].slice(-2).map(cd => cd.id)
    const next = discard(state, state.picker, cardIds)
    expect(next.hands[next.picker]).toHaveLength(6)
  })

  it('stores the 2 discarded cards in state.discard', () => {
    const state = makeDiscardingState()
    const cardIds = state.hands[state.picker].slice(-2).map(cd => cd.id)
    const next = discard(state, state.picker, cardIds)
    expect(next.discard).toHaveLength(2)
    expect(next.discard.map(cd => cd.id)).toEqual(expect.arrayContaining(cardIds))
  })

  it('throws when not exactly 2 cards are discarded', () => {
    const state = makeDiscardingState()
    const oneCard = [state.hands[state.picker][0].id]
    expect(() => discard(state, state.picker, oneCard)).toThrow('Must discard exactly 2 cards.')
  })

  it('throws if a non-picker tries to discard', () => {
    const state = makeDiscardingState()
    const nonPicker = state.pickOrder.find(p => p !== state.picker)
    const cardIds = state.hands[state.picker].slice(-2).map(cd => cd.id)
    expect(() => discard(state, nonPicker, cardIds)).toThrow('Only the picker can discard.')
  })
})
