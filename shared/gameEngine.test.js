import { describe, it, expect, beforeEach } from 'vitest'
import { decidePick, decideDiscard } from './botStrategy.js'
import {
  isTrump, trumpRank, suitRank, effectiveSuit, cardPoints,
  schwanzerCardPoints, resolveSchwanzer,
  dealHand, pick, pass, blitz,
  discard, callAce, goAlone, callTen, callKing,
  callAceUnknown, crack, recrack,
  playCard, computeScores, resolveLeaster,
  setupLeaster, awardLeasterBlind, getPlayerView,
  rewindPlay, rewindTrick,
} from './gameEngine.js'
import {
  countTrumpPlayed, trumpRemainingElsewhere,
  buriablePoints, handScore,
  beats, currentWinner, teammateWinning,
  bestVoidDiscard,
} from './botInference.js'

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

  it('initializes rewindHistory as an empty array', () => {
    const state = dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
    expect(state.rewindHistory).toEqual([])
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

  it('throws when trying to bury a card the picker must keep for the partner call', () => {
    // Picker holds all 3 fail aces → callMode becomes 'ten', mustHold = [AC, AH, AS]
    const state = {
      phase: 'discarding',
      picker: 'p1',
      pickOrder: ['p1','p2','p3','p4','p5'],
      blind: [],
      log: [],
      hands: {
        p1: [c('A','C'), c('A','H'), c('A','S'), c('Q','C'), c('J','C'), c('K','D'), c('9','D'), c('8','D')],
        p2: [], p3: [], p4: [], p5: [],
      },
    }
    expect(() => discard(state, 'p1', ['AC', 'QC'])).toThrow('Cannot bury AC')
  })
})

describe('partner calling', () => {
  function makeCallingState({ callMode = 'ace' } = {}) {
    return {
      phase: 'calling',
      picker: 'p1',
      callMode,
      pickOrder: ['p1','p2','p3','p4','p5'],
      hands: {
        // p1: trump + clubs fail (no AC) — can call AC
        p1: [c('Q','C'), c('J','C'), c('A','D'), c('K','C'), c('9','C'), c('8','C')],
        // p2: holds AC → will be partner when clubs called
        p2: [c('A','C'), c('7','C'), c('8','H'), c('9','H'), c('A','H'), c('10','H')],
        p3: [c('K','H'), c('A','S'), c('K','S'), c('9','S'), c('8','S'), c('7','S')],
        p4: [c('7','H'), c('10','C'), c('K','D'), c('9','D'), c('8','D'), c('7','D')],
        p5: [c('Q','S'), c('Q','H'), c('J','S'), c('J','H'), c('10','D'), c('10','S')],
      },
      discard: [c('Q','D'), c('J','D')],
      log: [],
    }
  }

  describe('callAce', () => {
    it('advances to playing phase and sets calledAce', () => {
      const next = callAce(makeCallingState(), 'p1', 'C')
      expect(next.phase).toBe('playing')
      expect(next.calledAce).toEqual({ suit: 'C', aceId: 'AC' })
    })

    it('identifies the holder of the called ace as partner', () => {
      const next = callAce(makeCallingState(), 'p1', 'C')
      expect(next.partner).toBe('p2')
    })

    it('throws if picker holds the called ace', () => {
      const state = makeCallingState()
      // Inject AC into p1's hand (remove KC to avoid hand size issues)
      state.hands.p1 = [c('Q','C'), c('J','C'), c('A','D'), c('A','C'), c('9','C'), c('8','C')]
      expect(() => callAce(state, 'p1', 'C')).toThrow()
    })

    it('throws if picker holds no fail cards of the called suit', () => {
      const state = makeCallingState()
      // p1 has no hearts fail cards → cannot call AH
      // p1's hand has no fail hearts (KH, 9H, etc.) — only trump and clubs fail
      expect(() => callAce(state, 'p1', 'H')).toThrow()
    })
  })

  describe('goAlone', () => {
    it('sets goingAlone=true, clears partner, and advances to playing', () => {
      const next = goAlone(makeCallingState(), 'p1')
      expect(next.phase).toBe('playing')
      expect(next.goingAlone).toBe(true)
      expect(next.partner).toBeNull()
    })

    it('throws if a non-picker calls goAlone', () => {
      expect(() => goAlone(makeCallingState(), 'p2')).toThrow()
    })
  })

  describe('callTen', () => {
    // callMode='ten': picker holds all 3 fail aces (AC, AH, AS) but not 10C
    it('sets calledTen, partner, and pickerForcedPlays', () => {
      const state = {
        phase: 'calling',
        picker: 'p1',
        callMode: 'ten',
        pickOrder: ['p1','p2','p3','p4','p5'],
        hands: {
          p1: [c('A','C'), c('A','H'), c('A','S'), c('Q','C'), c('J','C'), c('K','D')],
          p2: [c('10','C'), c('7','C'), c('8','H'), c('9','H'), c('Q','S'), c('J','S')],
          p3: [c('K','H'), c('K','S'), c('9','S'), c('8','S'), c('7','S'), c('9','C')],
          p4: [c('7','H'), c('8','C'), c('A','D'), c('9','D'), c('8','D'), c('7','D')],
          p5: [c('Q','H'), c('Q','D'), c('J','H'), c('J','D'), c('10','D'), c('10','H')],
        },
        discard: [c('10','S'), c('K','C')],
        log: [],
      }
      const next = callTen(state, 'p1', 'C')
      expect(next.calledTen).toEqual({ suit: 'C', tenId: '10C' })
      expect(next.partner).toBe('p2')
      expect(next.pickerForcedPlays).toContain('AC')
    })
  })

  describe('callKing', () => {
    // callMode='king': picker holds all 3 fail aces AND all 3 fail tens
    it('sets calledKing, partner, and pickerForcedPlays with both ace and ten', () => {
      const state = {
        phase: 'calling',
        picker: 'p1',
        callMode: 'king',
        pickOrder: ['p1','p2','p3','p4','p5'],
        hands: {
          p1: [c('A','C'), c('A','H'), c('A','S'), c('10','C'), c('10','H'), c('10','S')],
          p2: [c('K','C'), c('7','C'), c('8','H'), c('9','H'), c('Q','S'), c('J','S')],
          p3: [c('K','H'), c('K','S'), c('9','S'), c('8','S'), c('7','S'), c('9','C')],
          p4: [c('7','H'), c('8','C'), c('A','D'), c('9','D'), c('8','D'), c('7','D')],
          p5: [c('Q','C'), c('Q','H'), c('J','C'), c('J','H'), c('10','D'), c('Q','D')],
        },
        discard: [c('J','D'), c('K','D')],
        log: [],
      }
      const next = callKing(state, 'p1', 'C')
      expect(next.calledKing).toEqual({ suit: 'C', kingId: 'KC' })
      expect(next.partner).toBe('p2')
      expect(next.pickerForcedPlays).toContain('AC')
      expect(next.pickerForcedPlays).toContain('10C')
    })
  })
})

describe('playCard', () => {
  // State: p1 has led KH; p2 & p3 have played; p4 is next; partner is p3 (already revealed)
  function makeMidTrickState() {
    return {
      phase: 'playing',
      picker: 'p1',
      partner: 'p3',
      goingAlone: false,
      calledAce: { suit: 'S', aceId: 'AS' },
      calledSuit: 'S',
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      blitzes: [],
      discard: [],
      tricks: [],
      currentTrick: [
        { userId: 'p1', card: c('K','H') },
        { userId: 'p2', card: c('A','H') },
        { userId: 'p3', card: c('7','C') },
      ],
      currentLeader: 'p1',
      log: [],
      scores: {},
      hands: {
        p1: [],                              // already played
        p2: [],                              // already played
        p3: [],                              // already played
        p4: [c('9','H'), c('K','S')],        // has hearts (led suit) — p4 is next
        p5: [c('10','H'), c('9','C')],
      },
    }
  }

  it('throws when player has the led suit but plays a different suit', () => {
    const state = makeMidTrickState()
    // p4 has 9H (the led suit) but tries to play KS instead
    expect(() => playCard(state, 'p4', 'KS')).toThrow('Must follow suit')
  })

  it('allows playing any card when void in the led suit', () => {
    // Create a separate state where p4 is void in the led suit
    const state = {
      phase: 'playing',
      picker: 'p1',
      partner: 'p3',
      goingAlone: false,
      calledAce: { suit: 'S', aceId: 'AS' },
      calledSuit: 'S',
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      blitzes: [],
      discard: [],
      tricks: [],
      currentTrick: [
        { userId: 'p1', card: c('K','H') },
        { userId: 'p2', card: c('A','H') },
        { userId: 'p3', card: c('8','C') },
      ],
      currentLeader: 'p1',
      log: [],
      scores: {},
      hands: {
        p1: [],
        p2: [],
        p3: [],
        p4: [c('7','C'), c('K','S')],        // void in hearts — can play 7C or KS
        p5: [c('10','H'), c('9','C')],
      },
    }
    // p4 has no hearts — can play 7C freely
    expect(() => playCard(state, 'p4', '7C')).not.toThrow()
  })

  it('throws when playing a card not in hand', () => {
    const state = makeMidTrickState()
    // p4 does not have QC in hand
    expect(() => playCard(state, 'p4', 'QC')).toThrow()
  })

  it('throws when it is not the player\'s turn', () => {
    const state = makeMidTrickState()
    // p5's turn comes after p4 — p5 cannot play before p4
    expect(() => playCard(state, 'p5', '10H')).toThrow()
  })

  // State: empty trick, p1 leads first
  function makeOpenTrickState() {
    return {
      phase: 'playing',
      picker: 'p1',
      partner: 'p3',
      goingAlone: false,
      calledAce: { suit: 'S', aceId: 'AS' },
      calledSuit: 'S',
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      blitzes: [],
      discard: [],
      tricks: [],
      currentTrick: [],
      currentLeader: 'p1',
      log: [],
      scores: {},
      hands: {
        p1: [c('K','H')],   // leads hearts
        p2: [c('A','H')],   // higher heart — would win if no trump
        p3: [c('Q','C')],   // trump — beats all fail
        p4: [c('9','H')],
        p5: [c('7','H')],
      },
    }
  }

  it('trump beats a led fail card', () => {
    let state = makeOpenTrickState()
    state = playCard(state, 'p1', 'KH')   // p1 leads KH
    state = playCard(state, 'p2', 'AH')   // p2 plays AH (would win among hearts)
    state = playCard(state, 'p3', 'QC')   // p3 plays QC (trump — should win)
    state = playCard(state, 'p4', '9H')
    state = playCard(state, 'p5', '7H')
    expect(state.tricks[0].winner).toBe('p3')
  })

  it('higher trump beats lower trump', () => {
    const state = {
      phase: 'playing',
      picker: 'p1',
      partner: 'p2',
      goingAlone: false,
      calledAce: { suit: 'H', aceId: 'AH' },
      calledSuit: 'H',
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      blitzes: [],
      discard: [],
      tricks: [],
      currentTrick: [],
      currentLeader: 'p1',
      log: [],
      scores: {},
      hands: {
        p1: [c('Q','C')],   // QC — rank 0 (strongest trump)
        p2: [c('Q','S')],   // QS — rank 1
        p3: [c('J','C')],   // JC — rank 4
        p4: [c('A','D')],   // AD — rank 8
        p5: [c('7','D')],   // 7D — rank 13 (weakest trump)
      },
    }
    let s = state
    s = playCard(s, 'p1', 'QC')
    s = playCard(s, 'p2', 'QS')
    s = playCard(s, 'p3', 'JC')
    s = playCard(s, 'p4', 'AD')
    s = playCard(s, 'p5', '7D')
    expect(s.tricks[0].winner).toBe('p1')  // QC (rank 0) wins
  })

  it('higher card of led suit wins among fail cards', () => {
    const state = {
      phase: 'playing',
      picker: 'p1',
      partner: 'p2',
      goingAlone: false,
      calledAce: { suit: 'H', aceId: 'AH' },
      calledSuit: 'H',
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      blitzes: [],
      discard: [],
      tricks: [],
      currentTrick: [],
      currentLeader: 'p1',
      log: [],
      scores: {},
      hands: {
        p1: [c('K','C')],   // leads clubs
        p2: [c('A','C')],   // AC — highest club, should win
        p3: [c('9','C')],
        p4: [c('8','C')],
        p5: [c('7','C')],
      },
    }
    let s = state
    s = playCard(s, 'p1', 'KC')
    s = playCard(s, 'p2', 'AC')
    s = playCard(s, 'p3', '9C')
    s = playCard(s, 'p4', '8C')
    s = playCard(s, 'p5', '7C')
    expect(s.tricks[0].winner).toBe('p2')  // AC wins
  })

  it('transitions to scoring phase after 6 tricks', () => {
    // Build a state with 5 complete tricks already done, then play the last card
    const tricksComplete = Array(5).fill(null).map(() => ({
      leader: 'p1',
      plays: [
        { userId: 'p1', card: c('7','C') },
        { userId: 'p2', card: c('8','C') },
        { userId: 'p3', card: c('9','C') },
        { userId: 'p4', card: c('7','H') },
        { userId: 'p5', card: c('8','H') },
      ],
      winner: 'p1',
    }))
    const endState = {
      phase: 'playing',
      picker: 'p1',
      partner: null,
      goingAlone: true,
      calledAce: null,
      calledSuit: null,
      calledTen: null,
      calledKing: null,
      partnerRevealed: false,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      blitzes: [],
      discard: [],
      tricks: tricksComplete,
      currentTrick: [
        { userId: 'p1', card: c('A','C') },
        { userId: 'p2', card: c('K','S') },
        { userId: 'p3', card: c('9','S') },
        { userId: 'p4', card: c('8','S') },
      ],
      currentLeader: 'p1',
      log: [],
      scores: {},
      hands: {
        p1: [],
        p2: [],
        p3: [],
        p4: [],
        p5: [c('7','S')],
      },
    }
    const final = playCard(endState, 'p5', '7S')
    expect(final.phase).toBe('scoring')
    expect(final.tricks).toHaveLength(6)
  })
})

describe('rewind history (playCard)', () => {
  function makeLeadingState() {
    return {
      phase: 'playing',
      picker: 'p1',
      partner: 'p3',
      goingAlone: false,
      calledAce: { suit: 'S', aceId: 'AS' },
      calledSuit: 'S',
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      crackState: null,
      blitzes: [],
      discard: [],
      tricks: [],
      currentTrick: [],
      currentLeader: 'p1',
      lastTrick: [],
      log: [],
      scores: {},
      rewindHistory: [],
      hands: {
        p1: [c('K','H')],
        p2: [c('7','H')],
        p3: [c('8','H')],
        p4: [c('9','H')],
        p5: [c('10','H')],
      },
    }
  }

  it('adds one entry to rewindHistory per card play', () => {
    const state = makeLeadingState()
    const next = playCard(state, 'p1', 'KH')
    expect(next.rewindHistory).toHaveLength(1)
  })

  it('snapshot does not contain nested rewindHistory entries (no exponential growth)', () => {
    const state = makeLeadingState()
    const next = playCard(state, 'p1', 'KH')
    expect(next.rewindHistory[0].rewindHistory).toEqual([])
  })

  it('snapshot captures pre-play state (card still in hand, trick still empty)', () => {
    const state = makeLeadingState()
    const next = playCard(state, 'p1', 'KH')
    const snapshot = next.rewindHistory[0]
    expect(snapshot.currentTrick).toHaveLength(0)
    expect(snapshot.hands.p1.some(cd => cd.id === 'KH')).toBe(true)
  })
})

describe('rewindPlay', () => {
  function makeHandStartSnapshot(overrides = {}) {
    return {
      phase: 'playing',
      picker: 'p1',
      partner: 'p3',
      goingAlone: false,
      calledAce: { suit: 'S', aceId: 'AS' },
      calledSuit: 'S',
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      crackState: null,
      blitzes: [],
      discard: [],
      tricks: [],
      currentTrick: [],
      currentLeader: 'p1',
      lastTrick: [],
      log: [],
      scores: {},
      rewindHistory: [],
      hands: {
        p1: [c('K','H')],
        p2: [c('7','H')],
        p3: [c('8','H')],
        p4: [c('9','H')],
        p5: [c('10','H')],
      },
      ...overrides,
    }
  }

  function makeStateAfterOnePlay() {
    const snapshot = makeHandStartSnapshot()
    return {
      ...makeHandStartSnapshot(),
      hands: { ...makeHandStartSnapshot().hands, p1: [] },
      currentTrick: [{ userId: 'p1', card: c('K','H') }],
      rewindHistory: [snapshot],
    }
  }

  it('restores currentTrick to pre-play length', () => {
    const state = makeStateAfterOnePlay()
    const rewound = rewindPlay(state)
    expect(rewound.currentTrick).toHaveLength(0)
  })

  it('restores the played card to the player hand', () => {
    const state = makeStateAfterOnePlay()
    const rewound = rewindPlay(state)
    expect(rewound.hands.p1.some(cd => cd.id === 'KH')).toBe(true)
  })

  it('removes the entry from rewindHistory', () => {
    const state = makeStateAfterOnePlay()
    const rewound = rewindPlay(state)
    expect(rewound.rewindHistory).toHaveLength(0)
  })

  it('throws when rewindHistory is empty', () => {
    const state = makeHandStartSnapshot()
    expect(() => rewindPlay(state)).toThrow('Nothing to rewind')
  })

  it('throws when phase is not playing', () => {
    const state = makeStateAfterOnePlay()
    state.phase = 'picking'
    expect(() => rewindPlay(state)).toThrow()
  })

  it('resets crackState and handCrackMultiplier when restored state is at hand start', () => {
    const crackedSnapshot = makeHandStartSnapshot({ crackState: 'cracked', handCrackMultiplier: 2 })
    const state = {
      ...makeHandStartSnapshot({ crackState: 'cracked', handCrackMultiplier: 2 }),
      hands: { ...makeHandStartSnapshot().hands, p1: [] },
      currentTrick: [{ userId: 'p1', card: c('K','H') }],
      rewindHistory: [crackedSnapshot],
    }
    const rewound = rewindPlay(state)
    expect(rewound.crackState).toBeNull()
    expect(rewound.handCrackMultiplier).toBe(1)
  })

  it('does NOT reset crackState when restored state is mid-trick (not hand start)', () => {
    const s0 = makeHandStartSnapshot()
    const s1 = {
      ...s0,
      crackState: 'cracked',
      handCrackMultiplier: 2,
      hands: { ...s0.hands, p1: [] },
      currentTrick: [{ userId: 'p1', card: c('K','H') }],
      rewindHistory: [],
    }
    const state = {
      ...s1,
      crackState: 'cracked',
      handCrackMultiplier: 2,
      hands: { ...s1.hands, p2: [] },
      currentTrick: [{ userId: 'p1', card: c('K','H') }, { userId: 'p2', card: c('7','H') }],
      rewindHistory: [s0, s1],
    }
    const rewound = rewindPlay(state)
    expect(rewound.currentTrick).toHaveLength(1)
    expect(rewound.crackState).toBe('cracked')
  })
})

describe('rewindTrick', () => {
  function makeHandStartSnapshot(overrides = {}) {
    return {
      phase: 'playing',
      picker: 'p1', partner: 'p3', goingAlone: false,
      calledAce: { suit: 'S', aceId: 'AS' }, calledSuit: 'S',
      calledTen: null, calledKing: null,
      partnerRevealed: true, pickerForcedPlays: [], underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1, handCrackMultiplier: 1, crackState: null,
      blitzes: [], discard: [],
      tricks: [], currentTrick: [], currentLeader: 'p1',
      lastTrick: [], log: [], scores: {},
      rewindHistory: [],
      hands: {
        p1: [c('K','H')], p2: [c('7','H')], p3: [c('8','H')],
        p4: [c('9','H')], p5: [c('10','H')],
      },
      ...overrides,
    }
  }

  it('is a no-op when rewindHistory is empty', () => {
    const state = makeHandStartSnapshot()
    const result = rewindTrick(state)
    expect(result).toBe(state)
  })

  it('rewinds mid-trick to the start of the current trick', () => {
    const s0 = makeHandStartSnapshot()
    const s1 = { ...makeHandStartSnapshot(), hands: { ...makeHandStartSnapshot().hands, p1: [] }, currentTrick: [{ userId: 'p1', card: c('K','H') }], rewindHistory: [] }
    const state = {
      ...s1,
      hands: { ...s1.hands, p2: [] },
      currentTrick: [{ userId: 'p1', card: c('K','H') }, { userId: 'p2', card: c('7','H') }],
      rewindHistory: [s0, s1],
    }
    const rewound = rewindTrick(state)
    expect(rewound.currentTrick).toHaveLength(0)
    expect(rewound.tricks).toHaveLength(0)
  })

  it('rewinds to the previous trick when currentTrick is already empty', () => {
    const s0 = makeHandStartSnapshot()
    const s1 = { ...s0, currentTrick: [{ userId: 'p1', card: c('K','H') }], rewindHistory: [] }
    const s2 = { ...s0, currentTrick: [{ userId: 'p1', card: c('K','H') }, { userId: 'p2', card: c('7','H') }], rewindHistory: [] }
    const s3 = { ...s0, currentTrick: [{ userId: 'p1', card: c('K','H') }, { userId: 'p2', card: c('7','H') }, { userId: 'p3', card: c('8','H') }], rewindHistory: [] }
    const s4 = { ...s0, currentTrick: [{ userId: 'p1', card: c('K','H') }, { userId: 'p2', card: c('7','H') }, { userId: 'p3', card: c('8','H') }, { userId: 'p4', card: c('9','H') }], rewindHistory: [] }
    const state = {
      ...makeHandStartSnapshot(),
      tricks: [{ leader: 'p1', plays: [], winner: 'p1' }],
      currentTrick: [],
      currentLeader: 'p1',
      rewindHistory: [s0, s1, s2, s3, s4],
    }
    const rewound = rewindTrick(state)
    expect(rewound.currentTrick).toHaveLength(0)
    expect(rewound.tricks).toHaveLength(0)
  })

  it('resets crackState and handCrackMultiplier when rewinding to hand start', () => {
    const s0 = makeHandStartSnapshot({ crackState: 'cracked', handCrackMultiplier: 2 })
    const s1 = { ...s0, hands: { ...s0.hands, p1: [] }, currentTrick: [{ userId: 'p1', card: c('K','H') }], rewindHistory: [] }
    const state = {
      ...s1,
      hands: { ...s1.hands, p2: [] },
      currentTrick: [{ userId: 'p1', card: c('K','H') }, { userId: 'p2', card: c('7','H') }],
      rewindHistory: [s0, s1],
    }
    const rewound = rewindTrick(state)
    expect(rewound.tricks).toHaveLength(0)
    expect(rewound.crackState).toBeNull()
    expect(rewound.handCrackMultiplier).toBe(1)
  })

  it('does NOT reset crackState when rewinding to a mid-hand trick boundary', () => {
    const s5 = makeHandStartSnapshot({
      tricks: [{ leader: 'p1', plays: [], winner: 'p1' }],
      currentTrick: [],
      crackState: 'cracked',
      handCrackMultiplier: 2,
    })
    const s6 = { ...s5, currentTrick: [{ userId: 'p1', card: c('K','H') }], rewindHistory: [] }
    const state = {
      ...s5,
      currentTrick: [{ userId: 'p1', card: c('K','H') }, { userId: 'p2', card: c('7','H') }],
      rewindHistory: [s5, s6],
    }
    const rewound = rewindTrick(state)
    expect(rewound.currentTrick).toHaveLength(0)
    expect(rewound.tricks).toHaveLength(1)
    expect(rewound.crackState).toBe('cracked')
  })

  it('throws when phase is not playing', () => {
    const state = makeHandStartSnapshot({ phase: 'picking' })
    expect(() => rewindTrick(state)).toThrow()
  })
})

describe('computeScores', () => {
  // Create a fake card with a specific point rank (suit doesn't affect scoring)
  let fakeId = 0
  beforeEach(() => { fakeId = 0 })
  const fk = (rank) => ({ id: `fk${fakeId++}`, rank, suit: 'C' })

  // Build a trick: `winner` takes all points from `cards`
  const makeTrick = (winner, cards) => ({
    leader: winner,
    plays: ['p1','p2','p3','p4','p5'].map((uid, i) => ({ userId: uid, card: cards[i] ?? fk('7') })),
    winner,
  })

  function baseState(tricks, overrides = {}) {
    return {
      phase: 'scoring',
      picker: 'p1',
      partner: 'p2',
      goingAlone: false,
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      blitzes: [],
      discard: [],
      log: [],
      hands: { p1:[], p2:[], p3:[], p4:[], p5:[] },
      tricks,
      ...overrides,
    }
  }

  it('picker wins when picker team has 61+ points', () => {
    // p1 wins 3 tricks with 25 pts each = 75 pts; opponents win 3 tricks with 0 pts
    const tricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 11+10+4 = 25
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p4', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p5', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
    ]
    const scores = computeScores(baseState(tricks))
    expect(scores.p1).toBe(2)   // picker wins: +2
    expect(scores.p2).toBe(1)   // partner wins: +1
    expect(scores.p3).toBe(-1)
    expect(scores.p4).toBe(-1)
    expect(scores.p5).toBe(-1)
  })

  it('opponents win when picker team has fewer than 61 points', () => {
    // Picker team wins 2 tricks with 32 pts total (>29, <61); opponents win 4 tricks
    // 32 pts < 61 → picker loses; 32 > 29 → no schneider; 2 tricks won → no schwarz
    // baseMultiplier = 1
    const tricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('9'), fk('8'), fk('7')]),  // 11+10 = 21 pts
      makeTrick('p2', [fk('A'), fk('9'), fk('8'), fk('7'), fk('7')]),   // 11 pts → total = 32
      makeTrick('p3', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),  // opponents
      makeTrick('p3', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),  // opponents
      makeTrick('p4', [fk('9'), fk('8'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p5', [fk('9'), fk('8'), fk('7'), fk('7'), fk('7')]),
    ]
    const scores = computeScores(baseState(tricks))
    expect(scores.p1).toBe(-2)   // picker loses: -2
    expect(scores.p2).toBe(-1)   // partner loses: -1
    expect(scores.p3).toBe(1)
    expect(scores.p4).toBe(1)
    expect(scores.p5).toBe(1)
  })

  it('schneider doubles the base multiplier when picker team has 91+ points', () => {
    // p1 wins 2 tricks with 53+33=86 pts, p1 wins 1 more with ≥5 pts → 91+
    const tricks = [
      makeTrick('p1', [fk('A'), fk('A'), fk('A'), fk('10'), fk('10')]),   // 53 pts
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('K'), fk('K')]),    // 33 pts  (total=86)
      makeTrick('p1', [fk('Q'), fk('J'), fk('7'), fk('7'), fk('7')]),     // 3+2=5 pts (total=91)
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
    ]
    // baseMultiplier=2 (schneider), doublerMultiplier=1, handCrackMultiplier=1
    const scores = computeScores(baseState(tricks))
    expect(scores.p1).toBe(4)   // 2 × 2 = +4
    expect(scores.p2).toBe(2)   // 1 × 2 = +2
    expect(scores.p3).toBe(-2)
  })

  it('discard points count toward the picker\'s total', () => {
    // p1 wins 1 trick with 39 pts + discard has 2 aces (22 pts) = 61 → wins
    const tricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('10'), fk('K')]),  // 11+10+4+10+4 = 39
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
    ]
    // discard: [A, A] = 22 pts → picker total = 39+22 = 61 → wins
    const state = baseState(tricks, { discard: [fk('A'), fk('A')] })
    const scores = computeScores(state)
    expect(scores.p1).toBe(2)   // picker wins
  })

  it('going alone: picker earns points from all 4 opponents', () => {
    const tricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts each
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p4', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p5', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
    ]
    const scores = computeScores(baseState(tricks, { goingAlone: true, partner: null }))
    expect(scores.p1).toBe(4)   // 4 opponents × 1 = +4
    expect(scores.p2).toBe(-1)
    expect(scores.p3).toBe(-1)
    expect(scores.p4).toBe(-1)
    expect(scores.p5).toBe(-1)
  })

  it('picker team wins all 6 tricks (schwarz) — baseMultiplier is 3', () => {
    // pickerTeamTricks=6 → schwarz overrides schneider → baseMultiplier=3
    const tricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
    ]
    const scores = computeScores(baseState(tricks))
    expect(scores.p1).toBe(6)   // 2×3 (picker)
    expect(scores.p2).toBe(3)   // 1×3 (partner)
    expect(scores.p3).toBe(-3)
  })

  it('picker team has ≤29 points (schneider loss) — baseMultiplier doubles on loss', () => {
    // p1 wins 1 trick with 0 pts → ≤29, not schwarz, picker loses
    const tricks = [
      makeTrick('p1', [fk('9'), fk('8'), fk('7'), fk('7'), fk('7')]),  // 0 pts, p1 wins 1 trick
      makeTrick('p3', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
      makeTrick('p3', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
      makeTrick('p4', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
      makeTrick('p4', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
      makeTrick('p5', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
    ]
    const scores = computeScores(baseState(tricks))
    // pickerTeamPoints=0 ≤ 29 → schneider → baseMultiplier=2, pickerWon=false
    expect(scores.p1).toBe(-4)   // -2×2
    expect(scores.p2).toBe(-2)   // -1×2
    expect(scores.p3).toBe(2)
  })

  it('doublerMultiplier is applied to all scores', () => {
    // Normal picker win (75 pts) with doublerMultiplier=2
    const tricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p4', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p5', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
    ]
    const scores = computeScores(baseState(tricks, { doublerMultiplier: 2 }))
    // baseMultiplier=1, doublerMultiplier=2 → multiplier=2
    expect(scores.p1).toBe(4)   // 2×2
    expect(scores.p2).toBe(2)   // 1×2
    expect(scores.p3).toBe(-2)
    expect(scores.p4).toBe(-2)
    expect(scores.p5).toBe(-2)
  })

  describe('Double on the Bump (DOB)', () => {
    // Picker loses with 32 pts (no schneider, no schwarz, no crack, no blitz)
    // Expected base scores without DOB: p1=-2, p2=-1, p3=+1, p4=+1, p5=+1
    const losingTricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('9'), fk('8'), fk('7')]),  // 21 pts
      makeTrick('p2', [fk('A'), fk('9'), fk('8'), fk('7'), fk('7')]),   // 11 pts → total = 32
      makeTrick('p3', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
      makeTrick('p3', [fk('A'), fk('10'), fk('K'), fk('9'), fk('8')]),
      makeTrick('p4', [fk('9'), fk('8'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p5', [fk('9'), fk('8'), fk('7'), fk('7'), fk('7')]),
    ]

    it('doubles stakes when picker loses and double_on_bump is true', () => {
      const scores = computeScores(baseState(losingTricks, { double_on_bump: true }))
      expect(scores.p1).toBe(-4)   // -2 × 2 (DOB)
      expect(scores.p2).toBe(-2)   // -1 × 2
      expect(scores.p3).toBe(2)    // +1 × 2
      expect(scores.p4).toBe(2)
      expect(scores.p5).toBe(2)
    })

    it('does not double when picker loses and double_on_bump is false', () => {
      const scores = computeScores(baseState(losingTricks, { double_on_bump: false }))
      expect(scores.p1).toBe(-2)
      expect(scores.p2).toBe(-1)
      expect(scores.p3).toBe(1)
      expect(scores.p4).toBe(1)
      expect(scores.p5).toBe(1)
    })

    it('does not double when picker wins even if double_on_bump is true', () => {
      // Picker team wins with 75 pts (3 tricks of 25 pts each)
      const winningTricks = [
        makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts
        makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts
        makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('7'), fk('7')]),  // 25 pts
        makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
        makeTrick('p4', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
        makeTrick('p5', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      ]
      const scores = computeScores(baseState(winningTricks, { double_on_bump: true }))
      expect(scores.p1).toBe(2)
      expect(scores.p2).toBe(1)
      expect(scores.p3).toBe(-1)
      expect(scores.p4).toBe(-1)
      expect(scores.p5).toBe(-1)
    })

    it('DOB stacks with crack multiplier when picker loses', () => {
      // handCrackMultiplier=2 (cracked), DOB=true → total multiplier = 1×1×2×1×2 = 4
      const scores = computeScores(baseState(losingTricks, { double_on_bump: true, handCrackMultiplier: 2 }))
      expect(scores.p1).toBe(-8)   // -2 × (crack×2) × (DOB×2) = -2×4
      expect(scores.p2).toBe(-4)
      expect(scores.p3).toBe(4)
      expect(scores.p4).toBe(4)
      expect(scores.p5).toBe(4)
    })
  })
})

describe('resolveLeaster', () => {
  let fkId = 0
  beforeEach(() => { fkId = 0 })
  const fk = (rank) => ({ id: `lk${fkId++}`, rank, suit: 'C' })

  const makeTrick = (winner, pointRanks) => ({
    leader: winner,
    plays: ['p1','p2','p3','p4','p5'].map((uid, i) => ({
      userId: uid,
      card: fk(pointRanks[i] ?? '7'),
    })),
    winner,
  })

  function leasterState(tricks) {
    return {
      hands: { p1:[], p2:[], p3:[], p4:[], p5:[] },
      tricks,
      log: [],
    }
  }

  it('player with fewest points who took ≥1 trick wins', () => {
    const tricks = [
      makeTrick('p1', ['A','10','K','7','7']),    // p1 gets 25 pts
      makeTrick('p2', ['A','10','K','7','7']),    // p2 gets 25 pts
      makeTrick('p3', ['7','7','7','7','7']),     // p3 gets 0 pts ← winner
      makeTrick('p4', ['A','7','7','7','7']),     // p4 gets 11 pts
      makeTrick('p5', ['10','7','7','7','7']),    // p5 gets 10 pts
      makeTrick('p3', ['7','7','7','7','7']),     // p3 gets 0 pts more
    ]
    const { winner, scores } = resolveLeaster(leasterState(tricks))
    expect(winner).toBe('p3')
    expect(scores.p3).toBe(4)
    expect(scores.p1).toBe(-1)
    expect(scores.p2).toBe(-1)
    expect(scores.p4).toBe(-1)
    expect(scores.p5).toBe(-1)
  })

  it('tie-break: when points are equal, player with fewer tricks wins', () => {
    const tricks = [
      makeTrick('p1', ['A','7','7','7','7']),    // p1: 11 pts, 1 trick
      makeTrick('p2', ['7','7','7','7','7']),    // p2: 0 pts, 1st trick
      makeTrick('p2', ['7','7','7','7','7']),    // p2: 0 pts, 2nd trick → 2 tricks total
      makeTrick('p3', ['7','7','7','7','7']),    // p3: 0 pts, 1 trick ← tied with p2 on pts, fewer tricks
      makeTrick('p4', ['10','7','7','7','7']),   // p4: 10 pts
      makeTrick('p5', ['K','7','7','7','7']),    // p5: 4 pts
    ]
    // p2 and p3 both have 0 pts. p3 has 1 trick, p2 has 2 tricks → p3 wins
    const { winner } = resolveLeaster(leasterState(tricks))
    expect(winner).toBe('p3')
  })

  it('player who won no tricks is not eligible', () => {
    const tricks = [
      makeTrick('p1', ['A','10','K','7','7']),
      makeTrick('p1', ['A','10','K','7','7']),
      makeTrick('p2', ['7','7','7','7','7']),
      makeTrick('p2', ['7','7','7','7','7']),
      makeTrick('p3', ['7','7','7','7','7']),
      makeTrick('p3', ['7','7','7','7','7']),
    ]
    // p4 and p5 never won a trick — they should not win leaster
    const { winner } = resolveLeaster(leasterState(tricks))
    expect(['p1','p2','p3']).toContain(winner)
    expect(winner).not.toBe('p4')
    expect(winner).not.toBe('p5')
  })

  it('pushes a log entry naming the winner', () => {
    const tricks = [
      makeTrick('p1', ['A','7','7','7','7']),
      makeTrick('p2', ['7','7','7','7','7']),
      makeTrick('p3', ['7','7','7','7','7']),
      makeTrick('p4', ['7','7','7','7','7']),
      makeTrick('p5', ['7','7','7','7','7']),
      makeTrick('p3', ['7','7','7','7','7']),
    ]
    const state = leasterState(tricks)
    resolveLeaster(state)
    expect(state.log.length).toBe(1)
    expect(state.log[0]).toContain('Leaster')
  })
})

describe('callAceUnknown', () => {
  function makeUnknownCallingState() {
    return {
      phase: 'calling',
      picker: 'p1',
      callMode: 'ace',
      pickOrder: ['p1','p2','p3','p4','p5'],
      hands: {
        // p1: all trump, no fail cards → no normal call available for any suit
        p1: [c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'), c('J','C'), c('J','S')],
        // p2: holds AC → becomes partner when clubs ace is called
        p2: [c('A','C'), c('7','C'), c('8','H'), c('9','H'), c('A','H'), c('10','H')],
        p3: [c('K','H'), c('A','S'), c('K','S'), c('9','S'), c('8','S'), c('7','S')],
        p4: [c('7','H'), c('10','C'), c('K','D'), c('9','D'), c('8','D'), c('7','D')],
        p5: [c('J','H'), c('J','D'), c('10','D'), c('A','D'), c('8','C'), c('9','C')],
      },
      discard: [c('K','C'), c('8','S')],  // AC not buried
      log: [],
    }
  }

  it('sets underCard, calledAce (unknown:true), partner, and advances to playing', () => {
    const next = callAceUnknown(makeUnknownCallingState(), 'p1', 'C', 'QS')
    expect(next.phase).toBe('playing')
    expect(next.underCard).toMatchObject({ id: 'QS', ownerId: 'p1', played: false })
    expect(next.calledAce).toEqual({ suit: 'C', aceId: 'AC', unknown: true })
    expect(next.partner).toBe('p2')
  })

  it('throws when a normal ace call is available for another suit', () => {
    const state = makeUnknownCallingState()
    // Add a fail heart (KH) — p1 doesn't hold AH, AH not in discard → normal call available for H
    state.hands.p1 = [c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'), c('J','C'), c('K','H')]
    expect(() => callAceUnknown(state, 'p1', 'C', 'QS')).toThrow('normal ace call is available')
  })
})

describe('crack / recrack', () => {
  function makeCrackState() {
    return {
      phase: 'playing',
      picker: 'p1',
      partner: 'p2',
      goingAlone: false,
      isLeaster: false,
      tricks: [],
      currentTrick: [],
      crackState: null,
      handCrackMultiplier: 1,
      pickOrder: ['p1','p2','p3','p4','p5'],
      pickIndex: 0,  // p1 picked first — no one passed → all opponents eligible to crack
      log: [],
      hands: { p1:[], p2:[], p3:[], p4:[], p5:[] },
    }
  }

  it('opponent cracks before any card is played — sets crackState and doubles multiplier', () => {
    const next = crack(makeCrackState(), 'p3')
    expect(next.crackState).toBe('cracked')
    expect(next.handCrackMultiplier).toBe(2)
  })

  it('throws if the picker tries to crack', () => {
    expect(() => crack(makeCrackState(), 'p1')).toThrow('Only opponents may crack.')
  })

  it('picker recrack after crack — multiplier becomes 4', () => {
    const cracked = crack(makeCrackState(), 'p3')
    const recracked = recrack(cracked, 'p1')
    expect(recracked.crackState).toBe('recracked')
    expect(recracked.handCrackMultiplier).toBe(4)
  })

  it('throws if an opponent tries to recrack', () => {
    const cracked = crack(makeCrackState(), 'p3')
    expect(() => recrack(cracked, 'p5')).toThrow('Only the picker or partner may recrack.')
  })
})

describe('setupLeaster', () => {
  function makeNoPickState() {
    return {
      phase: 'no_pick',
      pickOrder: ['p1','p2','p3','p4','p5'],
      dealerSeat: 0,
      blind: [c('Q','D'), c('J','D')],
      hands: { p1:[], p2:[], p3:[], p4:[], p5:[] },
      log: [],
    }
  }

  it('sets isLeaster, moves blind to leasterBlind, and advances to playing', () => {
    const next = setupLeaster(makeNoPickState())
    expect(next.isLeaster).toBe(true)
    expect(next.phase).toBe('playing')
    expect(next.leasterBlind).toHaveLength(2)
    expect(next.blind).toHaveLength(0)
  })

  it('sets currentLeader to the player left of the dealer', () => {
    const next = setupLeaster(makeNoPickState())
    // dealerSeat=0 → pickOrder[(0+1)%5] = pickOrder[1] = 'p2'
    expect(next.currentLeader).toBe('p2')
  })
})

describe('awardLeasterBlind', () => {
  it('adds blind cards as plays to trick 1 winner after trick 1 resolves', () => {
    const state = {
      tricks: [{
        leader: 'p1',
        winner: 'p2',
        plays: [
          { userId: 'p1', card: c('K','H') },
          { userId: 'p2', card: c('A','H') },
          { userId: 'p3', card: c('9','H') },
          { userId: 'p4', card: c('8','H') },
          { userId: 'p5', card: c('7','H') },
        ],
      }],
      leasterBlind: [c('Q','D'), c('J','D')],
    }
    const next = awardLeasterBlind(state)
    expect(next.tricks[0].plays).toHaveLength(7)   // 5 plays + 2 blind cards
    expect(next.leasterBlind).toHaveLength(0)
    const blindPlays = next.tricks[0].plays.slice(5)
    expect(blindPlays.every(p => p.userId === 'p2')).toBe(true)
  })
})

describe('getPlayerView', () => {
  function makeViewState() {
    return {
      phase: 'playing',
      picker: 'p1',
      partner: 'p2',
      partnerRevealed: false,
      goingAlone: false,
      blind: [],
      discard: [c('Q','D'), c('J','D')],
      underCard: null,
      tricks: [],
      currentTrick: [],
      lastTrick: [],
      log: [],
      hands: {
        p1: [c('Q','C'), c('J','C'), c('A','D')],
        p2: [c('A','C'), c('K','H'), c('9','S')],
        p3: [c('10','H'), c('8','C'), c('7','S')],
        p4: [c('K','S'), c('9','H'), c('8','H')],
        p5: [c('10','S'), c('7','H'), c('8','S')],
      },
    }
  }

  it('player sees their own hand; opponent hands are hidden', () => {
    const view = getPlayerView(makeViewState(), 'p1')
    expect(view.hands.p1.every(card => card.hidden !== true)).toBe(true)
    expect(view.hands.p2.every(card => card.hidden === true)).toBe(true)
    expect(view.hands.p3.every(card => card.hidden === true)).toBe(true)
  })

  it('picker can see the discard; opponents see hidden placeholders', () => {
    const pickerView = getPlayerView(makeViewState(), 'p1')
    expect(pickerView.discard.every(card => card.hidden !== true)).toBe(true)

    const oppView = getPlayerView(makeViewState(), 'p3')
    expect(oppView.discard.every(card => card.hidden === true)).toBe(true)
  })

  it('partner identity is hidden from opponents when partnerRevealed is false', () => {
    const pickerView = getPlayerView(makeViewState(), 'p1')
    expect(pickerView.partner).toBe('p2')   // picker always sees partner

    const oppView = getPlayerView(makeViewState(), 'p3')
    expect(oppView.partner).toBeNull()      // opponent sees null until revealed
  })

  it('partner identity is hidden from opponents when reveal_partner is false, even if partnerRevealed is true', () => {
    const state = { ...makeViewState(), partnerRevealed: true, reveal_partner: false }

    const oppView = getPlayerView(state, 'p3')
    expect(oppView.partner).toBeNull()

    const pickerView = getPlayerView(state, 'p1')
    expect(pickerView.partner).toBe('p2')   // picker always sees partner

    const partnerView = getPlayerView(state, 'p2')
    expect(partnerView.partner).toBe('p2')  // partner sees themselves
  })

  it('partner identity is visible to opponents when reveal_partner is true and partnerRevealed is true', () => {
    const state = { ...makeViewState(), partnerRevealed: true, reveal_partner: true }
    const oppView = getPlayerView(state, 'p3')
    expect(oppView.partner).toBe('p2')
  })

  it('strips rewindHistory from the player view', () => {
    // Build a minimal state with a non-empty rewindHistory
    const snapshot = { phase: 'playing', tricks: [], currentTrick: [], rewindHistory: [] }
    const state = {
      phase: 'playing',
      picker: 'p1', partner: 'p3', goingAlone: false,
      calledAce: null, calledSuit: null, calledTen: null, calledKing: null,
      partnerRevealed: false, pickerForcedPlays: [], underCard: null,
      pickOrder: ['p1','p2','p3','p4','p5'],
      doublerMultiplier: 1, handCrackMultiplier: 1, crackState: null,
      blitzes: [], discard: [], tricks: [], currentTrick: [], currentLeader: 'p1',
      lastTrick: [], log: [], scores: {},
      rewindHistory: [snapshot],
      hands: { p1: [], p2: [], p3: [], p4: [], p5: [] },
    }
    const view = getPlayerView(state, 'p1')
    expect(view.rewindHistory).toEqual([])
  })
})

// ─── botInference helpers ─────────────────────────────────────────────────────
const trick = (plays) => ({ plays: plays.map(([uid, card]) => ({ userId: uid, card })), winner: plays[0][0] })

describe('countTrumpPlayed', () => {
  it('counts trump in completed tricks', () => {
    const view = {
      tricks: [trick([['p1', c('Q','C')], ['p2', c('A','H')], ['p3', c('7','C')], ['p4', c('8','S')], ['p5', c('9','C')]])],
      currentTrick: [],
      hands: { p1: [] },
    }
    // QC is trump, rest are not
    expect(countTrumpPlayed(view, 'p1')).toBe(1)
  })

  it('counts trump in currentTrick', () => {
    const view = {
      tricks: [],
      currentTrick: [{ userId: 'p2', card: c('J','C') }, { userId: 'p3', card: c('K','H') }],
      hands: { p1: [] },
    }
    // JC is trump, KH is not
    expect(countTrumpPlayed(view, 'p1')).toBe(1)
  })

  it('skips hidden plays', () => {
    const view = {
      tricks: [{ plays: [{ userId: 'p2', card: { id: 'UNDER_CARD', hidden: true } }], winner: 'p2' }],
      currentTrick: [],
      hands: { p1: [] },
    }
    expect(countTrumpPlayed(view, 'p1')).toBe(0)
  })

  it('returns 0 when no tricks played', () => {
    const view = { tricks: [], currentTrick: [], hands: { p1: [] } }
    expect(countTrumpPlayed(view, 'p1')).toBe(0)
  })
})

describe('trumpRemainingElsewhere', () => {
  it('subtracts own trump and played trump from 14', () => {
    // Own hand: QC, JC = 2 trump. Played: AD = 1 trump. Remaining = 14 - 2 - 1 = 11
    const view = {
      tricks: [trick([['p2', c('A','D')], ['p1', c('7','C')]])],
      currentTrick: [],
      hands: { p1: [c('Q','C'), c('J','C'), c('A','H'), c('K','S'), c('9','C'), c('8','S')] },
    }
    expect(trumpRemainingElsewhere(view, 'p1')).toBe(11)
  })

  it('returns 0 when all trump accounted for', () => {
    // Own hand has 7 trump. Played tricks show 7 trump. 14 - 7 - 7 = 0.
    const myTrump = [
      { id: 'QC', rank: 'Q', suit: 'C' },
      { id: 'QS', rank: 'Q', suit: 'S' },
      { id: 'QH', rank: 'Q', suit: 'H' },
      { id: 'QD', rank: 'Q', suit: 'D' },
      { id: 'JC', rank: 'J', suit: 'C' },
      { id: 'JS', rank: 'J', suit: 'S' },
      { id: 'JH', rank: 'J', suit: 'H' },
    ]
    const playedTrump = [
      { id: 'JD', rank: 'J', suit: 'D' },
      { id: 'AD', rank: 'A', suit: 'D' },
      { id: '10D', rank: '10', suit: 'D' },
      { id: 'KD', rank: 'K', suit: 'D' },
      { id: '9D', rank: '9', suit: 'D' },
      { id: '8D', rank: '8', suit: 'D' },
      { id: '7D', rank: '7', suit: 'D' },
    ]
    const view = {
      tricks: [{ plays: playedTrump.map(card => ({ userId: 'p2', card })), winner: 'p2' }],
      currentTrick: [],
      hands: { p1: myTrump },
    }
    expect(trumpRemainingElsewhere(view, 'p1')).toBe(0)
  })

  it('subtracts trump visible in picker discard', () => {
    // Picker (p1) buried QS (trump) in discard. Own hand: QC. No tricks played.
    // Remaining = 14 - 1 (QC in hand) - 0 (played) - 1 (QS in discard) = 12
    const view = {
      tricks: [],
      currentTrick: [],
      hands: { p1: [c('Q','C'), c('A','H'), c('K','S'), c('9','C'), c('8','S'), c('7','H')] },
      discard: [c('Q','S'), c('K','H')],  // picker sees their own real discard
    }
    expect(trumpRemainingElsewhere(view, 'p1')).toBe(12)
  })
})

describe('buriablePoints', () => {
  it('returns sum of top 2 non-trump cards by point value', () => {
    // AC=11, 10H=10, KS=4 → top 2 are AC + 10H = 21
    const hand = [c('Q','C'), c('J','S'), c('A','C'), c('10','H'), c('K','S'), c('9','C')]
    expect(buriablePoints(hand)).toBe(21)
  })

  it('returns 0 when fewer than 2 non-trump cards exist', () => {
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','S'), c('A','D'), c('10','D')]
    expect(buriablePoints(hand)).toBe(0)
  })

  it('returns 0 when exactly 1 non-trump card exists', () => {
    // Only KS is non-trump; fewer than 2 → 0
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','S'), c('A','D'), c('K','S')]
    expect(buriablePoints(hand)).toBe(0)
  })

  it('returns sum when exactly 2 non-trump cards exist', () => {
    // KS=4, 9C=0 → 4
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','S'), c('K','S'), c('9','C')]
    expect(buriablePoints(hand)).toBe(4)
  })
})

describe('handScore', () => {
  it('returns schwanzerPts * 4 + buriablePoints (exact formula check)', () => {
    // QC=3, QS=3 = 6 schwanzer pts; 7C=0, 8C=0 non-trump → buriable=0; score = 6*4+0 = 24
    const hand = [c('Q','C'), c('Q','S'), c('7','C'), c('8','C'), c('9','H'), c('8','H')]
    expect(handScore(hand)).toBe(24)
  })

  it('scores < 24 for 5 schwanzer pts, 0 burial', () => {
    // QC=3, JC=2 = 5 schwanzer pts; 7C=0, 8C=0 non-trump → buriable=0; score = 5*4+0 = 20
    const hand = [c('Q','C'), c('J','C'), c('7','C'), c('8','C'), c('9','C'), c('9','H')]
    expect(handScore(hand)).toBeLessThan(24)
    expect(handScore(hand)).toBe(20)
  })

  it('scores >= 24 for 5 schwanzer pts + two aces to bury', () => {
    // QC=3, JC=2 = 5 schwanzer pts; AC=11, AH=11 → buriable=22; score = 5*4+22 = 42
    const hand = [c('Q','C'), c('J','C'), c('7','C'), c('A','C'), c('A','H'), c('8','S')]
    expect(handScore(hand)).toBe(42)
  })
})

describe('beats', () => {
  it('trump beats non-trump', () => {
    expect(beats(c('7','D'), c('A','H'), 'H')).toBe(true)   // 7D is trump, AH is not
    expect(beats(c('A','H'), c('7','D'), 'H')).toBe(false)  // AH is not trump, 7D is
  })

  it('higher trump rank beats lower trump rank', () => {
    expect(beats(c('Q','C'), c('Q','S'), 'T')).toBe(true)   // QC rank 0 beats QS rank 1
    expect(beats(c('Q','S'), c('Q','C'), 'T')).toBe(false)  // QS rank 1 loses to QC rank 0
    expect(beats(c('J','C'), c('7','D'), 'T')).toBe(true)   // JC rank 4 beats 7D rank 13
  })

  it('led-suit beats off-suit fail', () => {
    expect(beats(c('7','H'), c('A','S'), 'H')).toBe(true)   // 7H is led suit, AS is off-suit
    expect(beats(c('A','S'), c('7','H'), 'H')).toBe(false)  // AS is off-suit, 7H is led suit
  })

  it('higher card wins same suit', () => {
    expect(beats(c('A','H'), c('K','H'), 'H')).toBe(true)   // A ranks higher than K
    expect(beats(c('K','H'), c('A','H'), 'H')).toBe(false)
  })

  it('off-suit vs off-suit different suits — neither wins', () => {
    // Challenger is off-suit (S), current is off-suit (C) — neither matches led (H)
    expect(beats(c('A','S'), c('A','C'), 'H')).toBe(false)
    expect(beats(c('A','C'), c('A','S'), 'H')).toBe(false)
  })

  it('returns true when current is hidden (challenger wins by default)', () => {
    expect(beats(c('7','C'), { id: 'UNDER_CARD', hidden: true }, 'H')).toBe(true)
  })

  it('returns true when current is faceDown', () => {
    expect(beats(c('7','C'), { id: 'UNDER_CARD', faceDown: true }, 'H')).toBe(true)
  })
})

describe('currentWinner', () => {
  it('returns the play with the highest trump when trump is led', () => {
    const plays = [
      { userId: 'p1', card: c('Q','C') },
      { userId: 'p2', card: c('J','C') },
      { userId: 'p3', card: c('A','D') },
    ]
    expect(currentWinner(plays).userId).toBe('p1')
  })

  it('returns the play with the highest led-suit card when no trump played', () => {
    const plays = [
      { userId: 'p1', card: c('K','H') },
      { userId: 'p2', card: c('A','H') },
      { userId: 'p3', card: c('9','H') },
    ]
    expect(currentWinner(plays).userId).toBe('p2')
  })

  it('trump beats led suit', () => {
    const plays = [
      { userId: 'p1', card: c('A','H') },
      { userId: 'p2', card: c('7','D') },
    ]
    expect(currentWinner(plays).userId).toBe('p2')
  })
})

describe('teammateWinning', () => {
  it('returns true when picker is winning and bot is the partner', () => {
    const view = {
      currentTrick: [{ userId: 'p1', card: c('Q','C') }],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p2')).toBe(true)
  })

  it('returns true when partner is winning and bot is the picker', () => {
    const view = {
      currentTrick: [{ userId: 'p2', card: c('Q','C') }],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(true)
  })

  it('returns false when an opponent is winning and bot is on picker team', () => {
    const view = {
      currentTrick: [{ userId: 'p3', card: c('Q','C') }],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(false)
  })

  it('returns true when fellow opponent is winning and partner is known', () => {
    const view = {
      currentTrick: [{ userId: 'p4', card: c('Q','C') }],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p3')).toBe(true)
  })

  it('returns false when opponent bot cannot identify partner (partner null)', () => {
    const view = {
      currentTrick: [{ userId: 'p4', card: c('Q','C') }],
      picker: 'p1',
      partner: null,
    }
    expect(teammateWinning(view, 'p3')).toBe(false)
  })

  it('returns false when trick is empty (leading)', () => {
    const view = {
      currentTrick: [],
      picker: 'p1',
      partner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(false)
  })
})

describe('bestVoidDiscard', () => {
  it('returns 2-card IDs that void a suit when burial total >= 11', () => {
    // AC(11) + KC(4) in clubs = 15 pts >= 11 → void clubs
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('K','C'), c('9','H'), c('8','S'), c('7','S')]
    const result = bestVoidDiscard(hand)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    expect(result).toContain('AC')
    expect(result).toContain('KC')
  })

  it('returns null when no suit can be voided with >= 11 pts', () => {
    // Clubs: 7C + 8C = 0+0 = 0 pts, Hearts: 9H only (1 card), Spades: 7S + 8S = 0 pts
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('10','D'), c('7','C'), c('8','C'), c('9','H'), c('7','S')]
    expect(bestVoidDiscard(hand)).toBeNull()
  })

  it('handles 1-card suit: pairs with highest-point filler from another suit', () => {
    // Spades: only KS (4 pts). Filler: AH (11 pts). Total = 15 → qualifies
    const hand = [c('Q','C'), c('J','C'), c('A','D'), c('10','D'), c('K','S'), c('A','H'), c('8','C'), c('7','C')]
    const result = bestVoidDiscard(hand)
    expect(result).not.toBeNull()
    expect(result).toContain('KS')
    expect(result).toContain('AH')
  })

  it('returns null for suit with 3+ cards (burying 2 does not void it)', () => {
    // Clubs: AC+KC+9C (3 cards), Hearts: AH+KH+9H (3 cards), Spades: AS+KS+9S (3 cards)
    const hand = [c('Q','C'), c('A','C'), c('K','C'), c('A','H'), c('K','H'), c('A','S'), c('K','S'), c('9','C')]
    expect(bestVoidDiscard(hand)).toBeNull()
  })

  it('excludes mustHold cards — cannot bury fail ace when holding all 3', () => {
    // Picker holds AC, AH, AS — mustHold = [AC, AH, AS]
    // After mustHold exclusion: no eligible cards in clubs except... check what's left
    // Hand: AC(mustHold), AH(mustHold), AS(mustHold), QC, JC, KS, 9D, 8D
    // Eligible non-trump non-mustHold: KS only (1 card, 4 pts). Need filler from other suit.
    // No other eligible non-trump → null
    const hand = [c('A','C'), c('A','H'), c('A','S'), c('Q','C'), c('J','C'), c('K','S'), c('9','D'), c('8','D')]
    expect(bestVoidDiscard(hand)).toBeNull()
  })

  it('excludes both fail aces AND fail tens when holding all 6', () => {
    // Picker holds all 3 fail aces + all 3 fail tens → mustHold = [AC,AH,AS,10C,10H,10S]
    // Only remaining non-trump eligible: KS (4 pts). No second eligible card → null
    const hand = [
      c('A','C'), c('A','H'), c('A','S'),
      c('10','C'), c('10','H'), c('10','S'),
      c('K','S'), c('Q','C'),
    ]
    expect(bestVoidDiscard(hand)).toBeNull()
  })
})

describe('decidePick', () => {
  it('picks when handScore >= 24 (6 schwanzer pts, 0 burial = 24)', () => {
    // QC=3, QS=3 = 6 schwanzer pts; 7C+8C non-trump = 0 burial; score = 24
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','S'), c('7','C'), c('8','C')]
    expect(decidePick({ hands: { p1: hand } }, 'p1')).toBe(true)
  })

  it('passes when handScore < 24 (5 schwanzer pts, 0 burial = 20)', () => {
    // QC=3, JC=2 = 5 schwanzer pts; 7C+8C non-trump = 0 burial; score = 20
    const hand = [c('Q','C'), c('J','C'), c('7','C'), c('8','C'), c('9','C'), c('9','H')]
    expect(decidePick({ hands: { p1: hand } }, 'p1')).toBe(false)
  })

  it('picks when 5 schwanzer pts + two aces (score = 42)', () => {
    // QC=3, JC=2 = 5 schwanzer pts; AC+AH non-trump = 22 burial; score = 42
    const hand = [c('Q','C'), c('J','C'), c('7','C'), c('A','C'), c('A','H'), c('8','S')]
    expect(decidePick({ hands: { p1: hand } }, 'p1')).toBe(true)
  })
})

describe('decideDiscard', () => {
  it('buries void pair when suit can be voided with >= 11 pts', () => {
    // AC(11) + KC(4) in clubs = 15 pts → void clubs
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('K','C'), c('9','H'), c('8','S'), c('7','S')]
    const result = decideDiscard({ hands: { p1: hand }, discard: [] }, 'p1')
    expect(result).toHaveLength(2)
    expect(result).toContain('AC')
    expect(result).toContain('KC')
  })

  it('falls back to greedy when no qualifying void', () => {
    // Hearts: 10H + 9H = 10 pts (< 11). Spades: 8S + 7S = 0 pts. No qualifying void.
    // Greedy buries highest-point non-trump: AC(11) + 10H(10)
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('10','H'), c('9','H'), c('8','S'), c('7','S')]
    const result = decideDiscard({ hands: { p1: hand }, discard: [] }, 'p1')
    expect(result).toContain('AC')
    expect(result).toContain('10H')
  })
})
