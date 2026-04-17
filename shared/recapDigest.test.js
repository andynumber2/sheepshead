import { describe, it, expect } from 'vitest'
import { buildHandDigest } from './recapDigest.js'
import { dealHand } from './gameEngine.js'

function dealAction(state) {
  return { type: 'deal', user_id: null, payload_json: JSON.stringify(state), seq: 0 }
}

function action(type, userId, payload, seq) {
  return {
    type,
    user_id: userId ? Number(userId) : null,
    payload_json: payload ? JSON.stringify(payload) : null,
    seq,
  }
}

const PLAYERS = [
  { userId: '1', username: 'Andy', seat: 0, isBot: false },
  { userId: '2', username: 'Bot-Lou', seat: 1, isBot: true },
  { userId: '3', username: 'Bot-Mary', seat: 2, isBot: true },
  { userId: '4', username: 'Bot-Tom', seat: 3, isBot: true },
  { userId: '5', username: 'Bot-Pat', seat: 4, isBot: true },
]

describe('buildHandDigest — Normal variant', () => {
  it('returns metadata and dealt hands from a deal-only action list', () => {
    const initial = dealHand(['1', '2', '3', '4', '5'], 0, 1, 1)
    const actions = [dealAction(initial)]
    const digest = buildHandDigest(actions, PLAYERS, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })

    expect(digest.variant).toBe('normal')
    expect(digest.handNumber).toBe(1)
    expect(digest.picker).toBeNull()
    expect(digest.partner).toBeNull()
    expect(digest.blind).toHaveLength(2)
    expect(digest.blind.every(id => typeof id === 'string')).toBe(true)
    expect(digest.dealt['1']).toHaveLength(6)
    expect(digest.tricks).toEqual([])
    expect(digest.players).toEqual(PLAYERS)
  })

  it('populates picker for a completed normal hand', () => {
    const initial = dealHand(['1', '2', '3', '4', '5'], 0, 1, 1)
    const pickerId = initial.pickOrder[0]
    const actions = [
      dealAction(initial),
      action('pick', pickerId, null, 1),
    ]
    const digest = buildHandDigest(actions, PLAYERS, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
    expect(digest.picker).toEqual({ userId: pickerId })
  })

  it('flattens all 6 tricks with winners and card points into the digest', () => {
    // Integration-style: build a state with tricks pre-populated, serialize as the deal payload.
    const initial = dealHand(['1', '2', '3', '4', '5'], 0, 1, 1)
    initial.picker = '1'
    initial.partner = '2'
    initial.calledAce = { suit: 'C', aceId: 'AC' }
    initial.callMode = 'ace'
    initial.discard = [{ id: 'X1', suit: 'C', rank: '7', points: 0 }, { id: 'X2', suit: 'D', rank: '8', points: 0 }]
    initial.tricks = Array.from({ length: 6 }, () => ({
      leader: '1',
      plays: [
        { userId: '1', card: { id: 'T1', suit: 'C', rank: '9', points: 0 } },
        { userId: '2', card: { id: 'T2', suit: 'C', rank: '10', points: 10 } },
        { userId: '3', card: { id: 'T3', suit: 'C', rank: 'K', points: 4 } },
        { userId: '4', card: { id: 'T4', suit: 'C', rank: '8', points: 0 } },
        { userId: '5', card: { id: 'T5', suit: 'C', rank: 'A', points: 11 } },
      ],
      winner: '5',
    }))
    initial.phase = 'complete'
    const actions = [dealAction(initial)]
    const digest = buildHandDigest(actions, PLAYERS, { 1: -2, 2: -1, 3: 1, 4: 1, 5: 1 })

    expect(digest.tricks).toHaveLength(6)
    expect(digest.tricks[0].plays).toHaveLength(5)
    expect(digest.tricks[0].winnerUserId).toBe('5')
    expect(digest.tricks[0].cardPoints).toBe(25)
    expect(digest.picker.userId).toBe('1')
    expect(digest.partner.userId).toBe('2')
    expect(digest.calledCard).toBe('AC')
    expect(digest.pickerDiscards).toEqual(['X1', 'X2'])
    expect(digest.scores).toContainEqual({ userId: '1', cardPoints: expect.any(Number), scoreDelta: -2 })
  })
})
