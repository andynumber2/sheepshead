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
  vi.useFakeTimers({ shouldAdvanceTime: true })
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

  it('polls every 5000ms when game status is waiting', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'waiting' }])
    renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchGame).toHaveBeenCalledTimes(3)
  })

  it('does not poll when game status is complete', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'complete' }])
    renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchGame).toHaveBeenCalledTimes(1)
  })

  it('reconfigures interval when game status changes between fetches', async () => {
    const fetchGame = vi.fn()
      .mockResolvedValueOnce({ id: 1, status: 'waiting' })
      .mockResolvedValueOnce({ id: 1, status: 'active' })
      .mockResolvedValueOnce({ id: 1, status: 'active' })
      .mockResolvedValue({ id: 1, status: 'complete' })

    renderHook(() => useGameState('1', fetchGame))
    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(3)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(4)

    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchGame).toHaveBeenCalledTimes(4)
  })

  it('stops polling when document becomes hidden, resumes (with immediate fetch) when visible', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'active' }])
    renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(3))

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(4)
  })

  it('clears the interval and removes visibilitychange listener on unmount', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'active' }])
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchGame).toHaveBeenCalledTimes(1)
  })

  it('cancels the old interval and starts a new fetch when gameId changes', async () => {
    const fetchGame = vi.fn(async (id) => ({ id: Number(id), status: 'active' }))
    const { rerender } = renderHook(
      ({ id }) => useGameState(id, fetchGame),
      { initialProps: { id: '1' } }
    )

    await waitFor(() => expect(fetchGame).toHaveBeenCalledWith('1'))

    rerender({ id: '2' })
    await waitFor(() => expect(fetchGame).toHaveBeenCalledWith('2'))

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    const callsForGame2 = fetchGame.mock.calls.filter(([id]) => id === '2').length
    expect(callsForGame2).toBeGreaterThanOrEqual(2)
  })

  it('refresh() triggers an immediate fetch without disturbing cadence', async () => {
    const fetchGame = mockApi([{ id: 1, status: 'active' }])
    const { result } = renderHook(() => useGameState('1', fetchGame))

    await waitFor(() => expect(fetchGame).toHaveBeenCalledTimes(1))

    await act(async () => { await result.current.refresh() })
    expect(fetchGame).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchGame).toHaveBeenCalledTimes(3)
  })
})
