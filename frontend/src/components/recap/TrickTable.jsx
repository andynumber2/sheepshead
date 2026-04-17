import './recap.css'

function isRed(cardId) {
  return cardId.endsWith('H') || cardId.endsWith('D')
}

function formatCard(id) {
  return id.replace(/([AKQJ]|10)([CDHS])/, '$1$2')
}

export default function TrickTable({ digest, onCardClick }) {
  const { players, tricks, picker, partner } = digest
  if (!tricks || tricks.length === 0) return null

  const pickerId = picker?.userId ?? null
  const partnerId = partner?.userId ?? null

  return (
    <table className="recap-trick-table">
      <thead>
        <tr>
          <th style={{ textAlign: 'left', paddingLeft: 14 }}>Trick</th>
          {players.map(p => {
            const isPicker = p.userId === pickerId
            const isPartner = p.userId === partnerId
            const cls = isPicker ? 'picker-col' : isPartner ? 'partner-col' : ''
            const role = isPicker ? 'picker' : isPartner ? 'partner' : null
            return (
              <th key={p.userId} className={cls}>
                {p.username}
                {role && (<><br/><span style={{ fontWeight: 400, fontSize: 9 }}>{role}</span></>)}
              </th>
            )
          })}
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        {tricks.map(trick => (
          <tr key={trick.trickNumber}>
            <td className="trick-label">Trick {trick.trickNumber}</td>
            {players.map(p => {
              const play = trick.plays.find(pl => pl.userId === p.userId)
              if (!play) return <td key={p.userId} className="cell">—</td>
              const isLed = p.userId === trick.leaderUserId
              const isWinner = p.userId === trick.winnerUserId
              const cls = ['recap-c-link', isLed && 'led', isWinner && 'winner'].filter(Boolean).join(' ')
              return (
                <td key={p.userId} className="cell">
                  <a href="#"
                     className={cls}
                     onClick={(e) => { e.preventDefault(); onCardClick(play.seq) }}>
                    <span className={`recap-c-card${isRed(play.card) ? ' red' : ''}`}>{formatCard(play.card)}</span>
                  </a>
                </td>
              )
            })}
            <td className="trick-pts">{trick.cardPoints}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
