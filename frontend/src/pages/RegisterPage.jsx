import { useState } from 'react'
import { api } from '../lib/api.js'

export default function RegisterPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) return setError('Passwords do not match.')
    setLoading(true)
    try {
      const user = await api.auth.register(username, password)
      onLogin(user)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <hgroup>
        <h1>Sheepshead</h1>
        <p>Create an account</p>
      </hgroup>
      <form onSubmit={handleSubmit}>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            required
            minLength={2}
            maxLength={32}
          />
          <small>Letters, numbers, _ and - only.</small>
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error && <p style={{ color: 'var(--pico-del-color)' }}>{error}</p>}
        <button type="submit" aria-busy={loading} disabled={loading}>Create account</button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 16 }}>
        Already have an account? <a href="#/login">Sign in</a>
      </p>
    </div>
  )
}
