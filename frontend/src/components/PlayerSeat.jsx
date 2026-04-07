export default function PlayerSeat({
  player,
  cardCount,
  isDealer,
  isPicker,
  isPartner,
  isYou,
  isActiveTurn,
  dayScore,
  lifetimeScore,
}) {
  if (!player) {
    return (
      <div className="player-seat" style={{ opacity: 0.4 }}>
        <div style={{ fontSize: '0.75rem' }}>Empty seat</div>
      </div>
    )
  }

  const formatScore = (n) => (n > 0 ? `+${n}` : String(n))

  return (
    <div className={`player-seat${isActiveTurn ? ' active-turn' : ''}`}>
      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
        {player.username}
        {isYou     && <span className="badge badge-you">you</span>}
        {isDealer  && <span className="badge badge-dealer">D</span>}
        {isPicker  && <span className="badge badge-picker">picker</span>}
        {isPartner && <span className="badge badge-partner">partner</span>}
      </div>
      <div className="player-scores">
        D: {formatScore(dayScore ?? 0)}, L: {formatScore(lifetimeScore ?? 0)}
      </div>
      <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 1 }}>
        {cardCount} card{cardCount !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
