// ─── Bot Inference ────────────────────────────────────────────────────────────
// Pure functions that derive facts from a player's view (own hand + played cards).
// No decisions, no side effects. All functions receive a getPlayerView-redacted view.

import { isTrump, cardPoints, schwanzerCardPoints, effectiveSuit, trumpRank, suitRank } from './gameEngine.js'

// ─── Public knowledge ─────────────────────────────────────────────────────────

// Card objects for each blitz type. Blitz publicly reveals which queens the picker holds.
const BLITZ_CARDS = {
  black: [{ id: 'QC', rank: 'Q', suit: 'C' }, { id: 'QS', rank: 'Q', suit: 'S' }],
  red:   [{ id: 'QH', rank: 'Q', suit: 'H' }, { id: 'QD', rank: 'Q', suit: 'D' }],
}

export function getCalledCardId(view) {
  return view.calledAce?.aceId ?? view.calledTen?.tenId ?? view.calledKing?.kingId
}

// Add cards to map, creating entry if needed.
function addToMap(map, userId, ...cards) {
  if (map.has(userId)) {
    map.get(userId).push(...cards)
  } else {
    map.set(userId, [...cards])
  }
}

// Returns Map<userId, Array<card>> of cards known by public announcement to be in a player's hand.
// Phase 1: populated from view.blitzes.
// Phase 2: Ten call — picker holds Ace of called suit.
// Phase 3: King call — picker holds Ace and Ten of called suit.
// Phase 4: Partner holds called card (if resolvedPartner is provided and not going alone).
export function knownCardLocations(view, resolvedPartner = null) {
  const map = new Map()

  // Phase 1: Blitzes
  for (const { userId, type } of (view.blitzes ?? [])) {
    const cards = BLITZ_CARDS[type]
    if (cards) map.set(userId, [...cards])
  }

  // Phase 2: Ten call
  if (view.calledTen && view.picker) {
    const suit = view.calledTen.suit
    const card = { id: 'A' + suit, rank: 'A', suit }
    addToMap(map, view.picker, card)
  }

  // Phase 3: King call
  if (view.calledKing && view.picker) {
    const suit = view.calledKing.suit
    const ace = { id: 'A' + suit, rank: 'A', suit }
    const ten = { id: '10' + suit, rank: '10', suit }
    addToMap(map, view.picker, ace, ten)
  }

  // Phase 4: Partner holds called card
  if (resolvedPartner && view.calledSuit && !view.goingAlone) {
    const calledCardId = getCalledCardId(view)
    if (calledCardId) {
      const rank = calledCardId.startsWith('10') ? '10' : calledCardId[0]
      const card = { id: calledCardId, rank, suit: view.calledSuit }
      addToMap(map, resolvedPartner, card)
    }
  }

  return map
}

// Pre-computation wrapper. Runs four inference helpers once and attaches their results
// so downstream consumers in a single play decision can read them as property lookups.
export function resolveView(view, userId) {
  const resolvedPartner = deducedPartner(view, userId)
  return {
    ...view,
    calledCardId: getCalledCardId(view),
    knownLocations: knownCardLocations(view, resolvedPartner),
    resolvedPartner,
    resolvedTrumpVoids: deducedTrumpVoids(view),
    resolvedNonTrumpVoids: deducedNonTrumpVoids(view),
    resolvedTrumpRemaining: trumpRemainingElsewhere(view, userId),
  }
}

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

// Combined hand quality score for the pick decision.
// schwanzerPts × 4 + 3 × failAces + 2 × failTens + (5 if QC).
// Hidden cards are ignored — handScore is called from decidePick on the bot's own hand,
// but the hidden filter mirrors the prior implementation for safety.
export function handScore(hand) {
  const visible = hand.filter(c => !c.hidden)
  const schwanzerPts = visible.reduce((sum, c) => sum + schwanzerCardPoints(c), 0)
  const failAces = visible.filter(c => !isTrump(c) && c.rank === 'A').length
  const failTens = visible.filter(c => !isTrump(c) && c.rank === '10').length
  const hasQC = visible.some(c => c.id === 'QC')
  return schwanzerPts * 4 + 3 * failAces + 2 * failTens + (hasQC ? 5 : 0)
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

// Returns the array of fail card IDs that must be held (not buried).
export function computeMustHold(hand) {
  const failAces = ['AC', 'AH', 'AS']
  const failTens = ['10C', '10H', '10S']
  const holdsAllAces = failAces.every(id => hand.some(c => c.id === id))
  const holdsAllTens = failTens.every(id => hand.some(c => c.id === id))

  if (holdsAllAces && holdsAllTens) return [...failAces, ...failTens]
  if (holdsAllAces) return [...failAces]
  return []
}

// Returns 2 card IDs whose burial voids a non-trump suit with combined points >= 11,
// or null if no qualifying void exists.
//
// For a 1-card suit: pairs the suit card with the highest-point eligible card from any
// other suit (chosen for point value, not secondary voiding).
// Among qualifying pairs, returns the highest-total pair.
// Respects mustHold restrictions (same logic as decideBury).
export function bestVoidBury(hand) {
  const mustHold = computeMustHold(hand)

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

// ─── Void analysis (fail suits) ──────────────────────────────────────────────

// Returns Map<userId, Set<suit>> — a map of player IDs to the set of fail suits
// they are known to be void in, deduced from completed trick history.
//
// Logic: for each completed trick where the led card is a visible fail card (not trump),
// any subsequent player whose played card's effectiveSuit differs from the led suit is
// marked void in the led suit. This covers both playing off-suit fail AND trumping in
// (both prove void in the led fail suit).
//
// Only view.tricks (completed tricks) are scanned — not view.currentTrick.
function deducedNonTrumpVoids(view) {
  const voids = new Map()
  for (const trick of (view.tricks ?? [])) {
    const plays = trick.plays
    if (!plays || plays.length === 0) continue
    const led = plays[0].card
    if (!led || led.hidden) continue          // hidden led card — skip trick
    if (isTrump(led)) continue               // trump led — no fail-suit info
    const ledSuit = effectiveSuit(led)        // fail suit that was led
    for (let i = 1; i < plays.length; i++) {
      const play = plays[i]
      if (!play.card || play.card.hidden) continue  // can't see this card
      if (effectiveSuit(play.card) !== ledSuit) {
        // Did not follow the led fail suit → void in that suit
        if (!voids.has(play.userId)) voids.set(play.userId, new Set())
        voids.get(play.userId).add(ledSuit)
      }
    }
  }
  return voids
}

// ─── Void analysis (trump) ────────────────────────────────────────────────────

// Returns a Set<userId> of players known to be void in trump based on completed
// trick history. A player is trump-void if they played a non-trump (non-hidden)
// card on a trick where the led card was trump (non-hidden).
// Scans view.tricks only (not view.currentTrick) because the current trick is
// in-progress and not yet committed to state. Under-card leads are safe: the
// under card has hidden: true, so tricks led by the under card are skipped by
// the existing hidden-led-card guard and never produce false void deductions.
function deducedTrumpVoids(view) {
  const voids = new Set()
  for (const trick of (view.tricks ?? [])) {
    const plays = trick.plays
    if (!plays || plays.length === 0) continue
    const led = plays[0].card
    if (!led || led.hidden) continue           // hidden led card — skip trick
    if (!isTrump(led)) continue               // fail led — no trump info
    for (let i = 1; i < plays.length; i++) {
      const play = plays[i]
      if (!play.card || play.card.hidden) continue  // can't see this card
      if (!isTrump(play.card)) voids.add(play.userId)
    }
  }
  return voids
}

// Returns the array of cards known (via public announcement) to be in the bot's teammate's hand.
// Returns [] if bot is not on picker team, partner is unknown, or no knownLocations present.
function knownTeammateCards(view, userId) {
  if (!view.knownLocations) return []
  const onPickerTeam = userId === view.picker || userId === view.partner
  if (!onPickerTeam) return []
  const teammateId = userId === view.picker ? view.partner : view.picker
  if (!teammateId) return []
  return view.knownLocations.get(teammateId) ?? []
}

// ─── Guaranteed-winner inference ──────────────────────────────────────────────

// Returns true iff `card` cannot be beaten by any opponent:
//
// For trump cards: every trump with a strictly lower trumpRank index (i.e. higher
//   strength) must be accounted for (visible in own hand, played tricks, current
//   trick, bury, or known to be in a teammate's hand via knownLocations).
//
// For non-trump (fail) cards: BOTH conditions must hold:
//   1. Every same-suit non-trump card with a lower suitRank index (i.e. higher
//      strength) must be accounted for in: own hand, completed tricks (non-hidden),
//      current trick (non-hidden), or bury (non-hidden).
//   2. No opponent can trump it — satisfied if either:
//      a. trumpRemainingElsewhere(view, userId) − knownTeammateTrump === 0 (all trump
//         accounted for after subtracting known teammate trump from knownLocations), OR
//      b. Every other player is in the deducedTrumpVoids set.
//
// Unseen higher trump / higher same-suit cards not in a known teammate's hand are
// treated as opponent-held.
//
// NOTE — currentTrick is included in the "seen" sources. Callers should use this
// function either (a) when leading (currentTrick is empty) or (b) when `card` is
// the currently-winning card in the trick, so that including currentTrick cards in
// the accounting does not conflate the question "can this card be beaten?" with
// cards already played against it.
//
// NOTE — For non-trump cards, Condition 2 reads `view.resolvedTrumpRemaining` and
// `view.resolvedTrumpVoids` directly. `view` must be a resolved view produced by
// `resolveView(rawView, userId)` — plain views will crash on non-trump cards.
// The trump branch does not read these fields and is safe with plain views.
export function isGuaranteedWinner(card, view, userId) {
  if (!isTrump(card)) {
    // ── Condition 1: no higher same-suit card is unaccounted for ─────────────
    const mySuitRank = suitRank(card)
    if (mySuitRank === 0) {
      // Ace is the highest non-trump card; no need to check for higher same-suit
    } else {
      // Collect seen suitRank indices for same-suit non-trump cards from all sources.
      // SUIT_RANK_ORDER = ['A','10','K','9','8','7'] so rank 0 = Ace (strongest).
      // We need every rank index in 0..mySuitRank-1 to appear at least once.
      const seenSuitRanks = new Set()
      for (const c of (view.hands[userId] ?? [])) {
        if (!c || c.hidden || isTrump(c) || c.suit !== card.suit) continue
        seenSuitRanks.add(suitRank(c))
      }
      for (const trick of (view.tricks ?? [])) {
        for (const play of trick.plays) {
          const c = play.card
          if (!c || c.hidden || isTrump(c) || c.suit !== card.suit) continue
          seenSuitRanks.add(suitRank(c))
        }
      }
      for (const play of (view.currentTrick ?? [])) {
        const c = play.card
        if (!c || c.hidden || isTrump(c) || c.suit !== card.suit) continue
        seenSuitRanks.add(suitRank(c))
      }
      for (const c of (view.buried ?? [])) {
        if (!c || c.hidden || isTrump(c) || c.suit !== card.suit) continue
        seenSuitRanks.add(suitRank(c))
      }

      // Every rank strictly lower than mySuitRank (= stronger fail cards) must be seen.
      for (let r = 0; r < mySuitRank; r++) {
        if (!seenSuitRanks.has(r)) return false
      }
    }

    // ── Condition 2: no opponent can trump it ─────────────────────────────────
    const playedOrBuriedIds = new Set()
    for (const t of (view.tricks ?? [])) {
      for (const p of t.plays) { if (p.card?.id) playedOrBuriedIds.add(p.card.id) }
    }
    for (const p of (view.currentTrick ?? [])) { if (p.card?.id) playedOrBuriedIds.add(p.card.id) }
    for (const c of (view.buried ?? [])) { if (c?.id) playedOrBuriedIds.add(c.id) }
    const knownTeammateTrump = knownTeammateCards(view, userId)
      .filter(c => isTrump(c) && !playedOrBuriedIds.has(c.id))
      .length
    const noTrumpElsewhere = view.resolvedTrumpRemaining - knownTeammateTrump === 0
    if (!noTrumpElsewhere) {
      const voids = view.resolvedTrumpVoids
      const otherPlayerIds = Object.keys(view.hands).filter(id => id !== userId)
      const allOthersVoid = otherPlayerIds.length > 0 && otherPlayerIds.every(id => voids.has(id))
      if (!allOthersVoid) return false
    }

    return true
  }
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

  // Also treat trump in a known teammate's hand as accounted for.
  // No played/buried filter needed: seenRanks is a Set so double-adding a rank is harmless.
  for (const c of knownTeammateCards(view, userId)) noteIfHigherTrump(c)

  // Every rank strictly lower than myRank must be seen somewhere.
  for (let r = 0; r < myRank; r++) {
    if (!seenRanks.has(r)) return false
  }
  return true
}

// Returns the card in `candidates` with the lowest point value for which
// isGuaranteedWinner returns true. Tiebreak by trump rank (weaker/higher-index first,
// matching cheapestWinningTrump conventions). Returns null if no card qualifies.
export function cheapestGuaranteedWin(candidates, view, userId) {
  const eligible = candidates.filter(card => isGuaranteedWinner(card, view, userId))
  if (eligible.length === 0) return null
  return eligible.reduce((best, c) => {
    const bestPts = cardPoints(best)
    const cPts = cardPoints(c)
    if (cPts !== bestPts) return cPts < bestPts ? c : best
    // Tie on points: prefer weaker trump (higher rank index = weaker).
    const bestTrump = isTrump(best)
    const cTrump = isTrump(c)
    if (cTrump && bestTrump) return trumpRank(c) > trumpRank(best) ? c : best
    return best
  })
}

// ─── Partner deduction ────────────────────────────────────────────────────────

// Returns the set of userIds known not to be the partner, derived from public
// information available in the view. Used by deducedPartner to identify the
// partner once the rule-out set covers 3 of the 4 non-picker seats.
//
// Signals:
//   - The picker is always ruled out.
//   - The bot itself, if not on the picker team (view.partner !== userId).
//   - The cracker, if view.crackerId is set.
//   - Any player who played a non-called card on a called-suit-led trick before
//     the called card was played in that trick.
//
// Hidden cards in tricks are treated as unknown (no deduction).
// Leasters / no-picker hands return an empty set.
export function knownNonPartners(view, userId) {
  const set = new Set()
  if (!view.picker) return set  // leaster / no-picker hand
  set.add(view.picker)
  if (view.partner !== userId && view.picker !== userId) {
    set.add(userId)
  }
  if (view.crackerId) set.add(view.crackerId)

  const calledCardId = getCalledCardId(view)
  if (!view.calledSuit || !calledCardId) return set

  const scanTrick = (plays) => {
    if (!plays || plays.length === 0) return
    const first = plays[0]
    if (!first.card || first.card.hidden) return
    const ledSuit = first.declaredSuit ?? effectiveSuit(first.card)
    if (ledSuit !== view.calledSuit) return
    let calledCardSeen = false
    for (const play of plays) {
      if (calledCardSeen) return  // plays after the called card carry no info
      if (!play.card || play.card.hidden) continue
      if (play.card.id === calledCardId) {
        calledCardSeen = true
        continue
      }
      set.add(play.userId)
    }
  }

  for (const trick of (view.tricks ?? [])) scanTrick(trick.plays)
  scanTrick(view.currentTrick ?? [])

  return set
}

// Returns the partner's userId if known, else null. Resolution order:
//   1. view.partner if set (engine-revealed, or bot is on picker team).
//   2. view.recrackerId if set and not the picker (non-picker recrackers are
//      uniquely the partner per the recrack rule in gameEngine.js).
//   3. By elimination via knownNonPartners — if the rule-out set covers exactly
//      3 of the 4 non-picker seats, the remaining seat is the partner.
//   4. Otherwise, null.
//
// Returns null in alone/leaster/no-picker modes regardless of signals.
function deducedPartner(view, userId) {
  if (!view.picker || view.goingAlone || view.isLeaster) return null
  if (view.partner) return view.partner
  if (view.recrackerId && view.recrackerId !== view.picker) return view.recrackerId

  const ruled = knownNonPartners(view, userId)
  const allIds = Object.keys(view.hands ?? {})
  const candidates = allIds.filter(id => id !== view.picker && !ruled.has(id))
  if (candidates.length === 1) return candidates[0]
  return null
}

// ─── Schmear detection ────────────────────────────────────────────────────────

// Returns true if the player currently winning the trick is on the same team as userId.
// Picker-team bots: teammate = picker or partner.
// Opponent bots: only returns true when partner identity is known AND winner is confirmed opponent.
//   If partner is null (identity not yet deduced), returns false — unsafe to schmear.
export function teammateWinning(view, userId) {
  const { currentTrick, picker } = view
  if (!currentTrick || currentTrick.length === 0) return false

  const partner = view.resolvedPartner

  const winner = currentWinner(currentTrick)
  if (!winner) return false
  const winnerId = winner.userId

  const onPickerTeam = userId === picker || userId === partner

  if (onPickerTeam) {
    return winnerId === picker || winnerId === partner
  } else {
    if (partner === null) {
      // When picker went alone there is no partner — any non-picker winner is a teammate.
      if (view.goingAlone) return winnerId !== picker
      return false  // partner identity unknown — cannot confirm teammate
    }
    return winnerId !== picker && winnerId !== partner
  }
}

// ─── Schmear-priority pick ────────────────────────────────────────────────────

// Rank priority for "schmear-self" — when the bot is guaranteed to take the
// trick and is choosing the least-painful winning card to spend.
//
// Order rationale: cash high-point cards (A=11, 10=10, K=4) first, then 0-point
// pip cards (9, 8, 7), then keep tactical strength in reserve (Js before Qs,
// since Q is the top trump rank).
const TRUMP_SCHMEAR_PRIORITY = ['A', '10', 'K', '9', '8', '7', 'J', 'Q']
const FAIL_SCHMEAR_PRIORITY = ['A', '10', 'K', '9', '8', '7']

// Returns the schmear-priority pick from `candidates`, or null if no candidate
// matches any priority rank (or `candidates` is empty).
//
// `kind` ∈ {'trump', 'fail'} selects the priority list.
// `hand` is the bot's full remaining hand — used only for the fail tiebreak
// (prefer card whose suit is shortest in hand to move toward voiding a suit).
//
// Within-rank tiebreaks:
//   'trump' → weakest by trump rank (e.g., among Qs: Q♦ over Q♣)
//   'fail'  → shortest non-trump suit in `hand`; secondary tiebreak alphabetical by suit
export function pickBySchmearPriority(candidates, kind, hand) {
  if (!candidates || candidates.length === 0) return null
  const ranks = kind === 'trump' ? TRUMP_SCHMEAR_PRIORITY : FAIL_SCHMEAR_PRIORITY

  for (const rank of ranks) {
    const matches = candidates.filter(card => card.rank === rank)
    if (matches.length === 0) continue
    if (matches.length === 1) return matches[0]

    if (kind === 'trump') {
      // Weakest by trump rank = highest trumpRank index value
      return matches.reduce((best, card) =>
        trumpRank(card) > trumpRank(best) ? card : best
      )
    }

    // 'fail' tiebreak: shortest non-trump suit in hand, then alphabetical
    const nonTrumpHand = (hand ?? []).filter(card => !card.hidden && !isTrump(card))
    const suitCount = {}
    for (const card of nonTrumpHand) {
      suitCount[card.suit] = (suitCount[card.suit] ?? 0) + 1
    }
    return matches.reduce((best, card) => {
      const cCount = suitCount[card.suit] ?? 0
      const bestCount = suitCount[best.suit] ?? 0
      if (cCount !== bestCount) return cCount < bestCount ? card : best
      return card.suit < best.suit ? card : best
    })
  }

  return null
}

// Returns the count of opposing players (not picker team, not self) who haven't
// yet played in the current trick.
export function opponentsRemaining(currentTrick, view, userId, picker, partner) {
  const played = new Set(currentTrick.map(p => p.userId))
  return Object.keys(view.hands).filter(id =>
    !played.has(id) && id !== userId && id !== picker && id !== partner
  ).length
}
