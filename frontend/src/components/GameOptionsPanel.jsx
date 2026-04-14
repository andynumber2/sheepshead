import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api.js'

const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers', schwanzers: 'Schwanzers' }

/**
 * Reusable game options modal.
 *
 * mode="create"  — no API calls; calls onChange({ no_pick_variant, reveal_partner }) on each change.
 * mode="update"  — auto-saves via PATCH /api/games/:gameId/settings on each change; calls onUpdated(result).
 *
 * The parent controls open/close via the `open` prop and `onClose` callback.
 */
export default function GameOptionsPanel({ mode, gameId, open, values, onChange, onUpdated, onClose }) {
  const dialogRef  = useRef(null)
  const [variant, setVariant] = useState(values?.no_pick_variant ?? 'doublers')
  const [reveal,  setReveal]  = useState(values?.reveal_partner  ?? false)
  const [dob,     setDob]     = useState(values?.double_on_bump  ?? true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  // Re-sync form from parent values each time the panel opens
  useEffect(() => {
    if (open) {
      setVariant(values?.no_pick_variant ?? 'leasters')
      setReveal(values?.reveal_partner  ?? true)
      setDob(values?.double_on_bump ?? true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Drive the native <dialog> open/close
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) dialog.showModal()
    } else {
      if (dialog.open) dialog.close()
    }
  }, [open])

  async function handleVariantChange(v) {
    setVariant(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: v, reveal_partner: reveal, double_on_bump: dob })
    } else {
      await save({ no_pick_variant: v })
    }
  }

  async function handleRevealChange(v) {
    setReveal(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: variant, reveal_partner: v, double_on_bump: dob })
    } else {
      await save({ reveal_partner: v })
    }
  }

  async function handleDobChange(v) {
    setDob(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: variant, reveal_partner: reveal, double_on_bump: v })
    } else {
      await save({ double_on_bump: v })
    }
  }

  async function save(patch) {
    setSaving(true)
    setSaved(false)
    try {
      const result = await api.games.updateSettings(gameId, patch)
      setSaved(true)
      onUpdated?.(result)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* revert handled by parent re-poll */ }
    finally { setSaving(false) }
  }

  return (
    <dialog
      ref={dialogRef}
      className="game-options-dialog"
      onClose={onClose}
    >
      <strong style={{ fontSize: '0.95rem' }}>⚙ Game options</strong>
      {mode === 'update' && (
        <small style={{ color: '#aaa', display: 'block', marginBottom: 12, marginTop: 2 }}>
          Changes take effect next hand
        </small>
      )}
      {mode === 'create' && (
        <div style={{ marginBottom: 12 }} />
      )}

      {/* No-pick variant */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: '#ccc', fontSize: '0.82rem', marginBottom: 4 }}>No-pick variant</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {['doublers', 'leasters', 'schwanzers'].map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="radio"
                name={`variant-${gameId ?? 'create'}`}
                value={v}
                checked={variant === v}
                onChange={() => handleVariantChange(v)}
                disabled={saving}
              />
              {VARIANT_LABELS[v]}
            </label>
          ))}
        </div>
      </div>

      {/* Identify partner */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: '#ccc', fontSize: '0.82rem', marginBottom: 4 }}>
          Partner Visibility
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[false, true].map(v => (
            <label key={String(v)} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="radio"
                name={`reveal-${gameId ?? 'create'}`}
                value={String(v)}
                checked={reveal === v}
                onChange={() => handleRevealChange(v)}
                disabled={saving}
              />
              {v ? 'Shown' : 'Hidden'}
            </label>
          ))}
        </div>
      </div>

      {/* Double on the Bump */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
          <input
            type="checkbox"
            checked={dob}
            onChange={e => handleDobChange(e.target.checked)}
            disabled={saving}
          />
          Double on the Bump?
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.82rem' }}>
          {mode === 'update' && saving && <span style={{ color: '#aaa' }}>Saving…</span>}
          {mode === 'update' && saved  && <span style={{ color: '#4ade80' }}>✓ Saved</span>}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ fontSize: '0.85rem', padding: '4px 16px' }}
        >
          Done
        </button>
      </div>
    </dialog>
  )
}
