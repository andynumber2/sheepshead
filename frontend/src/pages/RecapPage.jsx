import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import MetaStrip from '../components/recap/MetaStrip.jsx'
import BlindStrip from '../components/recap/BlindStrip.jsx'
import ScoresList from '../components/recap/ScoresList.jsx'
import TrickTable from '../components/recap/TrickTable.jsx'
import '../components/recap/recap.css'

export default function RecapPage({ gameId, handNumber, onNavigate }) {
  const [digest, setDigest] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.recap.getDigest(gameId, handNumber)
      .then(d => { if (!cancelled) setDigest(d) })
      .catch(err => { if (!cancelled) setError(err.status === 404 ? 'Recap not available.' : 'Failed to load recap.') })
    return () => { cancelled = true }
  }, [gameId, handNumber])

  if (error) return <div className="recap-shell"><p>{error}</p></div>
  if (!digest) return <div className="recap-shell"><p>Loading…</p></div>

  function onCardClick(seq) {
    const base = `/recap/${gameId}/${handNumber}/replay`
    onNavigate(seq != null ? `${base}?seq=${seq}` : base)
  }

  const dateStr = digest.completedAt ? new Date(digest.completedAt).toLocaleString() : ''

  return (
    <div className="recap-shell">
      <div className="recap-header">
        <h1>Hand {digest.handNumber} Recap</h1>
        <div className="sub">Game #{digest.gameId}{dateStr && ` · played ${dateStr}`}</div>
      </div>
      <MetaStrip digest={digest} />
      <BlindStrip blind={digest.blind} pickerDiscards={digest.pickerDiscards} />
      <TrickTable digest={digest} onCardClick={onCardClick} />
      <div className="recap-legend">
        <span>Green outline = trick winner · Yellow outline = led the trick · Click a card to open the step-by-step replay at that point</span>
      </div>
      <ScoresList digest={digest} />
    </div>
  )
}
