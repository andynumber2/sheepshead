import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

function UserRow({ user, currentUserId, onSaved, onDeleted }) {
  const [editing, setEditing]         = useState(false)
  const [username, setUsername]       = useState(user.username)
  const [isAdmin, setIsAdmin]         = useState(!!user.is_admin)
  const [isBot, setIsBot]             = useState(!!user.is_bot)
  const [password, setPassword]       = useState('')
  const [draftDay, setDraftDay]       = useState(String(user.day_score ?? 0))
  const [draftLifetime, setDraftLifetime] = useState(String(user.lifetime_score ?? 0))
  const [saving, setSaving]           = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [error, setError]             = useState(null)

  useEffect(() => {
    if (!editing) {
      setUsername(user.username)
      setIsAdmin(!!user.is_admin)
      setIsBot(!!user.is_bot)
      setDraftDay(String(user.day_score ?? 0))
      setDraftLifetime(String(user.lifetime_score ?? 0))
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

    const newDay = parseInt(draftDay, 10)
    const newLifetime = parseInt(draftLifetime, 10)
    if (!Number.isInteger(newDay))      return setError('Day score must be an integer.')
    if (!Number.isInteger(newLifetime)) return setError('Lifetime score must be an integer.')

    setSaving(true)
    setError(null)
    try {
      let updated = { ...user }

      // Account fields update
      const patch = { username, is_admin: isAdmin, is_bot: isBot }
      if (password) patch.password = password
      const accountResult = await api.admin.updateUser(user.id, patch)
      updated = { ...updated, ...accountResult }

      // Score adjustment (only if values changed)
      const scoreChanged = newDay !== (user.day_score ?? 0) || newLifetime !== (user.lifetime_score ?? 0)
      if (scoreChanged) {
        const scoreResult = await api.admin.adjustScore(user.id, newDay, newLifetime)
        updated = { ...updated, day_score: scoreResult.day_score, lifetime_score: scoreResult.lifetime_score }
      }

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
    setDraftDay(String(user.day_score ?? 0))
    setDraftLifetime(String(user.lifetime_score ?? 0))
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
          {!!user.is_bot && <span className="badge" style={{ background: '#6b7280', color: '#fff', marginLeft: 6 }}>test bot</span>}
        </td>
        <td>{user.is_admin ? '✓' : '—'}</td>
        <td>{user.is_bot ? '✓' : '—'}</td>
        <td style={{ color: '#888' }}>
          {new Date(user.created_at).toLocaleDateString()}
        </td>
        <td style={{ textAlign: 'right' }}>{user.day_score ?? 0}</td>
        <td style={{ textAlign: 'right' }}>{user.lifetime_score ?? 0}</td>
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
        <input
          type="number"
          value={draftDay}
          onChange={e => setDraftDay(e.target.value)}
          style={{ margin: 0, padding: '2px 6px', width: '100%', boxSizing: 'border-box', textAlign: 'right' }}
        />
      </td>
      <td>
        <input
          type="number"
          value={draftLifetime}
          onChange={e => setDraftLifetime(e.target.value)}
          style={{ margin: 0, padding: '2px 6px', width: '100%', boxSizing: 'border-box', textAlign: 'right' }}
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
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Account Management</h2>
        <button className="outline" onClick={() => onNavigate('/admin')}>← Back to admin panel</button>
      </div>

      {error && <p style={{ color: 'var(--pico-del-color)' }}>{error}</p>}

      {loading
        ? <p aria-busy="true">Loading users…</p>
        : (
          <>
          <style>{`.acct-mgmt td, .acct-mgmt th { padding: 4px 6px; }`}</style>
          <table className="acct-mgmt" style={{ width: '100%', tableLayout: 'fixed', fontSize: '0.74rem' }}>
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '35%' }} />
              </colgroup>
              <thead>
                <tr>
                  <SortTh col="id">ID</SortTh>
                  <SortTh col="username">Username</SortTh>
                  <SortTh col="is_admin">Admin</SortTh>
                  <SortTh col="is_bot">Test Bot</SortTh>
                  <SortTh col="created_at">Created</SortTh>
                  <SortTh col="day_score">Day</SortTh>
                  <SortTh col="lifetime_score">Lifetime</SortTh>
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
          </>
        )
      }
    </div>
  )
}
