import { useState, useEffect } from 'react'
import { api } from './lib/api.js'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import LobbyPage from './pages/LobbyPage.jsx'
import GamePage from './pages/GamePage.jsx'
import AccountManagementPage from './pages/AccountManagementPage.jsx'

function getRoute() {
  return window.location.hash.replace('#', '') || '/'
}

function parseRoute(route) {
  const gameMatch = route.match(/^\/game\/(\d+)$/)
  if (gameMatch) return { page: 'game', gameId: gameMatch[1] }
  if (route === '/register')           return { page: 'register' }
  if (route === '/lobby')              return { page: 'lobby' }
  if (route === '/account-management') return { page: 'account-management' }
  return { page: 'login' }
}

export default function App() {
  const [user, setUser]               = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [route, setRoute]             = useState(getRoute())

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    api.auth.me()
      .then(u => { setUser(u); setAuthChecked(true) })
      .catch(() => { setAuthChecked(true) })
  }, [])

  function navigate(path) {
    window.location.hash = path
  }

  async function handleLogout() {
    await api.auth.logout().catch(() => {})
    setUser(null)
    navigate('/login')
  }

  function handleLogin(u) {
    setUser(u)
    navigate('/lobby')
  }

  if (!authChecked) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fff' }}>
        <span aria-busy="true">Loading…</span>
      </div>
    )
  }

  const { page, gameId } = parseRoute(route)

  if (!user) {
    if (page === 'register') return <RegisterPage onLogin={handleLogin} />
    return <LoginPage onLogin={handleLogin} />
  }

  if (page === 'game' && gameId) {
    return <GamePage gameId={gameId} user={user} onNavigate={navigate} />
  }

  if (page === 'account-management') {
    if (!user.is_admin) { navigate('/lobby'); return null }
    return <AccountManagementPage currentUser={user} onNavigate={navigate} />
  }

  return <LobbyPage user={user} onNavigate={navigate} onLogout={handleLogout} />
}
