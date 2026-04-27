import { useState, useEffect, useRef, useCallback } from 'react'

function intervalForStatus(status) {
  if (status === 'active')  return 2000
  if (status === 'waiting') return 5000
  return null
}

export function useGameState(gameId, fetchFn) {
  const [game, setGame]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const intervalRef = useRef(null)

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const fetchOnce = useCallback(async () => {
    try {
      const data = await fetchFn(gameId)
      setGame(data)
      setError(null)
      return data
    } catch (e) {
      setError(e)
      return null
    } finally {
      setLoading(false)
    }
  }, [gameId, fetchFn])

  const refresh = useCallback(() => fetchOnce(), [fetchOnce])

  // Schedule polling that reconfigures whenever the cadence-determining
  // condition (status, eventually visibility) changes. The single source of
  // truth for "what interval should we be on right now?" is `desiredInterval()`.
  useEffect(() => {
    let cancelled = false
    let currentMs = null

    const desiredInterval = (data) => {
      if (document.hidden) return null
      return intervalForStatus(data?.status)
    }

    const tick = async () => {
      if (cancelled) return
      const data = await fetchOnce()
      if (cancelled || !data) return
      const next = desiredInterval(data)
      if (next !== currentMs) {
        clearTimer()
        currentMs = next
        if (next != null) {
          intervalRef.current = setInterval(tick, next)
        }
      }
    }

    const onVisibility = () => {
      if (cancelled) return
      if (document.hidden) {
        clearTimer()
        currentMs = null
      } else {
        tick()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    tick()

    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchOnce])

  return { game, loading, error, refresh }
}
