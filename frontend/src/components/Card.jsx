import { isTrump } from '@shared/gameEngine.js'

const SUIT_SYMBOLS = { C: '♣', D: '♦', H: '♥', S: '♠' }
const SUIT_CLASSES  = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' }

export default function Card({ card, playable = false, selected = false, onClick }) {
  if (!card || card.hidden) {
    return <div className="card hidden" aria-label="Hidden card" />
  }

  const trump = isTrump(card)
  const suitClass = SUIT_CLASSES[card.suit] ?? ''
  const classes = [
    'card',
    trump ? 'trump' : suitClass,
    playable ? 'playable' : '',
    selected ? 'selected' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      onClick={playable ? onClick : undefined}
      title={trump ? `${card.id} (trump)` : card.id}
      role={playable ? 'button' : undefined}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_SYMBOLS[card.suit]}</span>
    </div>
  )
}
