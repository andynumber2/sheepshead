// Dispatches on state.phase to the matching bot-strategy decision function.
// Pure — no side effects, no I/O. Caller is responsible for deciding *when*
// to call (toggle on, my turn). Errors are thrown; the caller wraps in try/catch.
import {
  decidePick, decideBlitz, decideBury, decideCall, decidePlay,
} from './botStrategy.js'

export function computeBotSuggestion(view, userId) {
  switch (view.phase) {
    case 'picking': {
      const potentialBlitz = (view.potentialBlitzes ?? []).find(b => b.userId === userId)
      if (potentialBlitz && decideBlitz(view, userId)) {
        return { kind: 'pick', ids: [], actionLabel: 'blitz' }
      }
      const shouldPick = decidePick(view, userId)
      return { kind: 'pick', ids: [], actionLabel: shouldPick ? 'pick' : 'pass' }
    }

    case 'burying': {
      const ids = decideBury(view, userId)
      return { kind: 'bury', ids }
    }

    case 'calling': {
      const decision = decideCall(view, userId)
      let actionLabel
      switch (decision.type) {
        case 'ace':
        case 'ace_under':
          actionLabel = `ace:${decision.suit}`
          break
        case 'ten':
          actionLabel = `ten:${decision.suit}`
          break
        case 'king':
          actionLabel = `king:${decision.suit}`
          break
        default:
          actionLabel = 'go_alone'
      }
      const ids = decision.type === 'ace_under' && decision.underCardId
        ? [decision.underCardId]
        : []
      return { kind: 'call', ids, actionLabel }
    }

    case 'playing': {
      const cardId = decidePlay(view, userId)
      return { kind: 'play', ids: [cardId] }
    }

    default:
      throw new Error(`Unknown phase: ${view.phase}`)
  }
}
