import { sortHand } from './Hand.jsx'

const CARD_BACK_SRC = '/cards/blue_back.png'

export default function PlayerSeat({
  player,
  isDealer,
  isPicker,
  isPartner,
  isYou,
  isActiveTurn,
  dayScore,
  lifetimeScore,
  hand,
  showFaceUp,
  playableIds,
  onCardClick,
  noOverlap,
  onCrack,
  onRecrack,
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
    <div className={`player-seat${isActiveTurn ? ' active-turn' : ''}${noOverlap ? ' player-seat-wide' : ''}`}>
      <div style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 3 }}>
        {player.username}
        {isYou     && <span className="badge badge-you">you</span>}
        {isDealer  && <span className="badge badge-dealer">D</span>}
        {isPicker  && <span className="badge badge-picker">picker</span>}
        {isPartner && <span className="badge badge-partner">partner</span>}
        {onCrack   && (
          <button onClick={onCrack} style={{ fontSize: '0.6rem', padding: '1px 4px', lineHeight: 1.4, marginLeft: 2 }}>
            crack
          </button>
        )}
{onRecrack && (
          <button onClick={onRecrack} style={{ fontSize: '0.6rem', padding: '1px 4px', lineHeight: 1.4, marginLeft: 2 }}>
            recrack
          </button>
        )}
      </div>
      <div className="player-scores">
        D: {formatScore(dayScore ?? 0)}, L: {formatScore(lifetimeScore ?? 0)}
      </div>

      {hand && hand.length > 0 && (
        <div className={`mini-card-stack${noOverlap ? ' no-overlap' : ''}`}>
          {sortHand(hand.filter(c => !c.hidden)).concat(hand.filter(c => c.hidden)).map((card, i) => {
            const faceUp = showFaceUp && !card.hidden
            const playable = playableIds?.includes(card.id)
            return (
              <img
                key={i}
                src={faceUp ? `/cards/${card.id}.png` : CARD_BACK_SRC}
                alt={faceUp ? card.id : 'card'}
                className={`mini-card${playable ? ' mini-card-playable' : ''}`}
                onClick={playable ? () => onCardClick?.(card) : undefined}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
