// ─── Play Bot Strategy ────────────────────────────────────────────────────────
// Pluggable strategy module for play bots.
// All decision functions receive a redacted player view (getPlayerView output)
// so the bot has no knowledge of opponents' hands — no cheating.

import {
  isTrump, cardPoints, effectiveSuit, trumpRank, suitRank, schwanzerCardPoints,
} from './gameEngine.js'
import { currentWinner, beats, handScore, bestVoidBury, teammateWinning, trumpRemainingElsewhere, isGuaranteedWinner, cheapestGuaranteedWin } from './botInference.js'

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
  let playableCards = (
    calledCardId &&
    ledSuit !== calledSuit &&
    handCards.some(c => c.id !== calledCardId)
  )
    ? handCards.filter(c => c.id !== calledCardId)
    : handCards

  // Picker called-suit holding rule: until the called suit is led, the picker
  // must keep ≥1 card of the called suit in hand (plus any pickerForcedPlays
  // cards in ten/king calls). Mirrors gameEngine validatePlay.
  if (
    userId === picker &&
    calledSuit &&
    !partnerRevealed &&
    ledSuit !== calledSuit &&
    playableCards.length > 1
  ) {
    const filtered = playableCards.filter(card => {
      if (pickerForcedPlays.includes(card.id)) return false
      if (effectiveSuit(card) === calledSuit) {
        const remaining = playableCards.filter(
          c => c.id !== card.id && effectiveSuit(c) === calledSuit
        ).length
        if (remaining === 0) return false
      }
      return true
    })
    if (filtered.length > 0) playableCards = filtered
  }

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

function cheapestWinningTrump(cards) {
  const POINT_DIAMONDS = new Set(['AD', '10D', 'KD'])
  const PIP_DIAMONDS = new Set(['9D', '8D', '7D'])
  const pointD = cards.filter(c => POINT_DIAMONDS.has(c.id))
  const pipD = cards.filter(c => PIP_DIAMONDS.has(c.id))
  const highTrump = cards.filter(c => c.rank === 'Q' || c.rank === 'J')
  const group = pointD.length > 0 ? pointD : pipD.length > 0 ? pipD : highTrump
  return group.reduce((best, c) => trumpRank(c) > trumpRank(best) ? c : best)
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

// ─── decideBury ───────────────────────────────────────────────────────────────
export function decideBury(view, userId) {
  const hand = view.hands[userId]  // 8 cards after picking up blind

  const voidCards = bestVoidBury(hand)
  if (voidCards) return voidCards

  // Replicate mustHold logic from gameEngine.bury to avoid illegal buries
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
  const { callMode, hands, buried: buriedCards } = view
  const hand = hands[userId]

  // Go alone with a dominant trump hand
  const trumpCount = hand.filter(c => isTrump(c)).length
  const queenCount = hand.filter(c => c.rank === 'Q').length
  if (trumpCount >= 6 && queenCount >= 2) return { type: 'alone' }

  const buried = (buriedCards ?? []).filter(c => !c.hidden)
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

    // Try ace-under call: suits where picker doesn't hold/bury the ace and has NO fail cards
    const underSuits = suits.filter(suit => {
      const aceId = `A${suit}`
      return !hand.some(c => c.id === aceId)
        && !buried.some(c => c.id === aceId)
        && !hand.some(c => c.suit === suit && !isTrump(c))
    })

    if (underSuits.length > 0) {
      const suit = underSuits[0]
      // Pick lowest-value non-trump card as under card; fall back to lowest trump
      const underCard =
        hand.filter(c => !isTrump(c)).sort((a, b) => cardPoints(a) - cardPoints(b))[0]
        ?? [...hand].sort((a, b) => cardPoints(a) - cardPoints(b))[0]
      return { type: 'ace_under', suit, underCardId: underCard.id }
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

      // Partner with no trump: lead called suit if previous trick was low on trump,
      // otherwise lead the lowest-point fail card
      if (userId === partner) {
        const { calledSuit, lastTrick = [] } = view
        const lastTrumpCount = lastTrick.filter(p => !p.card?.hidden && isTrump(p.card)).length
        if (lastTrumpCount <= 3) {
          const calledSuitCards = realCards.filter(c => effectiveSuit(c) === calledSuit)
          if (calledSuitCards.length > 0) return lowestCard(calledSuitCards).id
        }
        const fails = realCards.filter(c => !isTrump(c))
        return fails.length > 0 ? lowestCard(fails).id : lowestCard(realCards).id
      }

      // No trump; lead highest-value fail card
      return highestValueCard(realCards).id
    } else {
      // Cash a fail Ace only when picker team is completely out of trump
      if (trumpRemainingElsewhere(view, userId) === 0) {
        const { calledAce, calledTen, calledKing } = view
        const calledCardId = calledAce?.aceId ?? calledTen?.tenId ?? calledKing?.kingId
        const failAces = realCards
          .filter(c => !isTrump(c) && c.rank === 'A' && c.id !== calledCardId)
          .sort((a, b) => cardPoints(b) - cardPoints(a))
        if (failAces.length > 0) return failAces[0].id
      }
      // Lead called suit to flush out the unrevealed partner
      const { calledSuit, partnerRevealed } = view
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (!partnerRevealed && calledSuit) {
        const calledSuitCards = nonTrump.filter(c => effectiveSuit(c) === calledSuit)
        if (calledSuitCards.length > 0) return lowestCard(calledSuitCards).id
      }
      // Otherwise: lead lowest non-trump to avoid burning trump
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

    // Try to win with the most efficient card
    const winning = realCards.filter(c => {
      for (const play of currentTrick) {
        if (!beats(c, play.card, ledSuit)) return false
      }
      return true
    })
    if (winning.length > 0) {
      const nonTrumpWins = winning.filter(c => !isTrump(c))
      if (nonTrumpWins.length > 0) return lowestCard(nonTrumpWins).id

      // Trump wins only — compute how many opposing players have yet to play
      const playedIds = new Set(currentTrick.map(p => p.userId))
      const allPlayerIds = Object.keys(view.hands)
      const opponentsRemaining = allPlayerIds.filter(id =>
        !playedIds.has(id) && id !== userId && id !== picker && id !== partner
      ).length

      if (ledSuit === 'T') {
        // Scenario 1: Trump trick
        if (opponentsRemaining === 0) return cheapestWinningTrump(winning).id
        const guaranteed = cheapestGuaranteedWin(winning, view, userId)
        if (guaranteed) return guaranteed.id
        return highestTrump(winning).id
      }

      // Scenario 2: Fail trick, bot is void, playing trump to contest the lead
      if (userId === picker) {
        const guaranteed = cheapestGuaranteedWin(winning, view, userId)
        if (guaranteed) return guaranteed.id
        return highestTrump(winning).id
      }

      // Partner (void in led fail suit). playedIds already defined above.
      const myTrumpCount = realCards.filter(c => isTrump(c)).length
      const pickerStillToPlay = picker !== userId && !playedIds.has(picker)

      if (pickerStillToPlay) {
        // Picker hasn't played; picker likely has trump (picker-strength prior).
        if (myTrumpCount >= 2) {
          // Lead-back insurance: contest aggressively.
          return highestTrump(winning).id
        }
        // Exactly 1 trump: only spend it if guaranteed to win the trick.
        const myOnlyTrump = realCards.find(c => isTrump(c))
        if (myOnlyTrump && isGuaranteedWinner(myOnlyTrump, view, userId)) {
          return myOnlyTrump.id
        }
        return lowestCard(realCards).id
      }

      // Picker has played. Check if picker has the trick locked.
      const winnerPlay = currentWinner(currentTrick)
      const pickerCurrentlyWinning = winnerPlay?.userId === picker
      const pickerCardLocked = pickerCurrentlyWinning && (
        opponentsRemaining === 0 ||
        isGuaranteedWinner(winnerPlay.card, view, userId)
      )
      if (pickerCardLocked) return lowestCard(realCards).id

      if (myTrumpCount > 1) {
        const guaranteed = cheapestGuaranteedWin(winning, view, userId)
        if (guaranteed) return guaranteed.id
        return highestTrump(winning).id
      }
      return highestTrump(winning).id  // 1 trump, picker already played — play it
    }

    // Can't win; play lowest
    return lowestCard(realCards).id
  } else {
    // Opponent: schmear on confirmed teammate wins; otherwise play low
    if (teammateWinning(view, userId)) {
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (nonTrump.length > 0) return highestValueCard(nonTrump).id
      return lowestCard(realCards).id
    }
    // Trump in on called suit if picker team is currently winning the trick
    const { calledSuit } = view
    if (ledSuit === calledSuit) {
      const winner = currentWinner(currentTrick)
      const opponentWinning = winner && winner.userId !== picker && winner.userId !== partner
      if (!opponentWinning) {
        const trumpCards = realCards.filter(c => isTrump(c))
        if (trumpCards.length > 0) return lowestCard(trumpCards).id
      }
    }
    return lowestCard(realCards).id
  }
}
