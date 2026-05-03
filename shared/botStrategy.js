// ─── Play Bot Strategy ────────────────────────────────────────────────────────
// Pluggable strategy module for play bots.
// All decision functions receive a redacted player view (getPlayerView output)
// so the bot has no knowledge of opponents' hands — no cheating.

import {
  isTrump, cardPoints, effectiveSuit, trumpRank, suitRank, schwanzerCardPoints,
} from './gameEngine.js'
import { currentWinner, beats, handScore, bestVoidBury, computeMustHold, teammateWinning, isGuaranteedWinner, cheapestGuaranteedWin, pickBySchmearPriority, resolveView } from './botInference.js'

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

function weakestTrump(cards) {
  const trumps = cards.filter(c => isTrump(c))
  if (trumps.length === 0) return null
  return trumps.reduce((best, c) => trumpRank(c) > trumpRank(best) ? c : best)
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
// Calibrated values from scripts/simulate-pick.mjs targeting ~15% no-pick rate (issue #126).
export const PICK_THRESHOLD_BASE = 35
export const PICK_THRESHOLD_DISCOUNT = 2

export function pickThreshold(passesSoFar) {
  return PICK_THRESHOLD_BASE - PICK_THRESHOLD_DISCOUNT * passesSoFar
}

// Parameterized core — used by the simulator to sweep base/discount values.
export function decidePickWith(view, userId, base, discount) {
  const hand = view.hands[userId]
  const visible = hand.filter(c => !c.hidden)

  // Hard veto: too few trump → never pick.
  const trumpCount = visible.filter(c => isTrump(c)).length
  if (trumpCount <= 2) return false

  const passesSoFar = view.pickIndex ?? 0
  return handScore(hand) >= base - discount * passesSoFar
}

export function decidePick(view, userId) {
  return decidePickWith(view, userId, PICK_THRESHOLD_BASE, PICK_THRESHOLD_DISCOUNT)
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

  const mustHold = computeMustHold(hand)

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

  const rv = resolveView(view, userId)

  const isLeading = !currentTrick || currentTrick.length === 0
  // `view.partner` is set on picker-team views (the picker sees the partner;
  // the partner sees themselves), so this self-team check is correct as-is.
  // Opponent-side identity checks elsewhere in this file consult deducedPartner
  // to handle the case where view.partner is redacted to null.
  const isPickerTeam = userId === picker || userId === partner

  if (isLeading) {
    if (isPickerTeam) {
      // Cash any guaranteed non-trump winner: play highest-value first
      const guaranteedFails = realCards
        .filter(c => !isTrump(c) && isGuaranteedWinner(c, rv, userId))
        .sort((a, b) => cardPoints(b) - cardPoints(a))
      if (guaranteedFails.length > 0) return guaranteedFails[0].id
      // Lead strongest trump to win tricks and accumulate points.
      // Partner with 2+ trump: defer to a fail card if the strongest trump is not
      // a guaranteed winner (preserve trump for later when they can be decisive).
      const best = highestTrump(realCards)
      if (best) {
        if (userId === partner) {
          const fails = realCards.filter(c => !isTrump(c))
          if (realCards.filter(c => isTrump(c)).length >= 2 && fails.length > 0 && !isGuaranteedWinner(best, rv, userId)) {
            return lowestCard(fails).id
          }
        }
        return best.id
      }

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

      // No trump; lead highest-value fail card — but avoid suits where an opponent
      // is known void (Wire 1: they could trump in). Prefer a safe suit if available.
      // Wire 1 applies to the picker (not the partner, who follows a different lead-back strategy).
      {
        const allIds = Object.keys(view.hands)
        const opponentIds = allIds.filter(id => id !== picker && id !== partner)
        const nonTrumpVoids = rv.resolvedNonTrumpVoids
        const failCards = realCards.filter(c => !isTrump(c))
        const safeFails = failCards.filter(card => {
          const suit = effectiveSuit(card)
          return !opponentIds.some(id => nonTrumpVoids.get(id)?.has(suit))
        })
        if (safeFails.length > 0) return highestValueCard(safeFails).id
        return highestValueCard(realCards).id
      }
    } else {
      // Cash any guaranteed non-trump winner (excluding the called card which can't be led before reveal)
      {
        const { calledAce, calledTen, calledKing } = view
        const calledCardId = calledAce?.aceId ?? calledTen?.tenId ?? calledKing?.kingId
        const guaranteedFails = realCards
          .filter(c => !isTrump(c) && c.id !== calledCardId && isGuaranteedWinner(c, rv, userId))
          .sort((a, b) => cardPoints(b) - cardPoints(a))
        if (guaranteedFails.length > 0) return guaranteedFails[0].id
      }
      // Lead called suit to flush out the partner whose identity is not yet deduced —
      // skipped if partner identity is already known from public information (crack/recrack/elimination).
      const { calledSuit } = view
      const nonTrump = realCards.filter(c => !isTrump(c))
      if (rv.resolvedPartner === null && calledSuit) {
        const calledSuitCards = nonTrump.filter(c => effectiveSuit(c) === calledSuit)
        if (calledSuitCards.length > 0) return lowestCard(calledSuitCards).id
      }
      // Wire 2: when the partner identity is known, lead into a picker-team member's
      // known fail-suit void to force them to trump or waste a card.
      // Only fires when deducedPartner !== null (otherwise the called-suit flush above handles it).
      {
        const { calledAce: ca, calledTen: ct, calledKing: ck } = view
        const calledCardId = ca?.aceId ?? ct?.tenId ?? ck?.kingId
        const knownPartner = rv.resolvedPartner
        if (knownPartner !== null) {
          const nonTrumpVoids = rv.resolvedNonTrumpVoids
          const pickerTeamIds = [picker, knownPartner].filter(Boolean)
          // Candidate fail cards: non-trump, not the called card
          const failLeads = nonTrump.filter(c => c.id !== calledCardId)
          // Find cards in suits where at least one picker-team member is void
          const voidSuitCards = failLeads.filter(card => {
            const suit = effectiveSuit(card)
            return pickerTeamIds.some(id => nonTrumpVoids.get(id)?.has(suit))
          })
          if (voidSuitCards.length > 0) return lowestCard(voidSuitCards).id
        }
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
    // Schmear: dump highest-point card on teammate's winning trick,
    // unless an opponent still to play could trump over the teammate.
    // When safe=true (trick confirmed safe), fall back to trump A/10/K if no high-point fail.
    // Never schmear J or Q regardless of safety.
    if (teammateWinning(rv, userId)) {
      const schmear = (safe = false) => {
        const nonTrump = realCards.filter(c => !isTrump(c))
        const highPointFail = nonTrump.filter(c => c.rank === 'A' || c.rank === '10' || c.rank === 'K')
        if (highPointFail.length > 0) {
          // Pass the bot's full hand (not realCards) so the suit-count tiebreak counts
          // suits across the entire remaining hand, not just legal plays.
          const pick = pickBySchmearPriority(highPointFail, 'fail', view.hands[userId])
          if (pick) return pick.id
        }
        if (safe) {
          const trumpFallback = realCards.filter(c => isTrump(c) && (c.rank === 'A' || c.rank === '10' || c.rank === 'K'))
          if (trumpFallback.length > 0) {
            const pick = pickBySchmearPriority(trumpFallback, 'trump', view.hands[userId])
            if (pick) return pick.id
          }
        }
        return lowestCard(realCards).id
      }

      const winnerPlay = currentWinner(currentTrick)
      const playedIdsLocal = new Set(currentTrick.map(p => p.userId))
      const allIdsLocal = Object.keys(view.hands)
      const opponentsRemainingLocal = allIdsLocal.filter(id =>
        !playedIdsLocal.has(id) && id !== userId && id !== picker && id !== partner
      ).length

      const teammateSafe = opponentsRemainingLocal === 0 ||
        isGuaranteedWinner(winnerPlay.card, rv, userId)

      if (teammateSafe) return schmear(true)

      // Not safe — opponent could overtake.
      if (userId === partner) {
        // Partner role: trust picker's implied trump strength; schmear anyway.
        return schmear()
      }

      // Picker role: try to secure the trick.
      const ledSuitLocal = currentTrick[0].declaredSuit ?? effectiveSuit(currentTrick[0].card)
      const winningLocal = realCards.filter(card => {
        for (const play of currentTrick) {
          if (!beats(card, play.card, ledSuitLocal)) return false
        }
        return true
      })
      const takeover = cheapestGuaranteedWin(winningLocal, rv, userId)
      if (takeover) return takeover.id
      const highTrump = highestTrump(winningLocal)
      if (highTrump) return highTrump.id  // risk reduction
      return schmear()  // fallback
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
      if (nonTrumpWins.length > 0) {
        const playedIdsNT = new Set(currentTrick.map(p => p.userId))
        const allIdsNT = Object.keys(view.hands)
        const opponentsRemainingNT = allIdsNT.filter(id =>
          !playedIdsNT.has(id) && id !== userId && id !== picker && id !== partner
        ).length
        const bestNonTrumpWin = highestValueCard(nonTrumpWins)
        // Checking only the best non-trump winner is sufficient: in a fail-led trick
        // all nonTrumpWins are the same suit, so if the highest-value card isn't
        // guaranteed (a higher same-suit rank is unaccounted for), none of them are.
        const safeFromTrumpIn = opponentsRemainingNT === 0 ||
          isGuaranteedWinner(bestNonTrumpWin, rv, userId)
        if (safeFromTrumpIn) {
          return bestNonTrumpWin.id
        }
        return lowestCard(nonTrumpWins).id
      }

      // Trump wins only — compute how many opposing players have yet to play
      const playedIds = new Set(currentTrick.map(p => p.userId))
      const allPlayerIds = Object.keys(view.hands)
      const opponentsRemaining = allPlayerIds.filter(id =>
        !playedIds.has(id) && id !== userId && id !== picker && id !== partner
      ).length

      if (ledSuit === 'T') {
        // Scenario 1: Trump trick
        if (opponentsRemaining === 0) return cheapestWinningTrump(winning).id
        const guaranteed = cheapestGuaranteedWin(winning, rv, userId)
        if (guaranteed) return guaranteed.id
        return highestTrump(winning).id
      }

      // Scenario 2: Fail trick, bot is void, playing trump to contest the lead
      if (userId === picker) {
        const safeWinning = opponentsRemaining === 0
          ? winning
          : winning.filter(c => isGuaranteedWinner(c, rv, userId))
        if (safeWinning.length > 0) {
          // Trick is secured — maximize card points with schmear priority
          const pick = pickBySchmearPriority(safeWinning, 'trump', view.hands[userId])
          if (pick) return pick.id
          return highestTrump(safeWinning).id
        }
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
        if (myOnlyTrump && isGuaranteedWinner(myOnlyTrump, rv, userId)) {
          return myOnlyTrump.id
        }
        return lowestCard(realCards).id
      }

      // Picker has played but is not winning (schmear intercepts picker-winning case).
      if (myTrumpCount > 1) {
        const guaranteed = cheapestGuaranteedWin(winning, rv, userId)
        if (guaranteed) return guaranteed.id
        return highestTrump(winning).id
      }
      return highestTrump(winning).id  // 1 trump, picker already played — play it
    }

    // Can't win — on a trump-led trick, shed the weakest trump (highest rank index)
    // rather than the cheapest by points, to preserve tactically stronger trump.
    if (ledSuit === 'T') {
      const weak = weakestTrump(realCards)
      if (weak) return weak.id
    }
    return lowestCard(realCards).id
  } else {
    // Opponent: schmear on confirmed teammate wins — unless picker-team still to play
    // could trump over the teammate, in which case attempt a guaranteed takeover.
    if (teammateWinning(rv, userId)) {
      const schmearOpp = (safe = false) => {
        const nonTrump = realCards.filter(c => !isTrump(c))
        const highPointFail = nonTrump.filter(c => c.rank === 'A' || c.rank === '10' || c.rank === 'K')
        if (highPointFail.length > 0) {
          const pick = pickBySchmearPriority(highPointFail, 'fail', view.hands[userId])
          if (pick) return pick.id
        }
        if (safe) {
          const trumpFallback = realCards.filter(c => isTrump(c) && (c.rank === 'A' || c.rank === '10' || c.rank === 'K'))
          if (trumpFallback.length > 0) {
            const pick = pickBySchmearPriority(trumpFallback, 'trump', view.hands[userId])
            if (pick) return pick.id
          }
        }
        return lowestCard(realCards).id
      }

      const winnerPlay = currentWinner(currentTrick)
      const playedIdsOpp = new Set(currentTrick.map(p => p.userId))
      const allIdsOpp = Object.keys(view.hands)
      // From opponent POV, "threats" (could overtake teammate) = picker + partner still to play.
      const deducedOpp = rv.resolvedPartner
      const threatsRemaining = allIdsOpp.filter(id =>
        !playedIdsOpp.has(id) && id !== userId && (id === picker || id === deducedOpp)
      ).length

      const teammateSafe = threatsRemaining === 0 ||
        isGuaranteedWinner(winnerPlay.card, rv, userId)

      if (teammateSafe) return schmearOpp(true)

      const ledSuitOpp = currentTrick[0].declaredSuit ?? effectiveSuit(currentTrick[0].card)
      const winningOpp = realCards.filter(card => {
        for (const play of currentTrick) {
          if (!beats(card, play.card, ledSuitOpp)) return false
        }
        return true
      })
      const takeover = cheapestGuaranteedWin(winningOpp, rv, userId)
      if (takeover) return takeover.id

      // Predicted-win override (#163): when the called suit was led by a fellow
      // opponent, the called card has not yet been played this trick
      // (`partnerRevealed` engine flag), and no trump has been played in this
      // trick, the picker-team partner is forced to play the called card later
      // this trick and will overtake any current fail-suit winner. Schmearing
      // high points to the current leader just donates them to the picker team.
      // Fall through to the predicted-win trump-in branch below (which trumps
      // in via the trump schmear priority, or returns the lowest card if no
      // trump is held).
      const calledSuitLedUnrevealed = !view.partnerRevealed && !!view.calledSuit && ledSuit === view.calledSuit
      const noTrumpPlayedYet = !currentTrick.some(p => isTrump(p.card))
      if (!(calledSuitLedUnrevealed && noTrumpPlayedYet)) {
        return schmearOpp()
      }
      // else fall through to predicted-win / lead-back branches below
    }
    // Force-take to enable called-suit lead-back: when the called suit has not been led
    // on this trick AND the partner identity is not yet deduced, and the bot has a
    // called-suit fail card to lead back, win this trick aggressively so the bot can
    // lead the called suit on the next trick and flush the picker's partner.
    {
      const { calledSuit } = view
      const ledThisTrickIsCalled = ledSuit === calledSuit
      // Note: realCards already filters by must-follow rules. If the bot has a called-suit
      // card but is here following a different suit, the called-suit card is in `view.hands[userId]`
      // but not in `realCards`. We need to check the bot's full hand for the lead-back card.
      const fullHand = view.hands[userId] ?? []
      const hasCalledSuitFailInHand = !!calledSuit && fullHand.some(card =>
        !card.hidden && !isTrump(card) && effectiveSuit(card) === calledSuit
      )

      // Skipped if partner has already been deduced from public information —
      // the lead-back goal (flush the unknown partner) is then moot.
      if (rv.resolvedPartner === null && !ledThisTrickIsCalled && hasCalledSuitFailInHand) {
        const winningSet = realCards.filter(card => {
          for (const play of currentTrick) {
            if (!beats(card, play.card, ledSuit)) return false
          }
          return true
        })

        if (winningSet.length > 0) {
          const playedIds = new Set(currentTrick.map(p => p.userId))
          const allIds = Object.keys(view.hands)
          const potentialOppsRemaining = allIds.filter(id =>
            !playedIds.has(id) && id !== userId
          ).length

          const canPlayTrump = winningSet.some(card => isTrump(card))

          if (canPlayTrump) {
            // Void in led suit, or trump led
            if (potentialOppsRemaining > 0) {
              // Highest trump in winning set
              return highestTrump(winningSet).id
            }
            // 0 opps remain — schmear-self with trump priority
            const pick = pickBySchmearPriority(winningSet, 'trump', fullHand)
            if (pick) return pick.id
          } else {
            // Must-follow non-called fail; only fail-suit winners
            if (potentialOppsRemaining === 0) {
              const pick = pickBySchmearPriority(winningSet, 'fail', fullHand)
              if (pick) return pick.id
            }
            // potentialOppsRemaining > 0 → fall through (opponent could trump over)
          }
        }
      }
    }
    // Trump in to contest a picker-team-winning fail-led trick. Goal: capture
    // the trick and accumulate card points via schmear priority. The picker-
    // team-winning gate naturally excludes the case where another opponent has
    // already trumped in (then the bot's teammate is winning, handled above).
    //
    // Predicted-win extension: when the called suit was led, the called card
    // has not yet been played this trick (`partnerRevealed` engine flag), and
    // no trump has been played in this trick, the partner (ace call) or picker
    // (ten/king call) is forced to play the called card later this trick — the
    // picker team will take the trick. Treat that as a picker-team win for
    // trump-in purposes. The no-trump guard avoids firing when a fellow opponent
    // has already trumped in (their trump beats the forced card, so the picker
    // team will not win).
    //
    // Card choice: schmear priority (A/10/K before pips; Js/Qs reserved) on the
    // filtered set of trump that can beat the current winner. This applies
    // uniformly — whether the partner was unrevealed at trick start, revealed
    // mid-trick, or the picker won via a different fail — because the principle
    // is the same: when your trump takes the trick, maximize the points captured
    // while preserving your strongest trump for future battles.
    if (!isTrump(currentTrick[0].card)) {
      const winner = currentWinner(currentTrick)
      const deducedForPredicted = rv.resolvedPartner
      const pickerTeamWinning = winner && (winner.userId === picker || winner.userId === deducedForPredicted)
      const { calledSuit, partnerRevealed } = view
      const calledSuitLedUnrevealed = !partnerRevealed && !!calledSuit && ledSuit === calledSuit
      const noTrumpPlayedYet = !currentTrick.some(p => isTrump(p.card))
      const pickerTeamWillWin = calledSuitLedUnrevealed && noTrumpPlayedYet
      if (pickerTeamWinning || pickerTeamWillWin) {
        const trumpCards = realCards.filter(c => isTrump(c))
        if (trumpCards.length > 0) {
          const fullHand = view.hands[userId] ?? []
          const winningTrump = trumpCards.filter(card =>
            currentTrick.every(play => beats(card, play.card, ledSuit))
          )
          if (winningTrump.length > 0)
            return (pickBySchmearPriority(winningTrump, 'trump', fullHand) ?? lowestCard(winningTrump)).id
          // No trump can beat the current winner — fall through to lowestCard
        }
      }
    }
    // On a trump-led trick, shed the weakest trump (highest rank index)
    // rather than the cheapest by points, to preserve tactically stronger trump.
    if (ledSuit === 'T') {
      const weak = weakestTrump(realCards)
      if (weak) return weak.id
    }
    return lowestCard(realCards).id
  }
}
