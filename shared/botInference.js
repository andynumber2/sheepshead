// ─── Bot Inference ────────────────────────────────────────────────────────────
// Pure functions that derive facts from a player's view (own hand + played cards).
// No decisions, no side effects. All functions receive a getPlayerView-redacted view.

import { isTrump, cardPoints, schwanzerCardPoints, effectiveSuit, trumpRank, suitRank } from './gameEngine.js'

// ─── Trump tracking ───────────────────────────────────────────────────────────

// Count trump cards visible in completed tricks and the current trick.
// Skips hidden/face-down plays the bot cannot see.
// userId is unused here but kept for API symmetry with trumpRemainingElsewhere
export function countTrumpPlayed(view, _userId) {
  let count = 0
  for (const trick of (view.tricks ?? [])) {
    for (const play of trick.plays) {
      if (!play.card.hidden && isTrump(play.card)) count++
    }
  }
  for (const play of (view.currentTrick ?? [])) {
    if (!play.card.hidden && isTrump(play.card)) count++
  }
  return count
}

// Estimate trump still held by players other than userId.
// Formula: 14 total − own trump − trump seen in tricks.
// A result ≤ 2 means opponents are likely trump-exhausted.
export function trumpRemainingElsewhere(view, userId) {
  const myTrump = (view.hands[userId] ?? []).filter(c => !c.hidden && isTrump(c)).length
  const discardTrump = (view.discard ?? []).filter(c => !c.hidden && isTrump(c)).length
  return 14 - myTrump - countTrumpPlayed(view, userId) - discardTrump
}

// ─── Hand evaluation ──────────────────────────────────────────────────────────

// Sum of card points for the top 2 non-trump cards in hand.
// Returns 0 if fewer than 2 non-trump cards exist.
export function buriablePoints(hand) {
  const nonTrump = hand.filter(c => !c.hidden && !isTrump(c))
  if (nonTrump.length < 2) return 0
  const sorted = [...nonTrump].sort((a, b) => cardPoints(b) - cardPoints(a))
  return sorted.slice(0, 2).reduce((sum, c) => sum + cardPoints(c), 0)
}

// Combined hand quality score for the pick decision.
// schwanzerPts * 4 + buriablePoints. Threshold: >= 24 → pick.
export function handScore(hand) {
  const schwanzerPts = hand.filter(c => !c.hidden).reduce((sum, c) => sum + schwanzerCardPoints(c), 0)
  return schwanzerPts * 4 + buriablePoints(hand)
}

// ─── Trick evaluation ─────────────────────────────────────────────────────────

// Returns true if challenger beats current card given the led suit.
export function beats(challenger, current, ledSuit) {
  if (!current || current.hidden || current.faceDown) return true
  const cTrump = isTrump(challenger)
  const wTrump = isTrump(current)
  if (cTrump && !wTrump) return true
  if (!cTrump && wTrump) return false
  if (cTrump && wTrump) return trumpRank(challenger) < trumpRank(current)
  const cIsLed = challenger.suit === ledSuit
  const wIsLed = current.suit === ledSuit
  if (cIsLed && !wIsLed) return true
  if (!cIsLed && wIsLed) return false
  if (challenger.suit !== current.suit) return false
  return suitRank(challenger) < suitRank(current)
}

// Returns the play object currently winning the trick (array of {userId, card}).
export function currentWinner(trick) {
  if (!trick || trick.length === 0) return null
  const first = trick[0]
  const ledSuit = first.declaredSuit ?? effectiveSuit(first.card)
  let winner = trick[0]
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, winner.card, ledSuit)) winner = trick[i]
  }
  return winner
}

// ─── Schmear detection ────────────────────────────────────────────────────────

// Returns true if the player currently winning the trick is on the same team as userId.
// Picker-team bots: teammate = picker or partner.
// Opponent bots: only returns true when partner is known AND winner is confirmed opponent.
//   If partner is null (unrevealed), returns false — unsafe to schmear.
export function teammateWinning(view, userId) {
  const { currentTrick, picker, partner } = view
  if (!currentTrick || currentTrick.length === 0) return false

  const winner = currentWinner(currentTrick)
  if (!winner) return false
  const winnerId = winner.userId

  const onPickerTeam = userId === picker || userId === partner

  if (onPickerTeam) {
    return winnerId === picker || winnerId === partner
  } else {
    if (partner === null) return false
    return winnerId !== picker && winnerId !== partner
  }
}
