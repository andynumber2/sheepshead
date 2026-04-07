import { useState } from 'react'
import { api } from '../lib/api.js'

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const user = await api.auth.login(username, password)
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
        <p>Sign in to play</p>
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
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p style={{ color: 'var(--pico-del-color)' }}>{error}</p>}
        <button type="submit" aria-busy={loading} disabled={loading}>Sign in</button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 16 }}>
        No account? <a href="#/register">Create one</a>
      </p>
    </div>
  )
}
