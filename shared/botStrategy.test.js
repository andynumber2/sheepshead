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

  it('schmears A♦ on called-suit lead once partner has been revealed', () => {
    // Partner already revealed → schmear priority still applies uniformly.
    // winningTrump = [AD, QC] (both beat the non-trump lead). Schmear priority:
    // A rank first → AD (11 pts captured, QC preserved for future trump battles).
    const hand = [
      c('AD', 'D', 'A'), c('QC', 'C', 'Q'),
      c('KS', 'S', 'K'), c('9S', 'S', '9'),
      c('7C', 'C', '7'), c('8C', 'C', '8'),
    ]
    const view = trumpInOnCalledSuitView({ hand, partnerRevealed: true })
    expect(decidePlay(view, 'u2')).toBe('AD')
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

  it('schmears A♦ on a non-called fail lead when picker is winning', () => {
    // Picker leads 9♠ (spades, NOT the called suit). Bot is void in spades and
    // holds trump. Picker is currently winning → trump in via schmear priority.
    // winningTrump = [AD, QC]. Schmear priority: A rank first → AD (11 pts
    // captured, QC preserved for future trump battles).
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
    expect(decidePlay(view, 'u2')).toBe('AD')
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
  // Note: a 6th seat (u6) is included in `hands` to suppress mid-trick partner
  // deduction in tests where 2+ players have played non-called cards on a
  // called-suit-led trick. Without u6, knownNonPartners would resolve to a
  // unique partner and the schmear branch would override predicted-win,
  // masking what these tests are trying to verify. See #163 for the underlying
  // schmear-vs-predicted-win interaction this workaround paints over.
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

describe('decidePlay — opponent identifies picker-team winner via deducedPartner', () => {
  it('after recrack, opponent trumps in via schmear priority when deduced partner is winning', () => {
    // Setup: ace call on hearts. u3 recracked → u3 is the deduced partner (picker team).
    // Trick: u1 leads 9♠ (non-called fail). u3 (deduced partner) plays A♠ — picker team
    // is currently winning the trick.
    // Bot is u4 (opponent), void in spades. Trump in hand: QC, AD, KD.
    // All three beat non-trump A♠. Schmear priority: A rank first → AD (11 pts captured,
    // QC and KD preserved for future trump battles).
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('QC', 'C', 'Q'), c('AD', 'D', 'A'),
          c('10C', 'C', '10'), c('7C', 'C', '7'),
          c('KD', 'D', 'K'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9S', 'S', '9') },
        { userId: 'u3', card: c('AS', 'S', 'A') },
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
      crackerId: 'u1',       // u1 cracked
      recrackerId: 'u3',     // u3 recracked → u3 is the partner
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u4')).toBe('AD')
  })
})

describe('decidePlay — opponent schmear-anyway fallback overridden when picker-team will overtake (#163)', () => {
  // When the called suit is led by a fellow opponent, the deduced partner is
  // unrevealed, and no trump has been played, the picker-team partner is
  // forced to play the called card later this trick and will overtake the
  // current fail-suit winner. Without a guaranteed-winner takeover, the bot
  // would otherwise schmear high-value fail to the picker team.
  //
  // The fix only overrides the *fallback* (no guaranteed takeover available).
  // When the bot has a guaranteed winner (e.g., Q♣), the existing takeover
  // path still wins the trick — that case must not regress.

  it('after recrack, bot trumps in instead of schmearing when no guaranteed takeover available', () => {
    // Setup: ace call on hearts. u3 recracked → u3 deduced partner.
    // u1 (cracker, opp) leads KH (called-suit fail). Bot u4 (opp) is void in H,
    // holds [JD, AD, 10C, 7C] — trump but no top trump (J♣/Q's would beat JD).
    // u3 (partner) and u2 (picker) yet to play.
    // Pre-fix: teammateWinning(u4) true; takeover path returns null (JD/AD not
    //   guaranteed against unseen Q's/J♣); schmear-anyway fallback dumps 10C —
    //   partner u3's forced AH overtakes → picker team collects 10C.
    // Post-fix: predicted-win precondition holds (called-suit led, partner
    //   unrevealed, no trump played) → fallback overridden → falls through to
    //   predicted-win trump-in branch → AD via trump schmear priority (A first).
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('JD', 'D', 'J'), c('AD', 'D', 'A'),
          c('10C', 'C', '10'), c('7C', 'C', '7'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('KH', 'H', 'K') },
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
      crackerId: 'u1',
      recrackerId: 'u3',
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u4')).toBe('AD')
  })

  it('with partner deduced by 3-of-4 elimination, bot trumps in on called-suit lead', () => {
    // 5 seats. Ace call on hearts. picker=u3.
    // u1 (opp) leads KH — eliminates u1 (didn't play AH on first hearts trick).
    // u2 (opp) plays 8C — non-called on called-suit lead → eliminates u2.
    // From u4's POV: picker=u3, u1 eliminated, u2 eliminated, u4 self →
    //   u5 deduced as partner by elimination.
    // Bot u4 holds [JD, AD, 10C, 7C] — same non-top-trump shape as recrack test.
    // teammateWinning(u4) true (winner u1 not picker u3, not partner u5).
    // No trump played yet → predicted-win precondition holds → fallback override
    //   fires → bot trumps in with AD via schmear priority.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [],
        u3: [], u5: [],
        u4: [
          c('JD', 'D', 'J'), c('AD', 'D', 'A'),
          c('10C', 'C', '10'), c('7C', 'C', '7'),
        ],
      },
      currentTrick: [
        { userId: 'u1', card: c('KH', 'H', 'K') },
        { userId: 'u2', card: c('8C', 'C', '8') },
      ],
      tricks: [],
      picker: 'u3',
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
    expect(decidePlay(view, 'u4')).toBe('AD')
  })

  it('regression guard: takeover path still fires when bot holds a guaranteed winner', () => {
    // Same recrack setup, but bot u4 holds Q♣ (top trump, always guaranteed).
    // The schmear-branch takeover path (cheapestGuaranteedWin) must still fire
    // and the bot should win the trick with QC. The predicted-win override
    // applies only to the schmear-anyway *fallback*, not the takeover.
    // QC is the cheapest guaranteed winner by points (Q♣=3, A♦=11, K♦=4).
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('QC', 'C', 'Q'), c('AD', 'D', 'A'),
          c('10C', 'C', '10'), c('7C', 'C', '7'),
          c('KD', 'D', 'K'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('KH', 'H', 'K') },
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
      crackerId: 'u1',
      recrackerId: 'u3',
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u4')).toBe('QC')
  })
})

describe('decidePlay — opponent leading after recrack does not lead called suit', () => {
  it('skips lead-called-suit-to-flush when partner is deduced via recrack', () => {
    // Hand has only point-bearing hearts (KH=4pts, 10H=10pts) and zero-point clubs (7C, 8C).
    // Pre-fix: gate fires (!partnerRevealed) → leads lowest heart by lowestCard = KH.
    // Post-fix: deducedPartner non-null (recracker u3) → gate skipped → leads lowest
    //   non-trump overall = 7C (zero-point club beats KH 4pts).
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('KH', 'H', 'K'), c('10H', 'H', '10'),
          c('7C', 'C', '7'), c('8C', 'C', '8'),
          c('AD', 'D', 'A'),
        ],
        u5: [],
      },
      currentTrick: [],
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
      recrackerId: 'u3',
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u4')).toBe('7C')
  })
})

describe('decidePlay — regression: no behavior change when no deduction signals fired', () => {
  // This pins the contract that deducedPartner returning null leaves all updated
  // call sites behaving exactly as they did pre-fix.

  it('teammateWinning still false for opponent bot with no signals (no schmear)', () => {
    // 5 seats. Trick led with non-called suit (spades). No crack/recrack.
    // Bot is u4 (opponent), follows spades. teammateWinning must remain false
    // → no schmear → falls through. Bot must follow led suit; spade options are
    // [10S, 9S]. Pre-fix the schmear branch was skipped (view.partner null) and
    // the bot played 9S (lowest). Post-fix without signals deducedPartner returns
    // null → schmear still skipped → still 9S.
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
        { userId: 'u1', card: c('9S', 'S', '9') },
        { userId: 'u2', card: c('7S', 'S', '7') },
        { userId: 'u3', card: c('KS', 'S', 'K') },
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
    expect(decidePlay(view, 'u4')).toBe('9S')
  })

  it('lead-flush still leads called suit when no signals fired', () => {
    // Bot u4 leads. No crack/recrack. deducedPartner returns null → flush gate
    // fires → bot leads lowest heart. Both pre- and post-fix: 7H.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('7H', 'H', '7'), c('9H', 'H', '9'),
          c('8C', 'C', '8'), c('7C', 'C', '7'),
          c('AD', 'D', 'A'),
        ],
        u5: [],
      },
      currentTrick: [],
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
    expect(decidePlay(view, 'u4')).toBe('7H')
  })
})

// ─── Call Site 1: picker-team leading ─────────────────────────────────────────
// The new code uses isGuaranteedWinner instead of trumpRemainingElsewhere <= 2.
// This means the bot can now cash guaranteed non-trump winners beyond just aces
// (e.g. a 10 when its ace has been played and all trump are accounted for).

describe('decidePlay — picker-team leading: guaranteed fail cards (call site 1)', () => {
  // Build a view where the picker team bot is leading.
  // bot = u1 (picker). partner = u3.
  // 14 trump = QC,QS,QH,QD,JC,JS,JH,JD,AD,10D,KD,9D,8D,7D
  // We place 12 trump in a completed trick (others play them); bot holds 2 (7D, 8D).
  // trumpRemainingElsewhere = 14 - 2 (bot) - 12 (tricks) = 0.
  function pickerLeadingAllTrumpSeenView(hand) {
    return {
      phase: 'playing',
      hands: {
        u1: hand,
        u2: [], u3: [], u4: [], u5: [],
      },
      currentTrick: [],
      tricks: [
        {
          plays: [
            { userId: 'u2', card: c('QC', 'C', 'Q') },
            { userId: 'u3', card: c('QS', 'S', 'Q') },
            { userId: 'u4', card: c('QH', 'H', 'Q') },
            { userId: 'u5', card: c('QD', 'D', 'Q') },
            { userId: 'u1', card: c('JC', 'C', 'J') },
          ],
        },
        {
          plays: [
            { userId: 'u2', card: c('JS', 'S', 'J') },
            { userId: 'u3', card: c('JH', 'H', 'J') },
            { userId: 'u4', card: c('JD', 'D', 'J') },
            { userId: 'u5', card: c('AD', 'D', 'A') },
            { userId: 'u1', card: c('10D', 'D', '10') },
          ],
        },
        {
          plays: [
            { userId: 'u2', card: c('KD', 'D', 'K') },
            { userId: 'u3', card: c('9D', 'D', '9') },
          ],
        },
      ],
      // Also place AC (ace of clubs) in a completed trick so 10C is guaranteed top of suit
      // (No — we need AC played too; let's add it to tricks[2])
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: true,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
  }

  it('cashes a fail 10 (not just ace) when its ace has been played and all trump are accounted for', () => {
    // Bot holds 10C (fail 10 clubs, 10 pts) + 7D + 8D (low trump).
    // AC was played in a completed trick → 10C is top of clubs.
    // All 14 trump accounted for (12 in tricks above + 7D + 8D in bot's hand).
    // isGuaranteedWinner(10C) should be true → bot cashes it.
    const hand = [
      c('10C', 'C', '10'),
      c('7D', 'D', '7'),
      c('8D', 'D', '8'),
    ]
    const view = pickerLeadingAllTrumpSeenView(hand)
    // Add AC played in an earlier trick so 10C is top of clubs
    view.tricks[2].plays.push({ userId: 'u4', card: c('AC', 'C', 'A') })
    expect(decidePlay(view, 'u1')).toBe('10C')
  })

  it('does NOT cash a fail 10 when trump remains elsewhere (falls back to highest trump)', () => {
    // Bot holds 10C + 7D + 8D. AC has been played so 10C is top of clubs.
    // But only 10 trump are in tricks (not all 14 accounted for) → not guaranteed.
    // Trump remains = 14 - 2 (bot) - 10 (tricks) = 2 → NOT zero → not guaranteed.
    // Falls back to highestTrump(realCards) = 8D.
    const hand = [
      c('10C', 'C', '10'),
      c('7D', 'D', '7'),
      c('8D', 'D', '8'),
    ]
    const view = {
      phase: 'playing',
      hands: { u1: hand, u2: [], u3: [], u4: [], u5: [] },
      currentTrick: [],
      tricks: [
        {
          plays: [
            { userId: 'u2', card: c('QC', 'C', 'Q') },
            { userId: 'u3', card: c('QS', 'S', 'Q') },
            { userId: 'u4', card: c('QH', 'H', 'Q') },
            { userId: 'u5', card: c('QD', 'D', 'Q') },
            { userId: 'u1', card: c('JC', 'C', 'J') },
          ],
        },
        {
          plays: [
            { userId: 'u2', card: c('JS', 'S', 'J') },
            { userId: 'u3', card: c('JH', 'H', 'J') },
            { userId: 'u4', card: c('JD', 'D', 'J') },
            // Only 9 trump in tricks + 2 in bot = 11, leaving 3 elsewhere
            { userId: 'u5', card: c('AC', 'C', 'A') }, // AC played but trump not yet exhausted
          ],
        },
      ],
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: true,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
    // trumpRemainingElsewhere = 14 - 2(bot) - 9(tricks) = 3 → not zero
    // deducedTrumpVoids won't help because u2..u5 played trump in the trump-led trick
    // → not void. So isGuaranteedWinner(10C) = false.
    // Next branch: highestTrump(realCards) = 8D.
    expect(decidePlay(view, 'u1')).toBe('8D')
  })

  it('cashes a fail ace when trumpRemainingElsewhere is 0', () => {
    // Classic case: bot holds AC (ace of clubs, 11 pts) + 2 low trump.
    // All 12 other trump are in completed tricks → all accounted for.
    // isGuaranteedWinner(AC) = true (suitRank 0, all trump seen).
    const hand = [
      c('AC', 'C', 'A'),
      c('7D', 'D', '7'),
      c('8D', 'D', '8'),
    ]
    const view = pickerLeadingAllTrumpSeenView(hand)
    expect(decidePlay(view, 'u1')).toBe('AC')
  })
})

// ─── Call Site 2: opponent-team leading ───────────────────────────────────────
// The new code uses isGuaranteedWinner instead of trumpRemainingElsewhere === 0.
// Bot can now cash guaranteed non-trump winners including fail 10s (not just aces).

describe('decidePlay — opponent-team leading: guaranteed fail cards (call site 2)', () => {
  // Bot = u2 (opponent). Picker = u1. Partner = u3 (but unknown to u2; partner: null).
  // All 14 trump accounted for (12 in tricks + 2 in bot's hand via 7D, 8D).
  function oppLeadingAllTrumpSeenView(hand) {
    return {
      phase: 'playing',
      hands: {
        u1: [], u2: hand, u3: [], u4: [], u5: [],
      },
      currentTrick: [],
      tricks: [
        {
          plays: [
            { userId: 'u1', card: c('QC', 'C', 'Q') },
            { userId: 'u3', card: c('QS', 'S', 'Q') },
            { userId: 'u4', card: c('QH', 'H', 'Q') },
            { userId: 'u5', card: c('QD', 'D', 'Q') },
            { userId: 'u2', card: c('JC', 'C', 'J') },
          ],
        },
        {
          plays: [
            { userId: 'u1', card: c('JS', 'S', 'J') },
            { userId: 'u3', card: c('JH', 'H', 'J') },
            { userId: 'u4', card: c('JD', 'D', 'J') },
            { userId: 'u5', card: c('AD', 'D', 'A') },
            { userId: 'u2', card: c('10D', 'D', '10') },
          ],
        },
        {
          plays: [
            { userId: 'u1', card: c('KD', 'D', 'K') },
            { userId: 'u3', card: c('9D', 'D', '9') },
          ],
        },
      ],
      picker: 'u1',
      partner: null,   // masked from opponent view
      partnerRevealed: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
    }
  }

  it('cashes a fail 10 when its ace has been played and all trump are accounted for', () => {
    // Bot holds 10C + 7D + 8D. AC played in a completed trick → 10C is guaranteed.
    // All 14 trump seen. Opponent leads → bot should cash 10C.
    const hand = [
      c('10C', 'C', '10'),
      c('7D', 'D', '7'),
      c('8D', 'D', '8'),
    ]
    const view = oppLeadingAllTrumpSeenView(hand)
    view.tricks[2].plays.push({ userId: 'u4', card: c('AC', 'C', 'A') })
    expect(decidePlay(view, 'u2')).toBe('10C')
  })

  it('does NOT cash the called card even when it appears guaranteed (called card excluded from leading)', () => {
    // Defensive test: artificially place the called card (AH) in the bot's hand.
    // Even if AH were a guaranteed winner, the call-site filter excludes the called card.
    // This guards the `c.id !== calledCardId` filter in the new code.
    // Note: this is an artificial scenario — in a real game the called card is held
    // by the partner, not an opponent.
    const hand = [
      c('AH', 'H', 'A'),  // the called card itself — must NOT be cashed
      c('10C', 'C', '10'),
      c('7D', 'D', '7'),
      c('8D', 'D', '8'),
    ]
    const view = oppLeadingAllTrumpSeenView(hand)
    // Put AC in tricks so 10C is also guaranteed, giving the bot a valid alternative
    view.tricks[2].plays.push({ userId: 'u4', card: c('AC', 'C', 'A') })
    // AH is in bot's hand so it cannot be played (calledCard restriction when !partnerRevealed)
    // Expect 10C (the other guaranteed card), NOT AH
    const played = decidePlay(view, 'u2')
    expect(played).not.toBe('AH')
    expect(played).toBe('10C')
  })

  it('does NOT cash a guaranteed fail card when trump remains elsewhere', () => {
    // Bot holds AC + 9C + 7D + 8D. Only 9 trump in tricks → trumpRemainingElsewhere = 3.
    // Opponents not all trump-void (they played trump in trick 0).
    // isGuaranteedWinner(AC) = false → skip guaranteed-cash branch.
    // Falls through: deducedPartner is null (no signals) → lead called-suit-to-flush.
    // Bot holds no hearts → no called-suit cards → falls to lowestCard(nonTrump).
    // lowestCard([AC, 9C]) = 9C (0pts < 11pts) — NOT AC, proving the cash path was skipped.
    const hand = [
      c('AC', 'C', 'A'),
      c('9C', 'C', '9'),
      c('7D', 'D', '7'),
      c('8D', 'D', '8'),
    ]
    const view = {
      phase: 'playing',
      hands: { u1: [], u2: hand, u3: [], u4: [], u5: [] },
      currentTrick: [],
      tricks: [
        {
          plays: [
            { userId: 'u1', card: c('QC', 'C', 'Q') },
            { userId: 'u3', card: c('QS', 'S', 'Q') },
            { userId: 'u4', card: c('QH', 'H', 'Q') },
            { userId: 'u5', card: c('QD', 'D', 'Q') },
            { userId: 'u2', card: c('JC', 'C', 'J') },
          ],
        },
        {
          plays: [
            { userId: 'u1', card: c('JS', 'S', 'J') },
            { userId: 'u3', card: c('JH', 'H', 'J') },
            { userId: 'u4', card: c('JD', 'D', 'J') },
            // Only 9 trump in tricks + 2 in bot = 11, leaving 3 elsewhere
          ],
        },
      ],
      picker: 'u1',
      partner: null,
      partnerRevealed: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
    }
    // trumpRemainingElsewhere = 14 - 2 - 9 = 3 → not zero → isGuaranteedWinner(AC) = false
    // Cash path is skipped → falls through to called-suit flush logic (no hearts → no calledSuitCards)
    // → lowestCard([AC, 9C]) = 9C (0pts) — confirms AC was NOT cashed
    const result = decidePlay(view, 'u2')
    expect(result).not.toBe('AC')
    expect(result).toBe('9C')
  })
})

// ─── Wire 1: picker-team leading — avoid risky suit leads ─────────────────────
// When the picker-team bot has no trump, avoid leading into a suit where an opponent
// is known void (they could trump it). Prefer a safe suit if one exists. Fall back
// to highestValueCard when all suits are risky.

describe('decidePlay — Wire 1: picker-team avoids leading into known opponent voids', () => {
  // Bot = u1 (picker). Partner = u3. No trump in bot's hand.
  // Opponent u4 is known void in clubs (trick 1: clubs led, u4 played hearts).
  // Bot has clubs and spades fail cards. Clubs is risky (u4 void), spades is safe.

  function wire1BaseView({ hand, tricks = [] }) {
    return {
      phase: 'playing',
      hands: { u1: hand, u2: [], u3: [], u4: [], u5: [] },
      currentTrick: [],
      tricks,
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: true,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
    }
  }

  it('avoids leading into a known opponent void when a safe suit exists (even if risky card has higher value)', () => {
    // Prior trick: AC (clubs) led; u4 played KH (not clubs) → u4 void in C.
    // Bot has: AC (11pts, risky suit C — u4 will trump it), 7S (0pts, safe suit S).
    // Without Wire 1: highestValueCard = AC (11pts > 0pts).
    // With Wire 1: AC is in risky suit → skip; prefer safe suit → 7S.
    const tricks = [{
      plays: [
        { userId: 'u2', card: c('9C', 'C', '9') },  // led clubs
        { userId: 'u4', card: c('KH', 'H', 'K') },  // off-suit → void in C
        { userId: 'u3', card: c('8C', 'C', '8') },  // followed
        { userId: 'u5', card: c('7C', 'C', '7') },  // followed
        { userId: 'u1', card: c('8S', 'S', '8') },  // bot plays spades (not clubs)
      ],
    }]
    const hand = [
      c('AC', 'C', 'A'),   // risky suit (u4 void in C) — 11pts but dangerous
      c('7S', 'S', '7'),   // safe suit — 0pts but safe
    ]
    const view = wire1BaseView({ hand, tricks })
    // Wire 1: u4 (opponent) is void in C → AC is risky. 7S is safe. Prefer 7S.
    expect(decidePlay(view, 'u1')).toBe('7S')
  })

  it('falls back to highestValueCard when all suits are risky', () => {
    // Prior tricks: u4 void in C and S. Bot has only C and S fail cards.
    // All suits risky → fall through to highestValueCard(realCards).
    // KS (4pts) > 9C (0pts) → highestValueCard = KS.
    const tricks = [
      {
        plays: [
          { userId: 'u2', card: c('AC', 'C', 'A') },  // led clubs
          { userId: 'u4', card: c('KH', 'H', 'K') },  // void in C
          { userId: 'u1', card: c('9C', 'C', '9') },
          { userId: 'u3', card: c('8C', 'C', '8') },
          { userId: 'u5', card: c('7C', 'C', '7') },
        ],
      },
      {
        plays: [
          { userId: 'u2', card: c('AS', 'S', 'A') },  // led spades
          { userId: 'u4', card: c('9H', 'H', '9') },  // void in S
          { userId: 'u1', card: c('7S', 'S', '7') },
          { userId: 'u3', card: c('8S', 'S', '8') },
          { userId: 'u5', card: c('KS', 'S', 'K') },
        ],
      },
    ]
    const hand = [
      c('KS', 'S', 'K'),   // risky suit S
      c('9C', 'C', '9'),   // risky suit C
    ]
    const view = wire1BaseView({ hand, tricks })
    // All suits risky → highestValueCard = KS (4pts > 0pts)
    expect(decidePlay(view, 'u1')).toBe('KS')
  })
})

// ─── Wire 2: opponent-team leading — lead into picker-team void ────────────────
// When the opponent-team bot knows the partner's identity AND a picker-team member
// is void in a fail suit the bot holds, lead that suit to force the picker-team to
// trump or waste a high card.

describe('decidePlay — Wire 2: opponent leads into picker-team void to flush trump', () => {
  // Bot = u4 (opponent). Picker = u2. Partner deduced via recrackerId = u3.
  // Prior trick: spades led; u3 (partner) played hearts (off-suit) → void in S.
  // Bot holds spades fail cards. Should lead spades to force u3 to trump.

  function wire2BaseView({ hand, tricks = [], recrackerId = 'u3' }) {
    return {
      phase: 'playing',
      hands: { u1: [], u2: [], u3: [], u4: hand, u5: [] },
      currentTrick: [],
      tricks,
      picker: 'u2',
      partner: null,       // masked from opponent view
      partnerRevealed: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId,
      isLeaster: false,
      lastTrick: [],
    }
  }

  it('leads into picker-team (partner) known void to flush trump', () => {
    // Prior trick: AS (spades) led; u3 (partner, deduced via recrack) played KH → void in S.
    // Bot holds: KS (4pts), 8C (0pts). KS is in risky suit for the opponent team goal:
    // we WANT to lead spades here (partner is void → will have to trump or discard).
    // Wire 2: lead KS (spades, suit where picker-team member is void).
    const tricks = [{
      plays: [
        { userId: 'u1', card: c('AS', 'S', 'A') },  // led spades
        { userId: 'u3', card: c('KH', 'H', 'K') },  // off-suit → void in S
        { userId: 'u2', card: c('7S', 'S', '7') },
        { userId: 'u4', card: c('8S', 'S', '8') },
        { userId: 'u5', card: c('9S', 'S', '9') },
      ],
    }]
    const hand = [
      c('KS', 'S', 'K'),   // spades → suits where partner (u3) is void
      c('8C', 'C', '8'),   // clubs
    ]
    const view = wire2BaseView({ hand, tricks })
    expect(decidePlay(view, 'u4')).toBe('KS')
  })

  it('does NOT fire Wire 2 when partner identity is unknown', () => {
    // No crack/recrack signals → deducedPartner = null.
    // Wire 2 must not fire. Should fall through to lowestCard(nonTrump).
    // Prior trick: AS led; u3 played KH → would imply void in S, but we don't know u3 is partner.
    // Bot holds: KS, 8C. lowestCard(nonTrump) = 8C (0pts < 4pts).
    const tricks = [{
      plays: [
        { userId: 'u1', card: c('AS', 'S', 'A') },  // led spades
        { userId: 'u3', card: c('KH', 'H', 'K') },  // off-suit (but u3 is not yet deduced as partner)
        { userId: 'u2', card: c('7S', 'S', '7') },
        { userId: 'u4', card: c('8S', 'S', '8') },
        { userId: 'u5', card: c('9S', 'S', '9') },
      ],
    }]
    const hand = [
      c('KS', 'S', 'K'),
      c('8C', 'C', '8'),
    ]
    const view = wire2BaseView({ hand, tricks, recrackerId: null })
    // No crack/recrack → deducedPartner null → Wire 2 does not fire
    // Falls to lowestCard(nonTrump) = 8C
    expect(decidePlay(view, 'u4')).toBe('8C')
  })

  it('leads the lowest-value card across all void-suit candidates (not highest)', () => {
    // Partner (u3) void in both C and S.
    // Bot holds: 9C (0pts), KC (4pts) in clubs; 7S (0pts) in spades.
    // All three qualify (their suits are picker-team voids).
    // lowestCard([9C, KC, 7S]) = 9C or 7S (both 0pts); lowestCard picks 9C because it
    // iterates left-to-right and 9C appears first with 0pts, then 7S ties but doesn't
    // displace it. The key assertion is that the expensive KC is NOT chosen.
    const tricks = [
      {
        plays: [
          { userId: 'u1', card: c('AC', 'C', 'A') },  // led clubs
          { userId: 'u3', card: c('KH', 'H', 'K') },  // off-suit → void in C
          { userId: 'u2', card: c('7C', 'C', '7') },
          { userId: 'u4', card: c('8C', 'C', '8') },
          { userId: 'u5', card: c('9C', 'C', '9') },
        ],
      },
      {
        plays: [
          { userId: 'u1', card: c('AS', 'S', 'A') },  // led spades
          { userId: 'u3', card: c('9H', 'H', '9') },  // off-suit → void in S
          { userId: 'u2', card: c('7S', 'S', '7') },
          { userId: 'u4', card: c('8S', 'S', '8') },
          { userId: 'u5', card: c('6S', 'S', '6') },
        ],
      },
    ]
    const hand = [
      c('9C', 'C', '9'),   // clubs (0pts)
      c('KC', 'C', 'K'),   // clubs (4pts) — must NOT be chosen
      c('7S', 'S', '7'),   // spades (0pts)
    ]
    const view = wire2BaseView({ hand, tricks })
    // Wire 2 fires; lowestCard picks from [9C, KC, 7S]: KC (4pts) is skipped;
    // 9C and 7S both 0pts, 9C wins the reduce as the initial accumulator.
    expect(decidePlay(view, 'u4')).not.toBe('KC')
  })

  it('fires Wire 2 when only the partner (not the picker) is void in a suit', () => {
    // Picker (u2) followed all suits normally — no void in spades.
    // Partner (u3, deduced via recrack) is void in spades.
    // Bot holds: KS (spades, partner void) and 8H (hearts, no void).
    // Wire 2 should fire because pickerTeamIds.some(id => nonTrumpVoids.get(id)?.has('S'))
    // is satisfied by u3 (partner), even though u2 (picker) is not void.
    const tricks = [{
      plays: [
        { userId: 'u1', card: c('AS', 'S', 'A') },  // led spades
        { userId: 'u2', card: c('7S', 'S', '7') },  // picker follows → NOT void in S
        { userId: 'u3', card: c('KH', 'H', 'K') },  // partner off-suit → void in S
        { userId: 'u4', card: c('8S', 'S', '8') },
        { userId: 'u5', card: c('9S', 'S', '9') },
      ],
    }]
    const hand = [
      c('KS', 'S', 'K'),   // spades (partner u3 void) → Wire 2 candidate
      c('8H', 'H', '8'),   // hearts (no picker-team void)
    ]
    const view = wire2BaseView({ hand, tricks })
    // deducedPartner = u3 (recrack). nonTrumpVoids.get(u3) has 'S'. Picker u2 NOT void.
    // Wire 2 fires on 'S'. voidSuitCards = [KS]. lowestCard([KS]) = KS.
    expect(decidePlay(view, 'u4')).toBe('KS')
  })

  it('fires Wire 2 when partner is deduced by seat-elimination (knownNonPartners path)', () => {
    // 5 seats. Picker = u2. Bot = u4 (opponent). view.partner = null, partnerRevealed = false.
    // Ace call on hearts.
    // Elimination: u2 (picker), u4 (self), u1 (played non-called on called-suit-led trick)
    // rule out 3 seats → u5 is the deduced partner.
    // Completed trick 1: hearts led by u1, u1 plays 9H (non-called; AH is called card)
    //   → u1 added to knownNonPartners. u5 plays AH (called card) → loop stops.
    // Completed trick 2: spades led; u5 (deduced partner) plays 7H (off-suit) → void in S.
    // Bot holds: KS (spades, u5 void) and 9C (clubs, no void).
    // Wire 2 should fire and lead KS (lowest of [KS]).
    const tricks = [
      {
        // Trick 1: hearts led — eliminates u1 (plays non-called before AH)
        plays: [
          { userId: 'u1', card: c('9H', 'H', '9') },  // leads hearts (non-called)
          { userId: 'u3', card: c('KH', 'H', 'K') },  // follows hearts (non-called) → also eliminated
          { userId: 'u5', card: c('AH', 'H', 'A') },  // plays called card → partner, stops scan
          { userId: 'u2', card: c('7H', 'H', '7') },
          { userId: 'u4', card: c('8H', 'H', '8') },
        ],
      },
      {
        // Trick 2: spades led — u5 (deduced partner) plays off-suit → void in S
        plays: [
          { userId: 'u1', card: c('AS', 'S', 'A') },  // led spades
          { userId: 'u5', card: c('7H', 'H', '7') },  // off-suit → void in S
          { userId: 'u2', card: c('7S', 'S', '7') },
          { userId: 'u3', card: c('8S', 'S', '8') },
          { userId: 'u4', card: c('9S', 'S', '9') },
        ],
      },
    ]
    const hand = [
      c('KS', 'S', 'K'),   // spades (u5 deduced partner is void in S)
      c('9C', 'C', '9'),   // clubs (no picker-team void)
    ]
    const view = {
      phase: 'playing',
      hands: { u1: [], u2: [], u3: [], u4: hand, u5: [] },
      currentTrick: [],
      tricks,
      picker: 'u2',
      partner: null,        // masked — must deduce via elimination
      partnerRevealed: false,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,    // no recrack — must use elimination path
      isLeaster: false,
      lastTrick: [],
    }
    // knownNonPartners: u2 (picker), u4 (self), u1 (played non-called before AH), u3 (same)
    // → 4 ruled out of 5 non-picker seats? Wait: 5 seats total, picker=u2, non-picker = u1,u3,u4,u5.
    // ruled = {u2, u4, u1, u3} → candidates = [u5] → deducedPartner = u5.
    // nonTrumpVoids.get(u5) has 'S'. pickerTeamIds = [u2, u5]. Wire 2 fires on KS.
    expect(decidePlay(view, 'u4')).toBe('KS')
  })
})

// ─── Call Site 3: picker-team following ────────────────────────────────────────
// New code: use isGuaranteedWinner(bestNonTrumpWin) instead of
// trumpRemainingElsewhere === 0 to decide whether to play high or low.

describe('decidePlay — picker-team following: guaranteed non-trump win (call site 3)', () => {
  // Picker = u1. Partner = u3. Bot = u1 (picker, following a fail-led trick).
  // Trick led by u2 (opponent) with a low club. Bot holds 10C (wins the trick)
  // and KS (also wins because it's higher than what's been played).

  it('plays highest-value non-trump winner when that card is a guaranteed winner', () => {
    // Trick: u2 led 9C, u4 played 7C. Bot u1 must follow clubs.
    // Bot holds 10C (10pts) and 8C (0pts) — both beat everything in the trick.
    // AC has been played, so 10C is the guaranteed top club.
    // All trump accounted for (12 in tricks + 2 in bot hand = 14).
    // → bestNonTrumpWin = 10C, isGuaranteedWinner(10C) = true → return 10C.
    const botHand = [
      c('10C', 'C', '10'),
      c('8C', 'C', '8'),
      c('7D', 'D', '7'),
      c('8D', 'D', '8'),
    ]
    const view = {
      phase: 'playing',
      hands: {
        u1: botHand, u2: [], u3: [], u4: [], u5: [],
      },
      currentTrick: [
        { userId: 'u2', card: c('9C', 'C', '9') },
        { userId: 'u4', card: c('7C', 'C', '7') },
      ],
      tricks: [
        {
          plays: [
            { userId: 'u2', card: c('QC', 'C', 'Q') },
            { userId: 'u3', card: c('QS', 'S', 'Q') },
            { userId: 'u4', card: c('QH', 'H', 'Q') },
            { userId: 'u5', card: c('QD', 'D', 'Q') },
            { userId: 'u1', card: c('JC', 'C', 'J') },
          ],
        },
        {
          plays: [
            { userId: 'u2', card: c('JS', 'S', 'J') },
            { userId: 'u3', card: c('JH', 'H', 'J') },
            { userId: 'u4', card: c('JD', 'D', 'J') },
            { userId: 'u5', card: c('AD', 'D', 'A') },
            { userId: 'u1', card: c('10D', 'D', '10') },
          ],
        },
        {
          plays: [
            { userId: 'u2', card: c('KD', 'D', 'K') },
            { userId: 'u3', card: c('9D', 'D', '9') },
            { userId: 'u4', card: c('AC', 'C', 'A') }, // AC played → 10C is top of clubs
          ],
        },
      ],
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: true,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
    // trumpRemainingElsewhere = 14 - 2(bot) - 12(tricks) = 0
    // isGuaranteedWinner(10C) = true → safeFromTrumpIn = true → return highestValueCard = 10C
    expect(decidePlay(view, 'u1')).toBe('10C')
  })

  it('falls back to lowest non-trump winner when not guaranteed and opponents remain', () => {
    // Trick: u2 led 7C. Bot holds 10C (10pts, best) and KC (4pts) — both beat 7C.
    // AC has been played, so 10C is top of clubs.
    // But trump NOT exhausted: only 9 trump in tricks + 2 in bot = 11 (3 remain elsewhere).
    // Opponent u5 still to play → opponentsRemainingNT = 1 > 0.
    // isGuaranteedWinner(10C) = false (trump remains, opponents not all trump-void).
    // safeFromTrumpIn = false → lowestCard([10C, KC]) = KC (4pts < 10pts).
    const botHand = [
      c('10C', 'C', '10'),
      c('KC', 'C', 'K'),
      c('7D', 'D', '7'),
      c('8D', 'D', '8'),
    ]
    const view = {
      phase: 'playing',
      hands: {
        u1: botHand, u2: [], u3: [], u4: [], u5: [],
      },
      currentTrick: [
        { userId: 'u2', card: c('7C', 'C', '7') },
      ],
      tricks: [
        {
          plays: [
            { userId: 'u2', card: c('QC', 'C', 'Q') },
            { userId: 'u3', card: c('QS', 'S', 'Q') },
            { userId: 'u4', card: c('QH', 'H', 'Q') },
            { userId: 'u5', card: c('QD', 'D', 'Q') },
            { userId: 'u1', card: c('JC', 'C', 'J') },
          ],
        },
        {
          plays: [
            { userId: 'u2', card: c('JS', 'S', 'J') },
            { userId: 'u3', card: c('JH', 'H', 'J') },
            { userId: 'u4', card: c('JD', 'D', 'J') },
            { userId: 'u5', card: c('AC', 'C', 'A') }, // AC played → 10C is top of clubs
          ],
        },
        // Only 9 trump in tricks (+ 2 in bot = 11); trumpRemainingElsewhere = 3
      ],
      picker: 'u1',
      partner: 'u3',
      partnerRevealed: true,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
    // u5 is in view.hands and hasn't played in currentTrick → opponentsRemainingNT = 1
    // trumpRemainingElsewhere = 3 → isGuaranteedWinner(10C) = false (trump elsewhere)
    // safeFromTrumpIn = false → lowestCard([10C, KC]) = KC (4pts < 10pts)
    expect(decidePlay(view, 'u1')).toBe('KC')
  })
})

describe('decidePlay — Case 4: partner trump lead-back timing', () => {
  // Base view factory for partner-leading tests.
  // u1=picker, u2=partner (leading), u3..u5=opponents
  // calledSuit='H', no completed tricks, currentTrick=[] (leading)
  function partnerLeadView({ hand, tricks = [], buried = [] }) {
    return {
      phase: 'playing',
      hands: { u1: [], u2: hand, u3: [], u4: [], u5: [] },
      currentTrick: [],
      tricks,
      buried,
      picker: 'u1',
      partner: 'u2',
      partnerRevealed: true,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
  }

  it('defers to lowest-point fail when partner holds 2 weak trump and strongest is not guaranteed', () => {
    // Partner holds 9D + 8D (weak trump) and fail cards (KS=4pts, 7S=0pts).
    // No tricks have been played, so all higher-rank trump (ranks 0-10) are unseen.
    // isGuaranteedWinner(9D) = false (QC through 8D rank 0-10 unaccounted for).
    // Partner has 2+ trump, fails exist → should defer to lowestCard(fails) = 7S.
    const hand = [
      c('9D', 'D', '9'),  // trump rank 11
      c('8D', 'D', '8'),  // trump rank 12
      c('KS', 'S', 'K'),  // fail, 4 pts
      c('7S', 'S', '7'),  // fail, 0 pts
    ]
    const view = partnerLeadView({ hand })
    expect(decidePlay(view, 'u2')).toBe('7S')
  })

  it('leads highest trump when strongest is a guaranteed winner', () => {
    // Partner holds QC (rank 0, always guaranteed) + 8D + fail.
    // isGuaranteedWinner(QC) = true → should cash out with QC.
    const hand = [
      c('QC', 'C', 'Q'),  // trump rank 0 — always guaranteed
      c('8D', 'D', '8'),  // trump rank 12
      c('KS', 'S', 'K'),  // fail
    ]
    const view = partnerLeadView({ hand })
    expect(decidePlay(view, 'u2')).toBe('QC')
  })

  it('leads QS when QC was played in a prior trick (QS becomes guaranteed)', () => {
    // Partner holds QS (rank 1) + 8D + fail cards. QC (rank 0) was played in trick 1
    // by an opponent, so it appears in view.tricks and seenRanks picks up rank 0.
    // isGuaranteedWinner(QS) = true → deferral guard does not fire → leads QS.
    const hand = [
      c('QS', 'S', 'Q'),  // trump rank 1 — guaranteed once QC is seen
      c('8D', 'D', '8'),  // trump rank 12
      c('KS', 'S', 'K'),  // fail, 4 pts
      c('7S', 'S', '7'),  // fail, 0 pts
    ]
    const tricks = [
      {
        plays: [
          { userId: 'u3', card: c('QC', 'C', 'Q') },  // QC (rank 0) played by opponent
          { userId: 'u1', card: c('JC', 'C', 'J') },
          { userId: 'u2', card: c('9H', 'H', '9') },
          { userId: 'u4', card: c('8H', 'H', '8') },
          { userId: 'u5', card: c('7H', 'H', '7') },
        ],
      },
    ]
    const view = partnerLeadView({ hand, tricks })
    expect(decidePlay(view, 'u2')).toBe('QS')
  })

  it('leads trump unconditionally when partner has exactly 1 trump (even if not guaranteed)', () => {
    // Partner holds 9D (weak trump, not guaranteed) + fail cards.
    // Only 1 trump → lead it unconditionally (no deferral).
    const hand = [
      c('9D', 'D', '9'),  // trump rank 11, not guaranteed
      c('KS', 'S', 'K'),  // fail
      c('7S', 'S', '7'),  // fail
    ]
    const view = partnerLeadView({ hand })
    expect(decidePlay(view, 'u2')).toBe('9D')
  })

  it('leads highest trump when partner has 2+ trump but no fail cards to defer to', () => {
    // Partner holds QS (rank 1, not guaranteed — QC unseen) + 8D. No fail cards.
    // Can't defer when there's nothing to defer to → lead highest trump (QS).
    const hand = [
      c('QS', 'S', 'Q'),  // trump rank 1, not guaranteed (QC rank 0 unseen)
      c('8D', 'D', '8'),  // trump rank 12
    ]
    const view = partnerLeadView({ hand })
    expect(decidePlay(view, 'u2')).toBe('QS')
  })

  it('does not defer for the picker — picker with 2 weak trump still leads highest trump', () => {
    // Picker (u1) holds 9D + 8D (weak trump, not guaranteed) and fail cards.
    // The new deferral logic is partner-only → picker should still lead highest trump (9D).
    const hand = [
      c('9D', 'D', '9'),  // trump rank 11
      c('8D', 'D', '8'),  // trump rank 12
      c('KS', 'S', 'K'),  // fail
      c('7S', 'S', '7'),  // fail
    ]
    const view = {
      phase: 'playing',
      hands: { u1: hand, u2: [], u3: [], u4: [], u5: [] },
      currentTrick: [],
      tricks: [],
      buried: [],
      picker: 'u1',
      partner: 'u2',
      partnerRevealed: true,
      calledSuit: 'H',
      calledAce: { aceId: 'AH' },
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u1')).toBe('9D')
  })
})

describe('decidePlay — opponent plays cheapest trump when picker-team winner is unbeatable (#169)', () => {
  it('plays lowest trump instead of highest when no trump can beat current winner', () => {
    // Fail led (9H). Picker u2 already played QC (rank 0, highest trump possible).
    // Bot u4 (opponent) is void in hearts, holds QS (rank 3) and JD (rank 7).
    // Neither card beats QC. Pre-fix: highestTrump fires → QS donated to picker.
    // Post-fix: winningTrump filter finds none → falls through to lowestCard → JD.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('QS', 'S', 'Q'),
          c('JD', 'D', 'J'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9H', 'H', '9') },
        { userId: 'u2', card: c('QC', 'C', 'Q') },
      ],
      tricks: [],
      picker: 'u2',
      partner: 'u5',
      partnerRevealed: true,
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
    expect(decidePlay(view, 'u4')).toBe('JD')
  })

  it('schmears weakest winning trump (JH) not strongest (QS) when it can beat the picker-team winner', () => {
    // Fail led (9H). Picker u2 already played JD (rank 7, lowest trump).
    // Bot u4 (opponent) is void in hearts, holds QS (rank 3) and JH (rank 5).
    // Both QS and JH beat JD. Schmear priority: J rank before Q → JH (weakest
    // J by trump rank). QS preserved for future hard trump battles.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('QS', 'S', 'Q'),
          c('JH', 'H', 'J'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('9H', 'H', '9') },
        { userId: 'u2', card: c('JD', 'D', 'J') },
      ],
      tricks: [],
      picker: 'u2',
      partner: 'u5',
      partnerRevealed: true,
      callMode: 'ace',
      calledSuit: 'S',
      calledAce: { aceId: 'AS' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u4')).toBe('JH')
  })

  it('uses 7♦ not Q♥ when partner reveals mid-trick by playing called card', () => {
    // Called suit H led (8H). Partner u2 plays AH (revealing themselves).
    // Bot u3 (opponent) is void in hearts, holds QH (trump rank 2), JH (trump
    // rank 6), 7D (trump rank 13). All three beat non-trump AH.
    // Schmear priority on winningTrump: A/10/K/9/8/7 before J/Q → 7D.
    // QH and JH preserved for future trump battles.
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [],
        u3: [
          c('QH', 'H', 'Q'), c('JH', 'H', 'J'), c('7D', 'D', '7'),
          c('KS', 'S', 'K'), c('AC', 'C', 'A'), c('7C', 'C', '7'),
        ],
        u4: [], u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('8H', 'H', '8') },
        { userId: 'u2', card: c('AH', 'H', 'A') },
      ],
      tricks: [],
      picker: 'u4',
      partner: 'u2',
      partnerRevealed: true,
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
    expect(decidePlay(view, 'u3')).toBe('7D')
  })
})

describe('decidePlay — shed weakest trump when forced to follow and cannot win (#170)', () => {
  it('opponent sheds weakest trump (KD rank 10) not cheapest (JS rank 5) on unbeatable trump trick', () => {
    // Trump-led trick: u1 led JH (rank 6), u2 (picker) played QC (rank 0 — unbeatable).
    // Bot u4 (opponent) must follow trump. Holds KD (rank 10, 4pts), QS (rank 1, 3pts), JS (rank 5, 2pts).
    // Pre-fix: lowestCard picks JS (2pts). Post-fix: shed weakest trump → KD (rank 10).
    const view = {
      phase: 'playing',
      hands: {
        u1: [], u2: [], u3: [],
        u4: [
          c('KD', 'D', 'K'),
          c('QS', 'S', 'Q'),
          c('JS', 'S', 'J'),
        ],
        u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('JH', 'H', 'J') },
        { userId: 'u2', card: c('QC', 'C', 'Q') },
      ],
      tricks: [],
      picker: 'u2',
      partner: 'u5',
      partnerRevealed: true,
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
    expect(decidePlay(view, 'u4')).toBe('KD')
  })

  it('picker-team bot sheds weakest trump (KD rank 10) not cheapest (JS rank 5) on unbeatable trump trick', () => {
    // Trump-led trick: u1 (opponent) led QC (rank 0 — unbeatable).
    // Bot u3 (partner, picker-team) must follow trump. Holds KD (rank 10, 4pts), QS (rank 1, 3pts), JS (rank 5, 2pts).
    // No teammate is winning. winning.length === 0 → falls to picker-team "can't win" path.
    // Pre-fix: lowestCard picks JS (2pts). Post-fix: shed weakest trump → KD (rank 10).
    const view = {
      phase: 'playing',
      hands: {
        u1: [],
        u2: [c('JD', 'D', 'J')],
        u3: [
          c('KD', 'D', 'K'),
          c('QS', 'S', 'Q'),
          c('JS', 'S', 'J'),
        ],
        u4: [], u5: [],
      },
      currentTrick: [
        { userId: 'u1', card: c('QC', 'C', 'Q') },
      ],
      tricks: [],
      picker: 'u2',
      partner: 'u3',
      partnerRevealed: true,
      callMode: 'ace',
      calledSuit: 'S',
      calledAce: { aceId: 'AS' },
      calledTen: null,
      calledKing: null,
      crackerId: null,
      recrackerId: null,
      isLeaster: false,
      lastTrick: [],
    }
    expect(decidePlay(view, 'u3')).toBe('KD')
  })
})
