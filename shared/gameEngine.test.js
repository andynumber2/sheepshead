import { describe, it, expect, beforeEach } from 'vitest'
import { pickThreshold, PICK_THRESHOLD_BASE, PICK_THRESHOLD_DISCOUNT, decidePick, decideBury, decideCall, decidePlay } from './botStrategy.js'
import {
  isTrump, trumpRank, suitRank, effectiveSuit, cardPoints,
  schwanzerCardPoints, resolveSchwanzer,
  dealHand, pick, pass, blitz,
  bury, callAce, goAlone, callTen, callKing,
  callAceUnder, crack, recrack,
  playCard, computeScores, resolveLeaster,
  setupLeaster, awardLeasterBlind, getPlayerView,
} from './gameEngine.js'
import {
  countTrumpPlayed, trumpRemainingElsewhere,
  handScore,
  beats, currentWinner, teammateWinning,
  bestVoidBury,
  isGuaranteedWinner,
  cheapestGuaranteedWin,  // NEW
  pickBySchmearPriority,
  resolveView,
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

  it('initializes crackerId and recrackerId to null', () => {
    const state = dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
    expect(state.crackerId).toBeNull()
    expect(state.recrackerId).toBeNull()
  })

})

describe('pick / pass / blitz', () => {
  function makePickingState() {
    return dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
  }

  describe('pick', () => {
    it('transitions to burying phase', () => {
      const state = makePickingState()
      const next = pick(state, state.pickOrder[0])
      expect(next.phase).toBe('burying')
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
    it('transitions to burying phase', () => {
      const state = makePickingState()
      const firstPicker = state.pickOrder[0]
      const stateWithBlitz = {
        ...state,
        potentialBlitzes: [{ userId: firstPicker, type: 'black' }],
      }
      const next = blitz(stateWithBlitz, firstPicker)
      expect(next.phase).toBe('burying')
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

describe('bury', () => {
  function makeBuryingState() {
    const state = dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
    return pick(state, state.pickOrder[0])
    // picker now has 8 cards; phase = 'burying'
  }

  it('transitions to calling phase', () => {
    const state = makeBuryingState()
    const cardIds = state.hands[state.picker].slice(-2).map(cd => cd.id)
    const next = bury(state, state.picker, cardIds)
    expect(next.phase).toBe('calling')
  })

  it('picker ends with 6 cards', () => {
    const state = makeBuryingState()
    const cardIds = state.hands[state.picker].slice(-2).map(cd => cd.id)
    const next = bury(state, state.picker, cardIds)
    expect(next.hands[next.picker]).toHaveLength(6)
  })

  it('stores the 2 buried cards in state.buried', () => {
    const state = makeBuryingState()
    const cardIds = state.hands[state.picker].slice(-2).map(cd => cd.id)
    const next = bury(state, state.picker, cardIds)
    expect(next.buried).toHaveLength(2)
    expect(next.buried.map(cd => cd.id)).toEqual(expect.arrayContaining(cardIds))
  })

  it('throws when not exactly 2 cards are buried', () => {
    const state = makeBuryingState()
    const oneCard = [state.hands[state.picker][0].id]
    expect(() => bury(state, state.picker, oneCard)).toThrow('Must bury exactly 2 cards.')
  })

  it('throws if a non-picker tries to bury', () => {
    const state = makeBuryingState()
    const nonPicker = state.pickOrder.find(p => p !== state.picker)
    const cardIds = state.hands[state.picker].slice(-2).map(cd => cd.id)
    expect(() => bury(state, nonPicker, cardIds)).toThrow('Only the picker can bury.')
  })

  it('throws when trying to bury a card the picker must keep for the partner call', () => {
    // Picker holds all 3 fail aces → callMode becomes 'ten', mustHold = [AC, AH, AS]
    const state = {
      phase: 'burying',
      picker: 'p1',
      pickOrder: ['p1','p2','p3','p4','p5'],
      blind: [],
      log: [],
      hands: {
        p1: [c('A','C'), c('A','H'), c('A','S'), c('Q','C'), c('J','C'), c('K','D'), c('9','D'), c('8','D')],
        p2: [], p3: [], p4: [], p5: [],
      },
    }
    expect(() => bury(state, 'p1', ['AC', 'QC'])).toThrow('Cannot bury AC')
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
      buried: [c('Q','D'), c('J','D')],
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
        buried: [c('10','S'), c('K','C')],
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
        buried: [c('J','D'), c('K','D')],
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
      buried: [],
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
      buried: [],
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
      buried: [],
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
      buried: [],
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
      buried: [],
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
      buried: [],
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

describe('picker called-suit holding rule', () => {
  // p1 is picker, called AC (clubs). Trick is led with fail spades; p1 is void in
  // spades and is deciding what to sluff. Partner not yet revealed.
  function makePickerSluffingState(pickerHand) {
    return {
      phase: 'playing',
      picker: 'p1',
      partner: 'p2',
      goingAlone: false,
      calledAce: { suit: 'C', aceId: 'AC' },
      calledSuit: 'C',
      calledTen: null,
      calledKing: null,
      partnerRevealed: false,
      pickerForcedPlays: [],
      underCard: null,
      pickOrder: ['p3', 'p1', 'p2', 'p4', 'p5'],
      doublerMultiplier: 1,
      handCrackMultiplier: 1,
      blitzes: [],
      buried: [],
      tricks: [],
      currentTrick: [
        { userId: 'p3', card: c('8', 'S') }, // fail-spade lead
      ],
      currentLeader: 'p3',
      log: [],
      scores: {},
      hands: {
        p1: pickerHand,
        p2: [c('A', 'C')],
        p3: [],
        p4: [c('K', 'S')],
        p5: [c('9', 'S')],
      },
    }
  }

  it('rejects picker sluffing their last fail card of the called suit', () => {
    // p1 (picker) holds a single called-suit card (8C) plus trump/other-suit
    // cards; sluffing 8C would leave them with zero clubs.
    const state = makePickerSluffingState([
      c('8', 'C'),
      c('10', 'D'), // trump
      c('9', 'D'),  // trump
    ])
    expect(() => playCard(state, 'p1', '8C')).toThrow(/called suit/)
  })

  it('allows picker to sluff a fail card of the called suit if another remains', () => {
    // p1 holds two clubs (8C, 9C); sluffing 9C still leaves 8C in hand.
    const state = makePickerSluffingState([
      c('8', 'C'),
      c('9', 'C'),
      c('10', 'D'),
    ])
    expect(() => playCard(state, 'p1', '9C')).not.toThrow()
  })

  it('allows picker to play their last called-suit card when the called suit is led', () => {
    const state = {
      ...makePickerSluffingState([c('8', 'C'), c('10', 'D')]),
      currentTrick: [{ userId: 'p3', card: c('7', 'C') }], // clubs led
      currentLeader: 'p3',
    }
    expect(() => playCard(state, 'p1', '8C')).not.toThrow()
  })

  it('allows picker to play their last called-suit card after partner has been revealed', () => {
    const state = {
      ...makePickerSluffingState([c('8', 'C'), c('10', 'D')]),
      partnerRevealed: true,
    }
    expect(() => playCard(state, 'p1', '8C')).not.toThrow()
  })

  it('allows picker to play their last called-suit card on the last trick (no alternative)', () => {
    // Hand has only the club; picker must play it regardless.
    const state = makePickerSluffingState([c('8', 'C')])
    expect(() => playCard(state, 'p1', '8C')).not.toThrow()
  })

  it('does not restrict non-picker players from sluffing called-suit cards', () => {
    // p4 is an opponent with a single 8C plus KS; sluffing 8C is fine.
    const state = {
      ...makePickerSluffingState([c('Q', 'C')]),
      currentTrick: [
        { userId: 'p3', card: c('10', 'S') },
        { userId: 'p1', card: c('Q', 'C') }, // picker plays trump
        { userId: 'p2', card: c('K', 'S') },
      ],
      currentLeader: 'p3',
      hands: {
        p1: [],
        p2: [],
        p3: [],
        p4: [c('8', 'C'), c('J', 'H')],
        p5: [c('9', 'S')],
      },
    }
    expect(() => playCard(state, 'p4', '8C')).not.toThrow()
  })

  it('does not apply when the picker went alone (no called suit)', () => {
    const state = {
      ...makePickerSluffingState([c('8', 'C'), c('10', 'D')]),
      goingAlone: true,
      partner: null,
      calledAce: null,
      calledSuit: null,
    }
    expect(() => playCard(state, 'p1', '8C')).not.toThrow()
  })

  it('rejects picker sluffing the forced ace in a ten call', () => {
    // Ten-call: picker holds all three fail aces; the ace of called suit is
    // listed in pickerForcedPlays and must be kept for the called-suit trick.
    const state = {
      ...makePickerSluffingState([c('A', 'C'), c('10', 'D'), c('9', 'D')]),
      calledAce: null,
      calledTen: { suit: 'C', tenId: '10C' },
      pickerForcedPlays: ['AC'],
    }
    expect(() => playCard(state, 'p1', 'AC')).toThrow(/called suit/)
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
      buried: [],
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

  it('buried points count toward the picker\'s total', () => {
    // p1 wins 1 trick with 39 pts + buried has 2 aces (22 pts) = 61 → wins
    const tricks = [
      makeTrick('p1', [fk('A'), fk('10'), fk('K'), fk('10'), fk('K')]),  // 11+10+4+10+4 = 39
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
      makeTrick('p3', [fk('7'), fk('7'), fk('7'), fk('7'), fk('7')]),
    ]
    // buried: [A, A] = 22 pts → picker total = 39+22 = 61 → wins
    const state = baseState(tricks, { buried: [fk('A'), fk('A')] })
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

describe('callAceUnder', () => {
  function makeUnderCallingState() {
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
      buried: [c('K','C'), c('8','S')],  // AC not buried
      log: [],
    }
  }

  it('sets underCard, calledAce (under:true), partner, and advances to playing', () => {
    const next = callAceUnder(makeUnderCallingState(), 'p1', 'C', 'QS')
    expect(next.phase).toBe('playing')
    expect(next.underCard).toMatchObject({ id: 'QS', ownerId: 'p1', played: false })
    expect(next.calledAce).toEqual({ suit: 'C', aceId: 'AC', under: true })
    expect(next.partner).toBe('p2')
  })

  it('throws when a normal ace call is available for another suit', () => {
    const state = makeUnderCallingState()
    // Add a fail heart (KH) — p1 doesn't hold AH, AH not buried → normal call available for H
    state.hands.p1 = [c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'), c('J','C'), c('K','H')]
    expect(() => callAceUnder(state, 'p1', 'C', 'QS')).toThrow('normal ace call is available')
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
      crackerId: null,
      recrackerId: null,
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

  it('crack records the cracker userId', () => {
    const next = crack(makeCrackState(), 'p3')
    expect(next.crackerId).toBe('p3')
    expect(next.recrackerId).toBeNull()
  })

  it('recrack records the recracker userId', () => {
    const cracked = crack(makeCrackState(), 'p3')
    const recracked = recrack(cracked, 'p1')
    expect(recracked.crackerId).toBe('p3')
    expect(recracked.recrackerId).toBe('p1')
  })

  it('partner recracks — recrackerId is the partner', () => {
    const cracked = crack(makeCrackState(), 'p3')
    const recracked = recrack(cracked, 'p2')
    expect(recracked.recrackerId).toBe('p2')
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
      buried: [c('Q','D'), c('J','D')],
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

  it('picker can see buried cards; opponents see hidden placeholders', () => {
    const pickerView = getPlayerView(makeViewState(), 'p1')
    expect(pickerView.buried.every(card => card.hidden !== true)).toBe(true)

    const oppView = getPlayerView(makeViewState(), 'p3')
    expect(oppView.buried.every(card => card.hidden === true)).toBe(true)
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

  it('exposes crackerId and recrackerId unredacted to all players', () => {
    let state = dealHand(['p1','p2','p3','p4','p5'], 0, 1, 1)
    state = { ...state, phase: 'playing', picker: 'p1', partner: 'p2', goingAlone: false, isLeaster: false, crackState: null, handCrackMultiplier: 1, pickOrder: ['p1','p2','p3','p4','p5'], pickIndex: 0, log: [] }
    state = crack(state, 'p3')
    state = recrack(state, 'p2')
    for (const uid of ['p1','p2','p3','p4','p5']) {
      const view = getPlayerView(state, uid)
      expect(view.crackerId).toBe('p3')
      expect(view.recrackerId).toBe('p2')
    }
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

  it('subtracts trump visible in picker buried', () => {
    // Picker (p1) buried QS (trump). Own hand: QC. No tricks played.
    // Remaining = 14 - 1 (QC in hand) - 0 (played) - 1 (QS buried) = 12
    const view = {
      tricks: [],
      currentTrick: [],
      hands: { p1: [c('Q','C'), c('A','H'), c('K','S'), c('9','C'), c('8','S'), c('7','H')] },
      buried: [c('Q','S'), c('K','H')],  // picker sees their own real buried cards
    }
    expect(trumpRemainingElsewhere(view, 'p1')).toBe(12)
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
      resolvedPartner: 'p2',
    }
    expect(teammateWinning(view, 'p2')).toBe(true)
  })

  it('returns true when partner is winning and bot is the picker', () => {
    const view = {
      currentTrick: [{ userId: 'p2', card: c('Q','C') }],
      picker: 'p1',
      resolvedPartner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(true)
  })

  it('returns false when an opponent is winning and bot is on picker team', () => {
    const view = {
      currentTrick: [{ userId: 'p3', card: c('Q','C') }],
      picker: 'p1',
      resolvedPartner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(false)
  })

  it('returns true when fellow opponent is winning and partner is known', () => {
    const view = {
      currentTrick: [{ userId: 'p4', card: c('Q','C') }],
      picker: 'p1',
      resolvedPartner: 'p2',
    }
    expect(teammateWinning(view, 'p3')).toBe(true)
  })

  it('returns false when opponent bot cannot identify partner (partner null)', () => {
    const view = {
      currentTrick: [{ userId: 'p4', card: c('Q','C') }],
      picker: 'p1',
      resolvedPartner: null,
    }
    expect(teammateWinning(view, 'p3')).toBe(false)
  })

  it('returns true when fellow opponent is winning and picker went alone', () => {
    const view = {
      currentTrick: [{ userId: 'p3', card: c('A','S') }],
      picker: 'p1',
      resolvedPartner: null,
      goingAlone: true,
      isLeaster: false,
    }
    // p4 is an opponent; p3 (non-picker) is winning → teammate
    expect(teammateWinning(view, 'p4')).toBe(true)
  })

  it('returns false when picker is winning and picker went alone', () => {
    const view = {
      currentTrick: [{ userId: 'p1', card: c('Q','C') }],
      picker: 'p1',
      resolvedPartner: null,
      goingAlone: true,
      isLeaster: false,
    }
    // picker winning → not a teammate for p4
    expect(teammateWinning(view, 'p4')).toBe(false)
  })

  it('returns false when trick is empty (leading)', () => {
    const view = {
      currentTrick: [],
      picker: 'p1',
      resolvedPartner: 'p2',
    }
    expect(teammateWinning(view, 'p1')).toBe(false)
  })
})

describe('bestVoidBury', () => {
  it('returns 2-card IDs that void a suit when burial total >= 11', () => {
    // AC(11) + KC(4) in clubs = 15 pts >= 11 → void clubs
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('K','C'), c('9','H'), c('8','S'), c('7','S')]
    const result = bestVoidBury(hand)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    expect(result).toContain('AC')
    expect(result).toContain('KC')
  })

  it('returns null when no suit can be voided with >= 11 pts', () => {
    // Clubs: 7C + 8C = 0+0 = 0 pts, Hearts: 9H only (1 card), Spades: 7S + 8S = 0 pts
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('10','D'), c('7','C'), c('8','C'), c('9','H'), c('7','S')]
    expect(bestVoidBury(hand)).toBeNull()
  })

  it('handles 1-card suit: pairs with highest-point filler from another suit', () => {
    // Spades: only KS (4 pts). Filler: AH (11 pts). Total = 15 → qualifies
    const hand = [c('Q','C'), c('J','C'), c('A','D'), c('10','D'), c('K','S'), c('A','H'), c('8','C'), c('7','C')]
    const result = bestVoidBury(hand)
    expect(result).not.toBeNull()
    expect(result).toContain('KS')
    expect(result).toContain('AH')
  })

  it('returns null for suit with 3+ cards (burying 2 does not void it)', () => {
    // Clubs: AC+KC+9C (3 cards), Hearts: AH+KH+9H (3 cards), Spades: AS+KS+9S (3 cards)
    const hand = [c('Q','C'), c('A','C'), c('K','C'), c('A','H'), c('K','H'), c('A','S'), c('K','S'), c('9','C')]
    expect(bestVoidBury(hand)).toBeNull()
  })

  it('excludes mustHold cards — cannot bury fail ace when holding all 3', () => {
    // Picker holds AC, AH, AS — mustHold = [AC, AH, AS]
    // After mustHold exclusion: no eligible cards in clubs except... check what's left
    // Hand: AC(mustHold), AH(mustHold), AS(mustHold), QC, JC, KS, 9D, 8D
    // Eligible non-trump non-mustHold: KS only (1 card, 4 pts). Need filler from other suit.
    // No other eligible non-trump → null
    const hand = [c('A','C'), c('A','H'), c('A','S'), c('Q','C'), c('J','C'), c('K','S'), c('9','D'), c('8','D')]
    expect(bestVoidBury(hand)).toBeNull()
  })

  it('excludes both fail aces AND fail tens when holding all 6', () => {
    // Picker holds all 3 fail aces + all 3 fail tens → mustHold = [AC,AH,AS,10C,10H,10S]
    // Only remaining non-trump eligible: KS (4 pts). No second eligible card → null
    const hand = [
      c('A','C'), c('A','H'), c('A','S'),
      c('10','C'), c('10','H'), c('10','S'),
      c('K','S'), c('Q','C'),
    ]
    expect(bestVoidBury(hand)).toBeNull()
  })
})

describe('handScore', () => {
  it('returns schwanzerPts × 4 for an all-trump-no-QC hand', () => {
    // QH=3, QD=3, JS=2, JH=2, JD=2, 9D=1 → schwanzer 13 → 13*4 = 52
    // No QC, no fail aces, no fail tens
    const hand = [c('Q','H'), c('Q','D'), c('J','S'), c('J','H'), c('J','D'), c('9','D')]
    expect(handScore(hand)).toBe(52)
  })

  it('adds 5 when QC is held', () => {
    // QC=3, JS=2, JH=2, 7C=0, 8C=0, 9C=0 → schwanzer 7 → 7*4 = 28; +5 QC = 33
    const hand = [c('Q','C'), c('J','S'), c('J','H'), c('7','C'), c('8','C'), c('9','C')]
    expect(handScore(hand)).toBe(33)
  })

  it('adds 3 per non-trump ace', () => {
    // QH=3, JH=2, AC=0, AH=0, 7S=0, 8S=0 → schwanzer 5 → 20; +3*2 fail aces = 26
    // No QC, no tens
    const hand = [c('Q','H'), c('J','H'), c('A','C'), c('A','H'), c('7','S'), c('8','S')]
    expect(handScore(hand)).toBe(26)
  })

  it('adds 2 per non-trump ten', () => {
    // QH=3, JH=2, 10C=0, 10H=0, 7S=0, 8S=0 → schwanzer 5 → 20; +2*2 fail tens = 24
    const hand = [c('Q','H'), c('J','H'), c('10','C'), c('10','H'), c('7','S'), c('8','S')]
    expect(handScore(hand)).toBe(24)
  })

  it('does not count A♦ or 10♦ as a fail ace/ten (they are trump)', () => {
    // AD and 10D are diamonds → trump. They contribute schwanzerPts=1 each (diamond pips)
    // but are NOT fail aces/tens.
    // QH=3, JH=2, AD=1, 10D=1, 7S=0, 8S=0 → schwanzer 7 → 28; no QC, no fail A/10 → 28
    const hand = [c('Q','H'), c('J','H'), c('A','D'), c('10','D'), c('7','S'), c('8','S')]
    expect(handScore(hand)).toBe(28)
  })

  it('combines all terms', () => {
    // QC=3, QS=3, JC=2, AC=0, AH=0, 10S=0 → schwanzer 8 → 32; +5 QC; +3*2 aces; +2*1 ten = 45
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('A','C'), c('A','H'), c('10','S')]
    expect(handScore(hand)).toBe(45)
  })

  it('ignores hidden cards', () => {
    // Only QC visible: schwanzer 3 → 12; +5 QC = 17
    const hand = [c('Q','C'), { id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }]
    expect(handScore(hand)).toBe(17)
  })
})

describe('pickThreshold', () => {
  it('returns BASE at passesSoFar = 0', () => {
    expect(pickThreshold(0)).toBe(PICK_THRESHOLD_BASE)
  })

  it('subtracts DISCOUNT per pass', () => {
    expect(pickThreshold(1)).toBe(PICK_THRESHOLD_BASE - PICK_THRESHOLD_DISCOUNT)
    expect(pickThreshold(4)).toBe(PICK_THRESHOLD_BASE - 4 * PICK_THRESHOLD_DISCOUNT)
  })
})

describe('decidePick', () => {
  it('picks a strong hand at seat 0', () => {
    // QC=3, QS=3, JC=2, JS=2, AD=1, 10D=1 → schwanzer 12 → 48; +5 QC; trump 6 → score 53
    // Threshold at pickIndex=0 = BASE (35). Picks.
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','S'), c('A','D'), c('10','D')]
    expect(decidePick({ hands: { p1: hand }, pickIndex: 0 }, 'p1')).toBe(true)
  })

  it('passes a low-score hand at seat 0 (score below threshold, no veto)', () => {
    // QH=3, JH=2, 9D=1, 7C, 8C, 9S → schwanzer 6 → 24; trump 3 (QH, JH, 9D); no QC, no fail A/10 → score 24.
    // Threshold at pickIndex=0 = BASE=35 → 24 < 35 → pass. Trump count = 3 so veto does NOT fire.
    const hand = [c('Q','H'), c('J','H'), c('9','D'), c('7','C'), c('8','C'), c('9','S')]
    expect(decidePick({ hands: { p1: hand }, pickIndex: 0 }, 'p1')).toBe(false)
  })

  it('hard veto: never picks with trumpCount ≤ 2 even if score is high', () => {
    // QH=3, QD=3, AC=0, AH=0, AS=0, 10C(fail ten) → schwanzer 6 → 24; +3*3 aces +2*1 ten = 35
    // But trump count = 2 (QH, QD) → hard veto → false.
    const hand = [c('Q','H'), c('Q','D'), c('A','C'), c('A','H'), c('A','S'), c('10','C')]
    expect(decidePick({ hands: { p1: hand }, pickIndex: 0 }, 'p1')).toBe(false)
  })

  it('position-aware: a marginal hand passes early-seat but picks late-seat', () => {
    // Hand: QH=3, JH=2, JD=2, 9D=1, 7C, 8C → schwanzer 8 → score 32; trump 4 (QH, JH, JD, 9D); no QC, no fail A/10.
    // BASE=35, DISCOUNT=2.
    // At pickIndex=0 (threshold 35): 32 < 35 → pass.
    // At pickIndex=3 (threshold 35 - 3×2 = 29): 32 ≥ 29 → pick.
    const hand = [c('Q','H'), c('J','H'), c('J','D'), c('9','D'), c('7','C'), c('8','C')]
    expect(decidePick({ hands: { p1: hand }, pickIndex: 0 }, 'p1')).toBe(false)
    expect(decidePick({ hands: { p1: hand }, pickIndex: 3 }, 'p1')).toBe(true)
  })

  it('defaults pickIndex to 0 when undefined', () => {
    // Same marginal hand as above; without pickIndex, behaves as seat 0 → pass.
    const hand = [c('Q','H'), c('J','H'), c('J','D'), c('9','D'), c('7','C'), c('8','C')]
    expect(decidePick({ hands: { p1: hand } }, 'p1')).toBe(false)
  })
})

describe('decideBury', () => {
  it('buries void pair when suit can be voided with >= 11 pts', () => {
    // AC(11) + KC(4) in clubs = 15 pts → void clubs
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('K','C'), c('9','H'), c('8','S'), c('7','S')]
    const result = decideBury({ hands: { p1: hand }, buried: [] }, 'p1')
    expect(result).toHaveLength(2)
    expect(result).toContain('AC')
    expect(result).toContain('KC')
  })

  it('falls back to greedy when no qualifying void', () => {
    // Hearts: 10H + 9H = 10 pts (< 11). Spades: 8S + 7S = 0 pts. No qualifying void.
    // Greedy buries highest-point non-trump: AC(11) + 10H(10)
    const hand = [c('Q','C'), c('J','S'), c('A','D'), c('A','C'), c('10','H'), c('9','H'), c('8','S'), c('7','S')]
    const result = decideBury({ hands: { p1: hand }, buried: [] }, 'p1')
    expect(result).toContain('AC')
    expect(result).toContain('10H')
  })
})

describe('decideCall go-alone', () => {
  it('goes alone with 6 trump and 2 queens', () => {
    // QC, QS (2 queens), JC, JH, AD, 10D = 6 trump
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('J','H'), c('A','D'), c('10','D')]
    const view = { callMode: 'ace', hands: { p1: hand }, buried: [] }
    expect(decideCall(view, 'p1').type).toBe('alone')
  })

  it('does not go alone with only 1 queen even with 6 trump', () => {
    // QC (1 queen), JC, JS, JH, JD, AD = 6 trump
    const hand = [c('Q','C'), c('J','C'), c('J','S'), c('J','H'), c('J','D'), c('A','D')]
    const view = { callMode: 'ace', hands: { p1: hand }, buried: [] }
    expect(decideCall(view, 'p1').type).not.toBe('alone')
  })

  it('does not go alone with 2 queens but only 5 trump', () => {
    // QC, QS (2 queens), JC, AD, 10D = 5 trump; AH is fail
    const hand = [c('Q','C'), c('Q','S'), c('J','C'), c('A','D'), c('10','D'), c('A','H')]
    const view = { callMode: 'ace', hands: { p1: hand }, buried: [] }
    expect(decideCall(view, 'p1').type).not.toBe('alone')
  })
})

describe('decidePlay schmearing', () => {
  function makeFollowView({ userId, picker, partner, trickWinner, trickCard, handCards }) {
    return {
      hands: { [userId]: handCards },
      currentTrick: [{ userId: trickWinner, card: trickCard }],
      tricks: [],
      picker,
      partner,
      isLeaster: false,
      phase: 'playing',
      calledSuit: null,
      calledAce: null,
      calledTen: null,
      calledKing: null,
      partnerRevealed: false,
      pickerForcedPlays: [],
      underCard: null,
    }
  }

  it('picker-team bot schmears highest non-trump when partner is winning', () => {
    // Bot is picker (p1). Partner (p2) leads QC (trump). Bot has AC(11), KH(4), 9S(0) — all off-suit.
    // QC leads trump; bot has no trump. All cards legal (off-suit). Schmear: AC (11 pts).
    const view = makeFollowView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      trickWinner: 'p2',
      trickCard: c('Q','C'),
      handCards: [c('A','C'), c('K','H'), c('9','S')],
    })
    expect(decidePlay(view, 'p1')).toBe('AC')
  })

  it('opponent bot schmears highest non-trump when fellow opponent is winning (partner known)', () => {
    // Bot is p3. Partner is p2 (revealed). p4 (fellow opponent) leads QC.
    // Bot has AH(11), 9S(0), 8C(0) — all off-suit legal.
    const view = makeFollowView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      trickWinner: 'p4',
      trickCard: c('Q','C'),
      handCards: [c('A','H'), c('9','S'), c('8','C')],
    })
    expect(decidePlay(view, 'p3')).toBe('AH')
  })

  it('does not burn trump to schmear — plays lowest when only trump is legal', () => {
    // Bot is picker (p1), partner (p2) winning with QC. Bot has only trump.
    // Must follow trump. Should play lowest (7D), not burn JD.
    const view = makeFollowView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      trickWinner: 'p2',
      trickCard: c('Q','C'),
      handCards: [c('J','D'), c('7','D')],
    })
    expect(decidePlay(view, 'p1')).toBe('7D')
  })

  it('opponent does not schmear when partner is unknown (null)', () => {
    // Bot is p3. Partner is null (unrevealed). p4 leading QC.
    // teammateWinning returns false when partner is null → play low (9S)
    const view = makeFollowView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      trickWinner: 'p4',
      trickCard: c('Q','C'),
      handCards: [c('A','H'), c('9','S'), c('8','C')],
    })
    // Should NOT schmear — play lowest (9S: 0 pts, first 0-pt non-trump encountered)
    expect(decidePlay(view, 'p3')).toBe('9S')
  })

  it('schmears card from shortest non-trump suit on within-rank tie', () => {
    // Bot p3 (defender). Picker=p1, partner=p2 (revealed/known). Confirmed defender
    // teammate p4 is winning with Q♣. teammateWinning=true → schmearOpp fires.
    // Bot hand has A♠ and A♣ — both highest priority. Hand has 3 spades and 1 club
    // among non-trump → clubs is the shortest non-trump suit → schmear A♣, not A♠.
    const view = makeFollowView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      trickWinner: 'p4',
      trickCard: c('Q','C'),
      handCards: [c('A','S'), c('K','S'), c('9','S'), c('A','C')],
    })
    expect(decidePlay(view, 'p3')).toBe('AC')
  })

  it('opponent schmears 10H to fellow opponent winning when picker went alone', () => {
    // Picker (p1) went alone. p3 is winning with AC (11 pts, clubs lead).
    // Bot p4 has 10H (10 pts, fail) and 9S (0 pts, fail) — no clubs, so any card is legal.
    // teammateWinning should be true (p3 is non-picker → teammate) → schmearOpp → 10H.
    const view = {
      ...makeFollowView({
        userId: 'p4',
        picker: 'p1',
        partner: null,
        trickWinner: 'p3',
        trickCard: c('A','C'),
        handCards: [c('10','H'), c('9','S')],
      }),
      goingAlone: true,
    }
    expect(decidePlay(view, 'p4')).toBe('10H')
  })
})

describe('decidePlay trump counting', () => {
  function makeTrumpExhaustedView({ userId, picker, partner, handCards, trumpPlayed }) {
    return {
      hands: { [userId]: handCards },
      currentTrick: [],
      tricks: trumpPlayed.length > 0
        ? [{ plays: trumpPlayed.map(card => ({ userId: 'other', card })), winner: 'other' }]
        : [],
      picker,
      partner,
      isLeaster: false,
      phase: 'playing',
      calledSuit: null,
      calledAce: null,
      calledTen: null,
      calledKing: null,
      partnerRevealed: false,
      pickerForcedPlays: [],
      underCard: null,
      buried: [],
    }
  }

  // Helper: build trump card object from ID string like 'QS', 'JC', '10D'
  function trump(id) {
    const rank = id.startsWith('10') ? '10' : id[0]
    const suit = id[id.length - 1]
    return { id, rank, suit }
  }

  it('picker team leads fail Ace instead of trump when opponents exhausted', () => {
    // Own hand: QC (trump), AC (fail ace), KH (fail).
    // Own trump: 1 (QC). Played trump: 13. Remaining elsewhere = 14 - 1 - 13 = 0 ≤ 2.
    const playedTrump = ['QS','QH','QD','JC','JS','JH','JD','AD','10D','KD','9D','8D','7D'].map(trump)
    const view = makeTrumpExhaustedView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('Q','C'), c('A','C'), c('K','H')],
      trumpPlayed: playedTrump,
    })
    expect(decidePlay(view, 'p1')).toBe('AC')
  })

  it('picker team leads highest trump normally when opponents not exhausted', () => {
    // No played trump → remaining = 14 - 1 - 0 = 13 > 2
    const view = makeTrumpExhaustedView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('Q','C'), c('A','C'), c('K','H')],
      trumpPlayed: [],
    })
    expect(decidePlay(view, 'p1')).toBe('QC')
  })

  it('opponent leads fail Ace when picker team exhausted', () => {
    // Own trump: 0. Played trump: 14 (all). Remaining elsewhere = 14 - 0 - 14 = 0.
    const playedTrump = ['QC','QS','QH','QD','JC','JS','JH','JD','AD','10D','KD','9D','8D','7D'].map(trump)
    const view = makeTrumpExhaustedView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('A','H'), c('9','S'), c('8','C')],
      trumpPlayed: playedTrump,
    })
    expect(decidePlay(view, 'p3')).toBe('AH')
  })

  it('opponent does NOT lead fail Ace when picker team has 1 trump remaining', () => {
    // 13 trump played, own trump = 0 → remaining = 14 - 0 - 13 = 1
    const playedTrump = ['QC','QS','QH','QD','JC','JS','JH','JD','AD','10D','KD','9D','8D'].map(trump)
    const view = makeTrumpExhaustedView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('A','H'), c('9','S'), c('8','C')],
      trumpPlayed: playedTrump,
    })
    // Must NOT cash the ace — should fall through to lowest non-trump (9S or 8C)
    expect(decidePlay(view, 'p3')).not.toBe('AH')
  })

  it('opponent does NOT lead fail Ace when picker team has 2 trump remaining', () => {
    // 12 trump played, own trump = 0 → remaining = 14 - 0 - 12 = 2
    const playedTrump = ['QC','QS','QH','QD','JC','JS','JH','JD','AD','10D','KD','9D'].map(trump)
    const view = makeTrumpExhaustedView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('A','H'), c('9','S'), c('8','C')],
      trumpPlayed: playedTrump,
    })
    expect(decidePlay(view, 'p3')).not.toBe('AH')
  })

  it('opponent leads lowest non-trump normally when trump not exhausted', () => {
    const view = makeTrumpExhaustedView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('A','H'), c('9','S'), c('8','C')],
      trumpPlayed: [],
    })
    // Normal opponent lead: lowestCard of non-trump
    // AH=11, 9S=0, 8C=0 — lowest is 9S or 8C (both 0 pts, non-trump)
    const result = decidePlay(view, 'p3')
    expect(['8C', '9S']).toContain(result)
  })

  it('picks one of the fail Aces when multiple are held', () => {
    // Own hand: QC (trump), AC, AH (two fail aces). 13 trump played. Remaining = 14 - 1 - 13 = 0.
    const playedTrump = ['QS','QH','QD','JC','JS','JH','JD','AD','10D','KD','9D','8D','7D'].map(trump)
    const view = makeTrumpExhaustedView({
      userId: 'p1',
      picker: 'p1',
      partner: 'p2',
      handCards: [c('Q','C'), c('A','C'), c('A','H')],
      trumpPlayed: playedTrump,
    })
    // Should lead one of the fail Aces (both are 11 pts)
    expect(['AC', 'AH']).toContain(decidePlay(view, 'p1'))
  })
})

describe('decidePlay opponent leading called suit', () => {
  function makeOpponentLeadView({ handCards, partnerRevealed, calledSuit = 'H' }) {
    return {
      hands: { p3: handCards },
      currentTrick: [],
      tricks: [],          // no trump played → fail-ace branch won't fire
      picker: 'p1',
      partner: partnerRevealed ? 'p2' : null,
      isLeaster: false,
      phase: 'playing',
      calledSuit,
      calledAce: { aceId: `A${calledSuit}` },
      calledTen: null,
      calledKing: null,
      partnerRevealed,
      pickerForcedPlays: [],
      underCard: null,
      buried: [],
    }
  }

  it('leads lowest called-suit card when partner is not yet revealed', () => {
    // Hand: 10H (called suit, 10 pts), 8C (0 pts), 7S (0 pts)
    // partnerRevealed=false → should lead called suit even though it is the highest-value card
    const view = makeOpponentLeadView({
      handCards: [c('10','H'), c('8','C'), c('7','S')],
      partnerRevealed: false,
    })
    expect(decidePlay(view, 'p3')).toBe('10H')
  })

  it('does not lead called suit when partner is already revealed', () => {
    // Same hand, partnerRevealed=true → falls through to lowest non-trump
    const view = makeOpponentLeadView({
      handCards: [c('10','H'), c('8','C'), c('7','S')],
      partnerRevealed: true,
    })
    // 10H is 10pts; 8C and 7S are 0pts → lowest non-trump is 8C or 7S, not 10H
    expect(['8C', '7S']).toContain(decidePlay(view, 'p3'))
  })

  it('falls through to lowest non-trump when bot holds no called-suit cards', () => {
    // No hearts in hand; calledSuit='H' → no called-suit lead possible
    const view = makeOpponentLeadView({
      handCards: [c('9','C'), c('8','C'), c('7','S')],
      partnerRevealed: false,
    })
    // All 0pt non-trump; lowestCard picks 9C (first encountered)
    expect(decidePlay(view, 'p3')).toBe('9C')
  })
})

describe('decidePlay (botStrategy)', () => {
  function makeView({ userId, hand, trick = [], picker, partner, calledSuit, lastTrick = [] }) {
    return {
      hands: { [userId]: hand },
      currentTrick: trick,
      picker,
      partner,
      isLeaster: false,
      calledSuit,
      calledAce: calledSuit ? { aceId: `A${calledSuit}` } : null,
      calledTen: null,
      calledKing: null,
      partnerRevealed: true,
      underCard: null,
      pickerForcedPlays: [],
      lastTrick,
    }
  }

  it('opponent plays trump (highest) when called suit is led and picker team is winning', () => {
    // p1 (picker) leads 9♥ (called suit), p2 (partner, already revealed) plays K♥
    // and is winning. With partner already revealed the schmear specialization
    // does not apply, so p3 plays highest trump to force-up: J♦.
    const view = makeView({
      userId: 'p3',
      hand: [c('J','D'), c('8','S'), c('7','C')],
      trick: [
        { userId: 'p1', card: c('9','H') },
        { userId: 'p2', card: c('K','H') },
      ],
      picker: 'p1',
      partner: 'p2',
      calledSuit: 'H',
    })
    expect(decidePlay(view, 'p3')).toBe('JD')
  })

  it('opponent does not trump in when another opponent is already winning the called suit trick', () => {
    // p1 (picker) leads 9♥, p4 (opponent) trumps in with Q♥ and is winning
    // p3 should play low rather than wasting trump
    // lowestCard([J♦, 8♠, 7♣]) = 8♠ (first 0-pt non-trump in reduce order)
    const view = makeView({
      userId: 'p3',
      hand: [c('J','D'), c('8','S'), c('7','C')],
      trick: [
        { userId: 'p1', card: c('9','H') },
        { userId: 'p4', card: c('Q','H') },
      ],
      picker: 'p1',
      partner: 'p2',
      calledSuit: 'H',
    })
    expect(decidePlay(view, 'p3')).toBe('8S')
  })

  it('partner with no trump leads called suit when previous trick had few trump', () => {
    // p2 (partner, revealed) leads with no trump; last trick had 1 trump (≤3)
    // hand: 9♥ (called suit, 0pts), 10♣ (10pts), 7♠ (0pts)
    // current code would lead 10♣ (highestValueCard); fix should lead 9♥ (called suit)
    const view = makeView({
      userId: 'p2',
      hand: [c('9','H'), c('10','C'), c('7','S')],
      picker: 'p1',
      partner: 'p2',
      calledSuit: 'H',
      lastTrick: [
        { userId: 'p1', card: c('Q','D') },   // 1 trump
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p5', card: c('9','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('9H')
  })

  it('partner with no trump leads lowest fail when previous trick had many trump', () => {
    // p2 (partner, revealed) leads with no trump; last trick had 4 trump (>3)
    // hand: 10♥ (called suit, 10pts), 10♣ (10pts), 7♠ (0pts)
    // fix should lead 7♠ (lowest fail), not 10♥ or 10♣
    const view = makeView({
      userId: 'p2',
      hand: [c('10','H'), c('10','C'), c('7','S')],
      picker: 'p1',
      partner: 'p2',
      calledSuit: 'H',
      lastTrick: [
        { userId: 'p1', card: c('Q','D') },   // trump
        { userId: 'p3', card: c('J','D') },   // trump
        { userId: 'p4', card: c('Q','H') },   // trump
        { userId: 'p5', card: c('Q','S') },   // trump (4 total)
        { userId: 'p2', card: c('A','C') },   // fail
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('7S')
  })
})

// All 5 player IDs must appear in hands so Object.keys(view.hands) returns
// the full player list — required for opponents-remaining computation.
function makeTrumpEfficiencyView({ userId, picker, partner, hand, trick }) {
  const ALL = ['p1', 'p2', 'p3', 'p4', 'p5']
  const hands = Object.fromEntries(ALL.map(id => [id, id === userId ? hand : []]))
  return {
    hands,
    currentTrick: trick,
    tricks: [],
    picker,
    partner,
    isLeaster: false,
    calledSuit: 'H',
    calledAce: { aceId: 'AH' },
    calledTen: null,
    calledKing: null,
    partnerRevealed: true,
    underCard: null,
    pickerForcedPlays: [],
    lastTrick: [],
  }
}

describe('decidePlay trump efficiency — trump trick (Scenario 1)', () => {
  it('uses point diamond over Queen when 0 opponents remain', () => {
    // Trump trick (7D led by p3). Played: p3(7D), p4(8D), p5(9D), p2(AC — void in trump).
    // Current winner: p5 (9D, rank 11). All opponents (p3,p4,p5) and partner (p2) played.
    // Picker (p1) hand: KD(rank10), QS(rank1). Both beat 9D(rank11).
    //   KD beats 9D: trumpRank(KD)=10 < trumpRank(9D)=11 ✓
    //   QS beats 9D: trumpRank(QS)=1  < trumpRank(9D)=11 ✓
    // Old lowestCard([KD, QS]): QS=3pts < KD=4pts → picks QS. Bug: wastes strong Queen.
    // New cheapestWinningTrump: tier1=[KD] → return KD.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('Q','S')],
      trick: [
        { userId: 'p3', card: c('7','D') },
        { userId: 'p4', card: c('8','D') },
        { userId: 'p5', card: c('9','D') },
        { userId: 'p2', card: c('A','C') },  // p2 void in trump, plays off-suit
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('KD')
  })

  it('uses point diamond over pip diamond when 0 opponents remain', () => {
    // Trump trick (7D led by p2). Played: p2(7D), p3(AC), p4(KC), p5(8D).
    // p5 plays 8D (rank 12) which beats 7D (rank 13). Current winner: p5 (8D, rank 12).
    // 0 opponents remain (p3,p4,p5 all played; p2=partner played).
    // Picker (p1) hand: 10D(rank9), 9D(rank11). Both beat 8D(rank12).
    //   10D: trumpRank(10D)=9 < 12 ✓   9D: trumpRank(9D)=11 < 12 ✓
    // Old lowestCard: 9D=0pts < 10D=10pts → picks 9D. Bug: loses 10pts from pile.
    // New: tier1=[10D] → return 10D.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('10','D'), c('9','D')],
      trick: [
        { userId: 'p2', card: c('7','D') },
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p5', card: c('8','D') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('10D')
  })

  it('uses weakest point diamond when multiple options and 0 opponents remain', () => {
    // Trump trick (7D led by p3). All opponents + partner played. Current winner p5(9D, rank11).
    // Picker (p1) hand: AD(rank8), 10D(rank9), KD(rank10), JD(rank7).
    // All four beat 9D(rank11): AD(8<11), 10D(9<11), KD(10<11), JD(7<11).
    // Old lowestCard: JD=2pts (lowest) → picks JD. Bug: wastes the Jack.
    // New cheapestWinningTrump: tier1=[AD,10D,KD], weakest in tier1 = KD (rank10, highest index).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('A','D'), c('10','D'), c('K','D'), c('J','D')],
      trick: [
        { userId: 'p3', card: c('7','D') },
        { userId: 'p4', card: c('8','D') },
        { userId: 'p5', card: c('9','D') },
        { userId: 'p2', card: c('A','C') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('KD')
  })

  it('plays highest winning trump when opponents remain on trump trick', () => {
    // Trump trick (8D led by p3). Only p3 has played. p4 and p5 (opponents) still to play.
    // Current winner: p3 (8D, rank 12). Picker (p1) hand: KD(rank10), JD(rank7), QS(rank1).
    // All three beat 8D(rank12): KD(10<12), JD(7<12), QS(1<12).
    // Old lowestCard: JD=2pts → picks JD. Bug: should commit strongest against future opponents.
    // New: opponentsRemaining=2 → highestTrump(winning) = QS (rank 1).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('J','D'), c('Q','S')],
      trick: [
        { userId: 'p3', card: c('8','D') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('QS')
  })

  it('uses weakest pip diamond when no point diamonds are in winning set', () => {
    // Trump trick (7D led by p3). All opponents + partner played. Current winner p5(9D, rank11).
    // Picker (p1) hand: 9D already played by p5. Bot has 8D(rank12) and QH(rank2).
    // Wait — p5 played 9D so bot can't have 9D. Use 8D and QH in bot hand.
    // Both beat current winner... but current winner is p5(9D, rank11).
    // 8D(rank12): 12 < 11? No — 12 > 11, so 8D does NOT beat 9D. Only QH(rank2<11) wins.
    // Better: current winner p4(8D, rank12). Bot has 9D(rank11) and QH(rank2). Both beat 8D.
    // cheapestWinningTrump: tier1 empty (no AD/10D/KD), tier2=[9D] → return 9D.
    // Old lowestCard([9D, QH]): 9D=0pts < QH=3pts → picks 9D. Same result, but test documents the path.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('9','D'), c('Q','H')],
      trick: [
        { userId: 'p3', card: c('7','D') },
        { userId: 'p2', card: c('A','C') },
        { userId: 'p5', card: c('K','C') },
        { userId: 'p4', card: c('8','D') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('9D')
  })
})

describe('decidePlay trump efficiency — fail trick, bot void (Scenario 2)', () => {
  it('picker plays highest trump to get the lead on a void fail trick', () => {
    // Clubs led. Picker (p1) void in clubs. p3(AC), p4(KC), p5(9C), p2(7S — void in clubs).
    // Current winner: p3 (AC). Picker hand: KD(rank10), JD(rank7), QS(rank1).
    // All trump beat AC: KD(trump vs non-trump) ✓, JD ✓, QS ✓.
    // Old lowestCard([KD,JD,QS]): JD=2pts → JD. Bug: picker wants the lead, play strongest.
    // New: userId===picker → highestTrump(winning) = QS (rank1, lowest index).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('J','D'), c('Q','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p5', card: c('9','C') },
        { userId: 'p2', card: c('7','S') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('QS')
  })

  it('partner with >1 trump plays highest trump (point diamond) to win and lead back', () => {
    // Spades led. Partner (p2) void in spades. p3(AS), p4(KS), p5(9S). p1(picker) not yet played.
    // Current winner: p3 (AS). Partner hand: AD(rank8), KD(rank10), 8H.
    // Trump in hand: AD and KD (count=2 > 1) → play highest trump.
    // Old lowestCard([AD,KD]): KD=4pts < AD=11pts → picks KD. Bug: should lead back AD (strongest).
    // New: myTrumpCount=2 > 1 → highestTrump([AD,KD]) = AD (rank8 < rank10).
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('A','D'), c('K','D'), c('8','H')],
      trick: [
        { userId: 'p3', card: c('A','S') },
        { userId: 'p4', card: c('K','S') },
        { userId: 'p5', card: c('9','S') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('AD')
  })

  it('partner with 1 trump defers to picker still to play when trump not guaranteed', () => {
    // Clubs led. Partner (p2) void in clubs. p3(AC), p4(KC). Current winner: p3(AC, opponent).
    // Partner hand: JD (only trump), 8H, KS. myTrumpCount=1.
    // Picker (p1) still to play. JD is not a guaranteed winner (higher trumps outstanding).
    // Picker-still-to-play + 1 trump + trump not guaranteed → play low (8H is lowest non-trump).
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('J','D'), c('8','H'), c('K','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('8H')
  })

  it('partner with 1 trump plays low when picker has the trick locked', () => {
    // Clubs led. Partner (p2) void in clubs.
    // p3(AC), p4(KC), p5(9C), p1(AD — picker trumped in, currently winning).
    // teammateWinning=true → schmear branch. Called ace (AH) is filtered out by
    // the called-card-holding rule, so schmear sees non-trump [KS] and returns KS.
    // This guards the #92 no-waste-trump behavior via the schmear path.
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('9','D'), c('A','H'), c('K','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p5', card: c('9','C') },
        { userId: 'p1', card: c('A','D') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('KS')
  })
})

// Helper for tests that need completed-trick history.
// `tricks` is an array of arrays of { userId, card } plays.
function withTricks(view, tricks) {
  return { ...view, tricks: tricks.map(plays => ({ plays })) }
}

describe('isGuaranteedWinner', () => {
  it('returns true for Queen of Clubs (highest trump)', () => {
    // QC (rank 0) has no higher trump → trivially guaranteed.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('Q','C')],
      trick: [],
    })
    expect(isGuaranteedWinner(c('Q','C'), view, 'p1')).toBe(true)
  })

  it('returns true when all higher trump played in completed tricks', () => {
    // Own card: KD (rank 10). Higher trump (rank 0-9) = all Qs, all Js, AD, 10D.
    // Put them all in completed tricks.
    const higherTrump = [
      c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('A','D'), c('10','D'),
    ]
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D')],
      trick: [],
    })
    // Distribute higher trump across two completed tricks (5 cards each).
    const tricks = [
      higherTrump.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      higherTrump.slice(5, 10).map((card, i) => ({ userId: `p${i+1}`, card })),
    ]
    const view = withTricks(baseView, tricks)
    expect(isGuaranteedWinner(c('K','D'), view, 'p1')).toBe(true)
  })

  it('returns true when higher trump is split between own hand and played tricks', () => {
    // Own card: JD (rank 7). Higher trump = all Qs (0-3), JC/JS/JH (4-6).
    // Put QC, QS, QH in own hand. Put QD, JC, JS, JH in tricks.
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('J','D'), c('Q','C'), c('Q','S'), c('Q','H')],
      trick: [],
    })
    const tricks = [
      [
        { userId: 'p1', card: c('Q','D') },
        { userId: 'p2', card: c('J','C') },
        { userId: 'p3', card: c('J','S') },
        { userId: 'p4', card: c('J','H') },
        { userId: 'p5', card: c('7','C') },
      ],
    ]
    const view = withTricks(baseView, tricks)
    expect(isGuaranteedWinner(c('J','D'), view, 'p1')).toBe(true)
  })

  it('returns false when one higher trump is unseen', () => {
    // Own card: KD (rank 10). Higher trump (rank 0-9) = all Qs, Js, AD, 10D (10 cards).
    // Account for 9 of them; leave AD unseen.
    const higherTrump = [
      c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('10','D'),
      // AD missing
    ]
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D')],
      trick: [],
    })
    const tricks = [
      higherTrump.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      higherTrump.slice(5, 9).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p5', card: c('7','C') },  // filler non-trump
      ]),
    ]
    const view = withTricks(baseView, tricks)
    expect(isGuaranteedWinner(c('K','D'), view, 'p1')).toBe(false)
  })

  it('returns false for non-trump card', () => {
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('A','C')],
      trick: [],
    })
    expect(isGuaranteedWinner(c('A','C'), resolveView(view, 'p1'), 'p1')).toBe(false)
  })

  it('counts visible buried trump (picker view)', () => {
    // Picker view: buried cards are not hidden. KD is picker's own card; bury holds QC+QS.
    // Higher trump than KD = QC,QS,QH,QD,JC,JS,JH,JD,AD,10D (10 cards).
    // QC+QS are in bury, the other 8 are in the current trick.
    const higherInTrick = [
      c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('A','D'), c('10','D'),
    ]
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D')],
      trick: [],
    })
    const view = {
      ...baseView,
      buried: [c('Q','C'), c('Q','S')],  // visible to picker
      tricks: [{
        plays: higherInTrick.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      }, {
        plays: higherInTrick.slice(5, 8).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
          { userId: 'p4', card: c('7','C') },
          { userId: 'p5', card: c('8','C') },
        ]),
      }],
    }
    expect(isGuaranteedWinner(c('K','D'), view, 'p1')).toBe(true)
  })

  it('treats hidden buried trump as unseen (partner view)', () => {
    // Same setup as above, but buried cards are marked hidden.
    // The KD test card can still be guaranteed only if those buried slots are
    // filled in via other means. Mark buried as hidden; account for the 10 higher
    // trump in tricks only (8 there) → 2 missing → false.
    const higherInTrick = [
      c('Q','C'), c('Q','S'),
      c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      // AD, 10D missing
    ]
    const baseView = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('K','D')],
      trick: [],
    })
    const view = {
      ...baseView,
      buried: [{ ...c('A','D'), hidden: true }, { ...c('10','D'), hidden: true }],
      tricks: [{
        plays: higherInTrick.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      }, {
        plays: higherInTrick.slice(5, 8).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
          { userId: 'p4', card: c('7','C') },
          { userId: 'p5', card: c('8','C') },
        ]),
      }],
    }
    expect(isGuaranteedWinner(c('K','D'), view, 'p2')).toBe(false)
  })
})

describe('cheapestGuaranteedWin', () => {
  it('returns null when no candidate is guaranteed', () => {
    // Candidates: KD, JD. Leave AD unseen → neither is guaranteed (AD beats both).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('J','D')],
      trick: [],
    })
    expect(cheapestGuaranteedWin([c('K','D'), c('J','D')], view, 'p1')).toBe(null)
  })

  it('returns lowest-point guaranteed card when multiple qualify', () => {
    // Candidates: KD (4pts), QS (3pts). Higher trump accounted for below.
    // Higher than KD (rank 10) = 10 cards. Higher than QS (rank 1) = just QC.
    // Put QC in own hand (user has KD, QS, QC).
    const higherTrumpForKD = [
      c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('A','D'), c('10','D'),
    ]
    // Hand has KD, QS. Higher trump distributed: QS/QC/etc in hand or tricks.
    // Simpler: put QC in hand, other 9 higher trump in tricks (covers both KD and QS).
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('Q','S'), c('Q','C')],
      trick: [],
    })
    const othersInTricks = higherTrumpForKD.filter(x => x.id !== 'QC' && x.id !== 'QS')
    const tricks = [
      othersInTricks.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      othersInTricks.slice(5, 8).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p4', card: c('7','C') },
        { userId: 'p5', card: c('8','C') },
      ]),
    ]
    const view = withTricks(baseView, tricks)
    // Both KD (4pts) and QS (3pts) guaranteed; return QS (lowest points).
    expect(cheapestGuaranteedWin([c('K','D'), c('Q','S')], view, 'p1').id).toBe('QS')
  })

  it('returns the single guaranteed candidate when only one qualifies', () => {
    // Candidates: KD (not guaranteed — AD unseen), QC (always guaranteed).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('Q','C')],
      trick: [],
    })
    expect(cheapestGuaranteedWin([c('K','D'), c('Q','C')], view, 'p1').id).toBe('QC')
  })

  it('returns null for empty candidates', () => {
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [],
      trick: [],
    })
    expect(cheapestGuaranteedWin([], view, 'p1')).toBe(null)
  })
})

describe('decidePlay — partner defers to picker still-to-play', () => {
  it('partner with 1 trump plays low when picker still to play AND not guaranteed', () => {
    // Clubs led. Partner (p2) void in clubs.
    // Current trick: p3(AC — opponent currently winning). p4, p1(picker), p5 still to play.
    // Partner hand: JD (only trump), KS (4pts), 7H (0pts).
    // JD is rank 7 — higher trump (QC,QS,QH,QD,JC,JS,JH = 7 cards) all unseen → not guaranteed.
    // Rule: picker still to play + 1 trump + not guaranteed → play low.
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('J','D'), c('K','S'), c('7','H')],
      trick: [
        { userId: 'p3', card: c('A','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('7H')  // lowest non-trump
  })

  it('partner with 1 trump plays the trump when picker still to play AND trump is guaranteed', () => {
    // Setup: partner's only trump is QC (rank 0, trivially guaranteed).
    // Clubs led. Partner (p2) void in clubs. p3(AC), picker+others still to play.
    // Rule: guaranteed → take the trick.
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('K','S'), c('7','H')],
      trick: [
        { userId: 'p3', card: c('A','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('QC')
  })
})

describe('decidePlay — cheapest-guaranteed refinement', () => {
  it('picker plays cheapest guaranteed trump on trump trick with opponents remaining', () => {
    // Trump trick (JC led by p3, rank 4). Partner (p2) played 9D (rank 11).
    // Current winner: p3 (JC). Picker (p1) hand: QC (rank 0), KD (4pts, rank 10).
    // Put 8 higher trump (excluding QC, JC) in completed tricks so KD is also guaranteed.
    // Both QC and KD beat JC. cheapestGuaranteedWin returns QC (3pts < 4pts).
    const higherThanKD = [
      c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('A','D'), c('10','D'),
    ]
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('K','D'), c('7','H'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('J','C') },  // opponent led trump
        { userId: 'p2', card: c('9','D') },  // partner played
      ],
    })
    const inTricks = higherThanKD.filter(x => x.id !== 'QC' && x.id !== 'JC')
    const view = withTricks(baseView, [
      inTricks.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      inTricks.slice(5, 8).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p4', card: c('7','C') },
        { userId: 'p5', card: c('8','C') },
      ]),
    ])
    expect(decidePlay(view, 'p1')).toBe('QC')
  })

  it('picker on trump trick picks weaker guaranteed trump when opponents remain', () => {
    // Trump trick. Picker (p1) hand: QC (3pts,rank0), JS (2pts,rank5).
    // For both to be guaranteed: all trump rank 0-4 accounted for.
    // QC in hand. QS, QH, QD, JC in tricks.
    // Current trick: p3 leads 7D. p2 plays AC (void in trump).
    // Opponents (p4, p5) still to play.
    // winning = [QC, JS]. highestTrump = QC (rank 0). cheapestGuaranteedWin: JS (2pts < 3pts).
    const higherTrumpInTricks = [c('Q','S'), c('Q','H'), c('Q','D'), c('J','C')]
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('J','S'), c('7','H'), c('8','H')],
      trick: [
        { userId: 'p3', card: c('7','D') },
        { userId: 'p2', card: c('A','C') },
      ],
    })
    const view = withTricks(baseView, [
      higherTrumpInTricks.map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p5', card: c('7','C') },
      ]),
    ])
    expect(decidePlay(view, 'p1')).toBe('JS')
  })
})

describe('decidePlay — picker-team schmear guard (#121)', () => {
  it('partner still schmears when picker is winning but opponent could overtake (trust picker)', () => {
    // Clubs led (so AH is NOT filtered for partner — but we omit AH from hand anyway to avoid fixture confusion).
    // p3(AC), p4(KC), p1(QD — picker trumped in, rank 3).
    // QC/QS/QH unseen → QD not guaranteed. p5 still to play → opponentsRemaining=1.
    // Partner (p2) role: teammateSafe=false but partner role → schmear anyway.
    // Partner hand: [AS(11pts spades), 7H(0pts), 8S(0pts)]. No trump, no AH. schmear picks AS.
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('A','S'), c('7','H'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p1', card: c('Q','D') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('AS')
  })

  it('partner still schmears when picker is winning and card IS guaranteed', () => {
    // Same layout but picker plays QC (rank 0, trivially guaranteed).
    // teammateSafe=true → schmear. Same hand, same expected AS.
    const view = makeTrumpEfficiencyView({
      userId: 'p2', picker: 'p1', partner: 'p2',
      hand: [c('A','S'), c('7','H'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
        { userId: 'p1', card: c('Q','C') },
      ],
    })
    expect(decidePlay(view, 'p2')).toBe('AS')
  })

  it('picker takes over when partner winning a fail trick, opponent could overtake, guaranteed takeover exists', () => {
    // Clubs led. Partner (p2) plays AC and is currently winning (highest club — no trumping yet).
    // p4 plays KC (following). Picker (p1) to play; p5 still to play.
    // Picker hand: [QC (guaranteed trump rank 0), AS, 7H]. QC beats AC (trump over fail).
    // teammateWinning=true (partner p2 winning). AC not a trump (can't check "AC guaranteed" as trump —
    //   but isGuaranteedWinner returns false for non-trump cards). So teammateSafe=false.
    // Picker role → takeover = cheapestGuaranteedWin([QC]) = QC.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('A','S'), c('7','H')],
      trick: [
        { userId: 'p3', card: c('8','C') },
        { userId: 'p2', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('QC')
  })

  it('picker plays highest winning trump as risk reduction when no guaranteed takeover exists', () => {
    // Same layout as test 3 but picker's only beating card is KD (trump rank 10, not guaranteed).
    // winningLocal = [KD] (trump beats AC). cheapestGuaranteedWin=null. highestTrump=KD.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('K','D'), c('A','S'), c('7','H')],
      trick: [
        { userId: 'p3', card: c('8','C') },
        { userId: 'p2', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('KD')
  })

  it('picker schmears as fallback when partner winning, not guaranteed, and no winning trump in hand', () => {
    // Same trick. Picker hand: [7D, AS, 7H]. Must follow clubs if any — none. So can play anything.
    // 7D is trump (rank 13). Does 7D beat AC? Trump beats fail → yes. So winningLocal = [7D].
    // Wait — we wanted NO winning trump. Replace 7D with something non-trump. Picker hand: [AS, 7H, 8S].
    // No trump, no clubs → winningLocal = [] (none beat AC — AS is spades not clubs/trump).
    // takeover=null, highTrump=null. Fall to schmear → AS.
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('A','S'), c('7','H'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('8','C') },
        { userId: 'p2', card: c('A','C') },
        { userId: 'p4', card: c('K','C') },
      ],
    })
    expect(decidePlay(view, 'p1')).toBe('AS')
  })
})

describe('decidePlay — opponent-team schmear guard (#121)', () => {
  it('opponent takes over when teammate-opponent winning, picker still to play, takeover guaranteed', () => {
    // Hearts led (fail). Opponent p3 currently winning with AH.
    // Another opponent p4 follows. Picker p1 and partner p2 still to play → threats remain.
    // p4 hand: QC (rank 0 trivially guaranteed), 7C, 8S.
    //   teammateSafe = false (picker could trump). takeover = QC.
    const view = makeTrumpEfficiencyView({
      userId: 'p4', picker: 'p1', partner: 'p2',
      hand: [c('Q','C'), c('7','C'), c('8','S')],
      trick: [
        { userId: 'p3', card: c('A','H') },
      ],
    })
    expect(decidePlay(view, 'p4')).toBe('QC')
  })

  it('opponent schmears when no takeover available', () => {
    // Same trick; p4 has no trump. Fall back to schmear.
    // partnerRevealed=true in fixture; p4 is opponent. teammateWinning(p4):
    //   winner p3, p3 is not picker (p1) nor partner (p2) → teammate of p4 → true.
    //   threats = picker + partner still to play = 2.
    //   teammateSafe = false AND no trump in hand → winningOpp=[] → takeover=null → schmear.
    //   schmear nonTrump = [AS, 7C, 9S]. highestValueCard → AS (11pts).
    const view = makeTrumpEfficiencyView({
      userId: 'p4', picker: 'p1', partner: 'p2',
      hand: [c('A','S'), c('7','C'), c('9','S')],
      trick: [
        { userId: 'p3', card: c('A','H') },
      ],
    })
    expect(decidePlay(view, 'p4')).toBe('AS')
  })
})

describe('decidePlay — non-trump-win point maximization', () => {
  it('plays highest-point non-trump win when trumpRemainingElsewhere is 0', () => {
    // Hearts led. Picker (p1) following; has AH (11pts) and 10H (10pts). Both beat what's played
    // in fail-suit rank order (A > 10 > 9 > 8). p5 still to play.
    // Put all 14 trump in completed tricks so trumpRemainingElsewhere = 0.
    const allTrump = [
      c('Q','C'), c('Q','S'), c('Q','H'), c('Q','D'),
      c('J','C'), c('J','S'), c('J','H'), c('J','D'),
      c('A','D'), c('10','D'), c('K','D'),
      c('9','D'), c('8','D'), c('7','D'),
    ]
    const baseView = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('A','H'), c('10','H'), c('8','C')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p4', card: c('8','H') },
      ],
    })
    const tricks = [
      allTrump.slice(0, 5).map((card, i) => ({ userId: `p${i+1}`, card })),
      allTrump.slice(5, 10).map((card, i) => ({ userId: `p${i+1}`, card })),
      allTrump.slice(10, 14).map((card, i) => ({ userId: `p${i+1}`, card })).concat([
        { userId: 'p5', card: c('7','C') },
      ]),
    ]
    const view = withTricks(baseView, tricks)
    // trumpRemainingElsewhere = 14 - 0 (in hand) - 14 (played) - 0 (buried) = 0.
    // nonTrumpWins = [AH, 10H]. New behavior: highest-point = AH (11pts).
    expect(decidePlay(view, 'p1')).toBe('AH')
  })

  it('plays lowest non-trump win when opponents could still trump in', () => {
    // Standard case: trump remaining elsewhere > 0 → preserve old behavior (play low).
    const view = makeTrumpEfficiencyView({
      userId: 'p1', picker: 'p1', partner: 'p2',
      hand: [c('A','H'), c('10','H'), c('8','C')],
      trick: [
        { userId: 'p3', card: c('9','H') },
        { userId: 'p4', card: c('8','H') },
      ],
    })
    // trumpRemainingElsewhere > 0 → lowestCard(nonTrumpWins) = 10H (10pts < 11pts).
    expect(decidePlay(view, 'p1')).toBe('10H')
  })
})

describe('pickBySchmearPriority', () => {
  it('trump kind: returns A♦ when winning set covers all priority ranks', () => {
    const candidates = [c('A','D'), c('10','D'), c('K','D'), c('9','D'), c('J','H'), c('Q','D')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'trump', hand).id).toBe('AD')
  })

  it('trump kind: returns J♥ over Q (J before Q in priority)', () => {
    const candidates = [c('Q','C'), c('Q','D'), c('J','H')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'trump', hand).id).toBe('JH')
  })

  it('trump kind: among Qs, returns weakest by trump rank (Q♦)', () => {
    const candidates = [c('Q','C'), c('Q','D'), c('Q','S')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'trump', hand).id).toBe('QD')
  })

  it('trump kind: among Js, returns weakest by trump rank (J♦)', () => {
    const candidates = [c('J','C'), c('J','S'), c('J','D')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'trump', hand).id).toBe('JD')
  })

  it('fail kind: returns A♠ when winning set is single-suit', () => {
    const candidates = [c('A','S'), c('K','S'), c('8','S')]
    const hand = [...candidates]
    expect(pickBySchmearPriority(candidates, 'fail', hand).id).toBe('AS')
  })

  it('fail kind: prefers card from shortest non-trump suit in hand', () => {
    const candidates = [c('A','S'), c('A','C')]
    // Hand has 3 spades and 1 club among non-trump → clubs is shorter
    const hand = [c('A','S'), c('K','S'), c('9','S'), c('A','C'), c('Q','D')]
    expect(pickBySchmearPriority(candidates, 'fail', hand).id).toBe('AC')
  })

  it('fail kind: alphabetical suit tiebreak when suit lengths tied', () => {
    const candidates = [c('A','S'), c('A','C')]
    // 2 spades, 2 clubs in non-trump hand → tied; C < S alphabetically → AC
    const hand = [c('A','S'), c('8','S'), c('A','C'), c('7','C')]
    expect(pickBySchmearPriority(candidates, 'fail', hand).id).toBe('AC')
  })

  it('fail kind: moves toward voiding — picks card from the rarer non-trump suit', () => {
    const candidates = [c('9','S'), c('9','C')]
    // Hand has 1 spade and 3 clubs in non-trump → spades is shorter
    const hand = [c('9','S'), c('9','C'), c('K','C'), c('7','C'), c('Q','D')]
    expect(pickBySchmearPriority(candidates, 'fail', hand).id).toBe('9S')
  })

  it('returns null when candidates is empty', () => {
    expect(pickBySchmearPriority([], 'trump', [])).toBe(null)
    expect(pickBySchmearPriority([], 'fail', [])).toBe(null)
  })

  it('returns null when no candidate matches any priority rank', () => {
    // Should not happen in practice but defensive
    const candidates = []
    expect(pickBySchmearPriority(candidates, 'fail', [])).toBe(null)
  })
})

describe('decidePlay — defender force-take to enable called-suit lead-back', () => {
  // Helper: build a 5-player view with the bot following on a trick already in progress.
  // playedSeq is an array of {userId, card} representing the current trick so far.
  function makeForceTakeView({
    userId,
    picker,
    partner,
    partnerRevealed,
    calledSuit,
    handCards,
    playedSeq,
  }) {
    // Hands: only the bot's hand needs real cards; others can be placeholders for length detection.
    const allIds = ['p1','p2','p3','p4','p5']
    const hands = {}
    for (const id of allIds) hands[id] = id === userId ? handCards : []
    return {
      hands,
      currentTrick: playedSeq,
      tricks: [],
      picker,
      partner,
      partnerRevealed,
      isLeaster: false,
      phase: 'playing',
      calledSuit,
      calledAce: calledSuit ? { aceId: `A${calledSuit}` } : null,
      calledTen: null,
      calledKing: null,
      pickerForcedPlays: [],
      underCard: null,
      buried: [],
    }
  }

  it('void in led fail, picker still to play → highest trump (Q♣)', () => {
    // Bot p3 (defender), called suit = hearts, partner unrevealed.
    // p1 (picker) hasn't played; p2 led 8♠. Bot has Q♣ (top trump), J♦, A♥ (called-suit fail).
    // Bot is void in spades → can play trump. picker still to play → highest trump = Q♣.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('J','D'), c('A','H')],
      playedSeq: [{ userId: 'p2', card: c('8','S') }],
    })
    expect(decidePlay(view, 'p3')).toBe('QC')
  })

  it('void in led fail, last to play (0 opps remaining) → A♦ from priority list', () => {
    // Bot p5 (defender). p1 (picker) and p2,p3,p4 already played; bot is last.
    // Called suit = hearts, partner unrevealed.
    // Played: p1=8♠, p2=7♠, p3=K♠, p4=9♠. Bot is void in spades. Hand: A♦, 7♦, A♥.
    // 0 opps remain → schmear-self priority → A♦ (top of trump priority).
    const view = makeForceTakeView({
      userId: 'p5',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('A','D'), c('7','D'), c('A','H')],
      playedSeq: [
        { userId: 'p1', card: c('8','S') },
        { userId: 'p2', card: c('7','S') },
        { userId: 'p3', card: c('K','S') },
        { userId: 'p4', card: c('9','S') },
      ],
    })
    expect(decidePlay(view, 'p5')).toBe('AD')
  })

  it('trump led, 0 opps, only Qs in winning set → weakest Q (Q♦)', () => {
    // Bot p5 (defender), last to play. Called=H, partner unrevealed.
    // Played: p1=K♦ (trump led), p2=8♠? — but this would be invalid (must follow
    // trump if held). Use a setup where everyone is void in trump:
    // p1=K♦ (leads trump), p2=8♠ (void in trump), p3=7♠, p4=9♠. winner = K♦.
    // Bot p5 has [Q♣, Q♦, A♥]. Must follow trump (has trump) → realCards excludes
    // A♥ (called card) → [Q♣, Q♦]. Both beat K♦.
    // 0 opps remain → schmear-self trump priority. Walk to Q rank → tiebreak by
    // weakest trump rank → Q♦ (rank 3) over Q♣ (rank 0).
    //
    // Note: This setup is engine-legal only if other players truly have no trump.
    // The test exercises decidePlay directly with a constructed view, so engine
    // legality of historical plays isn't enforced.
    const view = makeForceTakeView({
      userId: 'p5',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('Q','D'), c('A','H')],
      playedSeq: [
        { userId: 'p1', card: c('K','D') },
        { userId: 'p2', card: c('8','S') },
        { userId: 'p3', card: c('7','S') },
        { userId: 'p4', card: c('9','S') },
      ],
    })
    expect(decidePlay(view, 'p5')).toBe('QD')
  })

  it('trump led, 0 opps, Q♦ and J♥ both winning → J♥ (J before Q in priority)', () => {
    // Bot p5 (defender), last to play. Called=H, partner unrevealed.
    // Played: p1=8♦, p2=7♦, p3=9♦, p4=K♦ (trump trick). Current winner: p4 K♦ (rank 10).
    // Bot hand: [Q♦, J♥, A♥]. Must follow trump → realCards excludes A♥ (called card,
    // ledSuit T ≠ called H). realCards = [Q♦, J♥]. Both beat K♦.
    // 0 opps remain → schmear-self trump priority. Walk A,10,K,9,8,7,J,Q:
    //   J♥ found before Q♦ → return J♥.
    const view = makeForceTakeView({
      userId: 'p5',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','D'), c('J','H'), c('A','H')],
      playedSeq: [
        { userId: 'p1', card: c('8','D') },
        { userId: 'p2', card: c('7','D') },
        { userId: 'p3', card: c('9','D') },
        { userId: 'p4', card: c('K','D') },
      ],
    })
    expect(decidePlay(view, 'p5')).toBe('JH')
  })

  it('must-follow non-called fail, opps remain → strategy SKIPPED, plays lowest', () => {
    // Bot p3 (defender). Called suit = hearts. Partner unrevealed. Picker still to play.
    // p2 led 8♠. Bot has A♠ (could win), 7♠, A♥ (called-suit fail).
    // Must follow spades → realCards = [A♠, 7♠]. Bot has A♥ to lead back.
    // BUT picker still to play and could be void in spades → trump over.
    // → strategy skipped; default lowest = 7♠.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('A','S'), c('7','S'), c('A','H')],
      playedSeq: [{ userId: 'p2', card: c('8','S') }],
    })
    expect(decidePlay(view, 'p3')).toBe('7S')
  })

  it('must-follow non-called fail, 0 opps, A♠ and K♠ both winning → A♠', () => {
    // Bot p5 (defender), last to play. Called=H, partner unrevealed.
    // Played: p1=9♠ (current winner among spades), p2=8♠, p3=7♠, p4=9♣ (void).
    // Bot p5 hand: [A♠, K♠, A♥]. Must follow spades → realCards = [A♠, K♠].
    //   A♠(rank 0) and K♠(rank 2) both beat 9♠(rank 4). winningSet = [A♠, K♠].
    // canPlayTrump = false (both non-trump). 0 opps remain.
    // → fail priority: A first → A♠.
    const view = makeForceTakeView({
      userId: 'p5',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('A','S'), c('K','S'), c('A','H')],
      playedSeq: [
        { userId: 'p1', card: c('9','S') },
        { userId: 'p2', card: c('8','S') },
        { userId: 'p3', card: c('7','S') },
        { userId: 'p4', card: c('9','C') },
      ],
    })
    expect(decidePlay(view, 'p5')).toBe('AS')
  })

  it('strategy skipped when bot has no called-suit non-trump card', () => {
    // Bot p3 defender. Called = hearts. Partner unrevealed. Picker still to play.
    // Bot is void in spades and has trump but NO hearts (called-suit non-trump).
    // p2 led 8♠. Hand: Q♣, J♦, 8♣. Bot is void in spades, can play any.
    // Trigger #3 fails → strategy skipped → default opponent-following lowest non-trump = 8♣.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('J','D'), c('8','C')],
      playedSeq: [{ userId: 'p2', card: c('8','S') }],
    })
    expect(decidePlay(view, 'p3')).toBe('8C')
  })

  it('lead-back force-take is skipped when partner is already revealed; force-up branch schmears trump', () => {
    // partnerRevealed=true → schmearOpp does not fire (picker p1 winning), and the
    // lead-back force-take branch is skipped (it gates on !partnerRevealed). Falls
    // through to the general force-up branch: ledSuit S is fail, picker team is
    // currently winning, bot is void in spades and holds trump → schmear priority.
    //
    // Bot hand [Q♣, J♦, A♥]. A♥ is called card; ledSuit S ≠ called H, so A♥ is
    // excluded from realCards. realCards = [Q♣, J♦]. Both trump. Schmear priority:
    // J rank before Q → J♦. Q♣ preserved for future hard trump battles.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: 'p4',
      partnerRevealed: true,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('J','D'), c('A','H')],
      playedSeq: [{ userId: 'p1', card: c('8','S') }],
    })
    expect(decidePlay(view, 'p3')).toBe('JD')
  })

  it('strategy skipped when bot has no winning cards', () => {
    // Bot p3 defender, called=H, partner unrevealed, picker still to play.
    // p2 led Q♣ (top trump). Bot hand: [J♦, 7♦, A♥].
    // Bot has no spades; ledSuit is trump. Bot has trump → must follow trump.
    // realCards: A♥ is called card; ledSuit T ≠ called H → A♥ excluded.
    //   = [J♦, 7♦] (both trump → satisfy follow-suit rule).
    // winningSet: J♦(rank 7) and 7♦(rank 13) both lose to Q♣ (rank 0) → empty.
    // New branch: winningSet empty → fall through. Default lowestCard:
    //   both trump, both 0 points (J♦=2, 7♦=0). 7♦ has lower points → 7♦.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('J','D'), c('7','D'), c('A','H')],
      playedSeq: [{ userId: 'p2', card: c('Q','C') }],
    })
    expect(decidePlay(view, 'p3')).toBe('7D')
  })

  it('current trick led with called suit → force-take branch does not fire (predicted-win trump-in does)', () => {
    // Called = hearts, p2 led 9♥ (the called suit itself). Bot p3 defender, partner unrevealed.
    // Bot is void in hearts; has trump. The force-take branch is gated on
    // `!ledThisTrickIsCalled`, so it does NOT fire here. The trump-in branch's
    // predicted-win extension does fire: called suit led, partner unrevealed, no
    // trump played yet → the partner is forced to play the called ace later this
    // trick, taking it for the picker team. Bot trumps in via schmear priority.
    // Trump priority order (A, 10, K, 9, 8, 7, J, Q) → among J♦ and Q♣, J wins;
    // J♦ is the only J. Expected: JD.
    const view = makeForceTakeView({
      userId: 'p3',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      handCards: [c('Q','C'), c('J','D'), c('8','C')],
      playedSeq: [{ userId: 'p2', card: c('9','H') }],
    })
    expect(decidePlay(view, 'p3')).toBe('JD')
  })
})
