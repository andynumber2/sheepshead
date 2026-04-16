import {
  pick, blitz, pass, discard,
  callAce, callAceUnknown, callTen, callKing, goAlone,
  playCard, crack, recrack,
  setupLeaster, awardLeasterBlind,
} from './gameEngine.js'

/**
 * Replays an ordered array of hand_actions rows to produce game state.
 * The first action must be type='deal' with payload containing the full initial state.
 * Returns the state after applying all provided actions.
 */
export function replayActions(actions) {
  if (actions.length === 0) throw new Error('replayActions: no actions provided')

  const first = actions[0]
  if (first.type !== 'deal') throw new Error('replayActions: first action must be type=deal')

  let state = JSON.parse(first.payload_json)

  for (const action of actions.slice(1)) {
    const { type, user_id, payload_json } = action
    const payload = payload_json ? JSON.parse(payload_json) : null
    const uid = user_id ? String(user_id) : null

    switch (type) {
      case 'pick':             state = pick(state, uid); break
      case 'blitz':            state = blitz(state, uid); break
      case 'pass':             state = pass(state, uid); break
      case 'setup_leaster':    state = setupLeaster(state); break
      case 'discard':          state = discard(state, uid, payload.cardIds); break
      case 'call_ace':         state = callAce(state, uid, payload.suit); break
      case 'call_ace_unknown': state = callAceUnknown(state, uid, payload.suit, payload.underCardId); break
      case 'call_ten':         state = callTen(state, uid, payload.suit); break
      case 'call_king':        state = callKing(state, uid, payload.suit); break
      case 'go_alone':         state = goAlone(state, uid); break
      case 'crack':            state = crack(state, uid); break
      case 'recrack':          state = recrack(state, uid); break
      case 'play_card': {
        state = playCard(state, uid, payload.cardId)
        if (state.isLeaster && state.leasterBlind?.length > 0 && state.tricks.length === 1) {
          state = awardLeasterBlind(state)
        }
        break
      }
      default:
        throw new Error(`replayActions: unknown action type '${type}'`)
    }
  }

  return state
}
