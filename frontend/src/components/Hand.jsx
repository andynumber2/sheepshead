import Card from './Card.jsx'
import { effectiveSuit, isTrump } from '@shared/gameEngine.js'

// Sort hand: trump first (by trump order), then by suit then rank
export function sortHand(cards) {
  const TRUMP_ORDER = ['QC','QS','QH','QD','JC','JS','JH','JD','AD','10D','KD','9D','8D','7D']
  const SUIT_RANK = ['A','10','K','9','8','7']
  const SUIT_ORDER = { T: 0, S: 1, H: 2, C: 3 }

  return [...cards].sort((a, b) => {
    const aT = isTrump(a), bT = isTrump(b)
    if (aT && bT) return TRUMP_ORDER.indexOf(a.id) - TRUMP_ORDER.indexOf(b.id)
    if (aT) return -1
    if (bT) return 1
    const suitDiff = (SUIT_ORDER[a.suit] ?? 9) - (SUIT_ORDER[b.suit] ?? 9)
    if (suitDiff !== 0) return suitDiff
    return SUIT_RANK.indexOf(a.rank) - SUIT_RANK.indexOf(b.rank)
  })
}

export default function Hand({ cards = [], playableIds = null, selectedIds = [], suggestedIds = null, onCardClick }) {
  const sorted = sortHand(cards)

  return (
    <div className="hand">
      {sorted.map(card => {
        const playable  = playableIds === null ? false : playableIds.includes(card.id)
        const selected  = selectedIds.includes(card.id)
        const suggested = suggestedIds !== null && suggestedIds.includes(card.id)
        return (
          <Card
            key={card.id}
            card={card}
            playable={playable}
            selected={selected}
            suggested={suggested}
            onClick={() => onCardClick?.(card)}
          />
        )
      })}
    </div>
  )
}
