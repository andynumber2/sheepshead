import './recap.css'

function isRed(id) { return id.endsWith('H') || id.endsWith('D') }
function fmt(id) { return id.replace(/([AKQJ]|10)([CDHS])/, '$1$2') }

/**
 * Renders one seat showing the player's full dealt hand.
 * `dealt` = array of card ids the player held at deal.
 * `playedCardIds` = Set of card ids that have been played (dimmed).
 * `nowCardId` = the card this player just played (if active).
 * `roles` = {isPicker, isPartner, isActive}
 */
export default function ReplaySeat({ player, dealt, playedCardIds, nowCardId, roles = {} }) {
  const cls = [
    'replay-seat',
    roles.isPicker && 'is-picker',
    roles.isPartner && 'is-partner',
    roles.isActive && 'is-active',
  ].filter(Boolean).join(' ')

  const roleLabel = roles.isPicker ? 'picker' : roles.isPartner ? 'partner' : 'defender'

  return (
    <div className={cls}>
      <div className="seat-name">
        {player.username} <span className="role">{roleLabel}</span>
      </div>
      <div className="hand">
        {dealt.map(id => {
          const cardCls = [
            'replay-mini-card',
            isRed(id) && 'red',
            playedCardIds.has(id) && id !== nowCardId && 'played',
            id === nowCardId && 'now',
          ].filter(Boolean).join(' ')
          return <span key={id} className={cardCls}>{fmt(id)}</span>
        })}
      </div>
    </div>
  )
}
