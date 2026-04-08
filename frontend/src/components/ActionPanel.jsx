import { useState } from 'react'
import Hand from './Hand.jsx'

const SUIT_SYMBOLS = { C: '♣', H: '♥', S: '♠' }

export default function ActionPanel({ state, myUserId, myHand, onAction, loading, actingForName }) {
  const botStyle = actingForName
    ? { background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)' }
    : {}
  const turnLabel = actingForName ? `Acting for ${actingForName}` : 'Your turn'
  const [selectedDiscards, setSelectedDiscards] = useState([])
  const [error, setError] = useState(null)

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

  const { phase, picker, pickOrder, pickIndex, currentTrick, isLeaster, doublerMultiplier } = state

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
      return <div className="action-panel"><p>Waiting for picker to call an ace…</p></div>
    }
    const myAces = new Set(myHand.map(c => c.id))
    const callableSuits = ['C', 'H', 'S'].filter(s => !myAces.has(`A${s}`))

    return (
      <div className="action-panel" style={botStyle}>
        <h4>Call an ace</h4>
        <p style={{ fontSize: '0.85rem', color: '#ccc' }}>The holder of the called ace is your partner.</p>
        <div className="suit-picker">
          {callableSuits.map(suit => (
            <button
              key={suit}
              className={`suit-btn ${suit === 'H' || suit === 'D' ? 'red' : 'black'}`}
              onClick={() => act('call_ace', { suit })}
              disabled={loading}
              title={`Call A${suit}`}
            >
              A{SUIT_SYMBOLS[suit]}
            </button>
          ))}
        </div>
        {callableSuits.length === 0 && (
          <p style={{ color: '#f87171' }}>You hold all non-trump aces — you go alone!</p>
        )}
        {error && <p style={{ color: '#f87171', marginTop: 6 }}>{error}</p>}
      </div>
    )
  }

  // ── Playing phase ─────────────────────────────────────────
  if (phase === 'playing') {
    const myTurn = currentPlayer(state) === myUserId

    if (!myTurn) {
      return (
        <div className="action-panel">
          <p>Waiting for others to play…</p>
          {isLeaster && <p style={{ color: '#f59e0b' }}>🃏 Leaster — fewest points wins!</p>}
        </div>
      )
    }

    // Acting for a bot: show the header so admin knows who they're playing for
    if (actingForName) {
      return (
        <div className="action-panel" style={botStyle}>
          <h4>{turnLabel} — play a card</h4>
          {isLeaster && <p style={{ color: '#f59e0b', marginBottom: 4 }}>🃏 Leaster — fewest points wins!</p>}
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
