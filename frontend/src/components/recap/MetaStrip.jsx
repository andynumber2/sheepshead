import './recap.css'

function findUsername(players, userId) {
  return players.find(p => p.userId === userId)?.username ?? userId
}

function callModeLabel(callMode) {
  if (callMode === 'ace') return 'Ace'
  if (callMode === 'ten') return 'Ten'
  if (callMode === 'king') return 'King'
  return '—'
}

function variantLabel(v) {
  if (v === 'normal') return 'Normal'
  if (v === 'leaster') return 'Leaster'
  if (v === 'schwanzer') return 'Schwanzer'
  return v
}

export default function MetaStrip({ digest }) {
  const { variant, callMode, picker, partner, calledCard, players } = digest
  return (
    <div className="recap-meta-row">
      <div className="recap-meta-cell">
        <div className="k">Variant</div><div className="v">{variantLabel(variant)}</div>
      </div>
      <div className="recap-meta-cell">
        <div className="k">Call mode</div><div className="v">{callModeLabel(callMode)}</div>
      </div>
      <div className="recap-meta-cell picker">
        <div className="k">Picker</div>
        <div className="v">{picker ? findUsername(players, picker.userId) : '—'}</div>
      </div>
      <div className="recap-meta-cell">
        <div className="k">Called card</div><div className="v">{calledCard ?? '—'}</div>
      </div>
      <div className="recap-meta-cell partner">
        <div className="k">Partner</div>
        <div className="v">{partner ? findUsername(players, partner.userId) : '—'}</div>
      </div>
    </div>
  )
}
