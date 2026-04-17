import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { replayActions } from '../../../shared/actionReplay.js'
import ReplaySeat from '../components/recap/ReplaySeat.jsx'
import ReplayTrickZone from '../components/recap/ReplayTrickZone.jsx'
import ReplayControls from '../components/recap/ReplayControls.jsx'
import '../components/recap/recap.css'

export default function DetailedReplayPage({ gameId, handNumber, startSeq, onNavigate }) {
  const [digest, setDigest] = useState(null)
  const [rawActions, setRawActions] = useState(null)
  const [error, setError] = useState(null)
  const [actionIndex, setActionIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.recap.getDigest(gameId, handNumber),
      api.recap.getActions(gameId, handNumber),
    ])
      .then(([d, { actions }]) => {
        if (cancelled) return
        setDigest(d)
        const rows = actions.map(a => ({
          type: a.type,
          user_id: a.userId ? Number(a.userId) : null,
          payload_json: a.payload ? JSON.stringify(a.payload) : null,
          seq: a.seq,
        }))
        setRawActions(rows)
        if (startSeq != null) {
          const idx = rows.findIndex(r => r.seq === startSeq)
          if (idx >= 0) setActionIndex(idx)
        }
      })
      .catch(err => {
        if (!cancelled) setError(err.status === 404 ? 'Replay not available.' : 'Failed to load replay.')
      })
    return () => { cancelled = true }
  }, [gameId, handNumber, startSeq])

  const stateAtIndex = useMemo(() => {
    if (!rawActions || rawActions.length === 0) return null
    return replayActions(rawActions.slice(0, actionIndex + 1))
  }, [rawActions, actionIndex])

  const trickBoundaries = useMemo(() => {
    if (!rawActions) return []
    const boundaries = []
    let prevTrickCount = 0
    for (let i = 0; i < rawActions.length; i++) {
      const stateI = replayActions(rawActions.slice(0, i + 1))
      if (stateI.tricks.length > prevTrickCount) {
        boundaries.push(i)
        prevTrickCount = stateI.tricks.length
      }
    }
    return boundaries
  }, [rawActions])

  if (error) return <div className="recap-shell"><p>{error}</p></div>
  if (!digest || !rawActions || !stateAtIndex) return <div className="recap-shell"><p>Loading…</p></div>

  const players = digest.players
  const pickerId = digest.picker?.userId ?? null
  const partnerId = digest.partner?.userId ?? null
  const activeUserId = rawActions[actionIndex]?.user_id != null ? String(rawActions[actionIndex].user_id) : null

  const playedCardIds = new Set()
  for (const t of stateAtIndex.tricks) for (const p of t.plays) playedCardIds.add(p.card.id)
  for (const p of stateAtIndex.currentTrick) playedCardIds.add(p.card.id)

  let nowCardId = null
  const currentAction = rawActions[actionIndex]
  if (currentAction && currentAction.type === 'play_card' && currentAction.payload_json) {
    nowCardId = JSON.parse(currentAction.payload_json).cardId
  }

  const seatBottom = players.find(p => p.seat === 0)
  const seatLeft = players.find(p => p.seat === 1)
  const seatTopLeft = players.find(p => p.seat === 2)
  const seatTopRight = players.find(p => p.seat === 3)
  const seatRight = players.find(p => p.seat === 4)

  // The picker's play-phase hand is (dealt + blind) − pickerDiscards, not the raw dealt array.
  const pickerPlayHand = pickerId && digest.blind && digest.pickerDiscards
    ? (() => {
        const discards = new Set(digest.pickerDiscards)
        return [...(digest.dealt[pickerId] ?? []), ...digest.blind].filter(c => !discards.has(c))
      })()
    : null
  const dealtOf = uid => (uid === pickerId && pickerPlayHand) ? pickerPlayHand : (digest.dealt[uid] ?? [])
  const rolesOf = uid => ({
    isPicker: uid === pickerId,
    isPartner: uid === partnerId,
    isActive: uid === activeUserId,
  })

  const inProgressPlays = stateAtIndex.currentTrick.map(p => ({ userId: p.userId, cardId: p.card.id }))
  const completedPlays = stateAtIndex.tricks.length > 0 && stateAtIndex.currentTrick.length === 0
    ? stateAtIndex.tricks[stateAtIndex.tricks.length - 1].plays.map(p => ({ userId: p.userId, cardId: p.card.id }))
    : []
  const trickZonePlays = inProgressPlays.length > 0 ? inProgressPlays : completedPlays
  const trickZoneWinner = inProgressPlays.length === 0 && completedPlays.length > 0
    ? stateAtIndex.tricks[stateAtIndex.tricks.length - 1].winner
    : null
  const currentTrickNumber = stateAtIndex.tricks.length + (inProgressPlays.length > 0 ? 1 : 0)

  const playLabel = describePlay(currentAction, players)

  return (
    <div className="replay-shell">
      <div className="replay-meta">
        <div className="meta-group">
          <div><span className="label">Game / Hand</span><span className="val">#{digest.gameId} · Hand {digest.handNumber}</span></div>
          <div><span className="label">Variant</span><span className="val">{digest.variant}</span></div>
          {digest.picker && <div><span className="label">Picker</span><span className="val"><span className="picker-pill">{findName(players, digest.picker.userId)}</span></span></div>}
          {digest.calledCard && <div><span className="label">Called</span><span className="val">{digest.calledCard}</span></div>}
          {digest.partner && <div><span className="label">Partner</span><span className="val"><span className="partner-pill">{findName(players, digest.partner.userId)}</span></span></div>}
        </div>
        <div><a href={`#/recap/${gameId}/${handNumber}`} style={{ color: '#58a6ff', fontSize: 12 }}>← Back to simple recap</a></div>
      </div>

      <div className="replay-grid">
        <div className="replay-table">
          <div className="replay-seats-top">
            {seatTopLeft && <ReplaySeat player={seatTopLeft} dealt={dealtOf(seatTopLeft.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatTopLeft.userId)} />}
            {seatTopRight && <ReplaySeat player={seatTopRight} dealt={dealtOf(seatTopRight.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatTopRight.userId)} />}
          </div>
          <div className="replay-seats-mid">
            {seatLeft && <ReplaySeat player={seatLeft} dealt={dealtOf(seatLeft.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatLeft.userId)} />}
            <ReplayTrickZone
              plays={trickZonePlays}
              allPlayers={players}
              winnerUserId={trickZoneWinner}
              trickNumber={currentTrickNumber > 0 && currentTrickNumber <= 6 ? currentTrickNumber : null}
              totalTricks={6}
            />
            {seatRight && <ReplaySeat player={seatRight} dealt={dealtOf(seatRight.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatRight.userId)} />}
          </div>
          <div className="replay-seats-bottom">
            {seatBottom && <ReplaySeat player={seatBottom} dealt={dealtOf(seatBottom.userId)} playedCardIds={playedCardIds} nowCardId={nowCardId} roles={rolesOf(seatBottom.userId)} />}
          </div>
        </div>
        <div className="replay-side">
          <h4>Bot inference</h4>
          <div className="stub-block">Inference capture not wired up yet — see issue #125. The panel will populate here once bot actions record their belief state.</div>
          <h4 style={{ marginTop: 12 }}>Engine state</h4>
          <div className="stub-block" style={{ color: '#e6edf3', fontStyle: 'normal' }}>
            Phase: <b>{stateAtIndex.phase}</b><br/>
            Action: <b>{currentAction?.type ?? '—'}</b><br/>
            {activeUserId && <>By: <b>{findName(players, activeUserId)}</b></>}
          </div>
        </div>
      </div>

      <div className="replay-sticky">
        <ReplayControls
          actionIndex={actionIndex}
          totalActions={rawActions.length}
          onJump={setActionIndex}
          playLabel={playLabel}
          trickBoundaries={trickBoundaries}
        />
      </div>
    </div>
  )
}

function findName(players, userId) {
  return players.find(p => p.userId === userId)?.username ?? userId
}

function describePlay(action, players) {
  if (!action) return 'at start'
  const uname = action.user_id ? findName(players, String(action.user_id)) : null
  switch (action.type) {
    case 'deal':      return 'dealt'
    case 'pick':      return `${uname} picked`
    case 'pass':      return `${uname} passed`
    case 'call_ace':  return `${uname} called ace`
    case 'call_ten':  return `${uname} called ten`
    case 'call_king': return `${uname} called king`
    case 'discard':   return `${uname} discarded`
    case 'play_card': return `${uname} played`
    default:          return action.type
  }
}
