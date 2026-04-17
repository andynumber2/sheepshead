import { describe, it, expect } from 'vitest'
import { replayActions } from './actionReplay.js'
import { dealHand, pick, discard, pass, setupLeaster, awardLeasterBlind, playCard, currentPlayer } from './gameEngine.js'

describe('replayActions', () => {
  it('throws if no actions provided', () => {
    expect(() => replayActions([])).toThrow('no actions provided')
  })

  it('throws if first action is not deal', () => {
    expect(() => replayActions([{ type: 'pick', user_id: 1, payload_json: null }])).toThrow('first action must be type=deal')
  })

  it('returns initial state for deal-only action list', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)
    const actions = [{ type: 'deal', user_id: null, payload_json: JSON.stringify(initial) }]
    const result = replayActions(actions)
    expect(result.phase).toBe('picking')
    expect(result.handNumber).toBe(1)
    expect(result.dealerSeat).toBe(0)
  })

  it('replays a pick action', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)
    const pickerId = initial.pickOrder[0]
    const actions = [
      { type: 'deal', user_id: null, payload_json: JSON.stringify(initial) },
      { type: 'pick', user_id: Number(pickerId), payload_json: null },
    ]
    const result = replayActions(actions)
    expect(result.phase).toBe('discarding')
    expect(result.picker).toBe(pickerId)
  })

  it('produces the same state as direct engine calls through pick and discard', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)
    const pickerId = initial.pickOrder[0]

    // Direct engine path
    let direct = pick(initial, pickerId)
    const cardIdsToDiscard = direct.hands[pickerId].slice(0, 2).map(c => c.id)
    direct = discard(direct, pickerId, cardIdsToDiscard)

    // Replay path
    const actions = [
      { type: 'deal',    user_id: null,             payload_json: JSON.stringify(initial) },
      { type: 'pick',    user_id: Number(pickerId), payload_json: null },
      { type: 'discard', user_id: Number(pickerId), payload_json: JSON.stringify({ cardIds: cardIdsToDiscard }) },
    ]
    const replayed = replayActions(actions)

    expect(replayed.phase).toBe('calling')
    expect(replayed.picker).toBe(pickerId)
    expect(replayed.hands[pickerId]).toHaveLength(6)
    expect(replayed.discard).toEqual(direct.discard)
  })

  it('throws on unknown action type', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)
    const actions = [
      { type: 'deal',    user_id: null, payload_json: JSON.stringify(initial) },
      { type: 'unknown', user_id: 1,   payload_json: null },
    ]
    expect(() => replayActions(actions)).toThrow("unknown action type 'unknown'")
  })

  it('awards leasterBlind after first trick in leaster via play_card replay', () => {
    const playerIds = ['1', '2', '3', '4', '5']
    const initial = dealHand(playerIds, 0, 1, 1)

    // All players pass to reach no_pick phase
    let direct = initial
    for (const pid of initial.pickOrder) {
      direct = pass(direct, pid)
    }
    // Transition to leaster
    direct = setupLeaster(direct)

    // Helper: pick a valid card for the current player (follows suit if required)
    function pickValidCard(state) {
      const uid = currentPlayer(state)
      const hand = state.hands[uid]
      const trick = state.currentTrick
      if (trick.length === 0) {
        // Leader may play any card
        return { userId: uid, card: hand[0] }
      }
      const ledCard = trick[0].card
      const ledSuit = (ledCard.rank === 'Q' || ledCard.rank === 'J' || ledCard.suit === 'D')
        ? 'T'
        : ledCard.suit
      const matching = hand.filter(c => {
        const s = (c.rank === 'Q' || c.rank === 'J' || c.suit === 'D') ? 'T' : c.suit
        return s === ledSuit
      })
      return { userId: uid, card: matching.length > 0 ? matching[0] : hand[0] }
    }

    // Play the first trick via direct engine calls, collecting card plays
    const trickPlays = []
    for (let i = 0; i < 5; i++) {
      const { userId, card } = pickValidCard(direct)
      trickPlays.push({ userId, cardId: card.id })
      direct = playCard(direct, userId, card.id)
    }
    // After 5 cards, trick 1 is complete — award leaster blind directly
    direct = awardLeasterBlind(direct)

    // Build replay actions: deal → 5 passes → setup_leaster → 5 play_cards
    const actions = [
      { type: 'deal', user_id: null, payload_json: JSON.stringify(initial) },
      ...initial.pickOrder.map(pid => ({ type: 'pass', user_id: Number(pid), payload_json: null })),
      { type: 'setup_leaster', user_id: null, payload_json: null },
      ...trickPlays.map(({ userId, cardId }) => ({
        type: 'play_card',
        user_id: Number(userId),
        payload_json: JSON.stringify({ cardId }),
      })),
    ]
    const replayed = replayActions(actions)

    // leasterBlind should be empty — awarded to trick 1 winner
    expect(replayed.leasterBlind).toHaveLength(0)
    // One completed trick
    expect(replayed.tricks).toHaveLength(1)
    // The first trick should contain 7 plays (5 cards + 2 blind cards added by awardLeasterBlind)
    expect(replayed.tricks[0].plays).toHaveLength(7)
    // State should match direct engine result
    expect(replayed.tricks[0].winner).toBe(direct.tricks[0].winner)
  })
})
