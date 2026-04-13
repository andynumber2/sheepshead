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

// Schwanzer point value — used only when scoring a Schwanzer no-pick hand
// Queens=3, Jacks=2, diamond pips (non-Q, non-J, suit=D)=1, all else=0
export function schwanzerCardPoints(card) {
  if (card.rank === 'Q') return 3
  if (card.rank === 'J') return 2
  if (card.suit === 'D') return 1
  return 0
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

  // Detect potential blitzes: a player holding 2 queens of the same color may blitz
  const potentialBlitzes = []
  for (const pid of playerIds) {
    const hand = hands[pid]
    const hasQC = hand.some(c => c.id === 'QC')
    const hasQS = hand.some(c => c.id === 'QS')
    const hasQH = hand.some(c => c.id === 'QH')
    const hasQD = hand.some(c => c.id === 'QD')
    if (hasQC && hasQS) potentialBlitzes.push({ userId: pid, type: 'black' })
    else if (hasQH && hasQD) potentialBlitzes.push({ userId: pid, type: 'red' })
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
    calledAce: null,           // { suit, aceId, unknown? } — set for ace and ace-unknown calls
    calledTen: null,           // { suit, tenId } — set when picker holds all 3 fail aces
    calledKing: null,          // { suit, kingId } — set when picker holds all 3 fail aces and tens
    calledSuit: null,          // 'C'|'H'|'S' — unifying field across all call types
    callMode: null,            // null | 'ace' | 'ten' | 'king'
    underCard: null,           // { id, suit, rank, ownerId, played } — server-side full info
    pickerMustHold: [],        // card ids the picker may not bury during discard
    pickerForcedPlays: [],     // card ids the picker must play when called suit is led
    partnerRevealed: false,
    goingAlone: false,
    blind,
    discard: [],               // picker's 2 discarded cards
    hands,                     // { userId: [cards] }
    tricks: [],                // completed tricks: [{ leader, plays: [{userId, card}], winner }]
    currentTrick: [],          // in-progress: [{userId, card}]
    lastTrick: [],             // last completed trick — shown between tricks
    currentLeader: null,       // userId who leads next trick
    handCrackMultiplier: 1,    // 1 | 2 | 4 — crack/recrack multiplier for this hand only
    crackState: null,          // null | 'cracked' | 'recracked'
    potentialBlitzes,          // [{ userId, type: 'black'|'red' }] — players who may blitz
    blitzes: [],               // [{ userId, type: 'black'|'red' }] — players who declared a blitz
    log: [],                   // string messages
    scores: {},                // { userId: delta } — populated at scoring
    rewindHistory: [],         // card play snapshots for rewinding
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

export function blitz(state, userId) {
  assertPhase(state, 'picking')
  assertTurn(state, userId, currentPicker(state))

  const potentialBlitz = (state.potentialBlitzes ?? []).find(b => b.userId === userId)
  if (!potentialBlitz) {
    throw new Error('Cannot blitz — you do not hold 2 queens of the same color.')
  }

  const newState = deepClone(state)
  newState.picker = userId
  newState.blitzes = [...(newState.blitzes ?? []), { userId, type: potentialBlitz.type }]

  // Give picker the blind
  newState.hands[userId] = [...newState.hands[userId], ...newState.blind]
  newState.blind = []
  newState.phase = 'discarding'
  newState.log.push(`${userId} ${potentialBlitz.type === 'black' ? 'Black' : 'Red'} Blitzed!`)

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

  // Determine calling mode based on the picker's 8-card hand BEFORE discard
  const failAces = ['AC', 'AH', 'AS']
  const failTens = ['10C', '10H', '10S']
  const holdsAllAces = failAces.every(id => hand.some(c => c.id === id))
  const holdsAllTens = failTens.every(id => hand.some(c => c.id === id))

  let mustHold = []
  let callMode = 'ace'
  if (holdsAllAces && holdsAllTens) {
    mustHold = [...failAces, ...failTens]
    callMode = 'king'
  } else if (holdsAllAces) {
    mustHold = [...failAces]
    callMode = 'ten'
  }

  // Reject discards that bury cards the picker must keep for the partner call
  for (const cid of cardIds) {
    if (mustHold.includes(cid)) {
      throw new Error(`Cannot bury ${cid} — must keep for partner call.`)
    }
  }

  const discarded = []
  for (const cid of cardIds) {
    const idx = hand.findIndex(c => c.id === cid)
    if (idx === -1) throw new Error(`Card ${cid} not in hand.`)
    discarded.push(hand.splice(idx, 1)[0])
  }

  newState.discard = discarded
  newState.pickerMustHold = mustHold
  newState.callMode = callMode
  newState.phase = 'calling'
  newState.log.push(`${userId} discarded 2 cards.`)

  return newState
}

// ─── Calling phase ───────────────────────────────────────────────────────────
function findHolder(hands, cardId, exclude) {
  for (const [pid, hand] of Object.entries(hands)) {
    if (pid === exclude) continue
    if (hand.some(c => c.id === cardId)) return pid
  }
  return null
}

export function callAce(state, userId, suit) {
  assertPhase(state, 'calling')
  if (state.picker !== userId) throw new Error('Only the picker calls the ace.')
  if (state.callMode !== 'ace') throw new Error(`Picker must call a ${state.callMode}, not an ace.`)
  if (!['C', 'H', 'S'].includes(suit)) throw new Error('Must call a non-trump suit ace.')

  const aceId = `A${suit}`
  if (state.hands[userId].some(c => c.id === aceId)) {
    throw new Error(`Picker holds the ${aceId} — cannot call it.`)
  }
  if (state.discard.some(c => c.id === aceId)) {
    throw new Error(`Picker buried the ${aceId} — cannot call it.`)
  }

  // Picker must hold at least one fail card of the called suit (called-suit holding rule).
  // If they don't, they must use call_ace_unknown with an under card instead.
  const failOfSuit = state.hands[userId].filter(c => c.suit === suit && !isTrump(c))
  if (failOfSuit.length === 0) {
    throw new Error(`Cannot call A${suit} normally — picker holds no fail card of that suit. Use call_ace_unknown.`)
  }

  const newState = deepClone(state)
  newState.calledAce = { suit, aceId }
  newState.calledSuit = suit
  newState.partner = findHolder(newState.hands, aceId, userId)
  newState.phase = 'playing'
  newState.currentLeader = newState.pickOrder[0]
  newState.log.push(`${userId} called the A${suit}.`)
  return newState
}

// Picker chooses to go alone instead of calling a partner. Available in any call mode.
// No partner is selected; picker plays solo against the other four.
export function goAlone(state, userId) {
  assertPhase(state, 'calling')
  if (state.picker !== userId) throw new Error('Only the picker can go alone.')

  const newState = deepClone(state)
  newState.goingAlone = true
  newState.partner = null
  newState.calledAce = null
  newState.calledTen = null
  newState.calledKing = null
  newState.calledSuit = null
  newState.pickerForcedPlays = []
  newState.phase = 'playing'
  newState.currentLeader = newState.pickOrder[0]
  newState.log.push(`${userId} is going alone.`)
  return newState
}

// Situation B: picker calls an ace of a suit in which they hold no fail card,
// placing one card from their hand face-down on the table as the "under card."
export function callAceUnknown(state, userId, suit, underCardId) {
  assertPhase(state, 'calling')
  if (state.picker !== userId) throw new Error('Only the picker calls the ace.')
  if (state.callMode !== 'ace') throw new Error(`Picker must call a ${state.callMode}, not an unknown ace.`)
  if (!['C', 'H', 'S'].includes(suit)) throw new Error('Must call a non-trump suit ace.')

  const aceId = `A${suit}`
  if (state.hands[userId].some(c => c.id === aceId)) {
    throw new Error(`Picker holds the ${aceId} — cannot call it.`)
  }
  if (state.discard.some(c => c.id === aceId)) {
    throw new Error(`Picker buried the ${aceId} — cannot call it.`)
  }

  const failOfSuit = state.hands[userId].filter(c => c.suit === suit && !isTrump(c))
  if (failOfSuit.length > 0) {
    throw new Error(`Cannot call A${suit} unknown — picker holds fail card(s) of that suit. Use call_ace.`)
  }

  // Under card calls are only legal when the picker has no normal call available.
  // A normal call exists for any suit whose ace the picker neither holds nor buried,
  // and in which the picker holds at least one fail card.
  const hasNormalCall = ['C', 'H', 'S'].some(s => {
    const a = `A${s}`
    if (state.hands[userId].some(c => c.id === a)) return false
    if (state.discard.some(c => c.id === a)) return false
    return state.hands[userId].some(c => c.suit === s && !isTrump(c))
  })
  if (hasNormalCall) {
    throw new Error('Cannot call an unknown ace when a normal ace call is available.')
  }

  const cardIdx = state.hands[userId].findIndex(c => c.id === underCardId)
  if (cardIdx === -1) throw new Error(`Under card ${underCardId} not in hand.`)

  const newState = deepClone(state)
  const card = newState.hands[userId].splice(cardIdx, 1)[0]
  newState.underCard = { id: card.id, suit: card.suit, rank: card.rank, ownerId: userId, played: false }
  newState.calledAce = { suit, aceId, unknown: true }
  newState.calledSuit = suit
  newState.partner = findHolder(newState.hands, aceId, userId)
  newState.phase = 'playing'
  newState.currentLeader = newState.pickOrder[0]
  newState.log.push(`${userId} called A${suit} Unknown and placed an under card.`)
  return newState
}

// Situation A: picker holds all 3 fail aces and calls the 10 of a fail suit
// whose 10 they do not hold. Picker is forced to play that suit's Ace when the
// called suit is led; partner plays the called 10.
export function callTen(state, userId, suit) {
  assertPhase(state, 'calling')
  if (state.picker !== userId) throw new Error('Only the picker calls the ten.')
  if (state.callMode !== 'ten') throw new Error(`Picker must call a ${state.callMode}, not a ten.`)
  if (!['C', 'H', 'S'].includes(suit)) throw new Error('Must call a non-trump suit ten.')

  const tenId = `10${suit}`
  if (state.hands[userId].some(c => c.id === tenId)) {
    throw new Error(`Picker holds the ${tenId} — cannot call it.`)
  }
  if (state.discard.some(c => c.id === tenId)) {
    throw new Error(`Picker buried the ${tenId} — cannot call it.`)
  }

  const newState = deepClone(state)
  newState.calledTen = { suit, tenId }
  newState.calledSuit = suit
  newState.pickerForcedPlays = [`A${suit}`]
  newState.partner = findHolder(newState.hands, tenId, userId)
  newState.phase = 'playing'
  newState.currentLeader = newState.pickOrder[0]
  newState.log.push(`${userId} called the ${tenId}.`)
  return newState
}

// King escalation of Situation A: picker holds all 3 fail aces and all 3 fail tens
// and calls the King of any fail suit. Picker plays the Ace and 10 of the called
// suit when that suit is led (in either order).
export function callKing(state, userId, suit) {
  assertPhase(state, 'calling')
  if (state.picker !== userId) throw new Error('Only the picker calls the king.')
  if (state.callMode !== 'king') throw new Error(`Picker must call a ${state.callMode}, not a king.`)
  if (!['C', 'H', 'S'].includes(suit)) throw new Error('Must call a non-trump suit king.')

  const kingId = `K${suit}`
  if (state.hands[userId].some(c => c.id === kingId)) {
    throw new Error(`Picker holds the ${kingId} — cannot call it.`)
  }
  if (state.discard.some(c => c.id === kingId)) {
    throw new Error(`Picker buried the ${kingId} — cannot call it.`)
  }

  const newState = deepClone(state)
  newState.calledKing = { suit, kingId }
  newState.calledSuit = suit
  newState.pickerForcedPlays = [`A${suit}`, `10${suit}`]
  newState.partner = findHolder(newState.hands, kingId, userId)
  newState.phase = 'playing'
  newState.currentLeader = newState.pickOrder[0]
  newState.log.push(`${userId} called the ${kingId}.`)
  return newState
}

// ─── Crack / Recrack ─────────────────────────────────────────────────────────
// Opponents crack before the first card is played to double the hand's stakes.
// Picker/partner can recrack to double again (×4 total on top of doublerMultiplier).
// Cracking is unavailable in leasters (no teams).

function assertCrackWindow(state) {
  assertPhase(state, 'playing')
  if (state.isLeaster) throw new Error('Cannot crack during a leaster.')
  if (state.tricks.length > 0 || state.currentTrick.length > 0) {
    throw new Error('Cracking window is closed once the first card is played.')
  }
}

function isOpponent(state, userId) {
  return userId !== state.picker && userId !== state.partner
}

export function crack(state, userId) {
  assertCrackWindow(state)
  if (!isOpponent(state, userId)) throw new Error('Only opponents may crack.')
  if (state.crackState !== null) throw new Error('Already cracked.')
  const passedAtPicking = state.pickOrder.slice(0, state.pickIndex)
  if (passedAtPicking.includes(userId)) throw new Error('Cannot crack — you passed at picking.')

  const newState = deepClone(state)
  newState.crackState = 'cracked'
  newState.handCrackMultiplier = 2
  newState.log.push(`${userId} cracked! Hand stakes ×2.`)
  return newState
}

export function recrack(state, userId) {
  assertCrackWindow(state)
  if (isOpponent(state, userId)) throw new Error('Only the picker or partner may recrack.')
  if (state.crackState !== 'cracked') throw new Error('Can only recrack after a crack.')

  const newState = deepClone(state)
  newState.crackState = 'recracked'
  newState.handCrackMultiplier = 4
  newState.log.push(`${userId} recracked! Hand stakes ×4.`)
  return newState
}

// ─── Play card ───────────────────────────────────────────────────────────────
// Sentinel id used by clients to play the under card (its real id is hidden from them)
export const UNDER_CARD_ID = 'UNDER_CARD'

export function playCard(state, userId, cardId) {
  assertPhase(state, 'playing')
  assertTurn(state, userId, currentPlayer(state))

  // Capture pre-play snapshot. Strip rewindHistory to prevent exponential nesting.
  const snapshot = deepClone(state)
  snapshot.rewindHistory = []

  const newState = deepClone(state)
  newState.rewindHistory = [...(state.rewindHistory ?? []), snapshot]

  const isUnderCardPlay =
    newState.underCard &&
    !newState.underCard.played &&
    userId === newState.picker &&
    (cardId === UNDER_CARD_ID || cardId === newState.underCard.id)

  let card
  if (isUnderCardPlay) {
    validateUnderCardPlay(newState, userId)
    const uc = newState.underCard
    card = { id: uc.id, suit: uc.suit, rank: uc.rank, faceDown: true, hidden: true }
    newState.underCard.played = true

    const isLead = newState.currentTrick.length === 0
    const entry = { userId, card, faceDown: true }
    if (isLead) entry.declaredSuit = newState.calledSuit
    newState.currentTrick.push(entry)
    newState.log.push(`${userId} played the under card.`)
  } else {
    const hand = newState.hands[userId]
    const cardIdx = hand.findIndex(c => c.id === cardId)
    if (cardIdx === -1) throw new Error(`Card ${cardId} not in hand.`)
    card = hand[cardIdx]

    validatePlay(newState, userId, card)

    hand.splice(cardIdx, 1)
    newState.currentTrick.push({ userId, card })

    // Track picker's forced plays (Situation A / King case)
    if (userId === newState.picker && newState.pickerForcedPlays.includes(card.id)) {
      newState.pickerForcedPlays = newState.pickerForcedPlays.filter(id => id !== card.id)
    }

    newState.log.push(`${userId} played ${card.id}.`)
  }

  // Reveal partner if they just played the called ace/ten/king
  if (!newState.partnerRevealed) {
    const calledCardId =
      newState.calledAce?.aceId ||
      newState.calledTen?.tenId ||
      newState.calledKing?.kingId
    if (calledCardId && card.id === calledCardId && userId === newState.partner) {
      newState.partnerRevealed = true
      newState.log.push(`${userId} revealed as partner by playing the ${card.id}.`)
    }
  }

  if (newState.currentTrick.length === 5) {
    const ledSuit = getLedSuit(newState.currentTrick, newState)
    const winner = resolveTrick(newState.currentTrick, ledSuit)
    newState.tricks.push({
      leader: newState.currentLeader,
      plays: [...newState.currentTrick],
      winner,
    })
    newState.lastTrick = [...newState.currentTrick]
    newState.currentTrick = []
    newState.currentLeader = winner
    newState.log.push(`${winner} won the trick.`)

    if (newState.tricks.length === 6) {
      newState.phase = 'scoring'
      newState.scores = computeScores(newState)
    }
  }

  return newState
}

// ─── Rewind ──────────────────────────────────────────────────────────────────
export function rewindPlay(state) {
  assertPhase(state, 'playing')
  const history = state.rewindHistory ?? []
  if (history.length === 0) throw new Error('Nothing to rewind.')

  const remaining = history.slice(0, -1)
  let restored = { ...history[history.length - 1], rewindHistory: remaining }

  // Rewinding to the start of the hand resets crack/recrack state
  if (restored.tricks.length === 0 && restored.currentTrick.length === 0) {
    restored = { ...restored, crackState: null, handCrackMultiplier: 1 }
  }

  return restored
}

export function rewindTrick(state) {
  assertPhase(state, 'playing')
  const history = state.rewindHistory ?? []
  if (history.length === 0) return state  // no-op at start of hand

  let entries = [...history]
  let poppedSnapshot

  // Pop snapshots until we land at the start of a trick (currentTrick empty).
  // Works for both mid-trick and start-of-trick cases: if we're already at
  // currentTrick=[], the first pop goes back into the previous trick's plays,
  // then we keep popping until we hit the previous trick's start.
  do {
    poppedSnapshot = entries[entries.length - 1]
    entries = entries.slice(0, -1)
  } while (entries.length > 0 && poppedSnapshot.currentTrick.length > 0)

  const restored = { ...poppedSnapshot, rewindHistory: entries }

  // Rewinding to the start of the hand resets crack/recrack state
  if (restored.tricks.length === 0) {
    return { ...restored, crackState: null, handCrackMultiplier: 1 }
  }

  return restored
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

// Determine the led suit for the current trick. When the under card is the lead,
// the picker has declared the called suit, so we use that instead of the (hidden) card's suit.
function getLedSuit(trick, state) {
  if (!trick || trick.length === 0) return null
  const first = trick[0]
  if (first.declaredSuit) return first.declaredSuit
  return effectiveSuit(first.card)
}

function validatePlay(state, userId, card) {
  const trick = state.currentTrick

  // Partner cannot lead the called suit unless they lead with the called card
  if (trick.length === 0) {
    const calledCardId =
      state.calledAce?.aceId || state.calledTen?.tenId || state.calledKing?.kingId
    if (
      calledCardId &&
      userId === state.partner &&
      !state.partnerRevealed &&
      effectiveSuit(card) === state.calledSuit &&
      card.id !== calledCardId
    ) {
      throw new Error(`Partner cannot lead the called suit without playing ${calledCardId}.`)
    }
    return
  }

  const ledSuit = getLedSuit(trick, state)
  const hand = state.hands[userId]

  // If the picker still has an under card and the called suit is led, they MUST play the under card
  if (
    userId === state.picker &&
    state.underCard &&
    !state.underCard.played &&
    ledSuit === state.calledSuit
  ) {
    throw new Error('Picker must play the under card when the called suit is led.')
  }

  const hasSuit = hand.some(c => effectiveSuit(c) === ledSuit)

  // Must follow suit if possible
  if (hasSuit && effectiveSuit(card) !== ledSuit) {
    throw new Error(`Must follow suit (${ledSuit}).`)
  }

  // Partner must play the called card (ace/ten/king) when called suit is led
  const calledCardId =
    state.calledAce?.aceId || state.calledTen?.tenId || state.calledKing?.kingId
  if (
    calledCardId &&
    userId === state.partner &&
    !state.partnerRevealed &&
    ledSuit === state.calledSuit
  ) {
    const hasCalled = hand.some(c => c.id === calledCardId)
    if (hasCalled && card.id !== calledCardId) {
      throw new Error(`Partner must play ${calledCardId} when the called suit is led.`)
    }
  }

  // Called card cannot be played unless the called suit is led
  // (except when it's the player's only remaining card)
  if (
    calledCardId &&
    card.id === calledCardId &&
    ledSuit !== state.calledSuit &&
    hand.some(c => c.id !== calledCardId)
  ) {
    throw new Error(`Cannot play ${calledCardId} unless the called suit is led.`)
  }

  // Picker forced plays (Situation A / King case): when called suit led, picker must
  // play one of the still-held forced cards (Ace, or Ace/Ten in either order).
  if (
    userId === state.picker &&
    state.pickerForcedPlays?.length > 0 &&
    ledSuit === state.calledSuit
  ) {
    const heldForced = state.pickerForcedPlays.filter(cid => hand.some(c => c.id === cid))
    if (heldForced.length > 0 && !heldForced.includes(card.id)) {
      throw new Error(
        `Picker must play ${heldForced.join(' or ')} when the called suit is led.`
      )
    }
  }
}

// Validate that the picker is allowed to play the under card right now.
function validateUnderCardPlay(state, userId) {
  if (userId !== state.picker) throw new Error('Only the picker may play the under card.')
  if (!state.underCard || state.underCard.played) {
    throw new Error('No under card to play.')
  }

  const trick = state.currentTrick
  if (trick.length === 0) {
    // Leading: legal — declares the called suit as the led suit
    return
  }

  // Following: only legal if the called suit was led, OR the picker has no other cards
  // (last-trick fallback when called suit was never led).
  const ledSuit = getLedSuit(trick, state)
  if (ledSuit === state.calledSuit) return
  if (state.hands[userId].length === 0) return

  throw new Error('Under card can only be played when the called suit is led.')
}

function resolveTrick(plays, ledSuit) {
  let winner = null
  for (const play of plays) {
    if (play.card?.faceDown) continue  // face-down under card has no power
    if (winner === null) { winner = play; continue }
    if (beats(play.card, winner.card, ledSuit)) winner = play
  }
  if (winner === null) winner = plays[0]  // all face-down (shouldn't happen)
  return winner.userId
}

function beats(challenger, current, ledSuit) {
  const cTrump = isTrump(challenger)
  const wTrump = isTrump(current)

  if (cTrump && !wTrump) return true
  if (!cTrump && wTrump) return false
  if (cTrump && wTrump) return trumpRank(challenger) < trumpRank(current)

  // Both non-trump: a card of the led suit beats a card not of the led suit.
  const cIsLed = challenger.suit === ledSuit
  const wIsLed = current.suit === ledSuit
  if (cIsLed && !wIsLed) return true
  if (!cIsLed && wIsLed) return false

  if (challenger.suit !== current.suit) return false
  return suitRank(challenger) < suitRank(current)
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
export function computeScores(state) {
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

  const blitzMultiplier = (state.blitzes?.length ?? 0) > 0 ? 2 : 1
  const multiplier = baseMultiplier * doublerMultiplier * (state.handCrackMultiplier ?? 1) * blitzMultiplier

  const scores = {}
  for (const uid of Object.keys(state.hands)) scores[uid] = 0

  if (pickerWon) {
    if (goingAlone) {
      for (const opp of opponents) scores[opp] = -1 * multiplier
      scores[picker] = opponents.length * multiplier
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
      scores[picker] = -opponents.length * multiplier
      for (const opp of opponents) scores[opp] = 1 * multiplier
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

  const fmt = (n) => (n >= 0 ? '+' : '') + n
  let scoreLine = `${picker}: ${fmt(scores[picker])}`
  if (partner) scoreLine += `, ${partner}: ${fmt(scores[partner])}`
  scoreLine += `. Rest ${pickerWon ? 'lost' : 'earned'} ${Math.abs(scores[opponents[0]])}.`
  state.log.push(scoreLine)

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

// ─── Schwanzer ────────────────────────────────────────────────────────────────
// No tricks are played. Each player's dealt hand is scored using Schwanzer point
// values. The player with the most points is the loser (-4); all others gain +1.
// Tie-break: most powerful trump (lowest TRUMP_ORDER index) loses.
// Fallback: if all tied players hold no trump, first tied player in pickOrder loses.
export function resolveSchwanzer(state) {
  const pointsByPlayer = {}
  for (const [uid, hand] of Object.entries(state.hands)) {
    pointsByPlayer[uid] = hand.reduce((sum, card) => sum + schwanzerCardPoints(card), 0)
  }

  const maxPoints = Math.max(...Object.values(pointsByPlayer))
  // Preserve pickOrder sequence so fallback tie-break is deterministic
  const tied = state.pickOrder.filter(uid => pointsByPlayer[uid] === maxPoints)

  function bestTrumpIndex(uid) {
    const trumps = state.hands[uid].filter(c => isTrump(c))
    if (trumps.length === 0) return TRUMP_ORDER.length  // no trump → least powerful
    return Math.min(...trumps.map(c => trumpRank(c)))
  }

  // Among tied players: lowest trump index (most powerful) loses.
  // pickOrder preserves insertion order, so the first element wins the fallback.
  const loser = tied.reduce((worst, uid) =>
    bestTrumpIndex(uid) < bestTrumpIndex(worst) ? uid : worst
  )

  const scores = {}
  for (const uid of Object.keys(state.hands)) {
    scores[uid] = uid === loser ? -4 : 1
  }

  const breakdown = state.pickOrder
    .map(uid => `${uid}: ${pointsByPlayer[uid]}pts`)
    .join(', ')
  state.log.push(`Schwanzer! Points — ${breakdown}. ${loser} had the most and loses.`)

  return { loser, scores }
}

// ─── Player view (redact other hands) ────────────────────────────────────────
export function getPlayerView(state, userId) {
  const view = deepClone(state)
  view.rewindHistory = []   // strip snapshots — each contains all players' unredacted hands

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
  // Discard is visible to the picker (they buried it); hidden to everyone else.
  if (userId !== view.picker) {
    view.discard = view.discard.map(() => ({ id: 'HIDDEN', hidden: true }))
  }

  // Under card: picker (who placed it) can see its identity; other players cannot.
  // Use a sentinel id ('UNDER_CARD') for the redacted form so the client can submit
  // play_card with that id and the server resolves it.
  if (view.underCard) {
    if (userId === view.picker) {
      view.underCard = { ...view.underCard, isUnderCard: true }
    } else {
      view.underCard = {
        id: UNDER_CARD_ID,
        hidden: true,
        isUnderCard: true,
        played: view.underCard.played,
      }
    }
  }

  // Redact face-down plays in currentTrick: the player who played it sees the real card,
  // everyone else sees a hidden card. (Trick winner is unknown until resolution.)
  view.currentTrick = view.currentTrick.map(p => {
    if (!p.faceDown) return p
    if (p.userId === userId) return p
    return { ...p, card: { id: UNDER_CARD_ID, hidden: true, faceDown: true } }
  })

  // Redact face-down plays in completed tricks: the player who played it AND the trick winner
  // can see the real card. Everyone else sees a hidden card.
  view.tricks = view.tricks.map(t => ({
    ...t,
    plays: t.plays.map(p => {
      if (!p.faceDown) return p
      if (p.userId === userId || t.winner === userId) return p
      return { ...p, card: { id: UNDER_CARD_ID, hidden: true, faceDown: true } }
    }),
  }))

  // Redact lastTrick face-down plays the same way (using the most recent completed trick's winner).
  const mostRecent = view.tricks[view.tricks.length - 1]
  view.lastTrick = view.lastTrick.map(p => {
    if (!p.faceDown) return p
    if (p.userId === userId || mostRecent?.winner === userId) return p
    return { ...p, card: { id: UNDER_CARD_ID, hidden: true, faceDown: true } }
  })

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
