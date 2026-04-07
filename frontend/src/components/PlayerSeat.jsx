export default function PlayerSeat({ player, cardCount, isDealer, isPicker, isPartner, isYou, isActiveTurn }) {
  if (!player) {
    return (
      <div className="player-seat" style={{ opacity: 0.4 }}>
        <div style={{ fontSize: '0.75rem' }}>Empty seat</div>
      </div>
    )
  }

  return (
    <div className={`player-seat${isActiveTurn ? ' active-turn' : ''}`}>
      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
        {player.username}
        {isYou && <span className="badge badge-you">you</span>}
        {isDealer && <span className="badge badge-dealer">D</span>}
        {isPicker && <span className="badge badge-picker">picker</span>}
        {isPartner && <span className="badge badge-partner">partner</span>}
      </div>
      <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: 2 }}>
        {cardCount} card{cardCount !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
