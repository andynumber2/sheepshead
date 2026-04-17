import './recap.css'

function isRed(cardId) {
  return cardId.endsWith('H') || cardId.endsWith('D')
}

function CardStatic({ id }) {
  return <div className={`recap-card-static${isRed(id) ? ' red' : ''}`}>{id.replace(/([AKQJ]|10)([CDHS])/, '$1$2')}</div>
}

export default function BlindStrip({ blind, pickerDiscards }) {
  if (!blind) return null
  return (
    <div className="recap-blind">
      <div className="group">
        <div className="label">Blind (picked up)</div>
        <div className="cards">{blind.map(id => <CardStatic key={id} id={id} />)}</div>
      </div>
      {pickerDiscards && pickerDiscards.length > 0 && (
        <div className="group right">
          <div className="label">Picker discarded</div>
          <div className="cards">{pickerDiscards.map(id => <CardStatic key={id} id={id} />)}</div>
        </div>
      )}
    </div>
  )
}
