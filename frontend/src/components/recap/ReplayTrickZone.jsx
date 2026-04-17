import './recap.css'

function isRed(id) { return id.endsWith('H') || id.endsWith('D') }
function fmt(id) { return id.replace(/([AKQJ]|10)([CDHS])/, '$1$2') }

/**
 * Renders the center trick zone — plays shown in order, empty slots dashed.
 * `plays` = [{userId, cardId}] — plays so far in the current (in-progress) trick
 * `allPlayers` = seat-ordered [{userId, username}]
 * `winnerUserId` = set only when trick is complete
 * `trickNumber` = 1..6 (or null)
 */
export default function ReplayTrickZone({ plays, allPlayers, winnerUserId, trickNumber, totalTricks }) {
  const byUser = new Map(plays.map(p => [p.userId, p.cardId]))
  return (
    <div className="replay-trick-zone">
      <div className="label">
        {trickNumber ? `Trick ${trickNumber} of ${totalTricks}${winnerUserId ? '' : ' · in progress'}` : 'Before first trick'}
      </div>
      <div className="replay-trick-cards">
        {allPlayers.map(p => {
          const cardId = byUser.get(p.userId)
          if (!cardId) {
            return (
              <div key={p.userId} className="replay-trick-card"
                   style={{ opacity: 0.3, borderStyle: 'dashed' }}>
                ?<div className="by">{p.username}</div>
              </div>
            )
          }
          const isWinner = winnerUserId === p.userId
          const cls = ['replay-trick-card', isRed(cardId) && 'red', isWinner && 'winner']
            .filter(Boolean).join(' ')
          return (
            <div key={p.userId} className={cls}>
              {fmt(cardId)}<div className="by">{p.username}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
