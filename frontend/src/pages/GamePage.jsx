import { useState, useEffect, useCallback, useRef } from 'react'
import { effectiveSuit } from '@shared/gameEngine.js'
import { api } from '../lib/api.js'
import PlayerSeat from '../components/PlayerSeat.jsx'
import TrickArea from '../components/TrickArea.jsx'
import ActionPanel from '../components/ActionPanel.jsx'
import GameLog from '../components/GameLog.jsx'
import ScoreBoard from '../components/ScoreBoard.jsx'
import Hand from '../components/Hand.jsx'

const SUIT_SYMBOLS   = { C: '♣', D: '♦', H: '♥', S: '♠' }
const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers' }

// ── Seat layout (you at bottom, 4 opponents around the arc) ──────────────────
// 5-seat positions: bottom, left, top-left, top-right, right
function getRelativeSeats(players, myUserId) {
  const sorted = [...players].sort((a, b) => a.seat - b.seat)
  const myIdx  = sorted.findIndex(p => String(p.user_id) === String(myUserId))
  if (myIdx === -1) return { bottom: null, left: null, topLeft: null, topRight: null, right: null }
  const get = (offset) => sorted[(myIdx + offset) % sorted.length] ?? null
  return {
    bottom:   get(0),   // you
    left:     get(1),   // next player (clockwise from your perspective at the table)
    topLeft:  get(2),
    topRight: get(3),
    right:    get(4),
  }
}

// ── Replace user IDs in log entries with player usernames ────────────────────
// Only replace a numeric ID when it follows start-of-line, '(', ', ', or '! '
// to avoid matching hand numbers ("Hand 1 complete") or multipliers ("×1").
function resolveLogNames(entries, players) {
  return entries.map(entry => {
    let s = entry
    for (const p of players) {
      const uid = String(p.user_id)
      s = s.replace(new RegExp(`(^|\\(|, |! )${uid}\\b`, 'gm'), `$1${p.username}`)
    }
    return s
  })
}

// ── Game admin settings panel (game creator only) ────────────────────────────
function AdminSettingsPanel({ gameId, currentVariant, revealPartner, onUpdated }) {
  const [variant, setVariant]             = useState(currentVariant)
  const [reveal, setReveal]               = useState(revealPartner)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)

  useEffect(() => { setVariant(currentVariant) },  [currentVariant])
  useEffect(() => { setReveal(revealPartner) },     [revealPartner])

  async function save(patch) {
    setSaving(true)
    setSaved(false)
    try {
      const result = await api.games.updateSettings(gameId, patch)
      setSaved(true)
      onUpdated?.(result)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* revert handled by parent re-poll */ }
    finally { setSaving(false) }
  }

  async function handleVariantChange(v) {
    setVariant(v)
    await save({ no_pick_variant: v })
  }

  async function handleRevealChange(v) {
    setReveal(v)
    await save({ reveal_partner: v })
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
      <strong>⚙ Game settings</strong>
      <small style={{ color: '#aaa', display: 'block', marginBottom: 8 }}>
        Changes take effect next hand
      </small>

      {/* No-pick variant */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ color: '#ccc', marginBottom: 4 }}>No-pick variant:</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['leasters', 'doublers'].map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name={`variant-${gameId}`} value={v}
                checked={variant === v} onChange={() => handleVariantChange(v)} disabled={saving} />
              {VARIANT_LABELS[v]}
            </label>
          ))}
        </div>
      </div>

      {/* Reveal partner */}
      <div>
        <div style={{ color: '#ccc', marginBottom: 4 }}>Identify partner after ace is played?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[true, false].map(v => (
            <label key={String(v)} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name={`reveal-${gameId}`} value={String(v)}
                checked={reveal === v} onChange={() => handleRevealChange(v)} disabled={saving} />
              {v ? 'Yes' : 'No'}
            </label>
          ))}
        </div>
      </div>

      {saving && <span style={{ color: '#aaa', marginTop: 6, display: 'block' }}>Saving…</span>}
      {saved  && <span style={{ color: '#4ade80', marginTop: 6, display: 'block' }}>✓ Saved</span>}
    </div>
  )
}

// ── Test mode panel — shows ALL players' hands ────────────────────────────────
function TestModePanel({ state, players, currentTurnUserId, myUserId, onAction, loading }) {
  if (!state) return null

  return (
    <div style={{
      background: 'rgba(124,58,237,0.15)',
      border: '1px solid rgba(124,58,237,0.4)',
      borderRadius: 8,
      padding: 12,
      color: '#fff',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: '0.85rem', color: '#c4b5fd' }}>
        🧪 Test Mode — all hands visible
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {players.map(p => {
          const uid          = String(p.user_id)
          const hand         = state.hands?.[uid] ?? []
          const isTurn       = uid === currentTurnUserId
          const isMe         = uid === myUserId
          let visibleCards = hand.filter(c => !c.hidden)
          // Append the under card as a clickable face-down tile if this player is the
          // picker and there's an unplayed under card.
          if (uid === state.picker && state.underCard && !state.underCard.played) {
            visibleCards = [
              ...visibleCards,
              { id: 'UNDER_CARD', hidden: true, isUnderCard: true, faceDown: true },
            ]
          }

          if (isMe || visibleCards.length === 0) return null

          return (
            <div key={uid} style={{
              background: isTurn ? 'rgba(124,58,237,0.3)' : 'rgba(0,0,0,0.2)',
              borderRadius: 6,
              padding: 8,
              outline: isTurn ? '2px solid #a78bfa' : 'none',
            }}>
              <div style={{ fontSize: '0.75rem', marginBottom: 4, color: isTurn ? '#c4b5fd' : '#aaa' }}>
                {p.username}{isTurn && ' ← turn'}{p.is_bot && <span style={{ color: '#6b7280' }}> (bot)</span>}
              </div>
              <Hand
                cards={visibleCards}
                playableIds={isTurn && state.phase === 'playing' ? visibleCards.map(c => c.id) : []}
                onCardClick={isTurn ? (card) => onAction('play_card', { cardId: card.id }, uid) : undefined}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Current turn helper ───────────────────────────────────────────────────────
function currentTurnPlayer(state) {
  if (!state) return null
  const { phase, pickOrder, pickIndex, currentTrick, currentLeader } = state
  if (phase === 'picking')                            return pickOrder?.[pickIndex] ?? null
  if (phase === 'discarding' || phase === 'calling')  return state.picker
  if (phase === 'playing') {
    const played    = (currentTrick ?? []).map(p => p.userId)
    const leaderIdx = pickOrder.indexOf(currentLeader)
    for (let i = 0; i < 5; i++) {
      const uid = pickOrder[(leaderIdx + i) % 5]
      if (!played.includes(uid)) return uid
    }
  }
  return null
}

// ── Legal card computation (mirrors ActionPanel / engine logic) ───────────────
// `hand` here may include the under card pseudo-entry (id 'UNDER_CARD', isUnderCard: true)
// when the viewer is the picker.
function getLegalCardIds(state, userId, hand) {
  const { currentTrick, calledAce, calledTen, calledKing, calledSuit, partner, partnerRevealed,
          underCard, picker, pickerForcedPlays = [] } = state
  const handCards = hand.filter(c => !c.isUnderCard)
  const hasUnderCard = hand.some(c => c.isUnderCard) && underCard && !underCard.played

  // Leading: any hand card, plus the under card if held (declares called suit as led)
  if (!currentTrick || currentTrick.length === 0) {
    const ids = handCards.map(c => c.id)
    if (userId === picker && hasUnderCard) ids.push('UNDER_CARD')
    return ids
  }

  // Determine led suit (face-down lead means called suit is led)
  const first = currentTrick[0]
  const ledSuit = first.declaredSuit ?? effectiveSuit(first.card)

  // Picker with under card: when called suit led, MUST play under card
  if (userId === picker && hasUnderCard && ledSuit === calledSuit) {
    return ['UNDER_CARD']
  }

  const hasSuit = handCards.some(c => effectiveSuit(c) === ledSuit)
  const mustFollow = hasSuit
    ? handCards.filter(c => effectiveSuit(c) === ledSuit).map(c => c.id)
    : handCards.map(c => c.id)

  // Partner must play the called card when called suit is led
  const calledCardId = calledAce?.aceId || calledTen?.tenId || calledKing?.kingId
  if (calledCardId && userId === partner && !partnerRevealed && ledSuit === calledSuit) {
    if (handCards.some(c => c.id === calledCardId)) return [calledCardId]
  }

  // Picker forced plays (Situation A / King case): when called suit led, must play
  // one of the still-held forced cards (Ace, or Ace/Ten in either order).
  if (userId === picker && pickerForcedPlays.length > 0 && ledSuit === calledSuit) {
    const heldForced = pickerForcedPlays.filter(cid => handCards.some(c => c.id === cid))
    if (heldForced.length > 0) return heldForced
  }

  return mustFollow
}

// ── Main GamePage ─────────────────────────────────────────────────────────────
export default function GamePage({ gameId, user, onNavigate }) {
  const [gameData, setGameData]             = useState(null)
  const [error, setError]                   = useState(null)
  const [actionLoading, setActionLoading]   = useState(false)
  const [leaving, setLeaving]               = useState(false)
  const [currentVariant, setCurrentVariant] = useState(null)
  const [revealPartner, setRevealPartner]   = useState(null)
  const pollingRef = useRef(null)

  const myUserId = String(user.id)

  const fetchGame = useCallback(async () => {
    try {
      const data = await api.games.get(gameId)
      setGameData(data)
      // Only set once — don't clobber in-flight admin changes
      setCurrentVariant(prev => prev ?? data.no_pick_variant)
      setRevealPartner(prev => prev ?? data.reveal_partner)
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

  async function handleAction(type, payload, actAs = null) {
    setActionLoading(true)
    try {
      await api.games.action(gameId, type, payload, actAs)
      await fetchGame()
    } finally {
      setActionLoading(false)
    }
  }

  function handleSettingsUpdate(result) {
    if (result.no_pick_variant !== undefined) setCurrentVariant(result.no_pick_variant)
    if (result.reveal_partner  !== undefined) setRevealPartner(result.reveal_partner)
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

  // ── Loading / error ─────────────────────────────────────────────────────────
  if (error) return (
    <div style={{ padding: 32, color: '#fff' }}>
      <p>Error: {error}</p>
      <button onClick={() => onNavigate('/lobby')}>Back to lobby</button>
    </div>
  )
  if (!gameData) return (
    <div style={{ padding: 32, color: '#fff' }} aria-busy="true">Loading game…</div>
  )

  const {
    players,
    state,
    status,
    is_admin:     isGameAdmin,    // game creator → controls settings panel
    is_test_mode: isTestMode,     // test mode flag
    no_pick_variant: noPickVariant,
  } = gameData

  // ── Game ended ──────────────────────────────────────────────────────────────
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
            <button className="outline contrast" onClick={handleLeave}
              aria-busy={leaving} disabled={leaving} style={{ fontSize: '0.85rem' }}>
              Leave game
            </button>
          )}
        </div>

        {/* Game creator controls settings */}
        {isGameAdmin
          ? (
            <AdminSettingsPanel
              gameId={gameId}
              currentVariant={currentVariant ?? noPickVariant}
              revealPartner={revealPartner ?? gameData.reveal_partner ?? true}
              onUpdated={handleSettingsUpdate}
            />
          )
          : (
            <p style={{ color: '#aaa', fontSize: '0.85rem', marginTop: 8 }}>
              No-pick variant: <strong>{VARIANT_LABELS[noPickVariant]}</strong>
            </p>
          )
        }

        <p style={{ marginTop: 16 }}>Waiting for players… ({players.length}/5)</p>
        <ul>{players.map(p => <li key={p.user_id}>{p.username}</li>)}</ul>
        <button className="outline" onClick={() => onNavigate('/lobby')} style={{ marginTop: 8 }}>
          Back to lobby
        </button>
      </div>
    )
  }

  if (!state) return <div style={{ padding: 32, color: '#fff' }}>Waiting for game state…</div>

  // ── Active game setup ───────────────────────────────────────────────────────
  const seats      = getRelativeSeats(players, myUserId)
  const myHand     = state.hands?.[myUserId] ?? []
  const turnUserId = currentTurnPlayer(state)

  // Test mode: global admin can act for any player
  const isActingForBot = isTestMode && user.is_admin && turnUserId !== myUserId && turnUserId !== null
  const actingForPlayer = isActingForBot ? players.find(p => String(p.user_id) === turnUserId) : null
  const effectiveUserId = isActingForBot ? turnUserId : myUserId
  let activeHand        = isActingForBot
    ? (state.hands?.[turnUserId] ?? []).filter(c => !c.hidden)
    : myHand

  // If the effective viewer is the picker and there is an unplayed under card,
  // append it to the hand so it renders as a clickable face-down tile.
  if (effectiveUserId === state.picker && state.underCard && !state.underCard.played) {
    activeHand = [
      ...activeHand,
      { id: 'UNDER_CARD', hidden: true, isUnderCard: true, faceDown: true },
    ]
  }

  const dealerUserId  = state.pickOrder ? state.pickOrder[state.dealerSeat] : null
  const pickerUserId  = state.picker
  const partnerUserId = state.partnerRevealed ? state.partner : null

  // Called ace display
  const calledAce       = state.calledAce
  const showPartnerName = state.partnerRevealed && (revealPartner ?? gameData.reveal_partner ?? true)
  const partnerPlayer   = showPartnerName && state.partner
    ? players.find(p => String(p.user_id) === String(state.partner))
    : null

  function seatProps(player) {
    if (!player) return {}
    const uid  = String(player.user_id)
    let hand = state.hands?.[uid] ?? []
    // Append the under card pseudo entry for the picker so it renders as a
    // face-down, clickable tile alongside the rest of their hand.
    if (uid === state.picker && state.underCard && !state.underCard.played) {
      hand = [
        ...hand,
        { id: 'UNDER_CARD', hidden: true, isUnderCard: true, faceDown: true },
      ]
    }
    return {
      isDealer:      uid === dealerUserId,
      isPicker:      uid === pickerUserId,
      isPartner:     uid === partnerUserId,
      isYou:         uid === myUserId,
      isActiveTurn:  uid === turnUserId,
      cardCount:     hand.length,
      dayScore:      player.day_score      ?? 0,
      lifetimeScore: player.lifetime_score ?? 0,
      hand,
      showFaceUp:    isTestMode && user.is_admin,
    }
  }

  const resolvedLog  = resolveLogNames(state.log ?? [], players)
    .filter(e => !/ played /.test(e) && !e.endsWith('won the trick.'))
  const currentTrick = state.currentTrick ?? []
  const lastTrick    = state.lastTrick    ?? []

  const isMyPlayingTurn = state.phase === 'playing' && turnUserId === effectiveUserId
  const legalIds = isMyPlayingTurn ? getLegalCardIds(state, effectiveUserId, activeHand) : []

  return (
    <div className="game-table">

      {/* ── 5 seats ── */}
      <div className="seat-top-left">
        <PlayerSeat player={seats.topLeft}  {...seatProps(seats.topLeft)} />
      </div>
      <div className="seat-top-right">
        <PlayerSeat player={seats.topRight} {...seatProps(seats.topRight)} />
      </div>
      <div className="seat-left">
        <PlayerSeat player={seats.left}     {...seatProps(seats.left)} />
      </div>
      <div className="seat-right">
        <PlayerSeat player={seats.right}    {...seatProps(seats.right)} />
      </div>

      {/* ── Center trick ── */}
      <TrickArea
        trick={currentTrick}
        lastTrick={lastTrick}
        players={players}
        blind={state.phase === 'picking' ? (state.blind ?? []) : []}
      />

      {/* ── Info bar: called ace + partner reveal ── */}
      <div className="info-bar">
        {calledAce && (
          <span className="called-ace-badge">
            Partner: A{SUIT_SYMBOLS[calledAce.suit]}
            {partnerPlayer ? ` (${partnerPlayer.username})` : ''}
          </span>
        )}
        {state.isLeaster && (
          <span className="called-ace-badge" style={{ background: 'rgba(245,158,11,0.3)' }}>
            🃏 Leaster
          </span>
        )}
        {state.doublerMultiplier > 1 && (
          <span className="called-ace-badge" style={{ background: 'rgba(220,38,38,0.3)' }}>
            ×{state.doublerMultiplier} doubler
          </span>
        )}
      </div>

      {/* ── Your seat + hand (cards inside the seat box, playable on your turn) ── */}
      <div className="seat-bottom" style={{ textAlign: 'center' }}>
        <PlayerSeat
          player={seats.bottom}
          {...seatProps(seats.bottom)}
          showFaceUp={true}
          noOverlap={true}
          playableIds={isMyPlayingTurn ? legalIds : undefined}
          onCardClick={isMyPlayingTurn
            ? (card) => { if (legalIds.includes(card.id)) handleAction('play_card', { cardId: card.id }, isActingForBot ? turnUserId : null) }
            : undefined}
        />
      </div>

      {/* ── Action panel (hidden on your real playing turn — cards in seat instead) ── */}
      {!(isMyPlayingTurn && !isActingForBot) && (
        <div className="action-panel">
          <ActionPanel
            state={state}
            myUserId={effectiveUserId}
            myHand={activeHand}
            onAction={(type, payload) => handleAction(type, payload, isActingForBot ? turnUserId : null)}
            loading={actionLoading}
            actingForName={isActingForBot ? (actingForPlayer?.username ?? turnUserId) : null}
          />
        </div>
      )}

      {/* ── Game log ── */}
      <GameLog entries={resolvedLog} />

      {/* ── Game admin settings (game creator only) ── */}
      {isGameAdmin && (
        <div className="score-board">
          <AdminSettingsPanel
            gameId={gameId}
            currentVariant={currentVariant ?? noPickVariant}
            revealPartner={revealPartner ?? gameData.reveal_partner ?? true}
            onUpdated={handleSettingsUpdate}
          />
        </div>
      )}

      {/* ── Test mode panel (global admin only) ── */}
      {isTestMode && user.is_admin && (
        <div className="admin-panel-area">
          <TestModePanel
            state={state}
            players={players}
            currentTurnUserId={turnUserId}
            myUserId={myUserId}
            onAction={handleAction}
            loading={actionLoading}
          />
        </div>
      )}

      {/* ── Leave button ── */}
      <div style={{ gridColumn: '1 / -1', textAlign: 'right', padding: '0 4px' }}>
        <button className="outline contrast" style={{ fontSize: '0.8rem' }}
          onClick={handleLeave} aria-busy={leaving} disabled={leaving}>
          Leave game
        </button>
      </div>

    </div>
  )
}
