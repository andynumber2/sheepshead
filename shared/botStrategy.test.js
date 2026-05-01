import { describe, it, expect } from 'vitest'
import { decidePlay } from './botStrategy.js'

// Cards: { id, suit, rank }. Trump = all diamonds + all queens + all jacks.
const c = (id, suit, rank) => ({ id, suit, rank })

// Opponent (u2) is void in the called fail suit (H). Picker (u1) has led the
// called suit; partner (u3) holds the called Ace and has not yet played.
function trumpInOnCalledSuitView({ hand, partnerRevealed }) {
  return {
    phase: 'playing',
    hands: { u1: [], u2: hand, u3: [], u4: [] },
    currentTrick: [
      { userId: 'u1', card: c('9H', 'H', '9') },
    ],
    tricks: [],
    picker: 'u1',
    partner: 'u3',
    partnerRevealed,
    calledSuit: 'H',
    calledAce: { aceId: 'AH' },
    isLeaster: false,
    lastTrick: [],
  }
}

describe('decidePlay — trump in on partner-revealing called-suit lead', () => {
  it('schmears with A♦ when bot has high trump and partner is unrevealed', () => {
    // Hand has A♦ (trump A), Q♣ (trump Q), and fail spades. Bot is void in H.
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('KS', 'S', 'K'), c('9S', 'S', '9'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
    ]
    const view = trumpInOnCalledSuitView({ hand, partnerRevealed: false })
    expect(decidePlay(view, 'u2')).toBe('AD')
  })

  it('plays highest trump (force-up) on called-suit lead once partner has been revealed', () => {
    // Partner already revealed → schmear specialization does not apply.
    // Falls into the general force-up case: highest trump = QC (Q♣ tops trumpRank).
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('KS', 'S', 'K'), c('9S', 'S', '9'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
    ]
    const view = trumpInOnCalledSuitView({ hand, partnerRevealed: true })
    expect(decidePlay(view, 'u2')).toBe('QC')
  })

  it('still trumps in (schmear) when only Js/Qs are available with partner unrevealed', () => {
    // All trump (Qs and Js), no A/10/K/9/8/7 in hand. Schmear priority on Js/Qs:
    // among Js, weakest by trump rank = JD; QC tops the trumpRank ordering.
    const hand = [
      c('QC', 'C', 'Q'), c('QS', 'S', 'Q'),
      c('JC', 'C', 'J'), c('JS', 'S', 'J'),
      c('JH', 'H', 'J'), c('JD', 'D', 'J'),
    ]
    const view = trumpInOnCalledSuitView({ hand, partnerRevealed: false })
    const played = decidePlay(view, 'u2')
    expect(['QC', 'QS', 'JC', 'JS', 'JH', 'JD']).toContain(played)
  })

  it('plays highest trump on a non-called fail lead when picker is winning (force-up)', () => {
    // Picker leads 9♠ (spades, NOT the called suit). Bot is void in spades and
    // holds trump. Picker is currently winning → trump in with highest trump.
    const view = {
      phase: 'playing',
      hands: {
        u1: [],
        u2: [
          c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
          c('7C', 'C', '7'), c('8C', 'C', '8'),
          c('KH', 'H', 'K'), c('9H', 'H', '9'),
        ],
        u3: [], u4: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9S', 'S', '9') },
      ],
      tricks: [],
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u2')).toBe('QC')
  })

  it('does not trump in when a fellow opponent is already winning the trick', () => {
    // Picker leads 9♥, opponent u4 trumps in with QH and is winning.
    // Picker team is NOT winning → bot u2 should not waste trump.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u3: [], u4: [],
        u2: [c('AD', 'D', 'A'), c('7C', 'C', '7'), c('8C', 'C', '8')],
      },
      currentTrick: [
        { userId: 'u1', card: c('9H', 'H', '9') },
        { userId: 'u4', card: c('QH', 'H', 'Q') },
      ],
      tricks: [],
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
    const played = decidePlay(view, 'u2')
    expect(played).not.toBe('AD')
  })
})

describe('decidePlay — predicted picker-team win on called-suit lead by an opponent', () => {
  // Production scenario: an opponent leads the called suit, the partner is
  // unrevealed, and the partner (forced to play the called ace later this
  // trick) is set to take the trick. View.partner is masked to null because
  // partnerRevealed is false. The bot is void in the called suit, so realCards
  // already excludes any called-suit cards.
  function predictedWinView({ hand, currentTrick, calledSuit = 'H', aceId = 'AH' }) {
    return {
      phase: 'playing',
      hands: { u1: [], u2: hand, u3: [], u4: [], u5: [], u6: [] },
      currentTrick,
      tricks: [],
      picker: 'u3',
      partner: null,           // masked: partnerRevealed is false
      partnerRevealed: false,
      calledSuit,
      calledAce: { aceId },
      isLeaster: false,
      lastTrick: [],
      crackerId: null,
      recrackerId: null,
    }
  }

  it('trumps in (schmear priority) when an opponent led called suit and partner is unrevealed', () => {
    // u1 (opponent) led 9H. u2 (bot, opponent) is void in H and has trump + fail.
    // Partner is unrevealed and no trump played yet → trump in via schmear priority.
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('KS', 'S', 'K'), c('9S', 'S', '9'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
    ]
    const view = predictedWinView({
      hand,
      currentTrick: [{ userId: 'u1', card: c('9H', 'H', '9') }],
    })
    expect(decidePlay(view, 'u2')).toBe('AD')
  })

  it('still trumps in when an intermediate opponent followed with a higher fail of the called suit', () => {
    // u1 led 9H, u4 (opponent) followed with KH (forced to follow suit, higher fail).
    // No trump played yet → predicted-win still applies; bot trumps in.
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
      c('9S', 'S', '9'), c('KS', 'S', 'K'),
    ]
    const view = predictedWinView({
      hand,
      currentTrick: [
        { userId: 'u1', card: c('9H', 'H', '9') },
        { userId: 'u4', card: c('KH', 'H', 'K') },
      ],
    })
    expect(decidePlay(view, 'u2')).toBe('AD')
  })

  it('does not trump in when a fellow opponent has already trumped the called-suit lead', () => {
    // u1 led 9H, u4 (opponent) was void and trumped in with JD. The trumpor's
    // card beats the forced called ace, so the picker team will not win this
    // trick. Predicted-win must NOT fire — bot should play its lowest fail.
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
      c('9S', 'S', '9'), c('KS', 'S', 'K'),
    ]
    const view = predictedWinView({
      hand,
      currentTrick: [
        { userId: 'u1', card: c('9H', 'H', '9') },
        { userId: 'u4', card: c('JD', 'D', 'J') },
      ],
    })
    const played = decidePlay(view, 'u2')
    expect(played).not.toBe('AD')
    expect(played).not.toBe('QC')
  })

  it('does not fire when the led suit is not the called suit', () => {
    // u1 leads 9♠ (non-called fail). Partner unrevealed, picker not currently
    // winning, bot is forced to follow ♠ (no trump in legal plays). Predicted-
    // win is gated on called-suit lead → branch must not fire, and there is no
    // discretionary trump play available either.
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
      c('KS', 'S', 'K'), c('AS', 'S', 'A'),
    ]
    const view = predictedWinView({
      hand,
      currentTrick: [{ userId: 'u1', card: c('9S', 'S', '9') }],
    })
    // Must follow ♠; legal plays are KS, AS. lowestCard prefers lower points → KS.
    expect(decidePlay(view, 'u2')).toBe('KS')
  })
})

describe('decidePlay — opponent schmears via deduced partner from elimination', () => {
  it('schmears 10S onto opp2 trump-in when partner is deduced by elimination', () => {
    // 5 seats: u1=opp1 (led KH), u2=picker, u3=opp2 (trumped in QC), u4=bot (opp3),
    // u5=partner (still to play, holds AH). Ace call on hearts.
    // u4 is void in hearts, holds 10S among other cards.
    // Deductions: u1 played non-called on called-suit lead → not partner;
    //             u3 played non-called → not partner; u2 picker. So u5 is partner,
    //             and u3 is a confirmed teammate currently winning the trick.
    // Expected: schmear 10S (highest fail) onto QC.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('10S', 'S', '10'), c('9S', 'S', '9'),
          c('8C', 'C', '8'), c('7C', 'C', '7'),
          c('AD', 'D', 'A'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('KH', 'H', 'K') },
        { userId: 'u2', card: c('7H', 'H', '7') },
        { userId: 'u3', card: c('QC', 'C', 'Q') },
      ],
      tricks: [],
      picker: 'u2',
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
      lastTrick: [],
    }
    expect(decidePlay(view, 'u4')).toBe('10S')
  })
})
