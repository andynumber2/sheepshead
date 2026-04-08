import Card from './Card.jsx'

export default function TrickArea({ trick = [], lastTrick = [], players = [], blind = [] }) {
  const getUsername = (userId) => {
    const p = players.find(p => String(p.user_id) === String(userId))
    return p?.username ?? userId
  }

  const trickCards = (entries, dim = false) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', opacity: dim ? 0.45 : 1 }}>
      {entries.map(({ userId, card }) => (
        <div key={userId} style={{ textAlign: 'center' }}>
          <div style={{ color: '#ccc', fontSize: '0.7rem', marginBottom: 2 }}>{getUsername(userId)}</div>
          <Card card={card} />
        </div>
      ))}
    </div>
  )

  return (
    <div className="trick-area">
      {blind.length > 0 && (
        <div style={{ textAlign: 'center', color: '#ccc', fontSize: '0.75rem', width: '100%' }}>
          <div>Blind</div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            {blind.map((c, i) => <Card key={i} card={c} />)}
          </div>
        </div>
      )}

      {trick.length === 0 && lastTrick.length === 0 && blind.length === 0 && (
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>
          Waiting for first play…
        </span>
      )}

      {trick.length > 0 && trickCards(trick)}

      {lastTrick.length > 0 && (
        <div style={{ width: '100%', marginTop: trick.length > 0 ? 12 : 0 }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', textAlign: 'center', marginBottom: 4 }}>
            Last trick
          </div>
          {trickCards(lastTrick, true)}
        </div>
      )}
    </div>
  )
}
