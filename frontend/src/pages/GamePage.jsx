import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { effectiveSuit } from '@shared/gameEngine.js'
import { computeBotSuggestion } from '@shared/botSuggestion.js'
import { api } from '../lib/api.js'
import PlayerSeat from '../components/PlayerSeat.jsx'
import TrickArea, { LastTrickArea } from '../components/TrickArea.jsx'
import ActionPanel from '../components/ActionPanel.jsx'
import GameLog from '../components/GameLog.jsx'
import ScoreBoard from '../components/ScoreBoard.jsx'
import GameOptionsPanel from '../components/GameOptionsPanel.jsx'
import SettingsSummary from '../components/SettingsSummary.jsx'

const SUIT_SYMBOLS = { C: '♣', D: '♦', H: '♥', S: '♠' }

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

// ── Current turn helper ───────────────────────────────────────────────────────
function currentTurnPlayer(state) {
  if (!state) return null
  const { phase, pickOrder, pickIndex, currentTrick, currentLeader } = state
  if (phase === 'picking')                            return pickOrder?.[pickIndex] ?? null
  if (phase === 'burying' || phase === 'calling')  return state.picker
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
  // Exception: partner cannot lead the called suit unless they lead with the called card
  if (!currentTrick || currentTrick.length === 0) {
    const calledCardId = calledAce?.aceId || calledTen?.tenId || calledKing?.kingId
    let ids
    if (calledCardId && userId === partner && !partnerRevealed) {
      ids = handCards
        .filter(c => effectiveSuit(c) !== calledSuit || c.id === calledCardId)
        .map(c => c.id)
    } else {
      ids = handCards.map(c => c.id)
    }
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

  // Called card cannot be played unless the called suit is led
  // (except when it's the player's only remaining card)
  let playableCards = (
    calledCardId &&
    ledSuit !== calledSuit &&
    handCards.some(c => c.id !== calledCardId)
  )
    ? handCards.filter(c => c.id !== calledCardId)
    : handCards

  // Picker called-suit holding rule: must keep ≥1 called-suit card (plus any
  // pickerForcedPlays) in hand until the called suit is led.
  if (
    userId === picker &&
    calledSuit &&
    !partnerRevealed &&
    ledSuit !== calledSuit &&
    playableCards.length > 1
  ) {
    const filtered = playableCards.filter(card => {
      if (pickerForcedPlays.includes(card.id)) return false
      if (effectiveSuit(card) === calledSuit) {
        const remaining = playableCards.filter(
          c => c.id !== card.id && effectiveSuit(c) === calledSuit
        ).length
        if (remaining === 0) return false
      }
      return true
    })
    if (filtered.length > 0) playableCards = filtered
  }

  const hasSuit = playableCards.some(c => effectiveSuit(c) === ledSuit)
  return hasSuit
    ? playableCards.filter(c => effectiveSuit(c) === ledSuit).map(c => c.id)
    : playableCards.map(c => c.id)
}

// ── Main GamePage ─────────────────────────────────────────────────────────────
export default function GamePage({ gameId, user, onNavigate }) {
  const [gameData, setGameData]             = useState(null)
  const [error, setError]                   = useState(null)
  const [actionLoading, setActionLoading]   = useState(false)
  const [leaving, setLeaving]               = useState(false)
  const [currentVariant, setCurrentVariant] = useState(null)
  const [revealPartner, setRevealPartner]   = useState(null)
  const [dobEnabled, setDobEnabled]         = useState(null)
  const [showOptions, setShowOptions]       = useState(false)
  const [showBotSuggestion, setShowBotSuggestion] = useState(() => {
    try {
      return localStorage.getItem('sheepshead:showBotSuggestion') === 'true'
    } catch {
      return false
    }
  })

  const handleBotSuggestionChange = (next) => {
    setShowBotSuggestion(next)
    try {
      localStorage.setItem('sheepshead:showBotSuggestion', next ? 'true' : 'false')
    } catch {
      // localStorage unavailable — in-memory state still updates.
    }
  }
  const pollingRef = useRef(null)
  // Tracks the auto-play timer for the last trick. We key by
  // `${turnUserId}:${trickLen}` so each "pending play" only schedules once,
  // even though state polling produces a new state object every 2s.
  const autoPlayRef   = useRef({ key: null, timer: null })
  const botPlayRef    = useRef({ key: null, timer: null })
  // Displayed trick — trails the server state by 1 s after each trick completes
  // so the completed trick stays visible before clearing.
  const [displayedTrick, setDisplayedTrick] = useState([])
  const trickClearTimerRef = useRef(null)
  const lastProcessedTrickCountRef = useRef(null)

  const myUserId = String(user.id)

  const fetchGame = useCallback(async () => {
    try {
      const data = await api.games.get(gameId)
      setGameData(data)
      // Only set once — don't clobber in-flight admin changes
      setCurrentVariant(prev => prev ?? data.settings?.no_pick_variant)
      setRevealPartner(prev => prev ?? data.settings?.reveal_partner)
      setDobEnabled(prev => prev ?? data.settings?.double_on_bump)
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

  // ── Auto-play the last trick ────────────────────────────────────────────────
  // Once we're down to the final trick (every player has exactly 1 card left),
  // there are no more decisions to make, so the client auto-dispatches each
  // play with a 1s pause for a smoother end-of-hand cadence. In test mode the
  // admin acts on behalf of any player whose turn it is.
  useEffect(() => {
    const state    = gameData?.state
    const isTestMode = gameData?.settings?.is_test_mode
    if (!state || state.phase !== 'playing') return

    const turnUserId = currentTurnPlayer(state)
    if (!turnUserId) return

    // The "effective" user — me, or in test mode the player whose turn it is.
    const isActingForBot = isTestMode && user.is_admin && String(turnUserId) !== myUserId
    const effectiveUserId = isActingForBot ? String(turnUserId) : myUserId
    if (String(turnUserId) !== effectiveUserId) return

    // Are we in the last trick? Total cards remaining (across all hands +
    // any unplayed under card + the current trick) should equal pickOrder.length.
    const handsSum = Object.values(state.hands ?? {}).reduce((s, h) => s + (h?.length ?? 0), 0)
    const underCount = state.underCard && !state.underCard.played ? 1 : 0
    const totalRemaining = handsSum + underCount + (state.currentTrick?.length ?? 0)
    if (totalRemaining !== (state.pickOrder?.length ?? 5)) return

    // Compute the legal play (there should be exactly one in the last trick).
    let hand = state.hands?.[effectiveUserId] ?? []
    if (effectiveUserId === state.picker && state.underCard && !state.underCard.played) {
      hand = [...hand, { id: 'UNDER_CARD', hidden: true, isUnderCard: true, faceDown: true }]
    }
    const ids = getLegalCardIds(state, effectiveUserId, hand)
    if (ids.length === 0) return
    const cardId = ids[0]

    // Schedule the play — but only once per (turn, trick-progress) pair so
    // repeated polling of an unchanged state doesn't keep resetting the timer.
    const key = `${state.handNumber}:${turnUserId}:${state.currentTrick?.length ?? 0}`
    if (autoPlayRef.current.key === key) return
    if (autoPlayRef.current.timer) clearTimeout(autoPlayRef.current.timer)
    autoPlayRef.current.key = key
    autoPlayRef.current.timer = setTimeout(() => {
      autoPlayRef.current.timer = null
      handleAction('play_card', { cardId }, isActingForBot ? turnUserId : null)
    }, 500)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData, myUserId, user.is_admin])

  // Cancel any pending auto-play timer on unmount.
  useEffect(() => () => {
    if (autoPlayRef.current.timer) {
      clearTimeout(autoPlayRef.current.timer)
      autoPlayRef.current.timer = null
    }
  }, [])

  // ── Play bot card trigger ───────────────────────────────────────────────────
  // When the current player is a play bot, wait 700 ms then fire a bot_play
  // action so their card appears sequentially rather than all at once.
  // Test mode is excluded — admins drive bot plays manually there.
  useEffect(() => {
    const state   = gameData?.state
    const players = gameData?.players
    if (!state || state.phase !== 'playing') return
    if (gameData?.settings?.is_test_mode) return

    const turnUserId = currentTurnPlayer(state)
    if (!turnUserId) return

    const currentPlayerData = players?.find(p => String(p.user_id) === turnUserId)
    if (currentPlayerData?.bot_type !== 'play') return

    const key = `${state.handNumber}:${turnUserId}:${state.tricks?.length ?? 0}:${state.currentTrick?.length ?? 0}`
    if (botPlayRef.current.key === key) return
    if (botPlayRef.current.timer) clearTimeout(botPlayRef.current.timer)
    botPlayRef.current.key = key
    const isLeadingTrick1 = (state.tricks?.length ?? 0) === 0
                         && (state.currentTrick?.length ?? 0) === 0
    const delay = isLeadingTrick1 ? 5000 : 700
    botPlayRef.current.timer = setTimeout(async () => {
      botPlayRef.current.timer = null
      try {
        await api.games.action(gameId, 'bot_play', {})
        await fetchGame()
      } catch {
        // State may have already advanced (e.g. another client acted); ignore.
      }
    }, delay)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData, gameId, fetchGame])

  // Cancel any pending bot-play timer on unmount.
  useEffect(() => () => {
    if (botPlayRef.current.timer) {
      clearTimeout(botPlayRef.current.timer)
      botPlayRef.current.timer = null
    }
  }, [])

  // ── Trick clear delay ───────────────────────────────────────────────────────
  // When a trick completes the server returns currentTrick: []. Keep the cards
  // visible for 1 s before clearing, so players can see who played what.
  useEffect(() => {
    const trick      = gameData?.state?.currentTrick ?? []
    const trickCount = gameData?.state?.tricks?.length ?? 0

    if (trick.length > 0) {
      // Cards are being played — update immediately and cancel any pending clear.
      // Also sync the ref so a rewind-reduced trickCount is tracked; otherwise
      // re-completing the same trick won't trigger the completion branch below.
      if (trickClearTimerRef.current) {
        clearTimeout(trickClearTimerRef.current)
        trickClearTimerRef.current = null
      }
      lastProcessedTrickCountRef.current = trickCount
      setDisplayedTrick(trick)
    } else if (trickCount !== lastProcessedTrickCountRef.current) {
      // A new trick just completed — guard by trickCount so repeated polls of
      // the same state don't re-trigger.
      lastProcessedTrickCountRef.current = trickCount
      if (trickClearTimerRef.current) clearTimeout(trickClearTimerRef.current)

      // Skip the delay on the last trick of the hand (phase has already moved on).
      if (gameData?.state?.phase !== 'playing') {
        setDisplayedTrick([])
        return
      }

      // Show all 5 cards for 1 s then clear.
      const lastTrick = gameData?.state?.lastTrick ?? []
      if (lastTrick.length > 0) setDisplayedTrick(lastTrick)
      trickClearTimerRef.current = setTimeout(() => {
        trickClearTimerRef.current = null
        setDisplayedTrick([])
      }, 1000)
    }
  }, [gameData])

  // Cancel pending trick clear on unmount.
  useEffect(() => () => {
    if (trickClearTimerRef.current) {
      clearTimeout(trickClearTimerRef.current)
      trickClearTimerRef.current = null
    }
  }, [])

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
    const s = result.settings ?? {}
    if (s.no_pick_variant !== undefined) setCurrentVariant(s.no_pick_variant)
    if (s.reveal_partner  !== undefined) setRevealPartner(s.reveal_partner)
    if (s.double_on_bump  !== undefined) setDobEnabled(s.double_on_bump)
  }

  async function handleFillWithBots() {
    try {
      await api.games.fillWithBots(gameId)
      await fetchGame()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleLeave() {
    if (!window.confirm('Leave this game?')) return
    setLeaving(true)
    try {
      await api.games.leave(gameId)
      onNavigate('/lobby')
    } catch (e) {
      setError(e.message)
      setLeaving(false)
    }
  }

  // Must live above any early returns to preserve Rules of Hooks — hook count
  // must be identical across loading, waiting, and active renders.
  const botSuggestion = useMemo(() => {
    if (!showBotSuggestion) return null
    const st = gameData?.state
    if (!st) return null
    const turnUid = currentTurnPlayer(st)
    if (!turnUid) return null
    const isTestMode = !!gameData.settings?.is_test_mode
    const isActingForBot = isTestMode && user.is_admin && String(turnUid) !== String(user.id)
    const effectiveUid = isActingForBot ? String(turnUid) : String(user.id)
    if (String(turnUid) !== effectiveUid) return null
    try {
      return computeBotSuggestion(st, effectiveUid)
    } catch (err) {
      console.warn('[botSuggestion] computation failed:', err)
      return null
    }
  }, [showBotSuggestion, gameData, user.id, user.is_admin])

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
    is_admin:      isGameAdmin,
    admin_user_id: adminUserId,
    settings: {
      is_test_mode:    isTestMode,
      no_pick_variant: noPickVariant,
    } = {},
  } = gameData

  const currentSettings = {
    no_pick_variant: currentVariant ?? noPickVariant,
    reveal_partner:  revealPartner  ?? gameData.settings?.reveal_partner  ?? false,
    double_on_bump:  dobEnabled     ?? gameData.settings?.double_on_bump  ?? true,
  }

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

        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: 3 }}>Game options</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <SettingsSummary
              settings={currentSettings}
              style={{ color: '#ccc', fontSize: '0.85rem' }}
            />
            <button className="outline" style={{ fontSize: '0.8rem', padding: '2px 10px' }}
              onClick={() => setShowOptions(true)}>
              ⚙ Options
            </button>
          </div>
        </div>
        <GameOptionsPanel
          mode="update"
          gameId={gameId}
          open={showOptions}
          values={currentSettings}
          onUpdated={handleSettingsUpdate}
          onClose={() => setShowOptions(false)}
          role={isGameAdmin ? 'admin' : 'player'}
          botSuggestionEnabled={showBotSuggestion}
          onBotSuggestionChange={handleBotSuggestionChange}
        />

        <p style={{ marginTop: 16 }}>Waiting for players… ({players.length}/5)</p>
        <ul>{players.map(p => (
          <li key={p.user_id}>
            {p.username}
            {String(p.user_id) === String(adminUserId) && (
              <span className="badge badge-game-admin" aria-label="Game admin" style={{ marginLeft: 6 }} />
            )}
          </li>
        ))}</ul>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {isGameAdmin && !isTestMode && players.length < 5 && (
            <button className="secondary" onClick={handleFillWithBots}>
              Fill with Bots
            </button>
          )}
          <button className="outline" onClick={() => onNavigate('/lobby')}>
            Back to lobby
          </button>
        </div>
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

  const dealerUserId  = state.pickOrder ? state.pickOrder[4] : null
  const pickerUserId  = state.picker
  const partnerUserId  = (state.partnerRevealed && (state.reveal_partner ?? false)) ? state.partner : null

  // Called ace display
  const calledAce       = state.calledAce
  const showPartnerName = state.partnerRevealed && (state.reveal_partner ?? false)
  const partnerPlayer   = showPartnerName && state.partner
    ? players.find(p => String(p.user_id) === String(state.partner))
    : null

  // Crack/recrack window: test mode admin can act for any seat before first card
  const crackWindowOpen =
    isTestMode && user.is_admin
    && state.phase === 'playing'
    && !state.isLeaster
    && (state.tricks ?? []).length === 0
    && (state.currentTrick ?? []).length === 0

  const canRewindPlay  = isTestMode && user.is_admin && state.phase === 'playing'
    && ((state.currentTrick?.length ?? 0) > 0 || (state.tricks ?? []).length > 0)
  const canRewindTrick = isTestMode && user.is_admin && state.phase === 'playing'
    && ((state.tricks ?? []).length > 0 || (state.currentTrick ?? []).length > 0)

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
    // In test mode, the global admin can play directly out of any seat's hand
    // when it's that player's turn. (For the bottom seat — i.e. yourself —
    // playability is wired up below in the JSX as before.)
    const seatIsActingTarget =
      isTestMode && user.is_admin
      && state.phase === 'playing'
      && uid === turnUserId
      && uid !== myUserId
    const seatLegalIds = seatIsActingTarget
      ? getLegalCardIds(state, uid, hand)
      : undefined

    // Crack/recrack buttons: show in test mode during the cracking window
    const isSeatOpponent = uid !== state.picker && uid !== state.partner
    const seatPassedAtPicking = state.pickOrder.slice(0, state.pickIndex).includes(uid)
    const actAs = uid !== myUserId ? uid : null
    const onCrack   = crackWindowOpen && isSeatOpponent && state.crackState === null && !seatPassedAtPicking
      ? () => handleAction('crack', {}, actAs)
      : undefined
    const onRecrack = crackWindowOpen && !isSeatOpponent && state.crackState === 'cracked'
      ? () => handleAction('recrack', {}, actAs)
      : undefined

    const blitz = (state.blitzes ?? []).find(b => b.userId === uid)

    return {
      isDealer:      uid === dealerUserId,
      isPicker:      uid === pickerUserId,
      isGoingAlone:  uid === pickerUserId && !!state.goingAlone,
      isPartner:     uid === partnerUserId,
      isYou:         uid === myUserId,
      isGameAdmin:   String(adminUserId) === uid,
      isActiveTurn:  uid === turnUserId,
      blitzType:     uid === pickerUserId ? blitz?.type : undefined,
      cardCount:     hand.length,
      dayScore:      player.day_score      ?? 0,
      lifetimeScore: player.lifetime_score ?? 0,
      hand,
      showFaceUp:    isTestMode && user.is_admin,
      playableIds:   seatLegalIds,
      onCardClick:   seatIsActingTarget
        ? (card) => {
            if (seatLegalIds.includes(card.id)) {
              handleAction('play_card', { cardId: card.id }, uid)
            }
          }
        : undefined,
      onCrack,
      onRecrack,
    }
  }

  const resolvedLog  = resolveLogNames(state.log ?? [], players)
    .filter(e => !/ played /.test(e) && !e.endsWith('won the trick.'))
  const currentTrick = state.currentTrick ?? []
  const lastTrick    = state.lastTrick    ?? []

  const isMyPlayingTurn = state.phase === 'playing' && turnUserId === effectiveUserId
  const legalIds = isMyPlayingTurn ? getLegalCardIds(state, effectiveUserId, activeHand) : []
  const isPickerOverlay = (state.phase === 'burying' || state.phase === 'calling') && state.picker === effectiveUserId

  const suggestedIdsForHand = botSuggestion && botSuggestion.kind === 'play'
    ? botSuggestion.ids
    : null

  const suggestedIdsForActionPanel = botSuggestion &&
    (botSuggestion.kind === 'call' || botSuggestion.kind === 'bury')
      ? botSuggestion.ids
      : null

  const suggestedActionForPanel = botSuggestion?.actionLabel ?? null

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
        trick={displayedTrick}
        seats={seats}
        blind={state.phase === 'picking' ? (state.blind ?? []) : []}
      />

      {/* ── Right panel: last trick + game options + leave game ── */}
      <div className="last-trick-area">
        <LastTrickArea lastTrick={lastTrick} seats={seats} />
        <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
          <div style={{ fontSize: '0.68rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Game options</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <SettingsSummary
              settings={currentSettings}
              style={{ color: '#aaa', fontSize: '0.78rem' }}
            />
            <button className="outline" style={{ fontSize: '0.78rem', padding: '2px 8px' }}
              onClick={() => setShowOptions(true)}>
              ⚙ Options
            </button>
          </div>
          <GameOptionsPanel
            mode="update"
            gameId={gameId}
            open={showOptions}
            values={currentSettings}
            onUpdated={handleSettingsUpdate}
            onClose={() => setShowOptions(false)}
            role={isGameAdmin ? 'admin' : 'player'}
            botSuggestionEnabled={showBotSuggestion}
            onBotSuggestionChange={handleBotSuggestionChange}
          />
        </div>
        <div style={{ marginTop: 'auto', width: '100%', display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
          <button className="outline contrast" style={{ fontSize: '0.8rem' }}
            onClick={handleLeave} aria-busy={leaving} disabled={leaving}>
            Leave game
          </button>
        </div>
      </div>

      {/* ── Info bar: called ace + partner reveal ── */}
      <div className="info-bar">
        {calledAce && (
          <span className="called-ace-badge">
            Partner: A{SUIT_SYMBOLS[calledAce.suit]}
            {partnerPlayer ? ` (${partnerPlayer.username})` : ''}
          </span>
        )}
        {state.goingAlone && (
          <span className="called-ace-badge" style={{ background: 'rgba(168,85,247,0.35)' }}>
            Picker is going alone
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
          suggestedIds={suggestedIdsForHand}
          onCardClick={isMyPlayingTurn
            ? (card) => { if (legalIds.includes(card.id)) handleAction('play_card', { cardId: card.id }, isActingForBot ? turnUserId : null) }
            : undefined}
        />
      </div>

      {/* ── Action panel (hidden on your real playing turn — cards in seat instead) ── */}
      {!(isMyPlayingTurn && !isActingForBot) && (
        <div className={`action-panel${isPickerOverlay ? ' action-panel-bury-overlay' : ''}`}>
          <ActionPanel
            state={state}
            myUserId={effectiveUserId}
            myHand={activeHand}
            onAction={(type, payload) => handleAction(type, payload, isActingForBot ? turnUserId : null)}
            loading={actionLoading}
            actingForName={isActingForBot ? (actingForPlayer?.username ?? turnUserId) : null}
            suggestedAction={suggestedActionForPanel}
            suggestedIds={suggestedIdsForActionPanel}
          />
        </div>
      )}

      {/* ── Test controls (admin rewind) ── */}
      {isTestMode && user.is_admin && state.phase === 'playing' && (
        <div style={{
          gridColumn: '1 / -1',
          display: 'flex',
          gap: 8,
          justifyContent: 'center',
          padding: '4px 0',
        }}>
          <button
            className="secondary"
            onClick={() => handleAction('rewind_play', {})}
            disabled={!canRewindPlay || actionLoading}
            style={{ fontSize: '0.8rem' }}
          >
            Rewind Play
          </button>
          <button
            className="secondary"
            onClick={() => handleAction('rewind_trick', {})}
            disabled={!canRewindTrick || actionLoading}
            style={{ fontSize: '0.8rem' }}
          >
            Rewind Trick
          </button>
        </div>
      )}

      {/* ── Game log ── */}
      <GameLog entries={resolvedLog} gameId={gameId} />


    </div>
  )
}
