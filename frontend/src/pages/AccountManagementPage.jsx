import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

function UserRow({ user, currentUserId, onSaved, onDeleted }) {
  const [editing, setEditing]     = useState(false)
  const [username, setUsername]   = useState(user.username)
  const [isAdmin, setIsAdmin]     = useState(!!user.is_admin)
  const [isBot, setIsBot]         = useState(!!user.is_bot)
  const [password, setPassword]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [deleting, setDeleting]   = useState(false)
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

  async function handleDelete() {
    if (!window.confirm(`Delete account "${user.username}"? This cannot be undone.`)) return
    setDeleting(true)
    setError(null)
    try {
      await api.admin.deleteUser(user.id)
      onDeleted(user.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  if (!editing) {
    return (
      <tr>
        <td>{user.id}</td>
        <td>
          {user.username}
          {isSelf && <span className="badge badge-you" style={{ marginLeft: 6 }}>you</span>}
          {!!user.is_bot && <span className="badge" style={{ background: '#6b7280', color: '#fff', marginLeft: 6 }}>bot</span>}
        </td>
        <td>{user.is_admin ? '✓' : '—'}</td>
        <td>{user.is_bot ? '✓' : '—'}</td>
        <td style={{ color: '#888' }}>
          {new Date(user.created_at).toLocaleDateString()}
        </td>
        <td>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="outline" style={{ padding: '2px 8px' }} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              className="outline"
              style={{ padding: '2px 8px', color: '#ef4444', borderColor: '#ef4444' }}
              onClick={handleDelete}
              aria-busy={deleting}
              disabled={deleting || isSelf}
              title={isSelf ? 'You cannot delete your own account' : undefined}
            >
              Delete
            </button>
          </div>
          {error && <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 2 }}>{error}</div>}
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
          style={{ margin: 0, padding: '2px 6px', width: '100%', boxSizing: 'border-box' }}
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
          <span style={{ color: '#ef4444', fontSize: '0.7rem', marginLeft: 4 }}>⚠ removes your access</span>
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
          placeholder="New password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ margin: 0, padding: '2px 6px', width: '100%', boxSizing: 'border-box' }}
        />
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            style={{ padding: '2px 8px' }}
            onClick={handleSave}
            aria-busy={saving}
            disabled={saving}
          >
            Save
          </button>
          <button
            className="secondary outline"
            style={{ padding: '2px 8px' }}
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

function sortUsers(users, col, dir) {
  return [...users].sort((a, b) => {
    let av = a[col], bv = b[col]
    if (col === 'username') {
      av = av.toLowerCase(); bv = bv.toLowerCase()
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    if (av < bv) return dir === 'asc' ? -1 : 1
    if (av > bv) return dir === 'asc' ? 1 : -1
    return 0
  })
}

export default function AccountManagementPage({ currentUser, onNavigate }) {
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [sortCol, setSortCol] = useState('id')
  const [sortDir, setSortDir] = useState('asc')

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

  function handleDeleted(id) {
    setUsers(prev => prev.filter(u => u.id !== id))
  }

  function handleSort(col) {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sortedUsers = sortUsers(users, sortCol, sortDir)

  function SortTh({ col, children }) {
    const active = sortCol === col
    return (
      <th
        onClick={() => handleSort(col)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        {children}
        <span style={{ marginLeft: 4, opacity: active ? 1 : 0.25 }}>
          {active && sortDir === 'desc' ? '↓' : '↑'}
        </span>
      </th>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Account Management</h2>
        <button className="outline" onClick={() => onNavigate('/admin')}>← Back to admin panel</button>
      </div>

      {error && <p style={{ color: 'var(--pico-del-color)' }}>{error}</p>}

      {loading
        ? <p aria-busy="true">Loading users…</p>
        : (
          <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '0.78rem' }}>
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '27%' }} />
                <col style={{ width: '34%' }} />
              </colgroup>
              <thead>
                <tr>
                  <SortTh col="id">ID</SortTh>
                  <SortTh col="username">Username</SortTh>
                  <SortTh col="is_admin">Admin</SortTh>
                  <SortTh col="is_bot">Bot</SortTh>
                  <SortTh col="created_at">Created / New password</SortTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    currentUserId={currentUser.id}
                    onSaved={handleSaved}
                    onDeleted={handleDeleted}
                  />
                ))}
              </tbody>
            </table>
        )
      }
    </div>
  )
}
