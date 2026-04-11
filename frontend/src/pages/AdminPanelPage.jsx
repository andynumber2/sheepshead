import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

function GameLimitSetting() {
  const [limit, setLimit]     = useState(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    api.admin.getConfig()
      .then(c => setLimit(c.max_active_games))
      .catch(e => setError(e.message))
  }, [])

  async function handleSave() {
    const val = parseInt(draft, 10)
    if (!Number.isInteger(val) || val < 1 || val > 100) {
      setError('Must be a number between 1 and 100.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await api.admin.updateConfig({ max_active_games: val })
      setLimit(updated.max_active_games)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleEdit() {
    setDraft(String(limit))
    setError(null)
    setEditing(true)
  }

  function handleCancel() {
    setEditing(false)
    setError(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: '0.9rem' }}>Max active games:</span>
        {editing ? (
          <>
            <input
              type="number"
              min={1}
              max={100}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              style={{ width: 70, margin: 0, padding: '2px 6px', fontSize: '0.9rem' }}
            />
            <button style={{ padding: '2px 10px', fontSize: '0.85rem' }} onClick={handleSave} aria-busy={saving} disabled={saving}>
              Save
            </button>
            <button className="secondary outline" style={{ padding: '2px 8px', fontSize: '0.85rem' }} onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <strong>{limit ?? '…'}</strong>
            <button className="outline" style={{ padding: '2px 8px', fontSize: '0.8rem' }} onClick={handleEdit} disabled={limit === null}>
              Edit
            </button>
          </>
        )}
      </div>
      {error && <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 4 }}>{error}</div>}
      <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: '#888' }}>
        Admins can always create games regardless of this limit.
      </p>
    </div>
  )
}

export default function AdminPanelPage({ onNavigate }) {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Admin Panel</h2>
        <button className="outline" onClick={() => onNavigate('/lobby')}>← Back to lobby</button>
      </div>

      <article style={{ marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 12px' }}>Settings</h4>
        <GameLimitSetting />
      </article>

      <article
        style={{ cursor: 'pointer', marginBottom: 0 }}
        onClick={() => onNavigate('/account-management')}
      >
        <h4 style={{ margin: '0 0 4px' }}>Account Management</h4>
        <p style={{ margin: 0, color: '#888', fontSize: '0.9rem' }}>
          View, edit, and delete user accounts.
        </p>
      </article>
    </div>
  )
}
