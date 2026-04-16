import { describe, it, expect } from 'vitest'
import { replayActions } from './actionReplay.js'
import { dealHand, pick, discard, callAce, goAlone, playCard } from './gameEngine.js'

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
})
