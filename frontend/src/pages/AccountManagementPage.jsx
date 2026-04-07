import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

function UserRow({ user, currentUserId, onSaved }) {
  const [editing, setEditing]     = useState(false)
  const [username, setUsername]   = useState(user.username)
  const [isAdmin, setIsAdmin]     = useState(!!user.is_admin)
  const [isBot, setIsBot]         = useState(!!user.is_bot)
  const [password, setPassword]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  // Keep local state in sync when parent data refreshes
  useEffect(() => {
    if (!editing) {
      setUsername(user.username)
      setIsAdmin(!!user.is_admin)
      setIsBot(!!user.is_bot)
    }
  }, [user, editing])

  const isSelf = user.id === currentUserId
  const removingOwnAdmin = isSelf && isAdmin === false && user.is_admin

  async function handleSave() {
    if (removingOwnAdmin) {
      if (!window.confirm(
        'You are about to remove your own admin access.\nYou will be locked out of admin features immediately.\nAre you sure?'
      )) return
    }
    setSaving(true)
    setError(null)
    try {
      const patch = { username, is_admin: isAdmin, is_bot: isBot }
      if (password) patch.password = password
      const updated = await api.admin.updateUser(user.id, patch)
      setPassword('')
      setEditing(false)
      onSaved(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setUsername(user.username)
    setIsAdmin(!!user.is_admin)
    setIsBot(!!user.is_bot)
    setPassword('')
    setError(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <tr>
        <td>{user.id}</td>
        <td>
          {user.username}
          {isSelf && <span className="badge badge-you" style={{ marginLeft: 6 }}>you</span>}
          {user.is_bot && <span className="badge" style={{ background: '#6b7280', color: '#fff', marginLeft: 6 }}>bot</span>}
        </td>
        <td>{user.is_admin ? '✓' : '—'}</td>
        <td>{user.is_bot ? '✓' : '—'}</td>
        <td style={{ color: '#888', fontSize: '0.8rem' }}>
          {new Date(user.created_at).toLocaleDateString()}
        </td>
        <td>
          <button className="outline" style={{ padding: '2px 10px', fontSize: '0.8rem' }}
            onClick={() => setEditing(true)}>
            Edit
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr style={{ background: 'rgba(59,130,246,0.08)' }}>
      <td>{user.id}</td>
      <td>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          style={{ margin: 0, padding: '2px 6px', fontSize: '0.85rem' }}
        />
      </td>
      <td>
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={e => setIsAdmin(e.target.checked)}
          style={{ margin: 0 }}
        />
        {removingOwnAdmin && (
          <span style={{ color: '#ef4444', fontSize: '0.75rem', marginLeft: 4 }}>⚠ removes your access</span>
        )}
      </td>
      <td>
        <input
          type="checkbox"
          checked={isBot}
          onChange={e => setIsBot(e.target.checked)}
          style={{ margin: 0 }}
        />
      </td>
      <td>
        <input
          type="password"
          placeholder="New password (optional)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ margin: 0, padding: '2px 6px', fontSize: '0.85rem' }}
        />
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ padding: '2px 10px', fontSize: '0.8rem' }}
            onClick={handleSave}
            aria-busy={saving}
            disabled={saving}
          >
            Save
          </button>
          <button
            className="secondary outline"
            style={{ padding: '2px 8px', fontSize: '0.8rem' }}
            onClick={handleCancel}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
        {error && <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 2 }}>{error}</div>}
      </td>
    </tr>
  )
}

export default function AccountManagementPage({ currentUser, onNavigate }) {
  const [users, setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  async function load() {
    try {
      const list = await api.admin.listUsers()
      setUsers(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleSaved(updated) {
    setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u))
    // If admin removed their own access, boot them back to lobby
    if (updated.removedOwnAdmin) {
      alert('Your admin access has been removed. Returning to lobby.')
      onNavigate('/lobby')
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Account Management</h2>
        <button className="outline" onClick={() => onNavigate('/lobby')}>← Back to lobby</button>
      </div>

      {error && <p style={{ color: 'var(--pico-del-color)' }}>{error}</p>}

      {loading
        ? <p aria-busy="true">Loading users…</p>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Username</th>
                  <th>Admin</th>
                  <th>Bot</th>
                  <th>Created / New password</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    currentUserId={currentUser.id}
                    onSaved={handleSaved}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}
