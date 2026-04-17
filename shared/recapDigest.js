import { replayActions } from './actionReplay.js'
import { cardPoints } from './gameEngine.js'

/**
 * Builds a recap digest for a single hand from its action log.
 *
 * @param {Array} actions - hand_actions rows ordered by seq, first row must be type='deal'
 * @param {Array} players - [{ userId, username, seat, isBot }] all 5 seats
 * @param {Object} scoreEventsByUser - { [userId]: scoreDelta }
 * @returns {Object} digest - see spec for shape
 */
export function buildHandDigest(actions, players, scoreEventsByUser) {
  if (actions.length === 0) throw new Error('buildHandDigest: no actions')
  const finalState = replayActions(actions)

  const dealPayload = JSON.parse(actions[0].payload_json)
  const dealt = {}
  for (const [uid, hand] of Object.entries(dealPayload.hands)) {
    dealt[uid] = hand.map(c => c.id)
  }
  const initialBlind = dealPayload.blind.map(c => c.id)

  const variant = detectVariant(actions, finalState)

  const discardAction = actions.find(a => a.type === 'discard')
  const pickerDiscards = discardAction
    ? JSON.parse(discardAction.payload_json).cardIds
    : (finalState.discard ?? []).map(c => c.id)

  const calledCard =
    finalState.calledAce?.aceId ??
    finalState.calledTen?.tenId ??
    finalState.calledKing?.kingId ??
    null

  let partnerRevealedOnTrick = null
  if (finalState.partner && calledCard) {
    for (let i = 0; i < finalState.tricks.length; i++) {
      const played = finalState.tricks[i].plays.find(
        p => p.userId === finalState.partner && p.card.id === calledCard
      )
      if (played) { partnerRevealedOnTrick = i + 1; break }
    }
  }

  const playActions = actions.filter(a => a.type === 'play_card')
  const tricks = finalState.tricks.map((t, idx) => {
    const plays = t.plays.map(p => {
      const match = playActions.find(a => {
        const pa = JSON.parse(a.payload_json)
        return String(a.user_id) === p.userId && pa.cardId === p.card.id
      })
      return {
        userId: p.userId,
        card: p.card.id,
        seq: match ? match.seq : null,
      }
    })
    return {
      trickNumber: idx + 1,
      leaderUserId: t.leader,
      plays,
      winnerUserId: t.winner,
      cardPoints: t.plays.reduce((s, p) => s + cardPoints(p.card), 0),
    }
  })

  const cardPointsByUser = {}
  for (const p of players) cardPointsByUser[p.userId] = 0
  for (const t of finalState.tricks) {
    const pts = t.plays.reduce((s, p) => s + cardPoints(p.card), 0)
    cardPointsByUser[t.winner] = (cardPointsByUser[t.winner] ?? 0) + pts
  }
  if (finalState.picker && finalState.discard) {
    for (const c of finalState.discard) {
      cardPointsByUser[finalState.picker] += cardPoints(c)
    }
  }

  const scores = players.map(p => ({
    userId: p.userId,
    cardPoints: cardPointsByUser[p.userId] ?? 0,
    scoreDelta: scoreEventsByUser[p.userId] ?? 0,
  }))

  return {
    gameId: null,
    handNumber: dealPayload.handNumber,
    variant,
    callMode: finalState.callMode ?? null,
    startedAt: null,
    completedAt: null,
    players,
    dealt,
    blind: variant === 'normal' ? initialBlind : null,
    picker: finalState.picker ? { userId: finalState.picker } : null,
    partner: finalState.partner
      ? { userId: finalState.partner, revealedOnTrick: partnerRevealedOnTrick }
      : null,
    calledCard,
    pickerDiscards: variant === 'normal' ? pickerDiscards : null,
    tricks,
    scores,
  }
}

function detectVariant(actions, finalState) {
  if (actions.some(a => a.type === 'schwanzer_score')) return 'schwanzer'
  if (finalState.isLeaster) return 'leaster'
  return 'normal'
}
