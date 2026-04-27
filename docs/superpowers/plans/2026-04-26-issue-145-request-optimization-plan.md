# Request Optimization (Smart Polling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Worker requests from ~345K/week to <50K by gating frontend polling on game status and tab visibility, slowing infrequent-change cadences, and caching the `score_timezone` config singleton on the server.

**Architecture:** Introduce a `useGameState(gameId)` React hook in `frontend/src/hooks/` that owns all polling logic for the game page. Replace the unconditional `setInterval(fetchGame, 2000)` in `GamePage.jsx` with the hook. Add visibility handling inline to `LobbyPage.jsx`. Memoize `score_timezone` in Worker module scope.

**Tech Stack:** React 18 + Vite (frontend) · Cloudflare Pages Functions + D1 (backend) · Vitest + React Testing Library + jsdom (new test infra for the hook)

**Spec:** `docs/superpowers/specs/2026-04-26-issue-145-request-optimization-design.md`

---

## File Structure

**New files:**
- `frontend/vitest.config.js` — Vitest configuration for the frontend workspace
- `frontend/test-setup.js` — Testing-library global setup
- `frontend/src/hooks/useGameState.js` — The polling hook (the seam for #149)
- `frontend/src/hooks/useGameState.test.js` — Hook unit tests

**Modified files:**
- `frontend/package.json` — Add testing-library + jsdom dev deps; add `test` script
- `frontend/src/pages/GamePage.jsx` — Replace inline polling with `useGameState`; swap `fetchGame()` calls for `refresh()`
- `frontend/src/pages/LobbyPage.jsx` — Add `visibilitychange` handling to the existing 5s interval
- `functions/api/games/[id]/index.js` — Memoize the `score_timezone` config lookup in module scope

---

## Task 1: Set up frontend test infrastructure

The repo has Vitest configured at the root (`shared/*.test.js` runs against the Node default env). The frontend has no test infra yet. We need jsdom + Testing Library to test the hook.

**Files:**
- Create: `frontend/vitest.config.js`
- Create: `frontend/test-setup.js`
- Modify: `frontend/package.json`

- [ ] **Step 1: Add dev dependencies to the frontend workspace**

```bash
npm install --save-dev --workspace frontend \
  vitest@^4.1.4 \
  @testing-library/react@^16.0.1 \
  @testing-library/jest-dom@^6.6.3 \
  jsdom@^25.0.1
```

Pin `vitest@^4.1.4` to match the root's existing version (root `package.json` line: `"vitest": "^4.1.4"`).

- [ ] **Step 2: Create `frontend/vitest.config.js`**

```js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test-setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
})
```

- [ ] **Step 3: Create `frontend/test-setup.js`**

```js
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Add a `test` script to `frontend/package.json`**

In the `scripts` block, add:

```json
"test": "vitest run"
```

- [ ] **Step 5: Verify Vitest discovers the (empty) frontend suite**

Run: `npm test -w frontend`
Expected: Vitest starts, finds no tests (passes the `--passWithNoTests` semantics by reporting "No test files found" without an error). If it errors on missing config, recheck Step 2.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/vitest.config.js frontend/test-setup.js package-lock.json
git commit -m "test: add frontend Vitest infrastructure (jsdom + testing-library)"
```

---

## Task 2: Implement `useGameState` hook (TDD)

Build the hook one behavior at a time. Each behavior gets a test, then a minimal implementation extension.

**Files:**
- Create: `frontend/src/hooks/useGameState.js`
- Create: `frontend/src/hooks/useGameState.test.js`

- [ ] **Step 1: Create the test file with the active-cadence test**

Create `frontend/src/hooks/useGameState.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGameState } from './useGameState.js'

function mockApi(states) {
  // states: array of game objects to return on successive calls
  let i = 0
  return vi.fn(async () => {
    const next = states[Math.min(i, states.length - 1)]
    i += 1
    return next
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => false,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useGameState', () => {
  it('polls every 2000ms when game status is active', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'active' }])
    renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm test -w frontend`
Expected: FAIL — "Cannot find module './useGameState.js'"

- [ ] **Step 3: Create the minimal hook**

Create `frontend/src/hooks/useGameState.js`:

```js
import { useState, useEffect, useRef, useCallback } from 'react'

export function useGameState(gameId, fetchFn) {
  const [game, setGame]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const intervalRef = useRef(null)

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

  useEffect(() => {
    let cancelled = false
    fetchOnce().then(data => {
      if (cancelled || !data) return
      if (data.status === 'active') {
        intervalRef.current = setInterval(fetchOnce, 2000)
      }
    })
    return () => {
      cancelled = true
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [fetchOnce])

  return { game, loading, error, refresh }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npm test -w frontend`
Expected: PASS (1 test, 1 passed)

- [ ] **Step 5: Add the waiting-cadence test**

Append to `frontend/src/hooks/useGameState.test.js`:

```js
  it('polls every 5000ms when game status is waiting', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'waiting' }])
    renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    // No tick at 2000ms (would be active cadence)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(1)

    // Tick at 5000ms total
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    // Next tick at 10000ms total
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchGame).toHaveBeenCalledTimes(3)
  })
```

- [ ] **Step 6: Run test — verify it fails**

Run: `npm test -w frontend`
Expected: FAIL — second test fails because hook only handles 'active'

- [ ] **Step 7: Extend hook to handle 'waiting' cadence**

Replace the body of the `useEffect` block in `frontend/src/hooks/useGameState.js` with:

```js
  useEffect(() => {
    let cancelled = false
    const intervalForStatus = (status) => {
      if (status === 'active')  return 2000
      if (status === 'waiting') return 5000
      return null
    }
    fetchOnce().then(data => {
      if (cancelled || !data) return
      const ms = intervalForStatus(data.status)
      if (ms != null) {
        intervalRef.current = setInterval(fetchOnce, ms)
      }
    })
    return () => {
      cancelled = true
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [fetchOnce])
```

- [ ] **Step 8: Run tests — verify both pass**

Run: `npm test -w frontend`
Expected: PASS (2 tests, 2 passed)

- [ ] **Step 9: Add the complete-status test**

Append:

```js
  it('does not poll when game status is complete', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'complete' }])
    renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchGame).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 10: Run — verify it passes (no impl change needed)**

Run: `npm test -w frontend`
Expected: PASS (3/3) — `intervalForStatus('complete')` returns `null`, so no interval is set.

- [ ] **Step 11: Add the status-transition test**

The hook must react when status changes mid-poll (e.g. waiting → active when the 5th player joins, or active → complete when the game ends). Append:

```js
  it('reconfigures interval when game status changes between fetches', async () => {
    const fetchGame = vi.fn()
      .mockResolvedValueOnce({ id: 1, status: 'waiting' })
      .mockResolvedValueOnce({ id: 1, status: 'active' })
      .mockResolvedValueOnce({ id: 1, status: 'active' })
      .mockResolvedValue({ id: 1, status: 'complete' })

    renderHook(() => useGameState('1', fetchGame))
    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1)) // initial waiting

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchGame).toHaveBeenCalledTimes(2) // second poll: now active

    // Now should be on 2000ms cadence
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(3) // third poll: still active

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(4) // fourth poll: now complete

    // After complete, no more polls
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchGame).toHaveBeenCalledTimes(4)
  })
```

- [ ] **Step 12: Run — verify it fails**

Run: `npm test -w frontend`
Expected: FAIL — current hook only sets the interval based on the first fetch's status; never reconfigures.

- [ ] **Step 13: Refactor the hook to react to status changes**

The interval must be re-evaluated after each fetch, since the status (and therefore the cadence) can change between polls. Use a single named `tick` function that recomputes the desired interval and re-establishes the timer when it changes.

Replace the entire contents of `frontend/src/hooks/useGameState.js` with:

```js
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

    const desiredInterval = (data) => intervalForStatus(data?.status)

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

    tick()

    return () => {
      cancelled = true
      clearTimer()
    }
  }, [fetchOnce])

  return { game, loading, error, refresh }
}
```

- [ ] **Step 14: Run tests — verify all pass**

Run: `npm test -w frontend`
Expected: PASS (4/4)

- [ ] **Step 15: Add the visibility test**

Append to the test file:

```js
  it('stops polling when document becomes hidden, resumes (with immediate fetch) when visible', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'active' }])
    renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    // Simulate tab hidden
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // No more polls while hidden
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    // Tab visible again
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // Immediate fetch on becoming visible
    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(3))

    // Cadence resumes
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(4)
  })
```

- [ ] **Step 16: Run — verify it fails**

Run: `npm test -w frontend`
Expected: FAIL — hook does not yet listen to `visibilitychange`.

- [ ] **Step 17: Add visibility handling**

Replace the body of the `useEffect` in `useGameState.js` to incorporate visibility:

```js
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
        // Re-fetch immediately and re-establish the timer.
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
```

- [ ] **Step 18: Run tests — verify all pass**

Run: `npm test -w frontend`
Expected: PASS (5/5)

- [ ] **Step 19: Add the unmount-cleanup test**

Append:

```js
  it('clears the interval and removes visibilitychange listener on unmount', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'active' }])
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

    // No further fetches after unmount, even with timer advances.
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchGame).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 20: Run — verify it passes (cleanup is already implemented)**

Run: `npm test -w frontend`
Expected: PASS (6/6)

- [ ] **Step 21: Add the gameId-change test**

Append:

```js
  it('cancels the old interval and starts a new fetch when gameId changes', async () => {
    const fetchGame = vi.fn(async (id) => ({ id: Number(id), status: 'active' }))
    const { rerender } = renderHook(
      ({ id }) => useGameState(id, fetchGame),
      { initialProps: { id: '1' } }
    )

    await waitFor(() => expect(fetchGame).toHaveBeenCalledWith('1'))

    rerender({ id: '2' })
    await waitFor(() => expect(fetchGame).toHaveBeenCalledWith('2'))

    // Ticks should be for game 2 only
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    const callsForGame2 = fetchGame.mock.calls.filter(([id]) => id === '2').length
    expect(callsForGame2).toBeGreaterThanOrEqual(2)
  })
```

- [ ] **Step 22: Run — verify it passes**

Run: `npm test -w frontend`
Expected: PASS (7/7) — the existing effect's `[fetchOnce]` dep, which depends on `gameId`, already triggers re-setup on id change.

- [ ] **Step 23: Add the refresh() test**

Append:

```js
  it('refresh() triggers an immediate fetch without disturbing cadence', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'active' }])
    const { result } = renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await result.current.refresh() })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    // Original 2000ms cadence still ticks
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(3)
  })
```

- [ ] **Step 24: Run — verify all 8 pass**

Run: `npm test -w frontend`
Expected: PASS (8/8)

- [ ] **Step 25: Commit**

```bash
git add frontend/src/hooks/useGameState.js frontend/src/hooks/useGameState.test.js
git commit -m "feat(frontend): add useGameState hook with status- and visibility-aware polling"
```

---

## Task 3: Migrate `GamePage` to use the hook

The hook accepts `fetchFn` as a parameter (so tests can inject a mock). At the call site, pass `api.games.get`. Replace `gameData`/`fetchGame` plumbing with the hook's `game`/`refresh`.

**Files:**
- Modify: `frontend/src/pages/GamePage.jsx`

The current state:
- `GamePage.jsx:173` declares `pollingRef` (no longer needed)
- `GamePage.jsx:187-199` defines `fetchGame` (replaced by hook)
- `GamePage.jsx:201-205` is the polling `useEffect` (deleted)
- `GamePage.jsx:289`, `GamePage.jsx:356`, `GamePage.jsx:372` call `fetchGame()` after writes (replaced by `refresh()`)
- `GamePage.jsx:191-194` seeds `currentVariant` / `revealPartner` / `dobEnabled` from the first fetch (must be preserved — moved to a separate effect)

- [ ] **Step 1: Add the hook import**

In `frontend/src/pages/GamePage.jsx`, add to the imports near the top:

```js
import { useGameState } from '../hooks/useGameState.js'
```

- [ ] **Step 2: Locate `gameData` state declaration**

Find the line `const [gameData, setGameData] = useState(null)` near the top of the component. Note its exact position — it will be replaced.

- [ ] **Step 3: Replace fetch plumbing with the hook**

Make the following changes to `frontend/src/pages/GamePage.jsx`:

1. Delete the `pollingRef` declaration (line 173 in the current file):

```js
const pollingRef = useRef(null)
```

2. Delete the `fetchGame` definition (lines 187-199 in the current file):

```js
const fetchGame = useCallback(async () => {
  try {
    const data = await api.games.get(gameId)
    setGameData(data)
    setCurrentVariant(prev => prev ?? data.settings?.no_pick_variant)
    setRevealPartner(prev => prev ?? data.settings?.reveal_partner)
    setDobEnabled(prev => prev ?? data.settings?.double_on_bump)
    setError(null)
  } catch (e) {
    setError(e.message)
  }
}, [gameId])
```

3. Delete the polling effect (lines 201-205 in the current file):

```js
useEffect(() => {
  fetchGame()
  pollingRef.current = setInterval(fetchGame, 2000)
  return () => clearInterval(pollingRef.current)
}, [fetchGame])
```

4. Delete the `gameData` state declaration:

```js
const [gameData, setGameData] = useState(null)
```

5. In its place, add the hook call (immediately after the other `useState` declarations, before the `pollingRef` was located):

```js
const { game: gameData, error: hookError, refresh } = useGameState(gameId, api.games.get)
```

6. Add a separate effect that seeds the variant/reveal/DOB defaults — this preserves the "set-once" behavior the deleted `fetchGame` was doing:

```js
useEffect(() => {
  if (!gameData) return
  setCurrentVariant(prev => prev ?? gameData.settings?.no_pick_variant)
  setRevealPartner(prev => prev ?? gameData.settings?.reveal_partner)
  setDobEnabled(prev => prev ?? gameData.settings?.double_on_bump)
}, [gameData])
```

7. Wire the hook's error into the existing `error` state. Find the existing `error` state's `setError` calls and add one effect that mirrors hook errors into local state (so the existing error UI keeps working):

```js
useEffect(() => {
  if (hookError) setError(hookError.message)
}, [hookError])
```

- [ ] **Step 4: Replace `await fetchGame()` calls with `refresh()`**

Three sites — one in the bot-play effect, two in action handlers:

**Site 1** — `GamePage.jsx` around line 289 (inside the bot-play `useEffect` callback):

Find:
```js
try {
  await api.games.action(gameId, 'bot_play', {})
  await fetchGame()
} catch {
```

Replace with:
```js
try {
  await api.games.action(gameId, 'bot_play', {})
  await refresh()
} catch {
```

Also update this effect's dependency array (around line 295):

Find:
```js
}, [gameData, gameId, fetchGame])
```

Replace with:
```js
}, [gameData, gameId, refresh])
```

**Site 2** — `handleAction` around line 356:

Find:
```js
async function handleAction(type, payload, actAs = null) {
  setActionLoading(true)
  try {
    await api.games.action(gameId, type, payload, actAs)
    await fetchGame()
  } finally {
    setActionLoading(false)
  }
}
```

Replace with:
```js
async function handleAction(type, payload, actAs = null) {
  setActionLoading(true)
  try {
    await api.games.action(gameId, type, payload, actAs)
    await refresh()
  } finally {
    setActionLoading(false)
  }
}
```

**Site 3** — `handleFillWithBots` around line 372:

Find:
```js
async function handleFillWithBots() {
  try {
    await api.games.fillWithBots(gameId)
    await fetchGame()
  } catch (e) {
    setError(e.message)
  }
}
```

Replace with:
```js
async function handleFillWithBots() {
  try {
    await api.games.fillWithBots(gameId)
    await refresh()
  } catch (e) {
    setError(e.message)
  }
}
```

- [ ] **Step 5: Verify there are no stragglers**

Run: `grep -n "fetchGame\|pollingRef" frontend/src/pages/GamePage.jsx`
Expected: no output. If anything remains, replace it (`fetchGame` → `refresh`, `pollingRef` → delete).

- [ ] **Step 6: Verify the build still compiles**

Run: `npm run build`
Expected: build succeeds, no errors. (Vite's build is the closest thing to a type/lint check here.)

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev` (in a separate terminal or background).
Open: `http://localhost:3000` and log in.
- Open a game. Network tab: `GET /api/games/[id]` should fire on mount, then every 2000 ms while the game is `active`.
- Hide the tab. Polling should stop.
- Restore the tab. One immediate fetch, then 2000 ms cadence resumes.
- End/leave the game. Polling stops.

If any of those don't behave as expected, fix before committing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/GamePage.jsx
git commit -m "feat(frontend): migrate GamePage to useGameState hook"
```

---

## Task 4: Add visibility handling to `LobbyPage`

`LobbyPage.jsx:34` already polls every 5000 ms. Add a `visibilitychange` listener so it pauses when hidden and does an immediate fetch + resumes when visible.

**Files:**
- Modify: `frontend/src/pages/LobbyPage.jsx`

- [ ] **Step 1: Replace the polling effect**

In `frontend/src/pages/LobbyPage.jsx`, find the existing effect (around line 33):

```js
useEffect(() => {
  loadGames()
  const interval = setInterval(loadGames, 5000)
  return () => clearInterval(interval)
}, [])
```

Replace with:

```js
useEffect(() => {
  let intervalId = null

  const start = () => {
    if (intervalId != null) return
    intervalId = setInterval(loadGames, 5000)
  }
  const stop = () => {
    if (intervalId != null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  const onVisibility = () => {
    if (document.hidden) {
      stop()
    } else {
      loadGames()
      start()
    }
  }

  loadGames()
  if (!document.hidden) start()
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    stop()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}, [])
```

- [ ] **Step 2: Verify the build still compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`.
Open: `http://localhost:3000/#/lobby`.
- Network tab: `GET /api/games` fires on mount, then every 5000 ms.
- Hide the tab. Polling stops.
- Restore the tab. One immediate fetch, then 5000 ms cadence resumes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LobbyPage.jsx
git commit -m "feat(frontend): pause LobbyPage polling when tab is hidden"
```

---

## Task 5: Cache `score_timezone` in Worker module scope

The `SELECT value FROM config WHERE key = 'score_timezone'` query runs on every `GET /api/games/[id]` request. The value never changes at runtime; cache it once per Worker isolate.

**Files:**
- Modify: `functions/api/games/[id]/index.js`

- [ ] **Step 1: Check for other readers of `score_timezone`**

Run: `grep -rn "score_timezone" functions/`
Expected output: at least the line in `functions/api/games/[id]/index.js`. If the same query appears in any other handler, the cache helper should live in `functions/api/_helpers.js` instead of inline. **Note any other locations** before proceeding — Step 2 covers the inline case (one location only); Step 2-alt covers the shared-helper case.

- [ ] **Step 2: Inline cache (only one reader)**

If `grep` showed only one reader, edit `functions/api/games/[id]/index.js`. At the top of the file (after imports), add:

```js
let cachedScoreTimezone = null

async function getScoreTimezone(db) {
  if (cachedScoreTimezone) return cachedScoreTimezone
  const row = await db.prepare(
    "SELECT value FROM config WHERE key = 'score_timezone'"
  ).first()
  cachedScoreTimezone = row?.value ?? 'America/Chicago'
  return cachedScoreTimezone
}
```

Then find and replace this block inside `onRequestGet`:

Find:
```js
const tzRow = await env.DB.prepare("SELECT value FROM config WHERE key = 'score_timezone'").first()
const timezone = tzRow?.value ?? 'America/Chicago'
const [dayStart, dayEnd] = getDayScoreRange(timezone)
```

Replace with:
```js
const timezone = await getScoreTimezone(env.DB)
const [dayStart, dayEnd] = getDayScoreRange(timezone)
```

- [ ] **Step 2-alt: Shared helper (multiple readers)**

If `grep` showed multiple readers, do this instead. Edit `functions/api/_helpers.js` and add at the bottom:

```js
let cachedScoreTimezone = null

export async function getScoreTimezone(db) {
  if (cachedScoreTimezone) return cachedScoreTimezone
  const row = await db.prepare(
    "SELECT value FROM config WHERE key = 'score_timezone'"
  ).first()
  cachedScoreTimezone = row?.value ?? 'America/Chicago'
  return cachedScoreTimezone
}
```

In `functions/api/games/[id]/index.js`, change the import:

Find:
```js
import { json, err, requireUser, getDayScoreRange, AuthError } from '../../_helpers.js'
```

Replace with:
```js
import { json, err, requireUser, getDayScoreRange, AuthError, getScoreTimezone } from '../../_helpers.js'
```

Then replace the same `tzRow`/`timezone` block as in Step 2 with:
```js
const timezone = await getScoreTimezone(env.DB)
const [dayStart, dayEnd] = getDayScoreRange(timezone)
```

Apply the same import + call-site change to every other reader you found in Step 1.

- [ ] **Step 3: Manual verification**

Run: `npm run dev` and load any game page.
Inspect: the Wrangler console output. The first request after server start should log a query for `config WHERE key = 'score_timezone'`. Subsequent requests for the same game should not — only the 6 game-fetch queries.

(If the Wrangler logs aren't verbose enough to see this directly, alternative: temporarily add `console.log('cache miss')` inside the `if (!cachedScoreTimezone)` block, hit the endpoint twice, confirm the log fires once. Remove the `console.log` before committing.)

- [ ] **Step 4: Commit**

```bash
git add functions/api/games/[id]/index.js
# If Step 2-alt: also stage functions/api/_helpers.js
git commit -m "perf(api): memoize score_timezone config in Worker module scope"
```

**Note on test coverage:** The spec called for a single unit test of the cache helper. The repo currently has no test infrastructure for `functions/` (no Vitest config, no Wrangler test harness). Adding it for one test was deemed not worth the scope. The cache logic is six lines and fully verifiable by reading the source plus the manual log check above. If a `functions/` test runner is added later for any reason, fold a one-test cache-hit-count test in then.

---

## Task 6: Final verification + PR

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all existing tests pass + the 8 new `useGameState` tests pass.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: End-to-end manual verification (per spec Section 5d)**

Run: `npm run dev`. With browser DevTools network panel open:

- Lobby idle → one request every 5 s.
- Lobby with tab hidden → no requests.
- Lobby with tab visible again → one immediate request, then 5 s cadence.
- Active game → one request every 2 s.
- Active game with tab hidden → no requests.
- Active game with tab visible again → one immediate request, then 2 s cadence.
- Game becomes complete → polling stops.

Each of these is a hard pass/fail. Do not proceed if any fail.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin design/issue-145-request-optimization
gh pr create --title "Smart polling: gate frontend requests by status + tab visibility (#145)" --body "$(cat <<'EOF'
## Summary
- Introduces `useGameState(gameId)` hook in `frontend/src/hooks/` that owns all game-page polling. Cadence is 2s for `active`, 5s for `waiting`, stopped for `complete`. Pauses when `document.hidden`, resumes with an immediate fetch when visible.
- `GamePage.jsx` migrated to the hook. `fetchGame()` calls in action handlers and the bot-play effect swapped for `refresh()`.
- `LobbyPage.jsx` polling now pauses when the tab is hidden.
- `GET /api/games/[id]` caches the `score_timezone` config singleton in Worker module scope (one fewer D1 query per poll).
- Adds Vitest + jsdom + React Testing Library to the frontend workspace; 8 unit tests cover the hook's cadence, status-transition, visibility, cleanup, gameId-change, and refresh behaviors.

Spec: \`docs/superpowers/specs/2026-04-26-issue-145-request-optimization-design.md\`
Closes #145.

ETag / push-based transport deferred to #149 ([context](https://github.com/andynumber2/sheepshead/issues/149#issuecomment-4323677349)).

## Test plan
- [x] \`npm test\` — all suites pass (existing + 8 new hook tests).
- [x] \`npm run build\` — clean build.
- [ ] Manual: lobby idle polls every 5s; mid-game polls every 2s; both pause when tab hidden; both resume with one immediate fetch when visible; polling stops when game becomes complete.
- [ ] Post-deploy: monitor Cloudflare dashboard for one week. Targets: <50K Worker requests/week, <100 requests/hour during idle 1-hour windows.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

After implementation, before declaring done:

- [ ] All 8 hook tests pass.
- [ ] Build succeeds.
- [ ] Manual verification of all 7 browser behaviors (Task 6 Step 3) passes.
- [ ] No `fetchGame` or `pollingRef` references remain in `GamePage.jsx` (verify with `grep`).
- [ ] No `score_timezone` query duplicated elsewhere in `functions/` (verify with `grep`).
- [ ] PR description references issue #145 and #149 with correct context.
