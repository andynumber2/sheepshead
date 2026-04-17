import './recap.css'

function findPlayer(players, userId) {
  return players.find(p => p.userId === userId)
}

function roleTag(player, digest) {
  if (digest.picker && digest.picker.userId === player.userId) return ' (picker)'
  if (digest.partner && digest.partner.userId === player.userId) return ' (partner)'
  return ''
}

export default function ScoresList({ digest }) {
  const { scores, players, variant } = digest

  let winnerCallout = null
  if (variant === 'leaster' && scores.length > 0) {
    const eligible = scores.filter(s => s.cardPoints > 0)
    if (eligible.length > 0) {
      const lowest = eligible.reduce((min, s) => (s.cardPoints < min.cardPoints ? s : min))
      const p = findPlayer(players, lowest.userId)
      winnerCallout = (
        <div style={{ color: '#22c55e', marginTop: 8, fontSize: 13 }}>
          Hand winner: <b>{p?.username ?? lowest.userId}</b> ({lowest.cardPoints} pts)
        </div>
      )
    }
  }

  return (
    <div className="recap-scores">
      <h4>Final</h4>
      {scores.map(s => {
        const player = findPlayer(players, s.userId)
        return (
          <div className="row" key={s.userId}>
            <span className="name">{player?.username ?? s.userId}{roleTag(player, digest)}</span>
            <span className="pts">{variant === 'schwanzer' ? '—' : `${s.cardPoints} pts`}</span>
            <span className={`score ${s.scoreDelta >= 0 ? 'pos' : 'neg'}`}>
              {s.scoreDelta >= 0 ? '+' : ''}{s.scoreDelta}
            </span>
          </div>
        )
      })}
      {winnerCallout}
    </div>
  )
}
