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
  const buriedTrump = (view.buried ?? []).filter(c => !c.hidden && isTrump(c)).length
  return 14 - myTrump - countTrumpPlayed(view, userId) - buriedTrump
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

// ─── Void analysis ────────────────────────────────────────────────────────────

// Returns 2 card IDs whose burial voids a non-trump suit with combined points >= 11,
// or null if no qualifying void exists.
//
// For a 1-card suit: pairs the suit card with the highest-point eligible card from any
// other suit (chosen for point value, not secondary voiding).
// Among qualifying pairs, returns the highest-total pair.
// Respects mustHold restrictions (same logic as decideBury).
export function bestVoidBury(hand) {
  const failAces = ['AC', 'AH', 'AS']
  const failTens = ['10C', '10H', '10S']
  const holdsAllAces = failAces.every(id => hand.some(c => c.id === id))
  const holdsAllTens = failTens.every(id => hand.some(c => c.id === id))

  let mustHold = []
  if (holdsAllAces && holdsAllTens) mustHold = [...failAces, ...failTens]
  else if (holdsAllAces) mustHold = [...failAces]

  const eligible = hand.filter(c => !isTrump(c) && !mustHold.includes(c.id))

  const bySuit = {}
  for (const card of eligible) {
    if (!bySuit[card.suit]) bySuit[card.suit] = []
    bySuit[card.suit].push(card)
  }

  let bestPair = null
  let bestTotal = 10  // require > 10 (i.e., >= 11)

  for (const [suit, cards] of Object.entries(bySuit)) {
    if (cards.length === 1) {
      // Need a filler from another suit (highest-point eligible card)
      const filler = eligible
        .filter(c => c.suit !== suit)
        .sort((a, b) => cardPoints(b) - cardPoints(a))[0]
      if (!filler) continue
      const total = cardPoints(cards[0]) + cardPoints(filler)
      if (total > bestTotal) {
        bestTotal = total
        bestPair = [cards[0].id, filler.id]
      }
    } else if (cards.length === 2) {
      const total = cardPoints(cards[0]) + cardPoints(cards[1])
      if (total > bestTotal) {
        bestTotal = total
        bestPair = [cards[0].id, cards[1].id]
      }
    }
    // 3+ cards: burying 2 won't void this suit — skip
  }

  return bestPair
}

// ─── Guaranteed-winner inference ──────────────────────────────────────────────

// Returns true iff every trump that outranks `card` is visible to userId:
//   - in userId's own hand
//   - played in completed tricks (non-hidden)
//   - played in the current trick (non-hidden)
//   - in the visible bury (non-hidden; picker-only)
// Unseen higher trump is always treated as a potential opponent holding.
// Non-trump cards are never "guaranteed" — callers combine with trumpRemainingElsewhere.
export function isGuaranteedWinner(card, view, userId) {
  if (!isTrump(card)) return false
  const myRank = trumpRank(card)
  if (myRank === 0) return true  // highest trump (Queen of Clubs)

  const seenRanks = new Set()
  const noteIfHigherTrump = (c) => {
    if (!c || c.hidden) return
    if (!isTrump(c)) return
    seenRanks.add(trumpRank(c))
  }

  for (const c of (view.hands[userId] ?? [])) noteIfHigherTrump(c)
  for (const trick of (view.tricks ?? [])) {
    for (const play of trick.plays) noteIfHigherTrump(play.card)
  }
  for (const play of (view.currentTrick ?? [])) noteIfHigherTrump(play.card)
  for (const c of (view.buried ?? [])) noteIfHigherTrump(c)

  // Every rank strictly lower than myRank must be seen somewhere.
  for (let r = 0; r < myRank; r++) {
    if (!seenRanks.has(r)) return false
  }
  return true
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
