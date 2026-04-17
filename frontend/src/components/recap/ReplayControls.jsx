import { useEffect, useState } from 'react'
import './recap.css'

const SPEEDS = [
  { label: '1×', ms: 1000 },
  { label: '2×', ms: 500 },
  { label: '4×', ms: 250 },
]

/**
 * Step controls for the detailed replay.
 * Props:
 *  - actionIndex: number (0..totalActions-1) — current position in action log
 *  - totalActions: total number of actions in the hand
 *  - onJump: (index: number) => void
 *  - playLabel: short human description of what's happening now
 *  - trickBoundaries: number[] — action indices at which tricks end (used for next-trick jump)
 */
export default function ReplayControls({ actionIndex, totalActions, onJump, playLabel, trickBoundaries = [] }) {
  const atStart = actionIndex <= 0
  const atEnd = actionIndex >= totalActions - 1
  const auto = useAutoPlay(onJump, actionIndex, totalActions)

  function prevTrick() {
    const prev = trickBoundaries.filter(b => b < actionIndex).pop()
    onJump(prev != null ? prev : 0)
  }
  function nextTrick() {
    const next = trickBoundaries.find(b => b > actionIndex)
    onJump(next != null ? next : totalActions - 1)
  }

  return (
    <>
      <div className="replay-controls">
        <div className="step-info">Action <b>{actionIndex}</b> of {totalActions - 1} · {playLabel}</div>
        <div className="ctrls">
          <button disabled={atStart} onClick={() => onJump(0)}>⏮ Start</button>
          <button disabled={atStart} onClick={prevTrick}>◀ Prev trick</button>
          <button disabled={atStart} onClick={() => onJump(actionIndex - 1)}>◀ Step</button>
          <button disabled={atEnd} className="primary" onClick={() => onJump(actionIndex + 1)}>Step ▶</button>
          <button disabled={atEnd} onClick={nextTrick}>Next trick ▶</button>
          <button disabled={atEnd} onClick={() => onJump(totalActions - 1)}>End ⏭</button>
          <select value={auto.speedIdx} onChange={e => auto.setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
          </select>
          <button disabled={atEnd} onClick={auto.toggle}>{auto.running ? '⏸ Pause' : '▶▶ Auto'}</button>
        </div>
      </div>
      <div className="replay-scrubber">
        <div className="fill" style={{ width: `${totalActions > 1 ? (actionIndex / (totalActions - 1)) * 100 : 0}%` }} />
      </div>
    </>
  )
}

// Internal auto-play state hook. Ticks `onJump(i+1)` at the selected speed.
function useAutoPlay(onJump, actionIndex, totalActions) {
  const [running, setRunning] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(0)

  useEffect(() => {
    if (!running) return
    if (actionIndex >= totalActions - 1) { setRunning(false); return }
    const t = setTimeout(() => onJump(actionIndex + 1), SPEEDS[speedIdx].ms)
    return () => clearTimeout(t)
  }, [running, actionIndex, totalActions, speedIdx, onJump])

  return {
    running, speedIdx,
    toggle: () => setRunning(r => !r),
    setSpeed: (i) => setSpeedIdx(i),
  }
}
