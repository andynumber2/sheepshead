import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api.js'

const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers', schwanzers: 'Schwanzers' }

/**
 * Reusable game options modal.
 *
 * mode="create"  — no API calls; calls onChange({ no_pick_variant, reveal_partner, double_on_bump }) on each change.
 * mode="update"  — deferred save: local state only until the admin presses Done, which sends
 *                  one PATCH carrying the changed fields plus log_change: true. Escape or
 *                  backdrop click cancels and discards local edits.
 *
 * The parent controls open/close via the `open` prop and `onClose` callback.
 */
export default function GameOptionsPanel({
  mode, gameId, open, values, onChange, onUpdated, onClose,
  role = 'admin',
  botSuggestionEnabled = false,
  onBotSuggestionChange = null,
}) {
  const dialogRef = useRef(null)
  // True when the in-flight close was initiated by the Done button. Lets us
  // distinguish a commit (Done) from a cancel (Escape/backdrop), since the
  // native <dialog> onClose event fires for both.
  const committedRef = useRef(false)
  // Snapshot of the settings at the moment the modal opened. Used in update
  // mode to decide which fields actually changed when Done is pressed.
  const initialRef = useRef(null)

  const [variant, setVariant] = useState(values?.no_pick_variant ?? 'doublers')
  const [reveal,  setReveal]  = useState(values?.reveal_partner  ?? false)
  const [dob,     setDob]     = useState(values?.double_on_bump  ?? true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  // Re-sync form from parent values each time the panel opens, and capture
  // the initial snapshot.
  useEffect(() => {
    if (open) {
      const v = values?.no_pick_variant ?? 'doublers'
      const r = values?.reveal_partner  ?? false
      const d = values?.double_on_bump  ?? true
      setVariant(v)
      setReveal(r)
      setDob(d)
      setError(null)
      committedRef.current = false
      initialRef.current = { no_pick_variant: v, reveal_partner: r, double_on_bump: d }
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

  function handleVariantChange(v) {
    setVariant(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: v, reveal_partner: reveal, double_on_bump: dob })
    }
  }

  function handleRevealChange(v) {
    setReveal(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: variant, reveal_partner: v, double_on_bump: dob })
    }
  }

  function handleDobChange(v) {
    setDob(v)
    if (mode === 'create') {
      onChange?.({ no_pick_variant: variant, reveal_partner: reveal, double_on_bump: v })
    }
  }

  async function handleDone() {
    if (mode !== 'update' || role === 'player') {
      committedRef.current = true
      onClose?.()
      return
    }
    const initial = initialRef.current
    const changed = {}
    if (variant !== initial.no_pick_variant) changed.no_pick_variant = variant
    if (reveal  !== initial.reveal_partner)  changed.reveal_partner  = reveal
    if (dob     !== initial.double_on_bump)  changed.double_on_bump  = dob

    if (Object.keys(changed).length === 0) {
      committedRef.current = true
      onClose?.()
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await api.games.updateSettings(gameId, { ...changed, log_change: true })
      onUpdated?.(result)
      committedRef.current = true
      onClose?.()
    } catch (e) {
      setError(e?.message ?? 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  // Fires for any dialog close — Done, Escape, backdrop click. We only
  // propagate to the parent here; the commit path is in handleDone.
  function handleDialogClose() {
    if (!committedRef.current) {
      // Cancel path: discard local edits by simply closing. The next open
      // will reseed from `values` (parent state).
    }
    committedRef.current = false
    onClose?.()
  }

  const isReadOnly = role === 'player'
  const VARIANT_DISPLAY = { doublers: 'Doublers', leasters: 'Leasters', schwanzers: 'Schwanzers' }

  return (
    <dialog
      ref={dialogRef}
      className="game-options-dialog"
      onClose={handleDialogClose}
    >
      <strong style={{ fontSize: '0.95rem' }}>⚙ Game options</strong>
      {mode === 'update' && !isReadOnly && (
        <small style={{ color: '#aaa', display: 'block', marginBottom: 12, marginTop: 2 }}>
          Changes take effect next hand
        </small>
      )}
      {isReadOnly && (
        <small style={{ color: '#aaa', display: 'block', marginBottom: 12, marginTop: 2 }}>
          Only the game admin can change these
        </small>
      )}
      {mode === 'create' && (
        <div style={{ marginBottom: 12 }} />
      )}

      {isReadOnly ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 6, columnGap: 16, marginBottom: 16, fontSize: '0.85rem' }}>
          <span style={{ color: '#aaa' }}>No-pick variant</span>
          <span>{VARIANT_DISPLAY[variant] ?? variant}</span>
          <span style={{ color: '#aaa' }}>Partner visibility</span>
          <span>{reveal ? 'Shown' : 'Hidden'}</span>
          <span style={{ color: '#aaa' }}>Double on bump</span>
          <span>{dob ? 'On' : 'Off'}</span>
        </div>
      ) : (
        <>
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
              Double on the Bump?
              <input
                type="checkbox"
                checked={dob}
                onChange={e => handleDobChange(e.target.checked)}
                disabled={saving}
              />
            </label>
          </div>
        </>
      )}

      {/* Your preferences — hidden in create mode (no game yet) */}
      {mode !== 'create' && onBotSuggestionChange && (
        <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.15)', marginBottom: 16 }}>
          <div style={{ color: '#ccc', fontSize: '0.82rem', marginBottom: 6 }}>Your preferences</div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={botSuggestionEnabled}
              onChange={e => onBotSuggestionChange(e.target.checked)}
              disabled={saving}
              style={{ marginTop: 3 }}
            />
            <span>
              Show Bot Suggestion
              <small style={{ display: 'block', color: '#888', marginTop: 2 }}>
                Highlights the card the bot would play on your turn. Purely advisory — useful for learning the game or comparing against the bot's strategy.
              </small>
            </span>
          </label>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.82rem' }}>
          {mode === 'update' && saving && <span style={{ color: '#aaa' }}>Saving…</span>}
          {mode === 'update' && error  && <span style={{ color: '#f87171' }}>{error}</span>}
        </div>
        <button
          type="button"
          onClick={handleDone}
          disabled={saving}
          style={{ fontSize: '0.85rem', padding: '4px 16px' }}
        >
          Done
        </button>
      </div>
    </dialog>
  )
}
