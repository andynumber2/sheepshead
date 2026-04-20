import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./botStrategy.js', () => ({
  decidePick:  vi.fn(),
  decideBlitz: vi.fn(),
  decideBury:  vi.fn(),
  decideCall:  vi.fn(),
  decidePlay:  vi.fn(),
}))

const { decideCall } = await import('./botStrategy.js')
const { computeBotSuggestion } = await import('./botSuggestion.js')

describe('computeBotSuggestion — call label mappings', () => {
  beforeEach(() => {
    decideCall.mockReset()
  })

  it('maps ace_under → ids:[underCardId], actionLabel "ace:<suit>"', () => {
    decideCall.mockReturnValueOnce({ type: 'ace_under', suit: 'H', underCardId: '9H' })
    const result = computeBotSuggestion({ phase: 'calling' }, 'u1')
    expect(result.kind).toBe('call')
    expect(result.ids).toEqual(['9H'])
    expect(result.actionLabel).toBe('ace:H')
  })

  it('maps alone → actionLabel "go_alone" with empty ids', () => {
    decideCall.mockReturnValueOnce({ type: 'alone' })
    const result = computeBotSuggestion({ phase: 'calling' }, 'u1')
    expect(result.kind).toBe('call')
    expect(result.ids).toEqual([])
    expect(result.actionLabel).toBe('go_alone')
  })

  it('throws on unknown call decision type', () => {
    decideCall.mockReturnValueOnce({ type: 'bogus' })
    expect(() => computeBotSuggestion({ phase: 'calling' }, 'u1'))
      .toThrow(/unknown call decision type/i)
  })
})
