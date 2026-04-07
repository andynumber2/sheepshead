import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/api.js'
import PlayerSeat from '../components/PlayerSeat.jsx'
import TrickArea from '../components/TrickArea.jsx'
import ActionPanel from '../components/ActionPanel.jsx'
import GameLog from '../components/GameLog.jsx'
import ScoreBoard from '../components/ScoreBoard.jsx'
import Hand from '../components/Hand.jsx'

// Seat layout relative to current player (always at bottom)
// slots: bottom(you), left, top-left, top, top-right, right
// For 5 players, seats rotate so "you" are always at bottom
function getRelativeSeats(players, myUserId) {
  const sorted = [...players].sort((a, b) => a.seat - b.seat)
  const myIdx = sorted.findIndex(p => String(p.user_id) === String(myUserId))
  if (myIdx === -1) return { bottom: null, left: null, topLeft: null, top: null, topRight: null }

  const get = (offset) => sorted[(myIdx + offset) % sorted.length] ?? null
  return {
    bottom: get(0),
    left:   get(4),
    topLeft: get(3),
    top:    get(2),
    topRight: get(1),
  }
}

function ScoringOverlay({ state, players, onNextHand, loading }) {
  const scores = state.scores ?? {}
  const sorted = [...players].sort((a, b) => (scores[b.user_id] ?? 0) - (scores[a.user_id] ?? 0))

  const pickerTeam = state.goingAlone
    ? [state.picker]
    : [state.picker, state.partner].filter(Boolean)

  const pickerWon = pickerTeam.reduce((s, uid) => s + (scores[uid] ?? 0), 0) > 0

  return (
    <div className="scoring-overlay">
      <div className="scoring-card">
        <h2>{state.isLeaster ? '🃏 Leaster!' : pickerWon ? '🏆 Picker wins!' : '🎉 Opponents win!'}</h2>
        {state.doublerMultiplier > 1 && (
          <p style={{ color: '#f59e0b' }}>Doubler multiplier: ×{state.doublerMultiplier}</p>
        )}
        <table style={{ width: '100%', marginBottom: 16 }}>
          <thead>
            <tr><th>Player</th><th>This hand</th></tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const delta = scores[p.user_id] ?? 0
              return (
                <tr key={p.user_id}>
                  <td>
                    {p.username}
                    {pickerTeam.includes(String(p.user_id)) && (
                      <span className="badge badge-picker" style={{ marginLeft: 6 }}>picker team</span>
                    )}
                  </td>
                  <td className={delta >= 0 ? 'delta-positive' : 'delta-negative'}>
                    {delta > 0 ? `+${delta}` : delta}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <button onClick={onNextHand} aria-busy={loading} disabled={loading}>
          Next hand →
        </button>
      </div>
    </div>
  )
}

export default function GamePage({ gameId, user, onNavigate }) {
  const [gameData, setGameData] = useState(null)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const pollingRef = useRef(null)

  const myUserId = String(user.id)

  const fetchGame = useCallback(async () => {
    try {
      const data = await api.games.get(gameId)
      setGameData(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [gameId])

  useEffect(() => {
    fetchGame()
    pollingRef.current = setInterval(fetchGame, 2000)
    return () => clearInterval(pollingRef.current)
  }, [fetchGame])

  async function handleAction(type, payload) {
    setActionLoading(true)
    try {
      await api.games.action(gameId, type, payload)
      await fetchGame()
    } finally {
      setActionLoading(false)
    }
  }

  if (error) return (
    <div style={{ padding: 32, color: '#fff' }}>
      <p>Error: {error}</p>
      <button onClick={() => onNavigate('/lobby')}>Back to lobby</button>
    </div>
  )

  if (!gameData) return (
    <div style={{ padding: 32, color: '#fff' }} aria-busy="true">Loading game…</div>
  )

  const { players, state, status, no_pick_variant: noPickVariant } = gameData

  // Waiting for players
  if (status === 'waiting') {
    const amIn = players.some(p => String(p.user_id) === myUserId)
    return (
      <div style={{ padding: 32, color: '#fff', maxWidth: 500, margin: '0 auto' }}>
        <h2>{gameData.name}</h2>
        <p>Waiting for players… ({players.length}/5)</p>
        <ul>
          {players.map(p => <li key={p.user_id}>{p.username}</li>)}
        </ul>
        {!amIn && players.length < 5 && (
          <button onClick={() => handleAction('join')}>Join game</button>
        )}
        <button className="outline" onClick={() => onNavigate('/lobby')} style={{ marginLeft: 8 }}>
          Back to lobby
        </button>
      </div>
    )
  }

  if (!state) return <div style={{ padding: 32, color: '#fff' }}>Waiting for game state…</div>

  const seats = getRelativeSeats(players, myUserId)
  const myPlayer = players.find(p => String(p.user_id) === myUserId)
  const myHand = state.hands?.[myUserId] ?? []

  const dealerUserId = state.pickOrder ? state.pickOrder[state.dealerSeat] : null
  const pickerUserId = state.picker
  const partnerUserId = state.partnerRevealed ? state.partner : null

  function seatProps(player) {
    if (!player) return {}
    const uid = String(player.user_id)
    return {
      isDealer: uid === dealerUserId,
      isPicker: uid === pickerUserId,
      isPartner: uid === partnerUserId,
      isYou: uid === myUserId,
      isActiveTurn: uid === currentTurnPlayer(state),
      cardCount: state.hands?.[uid]?.length ?? 0,
    }
  }

  const log = state.log ?? []
  const currentTrick = state.currentTrick ?? []

  return (
    <div className="game-table">
      {/* Top-left seat */}
      <div className="seat-top-left">
        <PlayerSeat player={seats.topLeft} {...seatProps(seats.topLeft)} />
      </div>

      {/* Top seat */}
      <div className="seat-top">
        <PlayerSeat player={seats.top} {...seatProps(seats.top)} />
      </div>

      {/* Top-right seat */}
      <div className="seat-top-right">
        <PlayerSeat player={seats.topRight} {...seatProps(seats.topRight)} />
      </div>

      {/* Left seat */}
      <div className="seat-left">
        <PlayerSeat player={seats.left} {...seatProps(seats.left)} />
      </div>

      {/* Center trick area */}
      <TrickArea
        trick={currentTrick}
        players={players}
        blind={state.phase === 'picking' ? (state.blind ?? []) : []}
      />

      {/* Right seat */}
      <div className="seat-right">
        <PlayerSeat player={seats.right} {...seatProps(seats.right)} />
      </div>

      {/* Bottom — your hand */}
      <div className="seat-bottom" style={{ textAlign: 'center' }}>
        <PlayerSeat player={seats.bottom} {...seatProps(seats.bottom)} />
        {state.phase !== 'discarding' && state.phase !== 'playing' && (
          <Hand cards={myHand} />
        )}
      </div>

      {/* Action panel */}
      <ActionPanel
        state={state}
        myUserId={myUserId}
        myHand={myHand}
        onAction={handleAction}
        loading={actionLoading}
      />

      {/* Game log */}
      <GameLog entries={log} />

      {/* Score board */}
      <ScoreBoard players={players} />

      {/* Scoring overlay */}
      {state.phase === 'scoring' && (
        <ScoringOverlay
          state={state}
          players={players}
          onNextHand={() => handleAction('next_hand')}
          loading={actionLoading}
        />
      )}
    </div>
  )
}

function currentTurnPlayer(state) {
  if (!state) return null
  const { phase, pickOrder, pickIndex, currentTrick, currentLeader } = state
  if (phase === 'picking') return pickOrder?.[pickIndex] ?? null
  if (phase === 'discarding' || phase === 'calling') return state.picker
  if (phase === 'playing') {
    const played = (currentTrick ?? []).map(p => p.userId)
    const leaderIdx = pickOrder.indexOf(currentLeader)
    for (let i = 0; i < 5; i++) {
      const uid = pickOrder[(leaderIdx + i) % 5]
      if (!played.includes(uid)) return uid
    }
  }
  return null
}
