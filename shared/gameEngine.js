// ─── Card representation ─────────────────────────────────────────────────────
// { id: 'QC', suit: 'C', rank: 'Q' }
// Suits: C=Clubs, D=Diamonds, H=Hearts, S=Spades
// Ranks: 7 8 9 10 J Q K A

const SUITS = ['C', 'D', 'H', 'S']
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A']

export function createDeck() {
  const deck = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}${suit}`, suit, rank })
    }
  }
  return deck
}

// ─── Trump logic ─────────────────────────────────────────────────────────────
// Trump order (index 0 = highest):
// QC QS QH QD JC JS JH JD AD 10D KD 9D 8D 7D
const TRUMP_ORDER = [
  'QC','QS','QH','QD',
  'JC','JS','JH','JD',
  'AD','10D','KD','9D','8D','7D',
]

export function isTrump(card) {
  return card.rank === 'Q' || card.rank === 'J' || card.suit === 'D'
}

export function trumpRank(card) {
  return TRUMP_ORDER.indexOf(card.id)
}

// Non-trump suit rank (lower index = higher card)
const SUIT_RANK_ORDER = ['A', '10', 'K', '9', '8', '7']
export function suitRank(card) {
  return SUIT_RANK_ORDER.indexOf(card.rank)
}

// Point value of a card
const POINT_VALUES = { A: 11, '10': 10, K: 4, Q: 3, J: 2 }
export function cardPoints(card) {
  return POINT_VALUES[card.rank] ?? 0
}

// Effective suit for following-suit purposes (trump = 'T')
export function effectiveSuit(card) {
  return isTrump(card) ? 'T' : card.suit
}

// ─── Shuffle ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ─── Deal ─────────────────────────────────────────────────────────────────────
// Returns a fresh hand state for a new hand within a game.
// playerIds: array of 5 user IDs in seat order [seat0, seat1, seat2, seat3, seat4]
// dealerSeat: 0-4
// doublerMultiplier: current multiplier (passed in, not modified here)
export function dealHand(playerIds, dealerSeat, handNumber, doublerMultiplier) {
  const deck = shuffle(createDeck())
  const hands = {}
  const blind = deck.slice(0, 2)
  let idx = 2
  for (const pid of playerIds) {
    hands[pid] = deck.slice(idx, idx + 6)
    idx += 6
  }

  // Pick order starts left of dealer
  const pickOrder = []
  for (let i = 1; i <= 5; i++) {
    pickOrder.push(playerIds[(dealerSeat + i) % 5])
  }

  return {
    phase: 'picking',          // picking | discarding | calling | playing | scoring | complete
    handNumber,
    dealerSeat,
    doublerMultiplier,
    pickOrder,
    pickIndex: 0,              // index into pickOrder of whose turn it is to pick/pass
    picker: null,              // userId of picker
    partner: null,             // userId of partner (set when ace is called)
    calledAce: null,           // { suit } e.g. { suit: 'C' }
    partnerRevealed: false,
    goingAlone: false,
    blind,
    discard: [],               // picker's 2 discarded cards
    hands,                     // { userId: [cards] }
    tricks: [],                // completed tricks: [{ leader, plays: [{userId, card}], winner }]
    currentTrick: [],          // in-progress: [{userId, card}]
    currentLeader: null,       // userId who leads next trick
    log: [],                   // string messages
    scores: {},                // { userId: delta } — populated at scoring
  }
}

// ─── Picking phase ───────────────────────────────────────────────────────────
export function pick(state, userId) {
  assertPhase(state, 'picking')
  assertTurn(state, userId, currentPicker(state))

  const newState = deepClone(state)
  newState.picker = userId

  // Give picker the blind
  newState.hands[userId] = [...newState.hands[userId], ...newState.blind]
  newState.blind = []
  newState.phase = 'discarding'
  newState.log.push(`${userId} picked.`)
  return newState
}

export function pass(state, userId) {
  assertPhase(state, 'picking')
  assertTurn(state, userId, currentPicker(state))

  const newState = deepClone(state)
  newState.pickIndex++
  newState.log.push(`${userId} passed.`)

  if (newState.pickIndex >= 5) {
    // All passed
    newState.phase = 'no_pick'
    newState.log.push('All players passed.')
  }
  return newState
}

export function currentPicker(state) {
  return state.pickOrder[state.pickIndex]
}

// ─── Discard phase ───────────────────────────────────────────────────────────
export function discard(state, userId, cardIds) {
  assertPhase(state, 'discarding')
  if (state.picker !== userId) throw new Error('Only the picker can discard.')
  if (!Array.isArray(cardIds) || cardIds.length !== 2) throw new Error('Must discard exactly 2 cards.')

  const newState = deepClone(state)
  const hand = newState.hands[userId]

  const discarded = []
  for (const cid of cardIds) {
    const idx = hand.findIndex(c => c.id === cid)
    if (idx === -1) throw new Error(`Card ${cid} not in hand.`)
    discarded.push(hand.splice(idx, 1)[0])
  }

  newState.discard = discarded
  newState.log.push(`${userId} discarded 2 cards.`)

  // Check if picker holds all non-trump aces → goes alone
  const nonTrumpAces = ['AC', 'AH', 'AS']
  const pickerHasAll = nonTrumpAces.every(aid =>
    newState.hands[userId].some(c => c.id === aid)
  )

  if (pickerHasAll) {
    newState.goingAlone = true
    newState.partner = null
    newState.partnerRevealed = true
    newState.phase = 'playing'
    // Picker leads first trick
    newState.currentLeader = userId
    newState.log.push(`${userId} is going alone (holds all non-trump aces).`)
  } else {
    newState.phase = 'calling'
  }

  return newState
}

// ─── Calling phase ───────────────────────────────────────────────────────────
export function callAce(state, userId, suit) {
  assertPhase(state, 'calling')
  if (state.picker !== userId) throw new Error('Only the picker calls the ace.')
  if (!['C', 'H', 'S'].includes(suit)) throw new Error('Must call a non-trump suit ace.')

  const aceId = `A${suit}`
  // Picker cannot call an ace they hold
  if (state.hands[userId].some(c => c.id === aceId)) {
    throw new Error(`Picker holds the ${aceId} — cannot call it.`)
  }

  const newState = deepClone(state)
  newState.calledAce = { suit, aceId }

  // Identify partner (may be in discard — picker buried it — handled at scoring)
  let partner = null
  for (const [pid, hand] of Object.entries(newState.hands)) {
    if (pid === userId) continue
    if (hand.some(c => c.id === aceId)) {
      partner = pid
      break
    }
  }

  // Partner could be null if ace is buried in picker's discard (picker going with buried ace)
  newState.partner = partner
  newState.phase = 'playing'
  newState.currentLeader = userId  // picker leads first trick
  newState.log.push(`${userId} called the A${suit}.`)
  return newState
}

// ─── Play card ───────────────────────────────────────────────────────────────
export function playCard(state, userId, cardId) {
  assertPhase(state, 'playing')
  assertTurn(state, userId, currentPlayer(state))

  const newState = deepClone(state)
  const hand = newState.hands[userId]
  const cardIdx = hand.findIndex(c => c.id === cardId)
  if (cardIdx === -1) throw new Error(`Card ${cardId} not in hand.`)

  const card = hand[cardIdx]

  // Validate legal play
  validatePlay(newState, userId, card)

  hand.splice(cardIdx, 1)
  newState.currentTrick.push({ userId, card })

  // Reveal partner if they just played the called ace
  if (
    !newState.partnerRevealed &&
    newState.calledAce &&
    card.id === newState.calledAce.aceId
  ) {
    newState.partnerRevealed = true
    newState.log.push(`${userId} revealed as partner by playing the ${card.id}.`)
  }

  newState.log.push(`${userId} played ${card.id}.`)

  if (newState.currentTrick.length === 5) {
    // Resolve trick
    const winner = resolveTrick(newState.currentTrick)
    newState.tricks.push({
      leader: newState.currentLeader,
      plays: [...newState.currentTrick],
      winner,
    })
    newState.currentTrick = []
    newState.currentLeader = winner
    newState.log.push(`${winner} won the trick.`)

    if (newState.tricks.length === 6) {
      // Hand over
      newState.phase = 'scoring'
      newState.scores = computeScores(newState)
    }
  }

  return newState
}

// Who plays next in the current trick?
export function currentPlayer(state) {
  const played = state.currentTrick.map(p => p.userId)
  // Turn order from current leader
  const seats = state.pickOrder  // seat order (0-4 as userIds)
  const leaderIdx = seats.indexOf(state.currentLeader)
  for (let i = 0; i < 5; i++) {
    const uid = seats[(leaderIdx + i) % 5]
    if (!played.includes(uid)) return uid
  }
  return null
}

function validatePlay(state, userId, card) {
  const trick = state.currentTrick
  if (trick.length === 0) return  // Leader can play anything

  const ledSuit = effectiveSuit(trick[0].card)
  const hand = state.hands[userId]
  const hasSuit = hand.some(c => effectiveSuit(c) === ledSuit)

  // Must follow suit if possible
  if (hasSuit && effectiveSuit(card) !== ledSuit) {
    throw new Error(`Must follow suit (${ledSuit}).`)
  }

  // Special rule: if led suit is called suit, partner must play the called ace if they have it
  if (
    state.calledAce &&
    userId === state.partner &&
    !state.partnerRevealed &&
    ledSuit === state.calledAce.suit
  ) {
    const hasCalledAce = hand.some(c => c.id === state.calledAce.aceId)
    if (hasCalledAce && card.id !== state.calledAce.aceId) {
      throw new Error(`Partner must play the called ace (${state.calledAce.aceId}) when that suit is led.`)
    }
  }
}

function resolveTrick(plays) {
  const [first, ...rest] = plays
  let winner = first

  for (const play of rest) {
    if (beats(play.card, winner.card)) {
      winner = play
    }
  }
  return winner.userId
}

function beats(challenger, current) {
  const cTrump = isTrump(challenger)
  const wTrump = isTrump(current)

  if (cTrump && !wTrump) return true
  if (!cTrump && wTrump) return false
  if (cTrump && wTrump) return trumpRank(challenger) < trumpRank(current)

  // Both non-trump: only beats if same suit and higher rank
  if (challenger.suit !== current.suit) return false
  return suitRank(challenger) < suitRank(current)
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
function computeScores(state) {
  const { tricks, picker, partner, goingAlone, discard, doublerMultiplier } = state

  // Gather all trick winners' point piles
  const pointsByPlayer = {}
  for (const uid of Object.keys(state.hands)) {
    pointsByPlayer[uid] = 0
  }

  for (const trick of tricks) {
    const pts = trick.plays.reduce((sum, p) => sum + cardPoints(p.card), 0)
    pointsByPlayer[trick.winner] = (pointsByPlayer[trick.winner] ?? 0) + pts
  }

  // Add buried discard points to picker's pile
  for (const c of discard) {
    pointsByPlayer[picker] = (pointsByPlayer[picker] ?? 0) + cardPoints(c)
  }

  // Sum picker team points
  const pickerTeam = goingAlone ? [picker] : [picker, partner].filter(Boolean)
  const pickerTeamPoints = pickerTeam.reduce((s, uid) => s + (pointsByPlayer[uid] ?? 0), 0)

  const pickerWon = pickerTeamPoints >= 61

  // Trick count for schwarz check
  const pickerTeamTricks = tricks.filter(t => pickerTeam.includes(t.winner)).length
  const opponents = Object.keys(state.hands).filter(uid => !pickerTeam.includes(uid))

  let baseMultiplier = 1
  if (pickerTeamPoints >= 91 || (!pickerWon && pickerTeamPoints <= 29)) baseMultiplier = 2  // schneider
  if (pickerTeamTricks === 6 || pickerTeamTricks === 0) baseMultiplier = 3  // schwarz

  const multiplier = baseMultiplier * doublerMultiplier

  const scores = {}
  for (const uid of Object.keys(state.hands)) scores[uid] = 0

  if (pickerWon) {
    if (goingAlone) {
      for (const opp of opponents) scores[opp] = -2 * multiplier
      scores[picker] = opponents.length * 2 * multiplier
    } else {
      for (const opp of opponents) scores[opp] = -1 * multiplier
      if (partner) {
        scores[picker] = 2 * multiplier
        scores[partner] = 1 * multiplier
      } else {
        // Buried ace — picker effectively alone
        scores[picker] = opponents.length * multiplier
      }
    }
  } else {
    if (goingAlone) {
      scores[picker] = -opponents.length * 2 * multiplier
      for (const opp of opponents) scores[opp] = 2 * multiplier
    } else {
      scores[picker] = -2 * multiplier
      if (partner) scores[partner] = -1 * multiplier
      const payingOpponents = partner ? opponents : Object.keys(state.hands).filter(u => u !== picker)
      for (const opp of payingOpponents) scores[opp] = 1 * multiplier
    }
  }

  state.log.push(
    `Hand over. Picker team (${pickerTeam.join(', ')}) had ${pickerTeamPoints} pts. ` +
    `${pickerWon ? 'Picker wins' : 'Opponents win'}. Multiplier: ×${multiplier}.`
  )

  return scores
}

// ─── Leaster ─────────────────────────────────────────────────────────────────
export function resolveLeaster(state) {
  // Each player who took ≥1 trick is eligible. Fewest points wins.
  const pointsByPlayer = {}
  const tricksByPlayer = {}
  for (const uid of Object.keys(state.hands)) {
    pointsByPlayer[uid] = 0
    tricksByPlayer[uid] = 0
  }

  for (const trick of state.tricks) {
    const pts = trick.plays.reduce((sum, p) => sum + cardPoints(p.card), 0)
    pointsByPlayer[trick.winner] = (pointsByPlayer[trick.winner] ?? 0) + pts
    tricksByPlayer[trick.winner] = (tricksByPlayer[trick.winner] ?? 0) + 1
  }

  // Add points from blind (blind is exposed in leaster — no discard)
  // In leasters, the blind is placed with whoever wins trick 1
  // We handle blind awarding in the action handler

  const eligible = Object.keys(state.hands).filter(uid => tricksByPlayer[uid] > 0)
  if (eligible.length === 0) return { winner: null, scores: {} }

  // Sort: fewest points, then fewest tricks
  eligible.sort((a, b) => {
    if (pointsByPlayer[a] !== pointsByPlayer[b]) return pointsByPlayer[a] - pointsByPlayer[b]
    return tricksByPlayer[a] - tricksByPlayer[b]
  })

  const winner = eligible[0]
  const scores = {}
  for (const uid of Object.keys(state.hands)) {
    scores[uid] = uid === winner ? 4 : -1
  }

  state.log.push(
    `Leaster! ${winner} wins with ${pointsByPlayer[winner]} points in ${tricksByPlayer[winner]} tricks.`
  )

  return { winner, scores }
}

// ─── Player view (redact other hands) ────────────────────────────────────────
export function getPlayerView(state, userId) {
  const view = deepClone(state)

  for (const uid of Object.keys(view.hands)) {
    if (uid !== userId) {
      // Replace each card with its count (hide card identities)
      view.hands[uid] = view.hands[uid].map(() => ({ id: 'HIDDEN', hidden: true }))
    }
  }

  // Hide partner identity until revealed (don't expose to non-partners)
  if (!view.partnerRevealed && view.partner && view.partner !== userId && view.picker !== userId) {
    view.partner = null
  }

  // Hide blind during picking phase
  if (view.phase === 'picking') {
    view.blind = view.blind.map(() => ({ id: 'HIDDEN', hidden: true }))
  }

  // Picker can see blind during picking (they just picked it up — this is after picking)
  // Discard is always hidden
  view.discard = view.discard.map(() => ({ id: 'HIDDEN', hidden: true }))

  return view
}

// ─── Leaster dealing ─────────────────────────────────────────────────────────
// In leasters, the blind cards go to the winner of trick 1
export function setupLeaster(state) {
  const newState = deepClone(state)
  // Expose blind — place it in a pending area, awarded after trick 1
  newState.leasterBlind = newState.blind
  newState.blind = []
  newState.isLeaster = true
  newState.phase = 'playing'
  newState.currentLeader = state.pickOrder[(state.dealerSeat + 1) % 5]
  newState.log.push('Leaster! Each player plays for themselves.')
  return newState
}

// After trick 1 resolves in leaster, award blind points
export function awardLeasterBlind(state) {
  if (!state.leasterBlind || state.tricks.length !== 1) return state
  const newState = deepClone(state)
  const trick1Winner = newState.tricks[0].winner
  // Add blind cards as a phantom play to trick 1 for scoring purposes
  for (const card of newState.leasterBlind) {
    newState.tricks[0].plays.push({ userId: trick1Winner, card })
  }
  newState.leasterBlind = []
  return newState
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function assertPhase(state, phase) {
  if (state.phase !== phase) throw new Error(`Expected phase "${phase}", got "${state.phase}".`)
}

function assertTurn(state, userId, expected) {
  if (userId !== expected) throw new Error(`Not your turn. Expected ${expected}.`)
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
