import { isTrump } from '@shared/gameEngine.js'

const CARD_BACK_SRC = '/cards/blue_back.png'

function cardImageSrc(cardId) {
  return `/cards/${cardId}.png`
}

export default function Card({ card, playable = false, selected = false, suggested = false, onClick }) {
  if (!card || card.hidden) {
    const hiddenClasses = [
      'card', 'card-img', 'hidden',
      playable  ? 'playable'       : '',
      selected  ? 'selected'       : '',
      suggested ? 'card-suggested' : '',
    ].filter(Boolean).join(' ')
    return (
      <div
        className={hiddenClasses}
        aria-label={card?.isUnderCard ? 'Under card' : 'Hidden card'}
        title={card?.isUnderCard ? 'Under card' : undefined}
        onClick={playable ? onClick : undefined}
        role={playable ? 'button' : undefined}
      >
        <img src={CARD_BACK_SRC} alt="Card back" className="card-image" />
      </div>
    )
  }

  const trump = isTrump(card)

  const classes = [
    'card',
    'card-img',
    trump     ? 'trump'          : '',
    playable  ? 'playable'       : '',
    selected  ? 'selected'       : '',
    suggested ? 'card-suggested' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      onClick={playable ? onClick : undefined}
      title={trump ? `${card.id} (trump)` : card.id}
      role={playable ? 'button' : undefined}
    >
      <img src={cardImageSrc(card.id)} alt={card.id} className="card-image" />
    </div>
  )
}
