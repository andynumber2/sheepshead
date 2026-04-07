import { useEffect, useRef } from 'react'

export default function GameLog({ entries = [] }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [entries.length])

  return (
    <div className="game-log" ref={ref}>
      <strong style={{ color: '#fff', display: 'block', marginBottom: 4 }}>Game Log</strong>
      {entries.length === 0 && <p style={{ color: '#666' }}>No events yet.</p>}
      {entries.map((entry, i) => <p key={i}>{entry}</p>)}
    </div>
  )
}
