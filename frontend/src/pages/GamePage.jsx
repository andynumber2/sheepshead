import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/api.js'
import PlayerSeat from '../components/PlayerSeat.jsx'
import TrickArea from '../components/TrickArea.jsx'
import ActionPanel from '../components/ActionPanel.jsx'
import GameLog from '../components/GameLog.jsx'
import ScoreBoard from '../components/ScoreBoard.jsx'
import Hand from '../components/Hand.jsx'

const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers' }

// Seat layout relative to current player (always at bottom)
function getRelativeSeats(players, myUserId) {
  const sorted = [...players].sort((a, b) => a.seat - b.seat)
  const myIdx = sorted.findIndex(p => String(p.user_id) === String(myUserId))
  if (myIdx === -1) return { bottom: null, left: null, topLeft: null, top: null, topRight: null }
  const get = (offset) => sorted[(myIdx + offset) % sorted.length] ?? null
  return {
    bottom:   get(0),
    left:     get(4),
    topLeft:  get(3),
    top:      get(2),
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
          <thead><tr><th>Player</th><th>This hand</th></tr></thead>
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
        <button onClick={onNextHand} aria-busy={loading} disabled={loading}>Next hand →</button>
      </div>
    </div>
  )
}

function AdminSettingsPanel({ gameId, currentVariant, onUpdated }) {
  const [variant, setVariant] = useState(currentVariant)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Keep local state in sync if parent changes (e.g. on poll)
  useEffect(() => { setVariant(currentVariant) }, [currentVariant])

  async function handleChange(newVariant) {
    setVariant(newVariant)
    setSaving(true)
    setSaved(false)
    try {
      await api.games.updateSettings(gameId, { no_pick_variant: newVariant })
      setSaved(true)
      onUpdated?.(newVariant)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      // revert on error
      setVariant(currentVariant)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      background: 'rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 8,
      padding: '10px 14px',
      color: '#fff',
      fontSize: '0.82rem',
    }}>
      <strong>⚙ Admin — No-pick variant</strong>
      <small style={{ color: '#aaa', display: 'block', marginBottom: 6 }}>
        Change takes effect next no-pick hand
      </small>
      <div style={{ display: 'flex', gap: 8 }}>
        {['leasters', 'doublers'].map(v => (
          <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="variant"
              value={v}
              checked={variant === v}
              onChange={() => handleChange(v)}
              disabled={saving}
            />
            {VARIANT_LABELS[v]}
          </label>
        ))}
        {saving && <span style={{ color: '#aaa' }}>Saving…</span>}
        {saved && <span style={{ color: '#4ade80' }}>✓ Saved</span>}
      </div>
    </div>
  )
}

export default function GamePage({ gameId, user, onNavigate }) {
  const [gameData, setGameData] = useState(null)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [currentVariant, setCurrentVariant] = useState(null)
  const pollingRef = useRef(null)

  const myUserId = String(user.id)

  const fetchGame = useCallback(async () => {
    try {
      const data = await api.games.get(gameId)
      setGameData(data)
      setCurrentVariant(prev => prev ?? data.no_pick_variant)
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

  async function handleLeave() {
    if (!window.confirm('Leave this game? If the game is active, it will end for everyone.')) return
    setLeaving(true)
    try {
      await api.games.leave(gameId)
      onNavigate('/lobby')
    } catch (e) {
      setError(e.message)
      setLeaving(false)
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

  const { players, state, status, is_admin: isAdmin, no_pick_variant: noPickVariant } = gameData

  // ── Game ended (someone left mid-game) ─────────────────────────────────────
  if (status === 'complete') {
    return (
      <div style={{ padding: 32, color: '#fff', maxWidth: 500, margin: '40px auto', textAlign: 'center' }}>
        <h2>Game Over</h2>
        <p>This game has ended (a player left or the game was completed).</p>
        <ScoreBoard players={players} />
        <button style={{ marginTop: 16 }} onClick={() => onNavigate('/lobby')}>Back to lobby</button>
      </div>
    )
  }

  // ── Waiting for players ─────────────────────────────────────────────────────
  if (status === 'waiting') {
    const amIn = players.some(p => String(p.user_id) === myUserId)
    return (
      <div style={{ padding: 32, color: '#fff', maxWidth: 500, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{gameData.name}</h2>
          {amIn && (
            <button
              className="outline contrast"
              onClick={handleLeave}
              aria-busy={leaving}
              disabled={leaving}
              style={{ fontSize: '0.85rem' }}
            >
              Leave game
            </button>
          )}
        </div>

        {isAdmin && (
          <AdminSettingsPanel
            gameId={gameId}
            currentVariant={currentVariant ?? noPickVariant}
            onUpdated={setCurrentVariant}
          />
        )}
        {!isAdmin && (
          <p style={{ fontSize: '0.85rem', color: '#aaa' }}>
            No-pick variant: <strong style={{ color: '#fff' }}>{VARIANT_LABELS[currentVariant ?? noPickVariant]}</strong>
          </p>
        )}

        <p style={{ marginTop: 12 }}>Waiting for players… ({players.length}/5)</p>
        <ul>
          {players.map(p => (
            <li key={p.user_id}>
              {p.username}
              {String(p.user_id) === myUserId && <span className="badge badge-you" style={{ marginLeft: 6 }}>you</span>}
              {gameData.created_by === p.user_id && <span className="badge badge-dealer" style={{ marginLeft: 4 }}>admin</span>}
            </li>
          ))}
        </ul>

        <button className="outline" onClick={() => onNavigate('/lobby')} style={{ marginTop: 8 }}>
          Back to lobby
        </button>
      </div>
    )
  }

  if (!state) return <div style={{ padding: 32, color: '#fff' }}>Waiting for game state…</div>

  const seats = getRelativeSeats(players, myUserId)
  const myHand = state.hands?.[myUserId] ?? []

  const dealerUserId = state.pickOrder ? state.pickOrder[state.dealerSeat] : null
  const partnerUserId = state.partnerRevealed ? state.partner : null

  function seatProps(player) {
    if (!player) return {}
    const uid = String(player.user_id)
    return {
      isDealer: uid === dealerUserId,
      isPicker: uid === state.picker,
      isPartner: uid === partnerUserId,
      isYou: uid === myUserId,
      isActiveTurn: uid === currentTurnPlayer(state),
      cardCount: state.hands?.[uid]?.length ?? 0,
    }
  }

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
        trick={state.currentTrick ?? []}
        players={players}
        blind={state.phase === 'picking' ? (state.blind ?? []) : []}
      />

      {/* Right seat */}
      <div className="seat-right">
        <PlayerSeat player={seats.right} {...seatProps(seats.right)} />
      </div>

      {/* Bottom — your hand + leave button */}
      <div className="seat-bottom" style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <PlayerSeat player={seats.bottom} {...seatProps(seats.bottom)} />
          <button
            className="outline contrast"
            onClick={handleLeave}
            aria-busy={leaving}
            disabled={leaving}
            style={{ fontSize: '0.75rem', padding: '4px 10px', whiteSpace: 'nowrap' }}
          >
            Leave game
          </button>
        </div>
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
      <GameLog entries={state.log ?? []} />

      {/* Admin settings panel (active game) */}
      <div className="admin-panel-area">
        {isAdmin && (
          <AdminSettingsPanel
            gameId={gameId}
            currentVariant={currentVariant ?? noPickVariant}
            onUpdated={setCurrentVariant}
          />
        )}
      </div>

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
