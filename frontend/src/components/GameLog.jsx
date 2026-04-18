import { useEffect, useRef } from 'react'

const HAND_COMPLETE_RE = /^--- Hand (\d+) complete ---$/

export default function GameLog({ entries = [], gameId }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [entries.length])

  return (
    <div className="game-log" ref={ref}>
      <strong style={{ color: '#fff', display: 'block', marginBottom: 4 }}>Play History</strong>
      {entries.length === 0 && <p style={{ color: '#666' }}>No events yet.</p>}
      {entries.map((entry, i) => <LogLine key={i} text={entry} gameId={gameId} />)}
    </div>
  )
}

function LogLine({ text, gameId }) {
  const match = text.match(HAND_COMPLETE_RE)
  if (!match || !gameId) return <p>{text}</p>
  const handNumber = match[1]
  const href = `#/recap/${gameId}/${handNumber}`
  return (
    <p>
      --- <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff' }}>Hand {handNumber}</a> complete ---
    </p>
  )
}
