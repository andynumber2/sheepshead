// ─── Play Bot Strategy ────────────────────────────────────────────────────────
// Pluggable strategy module for play bots.
// All decision functions receive a redacted player view (getPlayerView output)
// so the bot has no knowledge of opponents' hands — no cheating.

import {
  isTrump, cardPoints, effectiveSuit, trumpRank, suitRank, schwanzerCardPoints,
} from './gameEngine.js'
import { currentWinner, beats, handScore, bestVoidDiscard, teammateWinning, trumpRemainingElsewhere } from './botInference.js'

// ─── Legal card helper ────────────────────────────────────────────────────────
// Mirrors getLegalCardIds from the frontend; computes which cards can be played.
// Returns an array of card objects (not just IDs) so strategy code can inspect them.
function getLegalCards(state, userId) {
  const hand = state.hands[userId] ?? []
  const {
    currentTrick, calledAce, calledTen, calledKing, calledSuit,
    partner, partnerRevealed, underCard, picker, pickerForcedPlays = [],
  } = state

  const handCards = hand.filter(c => !c.isUnderCard)
  const hasUnderCard = underCard && !underCard.played && userId === picker

  const calledCardId = calledAce?.aceId || calledTen?.tenId || calledKing?.kingId

  // Leading
  if (!currentTrick || currentTrick.length === 0) {
    if (calledCardId && userId === partner && !partnerRevealed) {
      const cards = handCards.filter(c => effectiveSuit(c) !== calledSuit || c.id === calledCardId)
      if (hasUnderCard) cards.push({ id: 'UNDER_CARD', isUnderCard: true })
      return cards
    }
    const cards = [...handCards]
    if (hasUnderCard) cards.push({ id: 'UNDER_CARD', isUnderCard: true })
    return cards
  }

  const first = currentTrick[0]
  const ledSuit = first.declaredSuit ?? effectiveSuit(first.card)

  // Picker with under card must play it when called suit is led
  if (userId === picker && hasUnderCard && ledSuit === calledSuit) {
    return [{ id: 'UNDER_CARD', isUnderCard: true }]
  }

  // Partner must play called card when called suit is led
  if (calledCardId && userId === partner && !partnerRevealed && ledSuit === calledSuit) {
    if (handCards.some(c => c.id === calledCardId)) {
      return handCards.filter(c => c.id === calledCardId)
    }
  }

  // Picker forced plays (Situation A / King case)
  if (userId === picker && pickerForcedPlays.length > 0 && ledSuit === calledSuit) {
    const heldForced = pickerForcedPlays.filter(cid => handCards.some(c => c.id === cid))
    if (heldForced.length > 0) return handCards.filter(c => heldForced.includes(c.id))
  }

  // Called card cannot be played unless the called suit is led (mirrors gameEngine restriction)
  const playableCards = (
    calledCardId &&
    ledSuit !== calledSuit &&
    handCards.some(c => c.id !== calledCardId)
  )
    ? handCards.filter(c => c.id !== calledCardId)
    : handCards

  const hasSuit = playableCards.some(c => effectiveSuit(c) === ledSuit)
  return hasSuit
    ? playableCards.filter(c => effectiveSuit(c) === ledSuit)
    : playableCards
}

// ─── Card comparison helpers ──────────────────────────────────────────────────

function lowestCard(cards) {
  // Prefer non-trump, then by point value ascending, then by trump rank descending (weaker trump)
  return cards.reduce((best, c) => {
    const bestPts = cardPoints(best)
    const cPts = cardPoints(c)
    const bestTrump = isTrump(best)
    const cTrump = isTrump(c)
    if (!cTrump && bestTrump) return c
    if (cTrump && !bestTrump) return best
    if (cPts !== bestPts) return cPts < bestPts ? c : best
    if (cTrump && bestTrump) return trumpRank(c) > trumpRank(best) ? c : best
    return best
  })
}

function highestTrump(cards) {
  const trumps = cards.filter(c => isTrump(c))
  if (trumps.length === 0) return null
  return trumps.reduce((best, c) => trumpRank(c) < trumpRank(best) ? c : best)
}

function highestValueCard(cards) {
  return cards.reduce((best, c) => cardPoints(c) > cardPoints(best) ? c : best)
}

// ─── decidePick ───────────────────────────────────────────────────────────────
export function decidePick(view, userId) {
  const hand = view.hands[userId]
  return handScore(hand) >= 24
}

// ─── decideBlitz ──────────────────────────────────────────────────────────────
// Called only when the bot has a potentialBlitz available. Returns true if the
// bot should declare the blitz (picking + 2x multiplier) rather than plain pick.
export function decideBlitz(view, userId) {
  const hand = view.hands[userId]
  const schwanzerPts = hand.reduce((sum, c) => sum + schwanzerCardPoints(c), 0)
  // Blitz only with the strongest hands (7+ schwanzer points)
  return schwanzerPts >= 7
}

// ─── decideDiscard ────────────────────────────────────────────────────────────
export function decideDiscard(view, userId) {
  const hand = view.hands[userId]  // 8 cards after picking up blind

  const voidCards = bestVoidDiscard(hand)
  if (voidCards) return voidCards

  // Replicate mustHold logic from gameEngine.discard to avoid illegal discards
  const failAces = ['AC', 'AH', 'AS']
  const failTens = ['10C', '10H', '10S']
  const holdsAllAces = failAces.every(id => hand.some(c => c.id === id))
  const holdsAllTens = failTens.every(id => hand.some(c => c.id === id))

  let mustHold = []
  if (holdsAllAces && holdsAllTens) mustHold = [...failAces, ...failTens]
  else if (holdsAllAces) mustHold = [...failAces]

  // Bury: non-trump first, then sorted by point value descending
  const candidates = hand
    .filter(c => !mustHold.includes(c.id))
    .sort((a, b) => {
      const aTrump = isTrump(a) ? 1 : 0
      const bTrump = isTrump(b) ? 1 : 0
      if (aTrump !== bTrump) return aTrump - bTrump
      return cardPoints(b) - cardPoints(a)
    })

  return candidates.slice(0, 2).map(c => c.id)
}

// ─── decideCall ───────────────────────────────────────────────────────────────
export function decideCall(view, userId) {
  const { callMode, hands, discard: discardCards } = view
  const hand = hands[userId]

  // Go alone with a dominant trump hand
  const trumpCount = hand.filter(c => isTrump(c)).length
  const queenCount = hand.filter(c => c.rank === 'Q').length
  if (trumpCount >= 6 && queenCount >= 2) return { type: 'alone' }

  const buried = (discardCards ?? []).filter(c => !c.hidden)
  const suits = ['C', 'H', 'S']

  if (callMode === 'ace') {
    // Try normal ace call: suits where picker doesn't hold/bury the ace and holds fail cards
    const normalSuits = suits.filter(suit => {
      const aceId = `A${suit}`
      return !hand.some(c => c.id === aceId)
        && !buried.some(c => c.id === aceId)
        && hand.some(c => c.suit === suit && !isTrump(c))
    })

    if (normalSuits.length > 0) {
      // Fewest fail cards of that suit → most likely an opponent holds the ace
      const ranked = normalSuits
        .map(suit => ({ suit, count: hand.filter(c => c.suit === suit && !isTrump(c)).length }))
        .sort((a, b) => a.count - b.count)
      return { type: 'ace', suit: ranked[0].suit }
    }

    // Try ace-unknown call: suits where picker doesn't hold/bury the ace and has NO fail cards
    const unknownSuits = suits.filter(suit => {
      const aceId = `A${suit}`
      return !hand.some(c => c.id === aceId)
        && !buried.some(c => c.id === aceId)
        && !hand.some(c => c.suit === suit && !isTrump(c))
    })

    if (unknownSuits.length > 0) {
      const suit = unknownSuits[0]
      // Pick lowest-value non-trump card as under card; fall back to lowest trump
      const underCard =
        hand.filter(c => !isTrump(c)).sort((a, b) => cardPoints(a) - cardPoints(b))[0]
        ?? hand.sort((a, b) => cardPoints(a) - cardPoints(b))[0]
      return { type: 'ace_unknown', suit, underCardId: underCard.id }
    }

    return { type: 'alone' }
  }

  if (callMode === 'ten') {
    const validSuits = suits.filter(suit => {
      const tenId = `10${suit}`
      return !hand.some(c => c.id === tenId) && !buried.some(c => c.id === tenId)
    })
    if (validSuits.length === 0) return { type: 'alone' }
    const ranked = validSuits
      .map(suit => ({ suit, count: hand.filter(c => c.suit === suit && !isTrump(c)).length }))
      .sort((a, b) => a.count - b.count)
    return { type: 'ten', suit: ranked[0].suit }
  }

  if (callMode === 'king') {
    const validSuits = suits.filter(suit => {
      const kingId = `K${suit}`
      return !hand.some(c => c.id === kingId) && !buried.some(c => c.id === kingId)
    })
    if (validSuits.length === 0) return { type: 'alone' }
    const ranked = validSuits
      .map(suit => ({ suit, count: hand.filter(c => c.suit === suit && !isTrump(c)).length }))
      .sort((a, b) => a.count - b.count)
    return { type: 'king', suit: ranked[0].suit }
  }

  return { type: 'alone' }
}

// ─── decidePlay ───────────────────────────────────────────────────────────────
export function decidePlay(view, userId) {
  const legal = getLegalCards(view, userId)
  if (legal.length === 0) throw new Error(`Bot ${userId} has no legal cards to play`)

  const realCards = legal.filter(c => !c.isUnderCard)

  // Under card is the only option
  if (realCards.length === 0) return 'UNDER_CARD'

  const { currentTrick, picker, partner, isLeaster } = view

  // Leaster: minimise trick-taking; play lowest value card
  if (isLeaster) return lowestCard(realCards).id

  const isLeading = !currentTrick || currentTrick.length === 0
  const isPickerTeam = userId === picker || userId === partner

  if (isLeading) {
    if (isPickerTeam) {
      // Cash a fail Ace when opponents are likely trump-exhausted
      if (trumpRemainingElsewhere(view, userId) <= 2) {
        const failAces = realCards.filter(c => !isTrump(c) && c.rank === 'A')
                                   .sort((a, b) => cardPoints(b) - cardPoints(a))
        if (failAces.length > 0) return failAces[0].id
      }
      // Lead strongest trump to win tricks and accumulate points
      const best = highestTrump(realCards)
      if (best) return best.id
      // No trump; lead highest-value fail card
      return highestValueCard(realCards).id
    } else {
      // Cash a fail Ace when picker team is likely trump-exhausted
      if (trumpRemainingElsewhere(view, userId) <= 2) {
        const failAces = realCards.filter(c => !isTrump(c) && c.rank === 'A')
                                   .sort((a, b) => cardPoints(b) - cardPoints(a))
        if (failAces.length > 0) return failAces[0].id
      }
      // Opponent: lead a non-trump to avoid burning trump while looking for called suit
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (nonTrump.length > 0) return lowestCard(nonTrump).id
      return lowestCard(realCards).id
    }
  }

  // Following a trick
  const first = currentTrick[0]
  const ledSuit = first.declaredSuit ?? effectiveSuit(first.card)

  if (isPickerTeam) {
    // Schmear: dump highest-point non-trump on teammate's winning trick
    if (teammateWinning(view, userId)) {
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (nonTrump.length > 0) return highestValueCard(nonTrump).id
      return lowestCard(realCards).id  // only trump available — don't burn trump to schmear
    }

    // Try to win with the lowest winning card
    const winning = realCards.filter(c => {
      for (const play of currentTrick) {
        if (!beats(c, play.card, ledSuit)) return false
      }
      return true
    })
    if (winning.length > 0) return lowestCard(winning).id

    // Can't win; play lowest
    return lowestCard(realCards).id
  } else {
    // Opponent: schmear on confirmed teammate wins; otherwise play low
    if (teammateWinning(view, userId)) {
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (nonTrump.length > 0) return highestValueCard(nonTrump).id
      return lowestCard(realCards).id
    }
    return lowestCard(realCards).id
  }
}
