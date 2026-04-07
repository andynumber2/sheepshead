import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

const STATUS_LABELS = { waiting: 'Open', active: 'In progress' }
const VARIANT_LABELS = { leasters: 'Leasters', doublers: 'Doublers' }

export default function LobbyPage({ user, onNavigate, onLogout }) {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [gameName, setGameName] = useState(`${user.username}'s game`)
  const [variant, setVariant] = useState('leasters')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  async function loadGames() {
    try {
      const list = await api.games.list()
      setGames(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGames()
    const interval = setInterval(loadGames, 5000)
    return () => clearInterval(interval)
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const game = await api.games.create(gameName.trim() || `${user.username}'s game`, variant)
      onNavigate(`/game/${game.id}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleJoin(gameId) {
    setError(null)
    try {
      await api.games.join(gameId)
      onNavigate(`/game/${gameId}`)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="lobby-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <hgroup style={{ margin: 0 }}>
          <h2 style={{ margin: 0 }}>Lobby</h2>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>Welcome, {user.username}</p>
        </hgroup>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowCreate(s => !s)} className="secondary">
            {showCreate ? 'Cancel' : 'New game'}
          </button>
          <button className="outline" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--pico-del-color)' }}>{error}</p>}

      {showCreate && (
        <article style={{ marginBottom: 24 }}>
          <h4>Create a game</h4>
          <form onSubmit={handleCreate}>
            <label>
              Game name
              <input
                type="text"
                value={gameName}
                onChange={e => setGameName(e.target.value)}
                maxLength={60}
              />
            </label>
            <fieldset>
              <legend>No-pick variant</legend>
              <label>
                <input
                  type="radio"
                  name="variant"
                  value="leasters"
                  checked={variant === 'leasters'}
                  onChange={() => setVariant('leasters')}
                />
                Leasters — fewest points wins
              </label>
              <label>
                <input
                  type="radio"
                  name="variant"
                  value="doublers"
                  checked={variant === 'doublers'}
                  onChange={() => setVariant('doublers')}
                />
                Doublers — stakes double each pass
              </label>
            </fieldset>
            <button type="submit" aria-busy={creating} disabled={creating}>Create</button>
          </form>
        </article>
      )}

      <h4>Games</h4>
      {loading && <p aria-busy="true">Loading games…</p>}
      {!loading && games.length === 0 && (
        <p style={{ color: '#666' }}>No open games. Create one!</p>
      )}

      {games.map(game => {
        const isMine = game.player_count > 0  // heuristic — full join info not loaded here
        return (
          <article key={game.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong>{game.name}</strong>
                <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#888' }}>
                  by {game.created_by_username}
                </span>
                <br />
                <small>
                  {VARIANT_LABELS[game.no_pick_variant]} ·{' '}
                  {game.player_count}/5 players ·{' '}
                  <span style={{ color: game.status === 'active' ? '#f59e0b' : '#4ade80' }}>
                    {STATUS_LABELS[game.status]}
                  </span>
                </small>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {game.status === 'active' && (
                  <button className="secondary" onClick={() => onNavigate(`/game/${game.id}`)}>
                    Spectate / Rejoin
                  </button>
                )}
                {game.status === 'waiting' && game.player_count < 5 && (
                  <button onClick={() => handleJoin(game.id)}>Join</button>
                )}
                {game.status === 'waiting' && game.player_count >= 5 && (
                  <button disabled>Full</button>
                )}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
