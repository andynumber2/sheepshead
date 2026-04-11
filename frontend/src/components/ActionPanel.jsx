import { useState } from 'react'
import Hand from './Hand.jsx'

const SUIT_SYMBOLS = { C: '♣', H: '♥', S: '♠' }

export default function ActionPanel({ state, myUserId, myHand, onAction, loading, actingForName }) {
  const botStyle = actingForName
    ? { background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)' }
    : {}
  const turnLabel = actingForName ? `Acting for ${actingForName}` : 'Your turn'
  const [selectedDiscards, setSelectedDiscards] = useState([])
  const [unknownSelectedSuit, setUnknownSelectedSuit] = useState(null)
  const [selectedUnderCard, setSelectedUnderCard] = useState(null)
  const [confirmingAlone, setConfirmingAlone] = useState(false)
  const [error, setError] = useState(null)

  const goAloneSection = (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
      {confirmingAlone ? (
        <>
          <p style={{ fontSize: '0.85rem', color: '#fbbf24', marginBottom: 6 }}>
            Play this hand alone against all four opponents?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => act('go_alone').then(() => setConfirmingAlone(false))}
              disabled={loading}
            >
              Confirm Go Alone
            </button>
            <button
              className="secondary"
              onClick={() => setConfirmingAlone(false)}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          className="secondary"
          onClick={() => setConfirmingAlone(true)}
          disabled={loading}
        >
          Go Alone
        </button>
      )}
    </div>
  )

  async function act(type, payload) {
    setError(null)
    try {
      await onAction(type, payload)
      setSelectedDiscards([])
    } catch (e) {
      setError(e.message)
    }
  }

  if (!state) return null

  const { phase, picker, pickOrder, pickIndex, currentTrick, isLeaster, doublerMultiplier,
          crackState, handCrackMultiplier } = state

  // ── Picking phase ─────────────────────────────────────────
  if (phase === 'picking') {
    const myTurn = pickOrder[pickIndex] === myUserId
    if (!myTurn) {
      const waitingFor = pickOrder[pickIndex]
      return (
        <div className="action-panel">
          <h4>Picking phase</h4>
          <p>Waiting for player to pick or pass…</p>
          {doublerMultiplier > 1 && <p>Stakes: ×{doublerMultiplier}</p>}
        </div>
      )
    }
    return (
      <div className="action-panel" style={botStyle}>
        <h4>{turnLabel} — pick or pass?</h4>
        {doublerMultiplier > 1 && <p style={{ color: '#f59e0b' }}>⚠ Stakes are ×{doublerMultiplier}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
          <button onClick={() => act('pick')} disabled={loading}>Pick the blind</button>
          <button className="secondary" onClick={() => act('pass')} disabled={loading}>Pass</button>
        </div>
        {error && <p style={{ color: '#f87171', marginTop: 6 }}>{error}</p>}
      </div>
    )
  }

  // ── Discarding phase ──────────────────────────────────────
  if (phase === 'discarding') {
    if (picker !== myUserId) {
      return <div className="action-panel"><p>Waiting for picker to discard…</p></div>
    }
    const toggleDiscard = (card) => {
      setSelectedDiscards(prev => {
        if (prev.find(c => c.id === card.id)) return prev.filter(c => c.id !== card.id)
        if (prev.length >= 2) return prev
        return [...prev, card]
      })
    }
    return (
      <div className="action-panel" style={botStyle}>
        <h4>Select 2 cards to discard</h4>
        <p className="discard-hint">({selectedDiscards.length}/2 selected)</p>
        <Hand
          cards={myHand}
          playableIds={myHand.map(c => c.id)}
          selectedIds={selectedDiscards.map(c => c.id)}
          onCardClick={toggleDiscard}
        />
        <button
          disabled={selectedDiscards.length !== 2 || loading}
          onClick={() => act('discard', { cardIds: selectedDiscards.map(c => c.id) })}
          style={{ marginTop: 8 }}
        >
          Confirm Discard
        </button>
        {error && <p style={{ color: '#f87171', marginTop: 6 }}>{error}</p>}
      </div>
    )
  }

  // ── Calling phase ─────────────────────────────────────────
  if (phase === 'calling') {
    if (picker !== myUserId) {
      return <div className="action-panel"><p>Waiting for picker to call a partner card…</p></div>
    }

    const callMode = state.callMode ?? 'ace'
    const heldIds = new Set(myHand.map(c => c.id))
    // Cards the picker buried — cannot call any of these since the "partner" would be
    // nobody (the card is in the blind, never played).
    const buriedIds = new Set((state.discard ?? []).filter(c => !c.hidden).map(c => c.id))

    // ── King mode: picker holds all 3 fail aces and all 3 fail tens.
    //    Calls the King of any fail suit they don't hold (mathematically all 3).
    if (callMode === 'king') {
      const callableSuits = ['C', 'H', 'S'].filter(s => !heldIds.has(`K${s}`) && !buriedIds.has(`K${s}`))
      return (
        <div className="action-panel" style={botStyle}>
          <h4>Call a king</h4>
          <p style={{ fontSize: '0.85rem', color: '#ccc' }}>
            You hold all fail aces and tens. Call a king as your partner.
            You'll be forced to play your A and 10 of the called suit when it's led.
          </p>
          <div className="suit-picker">
            {callableSuits.map(suit => (
              <button
                key={suit}
                className={`suit-btn ${suit === 'H' ? 'red' : 'black'}`}
                onClick={() => act('call_king', { suit })}
                disabled={loading}
                title={`Call K${suit}`}
              >
                K{SUIT_SYMBOLS[suit]}
              </button>
            ))}
          </div>
          {goAloneSection}
          {error && <p style={{ color: '#f87171', marginTop: 6 }}>{error}</p>}
        </div>
      )
    }

    // ── Ten mode: picker holds all 3 fail aces but not all 3 fail tens.
    //    Calls the 10 of a fail suit whose 10 they do not hold.
    if (callMode === 'ten') {
      const callableSuits = ['C', 'H', 'S'].filter(s => !heldIds.has(`10${s}`) && !buriedIds.has(`10${s}`))
      return (
        <div className="action-panel" style={botStyle}>
          <h4>Call a ten</h4>
          <p style={{ fontSize: '0.85rem', color: '#ccc' }}>
            You hold all three fail aces. Call a 10 as your partner.
            You'll be forced to play the Ace of the called suit when that suit is led.
          </p>
          <div className="suit-picker">
            {callableSuits.map(suit => (
              <button
                key={suit}
                className={`suit-btn ${suit === 'H' ? 'red' : 'black'}`}
                onClick={() => act('call_ten', { suit })}
                disabled={loading}
                title={`Call 10${suit}`}
              >
                10{SUIT_SYMBOLS[suit]}
              </button>
            ))}
          </div>
          {goAloneSection}
          {error && <p style={{ color: '#f87171', marginTop: 6 }}>{error}</p>}
        </div>
      )
    }

    // ── Ace mode (default). Each suit is either a normal call or requires placing
    //    an under card (Situation B) if the picker holds no fail card of that suit.
    const isFailCard = (c, s) => c.suit === s && c.rank !== 'Q' && c.rank !== 'J'
    const candidateSuits = ['C', 'H', 'S'].filter(s => !heldIds.has(`A${s}`) && !buriedIds.has(`A${s}`))
    const normalSuits = candidateSuits.filter(s => myHand.some(c => isFailCard(c, s)))
    const unknownSuits = candidateSuits.filter(s => !myHand.some(c => isFailCard(c, s)))

    if (unknownSelectedSuit) {
      // Situation B: pick the under card from hand
      return (
        <div className="action-panel" style={botStyle}>
          <h4>Place an under card for A{SUIT_SYMBOLS[unknownSelectedSuit]} Unknown</h4>
          <p style={{ fontSize: '0.85rem', color: '#ccc' }}>
            Choose any card to place face-down as the under card. It has no power; it must be played
            when the called suit is led.
          </p>
          <Hand
            cards={myHand}
            playableIds={myHand.map(c => c.id)}
            selectedIds={selectedUnderCard ? [selectedUnderCard] : []}
            onCardClick={(card) => setSelectedUnderCard(card.id)}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
            <button
              disabled={!selectedUnderCard || loading}
              onClick={() => act('call_ace_unknown', { suit: unknownSelectedSuit, underCardId: selectedUnderCard })
                .then(() => { setUnknownSelectedSuit(null); setSelectedUnderCard(null) })}
            >
              Confirm
            </button>
            <button
              className="secondary"
              onClick={() => { setUnknownSelectedSuit(null); setSelectedUnderCard(null) }}
              disabled={loading}
            >
              Back
            </button>
          </div>
          {error && <p style={{ color: '#f87171', marginTop: 6 }}>{error}</p>}
        </div>
      )
    }

    return (
      <div className="action-panel" style={botStyle}>
        <h4>Call an ace</h4>
        <p style={{ fontSize: '0.85rem', color: '#ccc' }}>The holder of the called ace is your partner.</p>
        <div className="suit-picker">
          {normalSuits.map(suit => (
            <button
              key={suit}
              className={`suit-btn ${suit === 'H' ? 'red' : 'black'}`}
              onClick={() => act('call_ace', { suit })}
              disabled={loading}
              title={`Call A${suit}`}
            >
              A{SUIT_SYMBOLS[suit]}
            </button>
          ))}
        </div>
        {/* Under card calls are only allowed when there is no normal call available. */}
        {normalSuits.length === 0 && unknownSuits.length > 0 && (
          <>
            <p style={{ fontSize: '0.8rem', color: '#ccc', marginTop: 8 }}>
              You hold no fail card of any callable suit. Place an under card and call Unknown:
            </p>
            <div className="suit-picker">
              {unknownSuits.map(suit => (
                <button
                  key={suit}
                  className={`suit-btn ${suit === 'H' ? 'red' : 'black'}`}
                  onClick={() => setUnknownSelectedSuit(suit)}
                  disabled={loading}
                  title={`Call A${suit} Unknown`}
                >
                  A{SUIT_SYMBOLS[suit]}?
                </button>
              ))}
            </div>
          </>
        )}
        {normalSuits.length === 0 && unknownSuits.length === 0 && (
          <p style={{ color: '#f87171' }}>No valid suit to call. Contact the game admin.</p>
        )}
        {goAloneSection}
        {error && <p style={{ color: '#f87171', marginTop: 6 }}>{error}</p>}
      </div>
    )
  }

  // ── Playing phase ─────────────────────────────────────────
  if (phase === 'playing') {
    const myTurn = currentPlayer(state) === myUserId

    // Crack / recrack window: before the first card of the hand is played
    const crackWindowOpen = !isLeaster && state.tricks.length === 0 && currentTrick.length === 0
    const iAmOpponent = myUserId !== state.picker && myUserId !== state.partner
    const passedAtPicking = state.pickOrder.slice(0, state.pickIndex)
    const iPassedAtPicking = passedAtPicking.includes(myUserId)
    const canCrack = crackWindowOpen && iAmOpponent && crackState === null && !iPassedAtPicking
    const canRecrack = crackWindowOpen && !iAmOpponent && crackState === 'cracked'

    if (crackWindowOpen && (canCrack || canRecrack || crackState !== null)) {
      const crackLabel =
        crackState === 'recracked' ? 'Recracked! Stakes ×4 for this hand.'
        : crackState === 'cracked' ? 'Opponents cracked! Stakes ×2 for this hand.'
        : null

      return (
        <div className="action-panel">
          {crackLabel && (
            <p style={{ color: '#fbbf24', fontWeight: 'bold', marginBottom: 8 }}>{crackLabel}</p>
          )}
          {canCrack && (
            <div>
              <p style={{ fontSize: '0.85rem', color: '#ccc', marginBottom: 6 }}>
                Double this hand's stakes before play begins.
              </p>
              <button onClick={() => act('crack')} disabled={loading}>
                Crack (×2)
              </button>
            </div>
          )}
          {canRecrack && (
            <div>
              <p style={{ fontSize: '0.85rem', color: '#ccc', marginBottom: 6 }}>
                Double again — opponents cracked first.
              </p>
              <button onClick={() => act('recrack')} disabled={loading}>
                Recrack (×4)
              </button>
            </div>
          )}
          {!canCrack && !canRecrack && crackState !== null && (
            <p style={{ fontSize: '0.85rem', color: '#aaa' }}>Waiting for others to play…</p>
          )}
          {error && <p style={{ color: '#f87171', marginTop: 6 }}>{error}</p>}
        </div>
      )
    }

    if (!myTurn) {
      return (
        <div className="action-panel">
          <p>Waiting for others to play…</p>
          {isLeaster && <p style={{ color: '#f59e0b' }}>Leaster — fewest points wins!</p>}
        </div>
      )
    }

    // Acting for a bot: show the header so admin knows who they're playing for
    if (actingForName) {
      return (
        <div className="action-panel" style={botStyle}>
          <h4>{turnLabel} — play a card</h4>
          {isLeaster && <p style={{ color: '#f59e0b', marginBottom: 4 }}>Leaster — fewest points wins!</p>}
        </div>
      )
    }

    // Real player's turn: cards are played directly from the hand in seat-bottom
    return null
  }

  // ── Scoring phase ─────────────────────────────────────────
  if (phase === 'scoring') {
    return null  // Handled by scoring overlay in GamePage
  }

  return null
}

// Helper to determine whose turn it is during playing phase
function currentPlayer(state) {
  const played = state.currentTrick.map(p => p.userId)
  const seats = state.pickOrder
  const leaderIdx = seats.indexOf(state.currentLeader)
  for (let i = 0; i < 5; i++) {
    const uid = seats[(leaderIdx + i) % 5]
    if (!played.includes(uid)) return uid
  }
  return null
}
