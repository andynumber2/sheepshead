import { describe, it, expect } from 'vitest'
import { knownNonPartners, deducedPartner, deducedTrumpVoids, isGuaranteedWinner, deducedNonTrumpVoids, knownCardLocations, resolveView } from './botInference.js'

const c = (id, suit, rank) => ({ id, suit, rank })

// Minimal view factory. Five players: p1=picker, p2=partner, p3/p4/p5=opponents.
function baseView(overrides = {}) {
  return {
    phase: 'playing',
    picker: 'p1',
    partner: null,         // redacted from opponents until partnerRevealed
    partnerRevealed: false,
    callMode: 'ace',
    calledSuit: 'H',
    calledAce: { aceId: 'AH' },
    calledTen: null,
    calledKing: null,
    crackerId: null,
    recrackerId: null,
    hands: { p1: [], p2: [], p3: [], p4: [], p5: [] },
    tricks: [],
    currentTrick: [],
    isLeaster: false,
    ...overrides,
  }
}

describe('knownNonPartners', () => {
  it('opponent bot with no signals: rules out picker and self', () => {
    const view = baseView()
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set(['p1', 'p3']))
  })

  it('picker-team bot (partner) with view.partner=self: rules out picker and self', () => {
    const view = baseView({ partner: 'p2' })
    const set = knownNonPartners(view, 'p2')
    // Self is the partner, so self is *not* in the rule-out set; only picker.
    expect(set).toEqual(new Set(['p1']))
  })

  it('crack: cracker added to rule-out set', () => {
    const view = baseView({ crackerId: 'p4' })
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set(['p1', 'p3', 'p4']))
  })

  it('called-suit-led trick: non-called play rules out the player', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: c('KH', 'H', 'K') },
        { userId: 'p1', card: c('7H', 'H', '7') },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    expect(set).toEqual(new Set(['p1', 'p3', 'p4']))
  })

  it('called-suit-led trick where called card has been played: stops elimination for that trick', () => {
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p3', card: c('KH', 'H', 'K') },
          { userId: 'p1', card: c('7H', 'H', '7') },
          { userId: 'p2', card: c('AH', 'H', 'A') },
          { userId: 'p4', card: c('9H', 'H', '9') },
          { userId: 'p5', card: c('8H', 'H', '8') },
        ],
      }],
      partnerRevealed: true,
      partner: 'p2',
    })
    const set = knownNonPartners(view, 'p3')
    expect(set.has('p4')).toBe(false)
    expect(set.has('p5')).toBe(false)
  })

  it('non-called-suit-led trick: no eliminations from it', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: c('KS', 'S', 'K') },
        { userId: 'p1', card: c('7S', 'S', '7') },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    expect(set).toEqual(new Set(['p1', 'p4']))
  })

  it('multiple signals stack (crack + elimination)', () => {
    const view = baseView({
      crackerId: 'p4',
      currentTrick: [
        { userId: 'p3', card: c('KH', 'H', 'K') },
      ],
    })
    const set = knownNonPartners(view, 'p5')
    expect(set).toEqual(new Set(['p1', 'p3', 'p4', 'p5']))
  })

  it('hidden cards in current trick: do not mistake hidden plays for non-called', () => {
    const view = baseView({
      currentTrick: [
        { userId: 'p3', card: { id: 'HIDDEN', hidden: true } },
      ],
    })
    const set = knownNonPartners(view, 'p4')
    expect(set).toEqual(new Set(['p1', 'p4']))
  })

  it('leaster: returns empty set (no picker, no partner concept)', () => {
    const view = baseView({ isLeaster: true, picker: null, callMode: null })
    const set = knownNonPartners(view, 'p3')
    expect(set).toEqual(new Set())
  })
})

describe('deducedPartner', () => {
  it('returns view.partner when set (engine-revealed)', () => {
    const view = baseView({ partner: 'p2', partnerRevealed: true })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('returns recracker when non-picker recracked', () => {
    const view = baseView({ recrackerId: 'p2' })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('does not use recracker when picker recracked (falls through)', () => {
    const view = baseView({ recrackerId: 'p1' })  // p1 is picker
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns the unique remaining seat when 3 of 4 non-picker seats ruled out', () => {
    // Picker = p1. Non-picker seats: p2, p3, p4, p5.
    // Bot = p3 (self, ruled out). p4 cracker (ruled out). p5 played non-called on called-suit lead.
    // Only p2 remains → partner.
    const view = baseView({
      crackerId: 'p4',
      currentTrick: [{ userId: 'p5', card: c('KH', 'H', 'K') }],
    })
    expect(deducedPartner(view, 'p3')).toBe('p2')
  })

  it('returns null when only 2 of 4 non-picker seats ruled out', () => {
    const view = baseView({ crackerId: 'p4' })
    // p1 picker, p3 self, p4 cracker → 2 ruled out (p3, p4 of the 4 non-picker seats); p2 and p5 remain candidates.
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns null when no signals fire', () => {
    const view = baseView()
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns null when picker goes alone (callMode === alone)', () => {
    const view = baseView({ callMode: 'alone', calledSuit: null, calledAce: null, recrackerId: 'p2' })
    expect(deducedPartner(view, 'p3')).toBeNull()
  })

  it('returns self when bot is the partner (view.partner === userId)', () => {
    const view = baseView({ partner: 'p2' })
    expect(deducedPartner(view, 'p2')).toBe('p2')
  })

  it('leaster: returns null', () => {
    const view = baseView({ isLeaster: true, picker: null, callMode: null })
    expect(deducedPartner(view, 'p3')).toBeNull()
  })
})

// ─── Trump card helpers ───────────────────────────────────────────────────────
// QC is the highest trump (trumpRank 0). Fail cards: suit ∈ {C,H,S}, rank ≠ Q/J
// Diamond pip cards (suit D, rank not Q/J) are trump.
// For these tests: trump = QC, QH, JS, 7D (diamond pip = trump)
// Fail = AC (suit C, rank A), KH (suit H, rank K), 10S (suit S, rank 10)

const trump = (id) => ({ id, suit: 'D', rank: '7' })       // generic trump (7D)
const trumpQ = (id) => ({ id, suit: 'C', rank: 'Q' })      // Queen = trump
const failAce = (suit) => ({ id: `A${suit}`, suit, rank: 'A' })
const fail10 = (suit) => ({ id: `10${suit}`, suit, rank: '10' })
const failKing = (suit) => ({ id: `K${suit}`, suit, rank: 'K' })
const fail9 = (suit) => ({ id: `9${suit}`, suit, rank: '9' })

describe('deducedTrumpVoids', () => {
  it('empty tricks → empty set', () => {
    const view = baseView({ tricks: [] })
    expect(deducedTrumpVoids(view)).toEqual(new Set())
  })

  it('trump led, one player played fail → that player in set', () => {
    // Trump (7D) led; p2 follows with trump (fine); p3 follows with fail (void)
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } },   // led: trump
          { userId: 'p2', card: { id: 'QD', suit: 'D', rank: 'Q' } },   // trump: fine
          { userId: 'p3', card: { id: 'AC', suit: 'C', rank: 'A' } },   // fail: void!
          { userId: 'p4', card: { id: 'KH', suit: 'H', rank: 'K' } },   // fail: void!
          { userId: 'p5', card: { id: '9S', suit: 'S', rank: '9' } },   // fail: void!
        ],
      }],
    })
    const voids = deducedTrumpVoids(view)
    expect(voids.has('p3')).toBe(true)
    expect(voids.has('p4')).toBe(true)
    expect(voids.has('p5')).toBe(true)
    expect(voids.has('p1')).toBe(false)
    expect(voids.has('p2')).toBe(false)
  })

  it('trump led, player played trump (followed suit) → NOT in set', () => {
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } },   // led: trump
          { userId: 'p2', card: { id: 'QC', suit: 'C', rank: 'Q' } },   // trump: fine
        ],
      }],
    })
    const voids = deducedTrumpVoids(view)
    expect(voids.has('p2')).toBe(false)
  })

  it('fail led, player played off-suit → NOT in set (only trump-led tricks count)', () => {
    // Fail (AC) led; p2 plays a different fail suit — that tells us nothing about trump
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: 'AC', suit: 'C', rank: 'A' } },   // led: fail
          { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } },   // off-suit fail
        ],
      }],
    })
    const voids = deducedTrumpVoids(view)
    expect(voids.has('p2')).toBe(false)
  })

  it('hidden led card → skip that trick', () => {
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: 'HIDDEN', hidden: true } },        // led: hidden
          { userId: 'p2', card: { id: 'AC', suit: 'C', rank: 'A' } },   // fail, but led card unknown
        ],
      }],
    })
    const voids = deducedTrumpVoids(view)
    expect(voids.has('p2')).toBe(false)
  })

  it('currentTrick is ignored — trump led + fail follow there does not add to void set', () => {
    // Even if a player follows with fail on a trump-led currentTrick,
    // deducedTrumpVoids must not add them: only completed tricks count.
    const view = baseView({
      tricks: [],   // no completed tricks
      currentTrick: [
        { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } },   // led: trump
        { userId: 'p2', card: { id: 'AC', suit: 'C', rank: 'A' } },   // fail — but in-progress
      ],
    })
    const voids = deducedTrumpVoids(view)
    expect(voids.has('p2')).toBe(false)
  })

  it('hidden non-led play in trump-led trick → NOT added to void set', () => {
    // p2's play is face-down; we cannot see the card, so no void deduction.
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } },         // led: trump
          { userId: 'p2', card: { id: 'HIDDEN', hidden: true } },              // can't see this
          { userId: 'p3', card: { id: 'AC', suit: 'C', rank: 'A' } },         // fail → void
        ],
      }],
    })
    const voids = deducedTrumpVoids(view)
    expect(voids.has('p2')).toBe(false)   // hidden — no deduction
    expect(voids.has('p3')).toBe(true)    // visible fail — deduced void
  })
})

describe('isGuaranteedWinner – non-trump extension', () => {
  // Helper: build a view where `trumpRemainingElsewhere(view, userId)` is exactly 0.
  // Formula: 14 − ownTrump − countTrumpPlayed − buriedTrump = 0
  // Put 6 trump in own hand, 6 trump in one completed trick, 2 in buried → 14 total.
  function allTrumpAccountedView(userId, extraOverrides = {}) {
    const ownTrumpCards = [
      { id: 'QC', suit: 'C', rank: 'Q' },
      { id: 'QH', suit: 'H', rank: 'Q' },
      { id: 'QS', suit: 'S', rank: 'Q' },
      { id: 'QD', suit: 'D', rank: 'Q' },
      { id: 'JC', suit: 'C', rank: 'J' },
      { id: 'JH', suit: 'H', rank: 'J' },
    ]
    const tricksCards = [
      { id: 'JS', suit: 'S', rank: 'J' },
      { id: 'JD', suit: 'D', rank: 'J' },
      { id: 'AD', suit: 'D', rank: 'A' },
      { id: '10D', suit: 'D', rank: '10' },
      { id: 'KD', suit: 'D', rank: 'K' },
      { id: '9D', suit: 'D', rank: '9' },
    ]
    const buriedCards = [
      { id: '8D', suit: 'D', rank: '8' },
      { id: '7D', suit: 'D', rank: '7' },
    ]
    const hands = { p1: [], p2: [], p3: [], p4: [], p5: [] }
    hands[userId] = ownTrumpCards
    return {
      phase: 'playing',
      picker: 'p1',
      partner: null,
      partnerRevealed: false,
      callMode: 'ace',
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      hands,
      tricks: [{
        plays: tricksCards.map((card, i) => ({ userId: `p${(i % 5) + 1}`, card })),
      }],
      currentTrick: [],
      buried: buriedCards,
      ...extraOverrides,
    }
  }

  it('fail ace, all other players trump-void → returns true', () => {
    // AC (suit C, rank A) = highest fail card in clubs
    // No other clubs exist as non-trump in the game
    // Make all others trump-void via completed trick history
    const aceOfClubs = { id: 'AC', suit: 'C', rank: 'A' }
    // Trump led in trick, p2/p3/p4/p5 all played fail
    const view = baseView({
      hands: { p1: [aceOfClubs], p2: [], p3: [], p4: [], p5: [] },
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } },   // led trump
          { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } },   // fail → void
          { userId: 'p3', card: { id: '9S', suit: 'S', rank: '9' } },   // fail → void
          { userId: 'p4', card: { id: '8S', suit: 'S', rank: '8' } },   // fail → void
          { userId: 'p5', card: { id: '7S', suit: 'S', rank: '7' } },   // fail → void
        ],
      }],
      currentTrick: [],
      buried: [],
    })
    expect(isGuaranteedWinner(aceOfClubs, view, 'p1')).toBe(true)
  })

  it('fail ace, trump still unaccounted for and not all void → returns false', () => {
    const aceOfClubs = { id: 'AC', suit: 'C', rank: 'A' }
    // No tricks played, no trump exhausted, nobody is void
    const view = baseView({
      hands: { p1: [aceOfClubs], p2: [], p3: [], p4: [], p5: [] },
      tricks: [],
      currentTrick: [],
      buried: [],
    })
    expect(isGuaranteedWinner(aceOfClubs, view, 'p1')).toBe(false)
  })

  it('fail ace, trumpRemainingElsewhere === 0 (all trump played) → returns true even without void deduction', () => {
    const aceOfClubs = { id: 'AC', suit: 'C', rank: 'A' }
    // Build a view where all 14 trump are accounted for; add AC to p1's hand
    const view = allTrumpAccountedView('p1', {
      hands: {
        p1: [
          aceOfClubs,
          { id: 'QC', suit: 'C', rank: 'Q' },
          { id: 'QH', suit: 'H', rank: 'Q' },
          { id: 'QS', suit: 'S', rank: 'Q' },
          { id: 'QD', suit: 'D', rank: 'Q' },
          { id: 'JC', suit: 'C', rank: 'J' },
          { id: 'JH', suit: 'H', rank: 'J' },
        ],
        p2: [], p3: [], p4: [], p5: [],
      },
    })
    expect(isGuaranteedWinner(aceOfClubs, view, 'p1')).toBe(true)
  })

  it('fail 10 where ace has been played, all others trump-void → returns true', () => {
    const tenOfClubs = { id: '10C', suit: 'C', rank: '10' }
    // AC (higher-rank same suit) has been played in a completed trick
    // All other players are trump-void (played fail on trump-led trick)
    const view = baseView({
      hands: { p1: [tenOfClubs], p2: [], p3: [], p4: [], p5: [] },
      tricks: [
        {
          // Trump led, others played fail → all void
          plays: [
            { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } }, // led trump
            { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } }, // fail → void
            { userId: 'p3', card: { id: '9H', suit: 'H', rank: '9' } }, // fail → void
            { userId: 'p4', card: { id: '8H', suit: 'H', rank: '8' } }, // fail → void
            { userId: 'p5', card: { id: '7H', suit: 'H', rank: '7' } }, // fail → void
          ],
        },
        {
          // AC was played in a completed trick (now accounted for)
          plays: [
            { userId: 'p2', card: { id: 'AC', suit: 'C', rank: 'A' } },
            { userId: 'p3', card: { id: '9S', suit: 'S', rank: '9' } },
            { userId: 'p4', card: { id: '8S', suit: 'S', rank: '8' } },
            { userId: 'p5', card: { id: '7S', suit: 'S', rank: '7' } },
            { userId: 'p1', card: { id: 'KS', suit: 'S', rank: 'K' } },
          ],
        },
      ],
      currentTrick: [],
      buried: [],
    })
    expect(isGuaranteedWinner(tenOfClubs, view, 'p1')).toBe(true)
  })

  it('fail 10 where ace NOT yet played → returns false (higher card outstanding)', () => {
    const tenOfClubs = { id: '10C', suit: 'C', rank: '10' }
    // AC exists in game but hasn't been played; make all others trump-void so that
    // only condition 1 (no higher same-suit unseen) is failing
    const view = baseView({
      hands: { p1: [tenOfClubs], p2: [], p3: [], p4: [], p5: [] },
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } }, // led trump
          { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } }, // fail → void
          { userId: 'p3', card: { id: '9H', suit: 'H', rank: '9' } }, // fail → void
          { userId: 'p4', card: { id: '8H', suit: 'H', rank: '8' } }, // fail → void
          { userId: 'p5', card: { id: '7H', suit: 'H', rank: '7' } }, // fail → void
        ],
      }],
      currentTrick: [],
      buried: [],
    })
    // AC has not been seen → condition 1 fails → not a guaranteed winner
    expect(isGuaranteedWinner(tenOfClubs, view, 'p1')).toBe(false)
  })

  it('trump card (existing behavior unchanged) — QC (rank 0) is always a guaranteed winner', () => {
    const qc = { id: 'QC', suit: 'C', rank: 'Q' }
    const view = baseView({
      hands: { p1: [qc], p2: [], p3: [], p4: [], p5: [] },
      tricks: [],
      currentTrick: [],
      buried: [],
    })
    expect(isGuaranteedWinner(qc, view, 'p1')).toBe(true)
  })

  it('trump card (existing behavior unchanged) — lower trump returns false when higher trump unseen', () => {
    // JC is a trump card but higher trumps (QC etc.) are not yet seen
    const jc = { id: 'JC', suit: 'C', rank: 'J' }
    const view = baseView({
      hands: { p1: [jc], p2: [], p3: [], p4: [], p5: [] },
      tricks: [],
      currentTrick: [],
      buried: [],
    })
    expect(isGuaranteedWinner(jc, view, 'p1')).toBe(false)
  })

  it('buried higher same-suit card satisfies condition 1 — fail 10 with buried ace returns true', () => {
    // 10C has suitRank 1 → requires AC (suitRank 0) to be accounted for.
    // AC is in view.buried (picker buried it), so condition 1 is satisfied.
    // All opponents are trump-void (played fail on a trump-led completed trick).
    const tenOfClubs = { id: '10C', suit: 'C', rank: '10' }
    const aceOfClubs = { id: 'AC', suit: 'C', rank: 'A' }
    const view = baseView({
      hands: { p1: [tenOfClubs], p2: [], p3: [], p4: [], p5: [] },
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } }, // led trump
          { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } }, // fail → void
          { userId: 'p3', card: { id: '9S', suit: 'S', rank: '9' } }, // fail → void
          { userId: 'p4', card: { id: '8S', suit: 'S', rank: '8' } }, // fail → void
          { userId: 'p5', card: { id: '7S', suit: 'S', rank: '7' } }, // fail → void
        ],
      }],
      currentTrick: [],
      buried: [aceOfClubs],   // AC buried — satisfies condition 1 for 10C
    })
    expect(isGuaranteedWinner(tenOfClubs, view, 'p1')).toBe(true)
  })

  it('fail King (suitRank 2) — false when only AC played (10C still outstanding)', () => {
    // KC requires both AC (rank 0) and 10C (rank 1) to be accounted for.
    // Only AC has been played → 10C is unaccounted → returns false.
    const kingOfClubs = { id: 'KC', suit: 'C', rank: 'K' }
    const view = baseView({
      hands: { p1: [kingOfClubs], p2: [], p3: [], p4: [], p5: [] },
      tricks: [
        {
          // Trump led — all followers play fail → trump-void
          plays: [
            { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } }, // led trump
            { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } }, // fail → void
            { userId: 'p3', card: { id: '9H', suit: 'H', rank: '9' } }, // fail → void
            { userId: 'p4', card: { id: '8H', suit: 'H', rank: '8' } }, // fail → void
            { userId: 'p5', card: { id: '7H', suit: 'H', rank: '7' } }, // fail → void
          ],
        },
        {
          // AC played — only rank 0 seen; rank 1 (10C) still outstanding
          plays: [
            { userId: 'p2', card: { id: 'AC', suit: 'C', rank: 'A' } },
            { userId: 'p3', card: { id: '9S', suit: 'S', rank: '9' } },
            { userId: 'p4', card: { id: '8S', suit: 'S', rank: '8' } },
            { userId: 'p5', card: { id: '7S', suit: 'S', rank: '7' } },
            { userId: 'p1', card: { id: 'QD', suit: 'D', rank: 'Q' } },
          ],
        },
      ],
      currentTrick: [],
      buried: [],
    })
    expect(isGuaranteedWinner(kingOfClubs, view, 'p1')).toBe(false)
  })

  it('fail King (suitRank 2) — true when both AC and 10C played and all others trump-void', () => {
    // KC requires AC (rank 0) and 10C (rank 1) both seen; all opponents must be void in trump.
    // Both AC and 10C were played in tricks; trump-void established via trump-led trick.
    const kingOfClubs = { id: 'KC', suit: 'C', rank: 'K' }
    const view = baseView({
      hands: { p1: [kingOfClubs], p2: [], p3: [], p4: [], p5: [] },
      tricks: [
        {
          // Trump led — p2/p3/p4/p5 all play fail → all trump-void
          plays: [
            { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } }, // led trump
            { userId: 'p2', card: { id: 'AC', suit: 'C', rank: 'A' } }, // fail (clubs) → void
            { userId: 'p3', card: { id: '10C', suit: 'C', rank: '10' } }, // fail (clubs) → void
            { userId: 'p4', card: { id: '8H', suit: 'H', rank: '8' } }, // fail → void
            { userId: 'p5', card: { id: '7H', suit: 'H', rank: '7' } }, // fail → void
          ],
        },
      ],
      currentTrick: [],
      buried: [],
    })
    // Both AC (rank 0) and 10C (rank 1) seen in tricks; all opponents are trump-void.
    expect(isGuaranteedWinner(kingOfClubs, view, 'p1')).toBe(true)
  })

  it('degenerate view with no other players in hands → returns false even when trumpRemainingElsewhere > 0', () => {
    // Regression guard: when view.hands only contains the bot's entry (e.g. some test helpers
    // only populate the bot's hand), otherPlayerIds is [] and [].every(...) is vacuously true.
    // isGuaranteedWinner must NOT claim the card is unbeatable in that case.
    const aceOfClubs = { id: 'AC', suit: 'C', rank: 'A' }
    const view = baseView({
      // Only the bot's own hand — no other player entries
      hands: { p1: [aceOfClubs] },
      tricks: [],
      currentTrick: [],
      buried: [],
    })
    // trumpRemainingElsewhere = 14 - ownTrump(0) - tricksTrump(0) - buriedTrump(0) = 14
    // With the vacuous-truth bug this returned true; with the fix it returns false.
    expect(isGuaranteedWinner(aceOfClubs, view, 'p1')).toBe(false)
  })
})

// ─── deducedNonTrumpVoids ─────────────────────────────────────────────────────
// Fail cards: suit ∈ {C,H,S}, rank ≠ Q/J; trump = all Qs, all Js, all diamonds.

describe('deducedNonTrumpVoids', () => {
  it('empty tricks → empty object (no voids)', () => {
    const view = baseView({ tricks: [] })
    const result = deducedNonTrumpVoids(view)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('fail suit led, one player played a different fail suit → that player void in led suit', () => {
    // p1 leads AC (clubs fail). p2 plays KH (hearts fail) — not clubs → void in clubs.
    // p3 plays 9C (follows clubs) → NOT void.
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: 'AC', suit: 'C', rank: 'A' } },   // led: clubs fail
          { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } },   // off-suit fail → void in C
          { userId: 'p3', card: { id: '9C', suit: 'C', rank: '9' } },   // followed suit → not void
          { userId: 'p4', card: { id: '7C', suit: 'C', rank: '7' } },   // followed suit → not void
          { userId: 'p5', card: { id: '8C', suit: 'C', rank: '8' } },   // followed suit → not void
        ],
      }],
    })
    const result = deducedNonTrumpVoids(view)
    expect(result['p2'] instanceof Set).toBe(true)
    expect(result['p2'].has('C')).toBe(true)
    expect(result['p3']).toBeUndefined()
    expect(result['p4']).toBeUndefined()
    expect(result['p5']).toBeUndefined()
  })

  it('fail suit led, player followed suit → NOT void in that suit', () => {
    // p1 leads KH; p2 plays 7H (hearts fail) → followed suit → not void.
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: 'KH', suit: 'H', rank: 'K' } },   // led: hearts fail
          { userId: 'p2', card: { id: '7H', suit: 'H', rank: '7' } },   // followed hearts → not void
          { userId: 'p3', card: { id: '9H', suit: 'H', rank: '9' } },   // followed hearts → not void
        ],
      }],
    })
    const result = deducedNonTrumpVoids(view)
    expect(result['p2']).toBeUndefined()
    expect(result['p3']).toBeUndefined()
  })

  it('fail suit led, player trumped in → void in led fail suit', () => {
    // p1 leads KH (hearts fail). p2 plays 7D (diamond trump) — not hearts → void in hearts.
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: 'KH', suit: 'H', rank: 'K' } },   // led: hearts fail
          { userId: 'p2', card: { id: '7D', suit: 'D', rank: '7' } },   // trump → void in H
          { userId: 'p3', card: { id: 'QC', suit: 'C', rank: 'Q' } },   // queen trump → void in H
        ],
      }],
    })
    const result = deducedNonTrumpVoids(view)
    expect(result['p2'] instanceof Set).toBe(true)
    expect(result['p2'].has('H')).toBe(true)
    expect(result['p3'] instanceof Set).toBe(true)
    expect(result['p3'].has('H')).toBe(true)
  })

  it('trump led → no void deduction for any player', () => {
    // 7D (diamond = trump) is led. p2 plays AC (fail) — but trump led means we learn
    // nothing about fail-suit voids. deducedNonTrumpVoids skips the trick.
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: '7D', suit: 'D', rank: '7' } },   // led: trump
          { userId: 'p2', card: { id: 'AC', suit: 'C', rank: 'A' } },   // fail
          { userId: 'p3', card: { id: 'KH', suit: 'H', rank: 'K' } },   // fail
        ],
      }],
    })
    const result = deducedNonTrumpVoids(view)
    expect(result['p2']).toBeUndefined()
    expect(result['p3']).toBeUndefined()
  })

  it('hidden led card → skip that trick', () => {
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: 'HIDDEN', hidden: true } },        // led: hidden
          { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } },   // could be anything
        ],
      }],
    })
    const result = deducedNonTrumpVoids(view)
    expect(result['p2']).toBeUndefined()
  })

  it('multiple tricks accumulate voids across suits', () => {
    // Trick 1: AC (clubs fail) led; p2 plays KH → void in C.
    // Trick 2: KH (hearts fail) led; p3 plays 7D (trump) → void in H.
    const view = baseView({
      tricks: [
        {
          plays: [
            { userId: 'p1', card: { id: 'AC', suit: 'C', rank: 'A' } },
            { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } },  // void in C
            { userId: 'p3', card: { id: '9C', suit: 'C', rank: '9' } },  // follows
          ],
        },
        {
          plays: [
            { userId: 'p1', card: { id: 'KH', suit: 'H', rank: 'K' } },
            { userId: 'p3', card: { id: '7D', suit: 'D', rank: '7' } },  // trump → void in H
            { userId: 'p2', card: { id: '9H', suit: 'H', rank: '9' } },  // follows hearts
          ],
        },
      ],
    })
    const result = deducedNonTrumpVoids(view)
    expect(result['p2'] instanceof Set).toBe(true)
    expect(result['p2'].has('C')).toBe(true)
    expect(result['p2'].has('H')).toBe(false)   // p2 followed hearts in trick 2
    expect(result['p3'] instanceof Set).toBe(true)
    expect(result['p3'].has('H')).toBe(true)
    expect(result['p3'].has('C')).toBe(false)   // p3 followed clubs in trick 1
  })

  it('currentTrick is ignored — only completed tricks are scanned', () => {
    // Clubs fail led in currentTrick; p2 plays hearts. Should NOT be deduced void.
    const view = baseView({
      tricks: [],
      currentTrick: [
        { userId: 'p1', card: { id: 'AC', suit: 'C', rank: 'A' } },
        { userId: 'p2', card: { id: 'KH', suit: 'H', rank: 'K' } },  // would imply void
      ],
    })
    const result = deducedNonTrumpVoids(view)
    expect(result['p2']).toBeUndefined()
  })

  it('hidden non-led play in fail-led trick → skip that play, no void deduction', () => {
    const view = baseView({
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: 'AC', suit: 'C', rank: 'A' } },       // led: clubs
          { userId: 'p2', card: { id: 'HIDDEN', hidden: true } },            // hidden → skip
          { userId: 'p3', card: { id: 'KH', suit: 'H', rank: 'K' } },       // visible off-suit → void in C
        ],
      }],
    })
    const result = deducedNonTrumpVoids(view)
    expect(result['p2']).toBeUndefined()   // hidden → no deduction
    expect(result['p3'] instanceof Set).toBe(true)
    expect(result['p3'].has('C')).toBe(true)
  })
})

describe('knownCardLocations', () => {
  it('no blitzes → empty Map', () => {
    const view = { blitzes: [] }
    expect(knownCardLocations(view).size).toBe(0)
  })

  it('black blitz → picker entry contains QC and QS card objects', () => {
    const view = { blitzes: [{ userId: 'p1', type: 'black' }] }
    const result = knownCardLocations(view)
    expect(result.has('p1')).toBe(true)
    const ids = result.get('p1').map(c => c.id)
    expect(ids).toContain('QC')
    expect(ids).toContain('QS')
    expect(ids).toHaveLength(2)
  })

  it('red blitz → picker entry contains QH and QD card objects', () => {
    const view = { blitzes: [{ userId: 'p1', type: 'red' }] }
    const result = knownCardLocations(view)
    expect(result.has('p1')).toBe(true)
    const ids = result.get('p1').map(c => c.id)
    expect(ids).toContain('QH')
    expect(ids).toContain('QD')
    expect(ids).toHaveLength(2)
  })

  it('missing blitzes field → empty Map', () => {
    expect(knownCardLocations({}).size).toBe(0)
  })

  it('multiple blitzes → separate entries per userId', () => {
    const view = { blitzes: [
      { userId: 'p1', type: 'black' },
      { userId: 'p2', type: 'red' },
    ] }
    const result = knownCardLocations(view)
    expect(result.has('p1')).toBe(true)
    expect(result.has('p2')).toBe(true)
    expect(result.get('p1').map(c => c.id)).toContain('QC')
    expect(result.get('p2').map(c => c.id)).toContain('QH')
  })
})

describe('resolveView', () => {
  it('returns view with knownLocations populated from blitzes', () => {
    const view = { blitzes: [{ userId: 'p1', type: 'black' }], hands: { p1: [], p2: [] } }
    const rv = resolveView(view, 'p2')
    expect(rv.knownLocations).toBeDefined()
    expect(rv.knownLocations.has('p1')).toBe(true)
    const ids = rv.knownLocations.get('p1').map(c => c.id)
    expect(ids).toContain('QC')
    expect(ids).toContain('QS')
  })

  it('other view fields are unchanged', () => {
    const view = { blitzes: [], hands: { p1: [], p2: [] }, picker: 'p1' }
    const rv = resolveView(view, 'p2')
    expect(rv.picker).toBe('p1')
    expect(rv.hands).toBe(view.hands)
  })

  it('no blitzes → knownLocations is an empty Map', () => {
    const view = { blitzes: [], hands: {} }
    const rv = resolveView(view, 'p1')
    expect(rv.knownLocations.size).toBe(0)
  })
})

describe('isGuaranteedWinner – blitz inference (trump case)', () => {
  it('partner holds QH; picker black-blitzed (QC+QS); neither played → true with resolveView', () => {
    // Without blitz inference: QC and QS are unaccounted for → false.
    // With resolveView: QC and QS are known to be in teammate's (picker's) hand → true.
    const qh = { id: 'QH', rank: 'Q', suit: 'H' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }],
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p2: [qh],
        p3: [], p4: [], p5: [],
      },
      tricks: [],
      currentTrick: [],
      buried: [],
      isLeaster: false,
    }
    // Plain view: QC (rank 0) and QS (rank 1) unseen → false
    expect(isGuaranteedWinner(qh, view, 'p2')).toBe(false)
    // Enriched view: QC and QS known in teammate's hand → true
    const rv = resolveView(view, 'p2')
    expect(isGuaranteedWinner(qh, rv, 'p2')).toBe(true)
  })

  it('opponent bot does NOT benefit from blitz: QH is false for p3 regardless of resolveView', () => {
    const qh = { id: 'QH', rank: 'Q', suit: 'H' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }],
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p2: [], p3: [qh], p4: [], p5: [],
      },
      tricks: [],
      currentTrick: [],
      buried: [],
      isLeaster: false,
    }
    const rv = resolveView(view, 'p3')
    // p3 is an opponent; picker's blitzed queens are opponent threats → still false
    expect(isGuaranteedWinner(qh, rv, 'p3')).toBe(false)
  })

  it('picker holds QS; partner red-blitzed (QH+QD in partner hand); QC still unaccounted → QS false for picker', () => {
    // Picker (p1) holds QS (rank 1). Partner (p2) declared red blitz (QH+QD in p2's hand).
    // QC (rank 0) is still unaccounted for and NOT in a teammate's known cards → false.
    const qs = { id: 'QS', rank: 'Q', suit: 'S' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p2', type: 'red' }],
      hands: {
        p1: [qs],
        p2: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p3: [], p4: [], p5: [],
      },
      tricks: [],
      currentTrick: [],
      buried: [],
      isLeaster: false,
    }
    const rv = resolveView(view, 'p1')
    // QC (rank 0) still unaccounted for → false
    expect(isGuaranteedWinner(qs, rv, 'p1')).toBe(false)
  })

  it('combined blitz — picker black-blitzed and partner red-blitzed: JC is guaranteed winner for picker', () => {
    // Picker (p1) holds JC (rank 4). QC(0)+QS(1) in p1's hand via own-black-blitz would not appear
    // in knownLocations since knownLocations tracks the teammate, not self.
    // But QH(2)+QD(3) are in partner's (p2's) hand via red-blitz → teammate known cards.
    // QC(0), QS(1) are in p1's own hand (visible), so seenRanks covers them from the hands loop.
    // QH(2), QD(3) come from knownLocations (teammate p2). All four higher-rank trump accounted for → true.
    const jc = { id: 'JC', rank: 'J', suit: 'C' }
    const qc = { id: 'QC', rank: 'Q', suit: 'C' }
    const qs = { id: 'QS', rank: 'Q', suit: 'S' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [
        { userId: 'p1', type: 'black' },
        { userId: 'p2', type: 'red' },
      ],
      hands: {
        p1: [jc, qc, qs],
        p2: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p3: [], p4: [], p5: [],
      },
      tricks: [],
      currentTrick: [],
      buried: [],
      isLeaster: false,
    }
    const rv = resolveView(view, 'p1')
    expect(isGuaranteedWinner(jc, rv, 'p1')).toBe(true)
  })
})

describe('isGuaranteedWinner – blitz inference (fail case, condition 2)', () => {
  it('partner holds AH; all trump accounted for except QC+QS (both in picker hand via blitz) → true', () => {
    // Consistent state: p1 (picker) holds QC+QS (black blitz). p2 (partner) holds AH with 0 trump.
    // 10 trump in tricks + 2 buried = 12. trumpRemainingElsewhere = 14 - 0 - 10 - 2 = 2 (QC+QS).
    // knownTeammateTrump = 2 (both unplayed). 2 - 2 = 0 → no opponent trump → true.
    const ah = { id: 'AH', rank: 'A', suit: 'H' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }],
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p2: [ah],
        p3: [], p4: [], p5: [],
      },
      tricks: [{
        plays: [
          { userId: 'p3', card: { id: 'QH', rank: 'Q', suit: 'H' } },
          { userId: 'p4', card: { id: 'QD', rank: 'Q', suit: 'D' } },
          { userId: 'p5', card: { id: 'JC', rank: 'J', suit: 'C' } },
          { userId: 'p1', card: { id: 'JS', rank: 'J', suit: 'S' } },
          { userId: 'p2', card: { id: 'JH', rank: 'J', suit: 'H' } },
        ],
      }, {
        plays: [
          { userId: 'p3', card: { id: 'JD', rank: 'J', suit: 'D' } },
          { userId: 'p4', card: { id: 'AD', rank: 'A', suit: 'D' } },
          { userId: 'p5', card: { id: '10D', rank: '10', suit: 'D' } },
          { userId: 'p1', card: { id: 'KD', rank: 'K', suit: 'D' } },
          { userId: 'p2', card: { id: '9D', rank: '9', suit: 'D' } },
        ],
      }],
      currentTrick: [],
      buried: [{ id: '8D', rank: '8', suit: 'D' }, { id: '7D', rank: '7', suit: 'D' }],
      isLeaster: false,
    }
    // Plain view: 2 trump remaining (QC+QS), not all others trump-void → false
    expect(isGuaranteedWinner(ah, view, 'p2')).toBe(false)
    // Enriched view: QC+QS known in teammate's hand, 2-2=0 opponent trump → true
    const rv = resolveView(view, 'p2')
    expect(isGuaranteedWinner(ah, rv, 'p2')).toBe(true)
  })

  it('played blitzed queen is filtered out — AH is still NOT a guaranteed winner when opponent holds residual trump', () => {
    // p1 black-blitzed (QC+QS). QC was played by p1 into a completed trick.
    // QS is still in p1's hand. Some opponent holds 8D (unaccounted).
    // trumpRemainingElsewhere = 14 - 0 - 10(tricks) - 2(buried) = 2 (QS + 8D)
    // knownTeammateTrump = 1 (QC filtered because it's in tricks; QS unplayed → counts)
    // 2 - 1 = 1 ≠ 0 → check voids → not all others void → false
    const ah = { id: 'AH', rank: 'A', suit: 'H' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }],
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }],
        p2: [ah],
        p3: [], p4: [], p5: [],
      },
      tricks: [{
        plays: [
          { userId: 'p1', card: { id: 'QC', rank: 'Q', suit: 'C' } }, // picker plays blitzed QC
          { userId: 'p3', card: { id: 'QH', rank: 'Q', suit: 'H' } },
          { userId: 'p4', card: { id: 'QD', rank: 'Q', suit: 'D' } },
          { userId: 'p5', card: { id: 'JC', rank: 'J', suit: 'C' } },
          { userId: 'p2', card: { id: 'JS', rank: 'J', suit: 'S' } },
        ],
      }, {
        plays: [
          { userId: 'p3', card: { id: 'JH', rank: 'J', suit: 'H' } },
          { userId: 'p4', card: { id: 'JD', rank: 'J', suit: 'D' } },
          { userId: 'p5', card: { id: 'AD', rank: 'A', suit: 'D' } },
          { userId: 'p1', card: { id: '10D', rank: '10', suit: 'D' } },
          { userId: 'p2', card: { id: 'KD', rank: 'K', suit: 'D' } },
        ],
      }],
      // 10 trump played. buried: 9D, 7D. trumpRemainingElsewhere = 14-0-10-2 = 2 (QS + 8D)
      currentTrick: [],
      buried: [{ id: '9D', rank: '9', suit: 'D' }, { id: '7D', rank: '7', suit: 'D' }],
      isLeaster: false,
    }
    const rv = resolveView(view, 'p2')
    // QC already in tricks (filtered); QS not played (counted); 2-1=1 opponent trump remains → false
    expect(isGuaranteedWinner(ah, rv, 'p2')).toBe(false)
  })

  it('opponent bot does NOT benefit: AH held by p3 → false even with resolveView', () => {
    const ah = { id: 'AH', rank: 'A', suit: 'H' }
    const view = {
      picker: 'p1',
      partner: 'p2',
      blitzes: [{ userId: 'p1', type: 'black' }],
      hands: {
        p1: [{ id: 'HIDDEN', hidden: true }, { id: 'HIDDEN', hidden: true }],
        p2: [],
        p3: [ah],
        p4: [], p5: [],
      },
      tricks: [{
        plays: [
          { userId: 'p3', card: { id: 'QH', rank: 'Q', suit: 'H' } },
          { userId: 'p4', card: { id: 'QD', rank: 'Q', suit: 'D' } },
          { userId: 'p5', card: { id: 'JC', rank: 'J', suit: 'C' } },
          { userId: 'p1', card: { id: 'JS', rank: 'J', suit: 'S' } },
          { userId: 'p2', card: { id: 'JH', rank: 'J', suit: 'H' } },
        ],
      }, {
        plays: [
          { userId: 'p3', card: { id: 'JD', rank: 'J', suit: 'D' } },
          { userId: 'p4', card: { id: 'AD', rank: 'A', suit: 'D' } },
          { userId: 'p5', card: { id: '10D', rank: '10', suit: 'D' } },
          { userId: 'p1', card: { id: 'KD', rank: 'K', suit: 'D' } },
          { userId: 'p2', card: { id: '9D', rank: '9', suit: 'D' } },
        ],
      }],
      currentTrick: [],
      buried: [{ id: '8D', rank: '8', suit: 'D' }, { id: '7D', rank: '7', suit: 'D' }],
      isLeaster: false,
    }
    const rv = resolveView(view, 'p3')
    expect(isGuaranteedWinner(ah, rv, 'p3')).toBe(false)
  })
})
