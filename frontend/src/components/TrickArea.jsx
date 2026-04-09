import Card from './Card.jsx'

// Map a played-card entry to one of the 5 seat slots based on `seats`
// (the relative-seat layout passed in from GamePage).
function slotForUserId(seats, userId) {
  const u = String(userId)
  for (const slot of ['bottom', 'left', 'topLeft', 'topRight', 'right']) {
    if (seats?.[slot] && String(seats[slot].user_id) === u) return slot
  }
  return null
}

// 3x3 sub-grid that places cards in front of their seat positions:
//   [topLeft]  .       [topRight]
//   [left]     .       [right]
//   .          [bottom] .
function TrickGrid({ entries = [], seats = {}, mini = false }) {
  const slots = { topLeft: null, topRight: null, left: null, right: null, bottom: null }
  for (const entry of entries) {
    const slot = slotForUserId(seats, entry.userId)
    if (slot) slots[slot] = entry
  }

  const cell = (slot) => {
    const entry = slots[slot]
    return (
      <div className={`trick-slot trick-slot-${slot}`}>
        {entry && <Card card={entry.card} />}
      </div>
    )
  }

  return (
    <div className={`trick-grid${mini ? ' trick-grid-mini' : ''}`}>
      {cell('topLeft')}
      <div className="trick-slot trick-slot-spacer" />
      {cell('topRight')}
      {cell('left')}
      {cell('bottom')}
      {cell('right')}
    </div>
  )
}

export default function TrickArea({ trick = [], seats = {}, blind = [] }) {
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

      {trick.length === 0 && blind.length === 0 && (
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>
          Waiting for first play…
        </span>
      )}

      {trick.length > 0 && <TrickGrid entries={trick} seats={seats} />}
    </div>
  )
}

export function LastTrickArea({ lastTrick = [], seats = {} }) {
  if (!lastTrick || lastTrick.length === 0) return null
  return (
    <div className="last-trick-area">
      <div className="last-trick-label">Last trick</div>
      <TrickGrid entries={lastTrick} seats={seats} mini />
    </div>
  )
}
