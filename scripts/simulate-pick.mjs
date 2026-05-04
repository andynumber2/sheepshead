#!/usr/bin/env node
// Monte Carlo simulator for the bot pick decision.
// Calibrates BASE and DISCOUNT against a target no-pick (Leaster/Schwanzer) rate.
//
// Usage:
//   npm run sim:pick -- --base 30 --discount 2 --hands 10000 [--seed 42]

import { dealHand } from '../shared/gameEngine.js'
import { decidePickWithAll } from '../shared/botStrategy.js'
import { DEFAULT_HAND_SCORE_WEIGHTS } from '../shared/botInference.js'

function parseArgs(argv) {
  const args = {
    base: 30, discount: 2, hands: 10000, seed: undefined,
    schwanzerMult: DEFAULT_HAND_SCORE_WEIGHTS.schwanzerMult,
    failAcesBonus: DEFAULT_HAND_SCORE_WEIGHTS.failAcesBonus,
    failTensBonus: DEFAULT_HAND_SCORE_WEIGHTS.failTensBonus,
    qcBonus:       DEFAULT_HAND_SCORE_WEIGHTS.qcBonus,
  }
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]
    const next = argv[i + 1]
    if (tok === '--base')             { args.base = Number(next); i++ }
    else if (tok === '--discount')    { args.discount = Number(next); i++ }
    else if (tok === '--hands')       { args.hands = Number(next); i++ }
    else if (tok === '--seed')        { args.seed = Number(next); i++ }
    else if (tok === '--schwanzer-mult') { args.schwanzerMult = Number(next); i++ }
    else if (tok === '--fail-aces')   { args.failAcesBonus = Number(next); i++ }
    else if (tok === '--fail-tens')   { args.failTensBonus = Number(next); i++ }
    else if (tok === '--qc-bonus')    { args.qcBonus = Number(next); i++ }
    else if (tok === '--help' || tok === '-h') {
      console.log(
        'Usage: npm run sim:pick -- --base N --discount N --hands N [--seed N]\n' +
        '  handScore weights (defaults match production):\n' +
        `    --schwanzer-mult N  (default ${DEFAULT_HAND_SCORE_WEIGHTS.schwanzerMult})\n` +
        `    --fail-aces N       (default ${DEFAULT_HAND_SCORE_WEIGHTS.failAcesBonus})\n` +
        `    --fail-tens N       (default ${DEFAULT_HAND_SCORE_WEIGHTS.failTensBonus})\n` +
        `    --qc-bonus N        (default ${DEFAULT_HAND_SCORE_WEIGHTS.qcBonus})`
      )
      process.exit(0)
    } else {
      console.error(`Unknown arg: ${tok}`)
      process.exit(1)
    }
  }
  if (Number.isNaN(args.base) || Number.isNaN(args.discount) || Number.isNaN(args.hands)) {
    console.error('--base, --discount, and --hands must all be numbers')
    process.exit(1)
  }
  if (!Number.isInteger(args.hands) || args.hands < 1) {
    console.error('--hands must be a positive integer')
    process.exit(1)
  }
  return args
}

// mulberry32: tiny seeded PRNG. Deterministic for a given seed.
function makeMulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function simulate({ base, discount, hands, seed, schwanzerMult, failAcesBonus, failTensBonus, qcBonus }) {
  // dealHand uses Math.random internally via shuffle. Override for deterministic runs.
  if (seed !== undefined) {
    Math.random = makeMulberry32(seed)
  }

  const scoreWeights = { schwanzerMult, failAcesBonus, failTensBonus, qcBonus }
  const playerIds = ['p0', 'p1', 'p2', 'p3', 'p4']
  const picksBySeat = [0, 0, 0, 0, 0]
  let noPick = 0

  for (let h = 0; h < hands; h++) {
    const state = dealHand(playerIds, 0, 1, 1)
    let picked = false
    for (let i = 0; i < state.pickOrder.length; i++) {
      const userId = state.pickOrder[i]
      const view = { hands: state.hands, pickIndex: i }
      if (decidePickWithAll(view, userId, base, discount, scoreWeights)) {
        picksBySeat[i]++
        picked = true
        break
      }
    }
    if (!picked) noPick++
  }

  const total = hands
  return {
    total,
    picksBySeat,
    pickedTotal: picksBySeat.reduce((a, b) => a + b, 0),
    noPick,
    noPickRate: noPick / total,
  }
}

const args = parseArgs(process.argv)
const r = simulate(args)

const pct = (x) => (x * 100).toFixed(2) + '%'
console.log('=== Pick Simulation ===')
console.log(`base=${args.base} discount=${args.discount} hands=${args.hands}` +
            (args.seed !== undefined ? ` seed=${args.seed}` : ' (random seed)'))
console.log(`handScore weights: schwanzerMult=${args.schwanzerMult} failAces=${args.failAcesBonus} failTens=${args.failTensBonus} qcBonus=${args.qcBonus}`)
console.log(`Total hands:        ${r.total}`)
console.log(`Picked total:       ${r.pickedTotal} (${pct(r.pickedTotal / r.total)})`)
for (let i = 0; i < 5; i++) {
  console.log(`  Pick position ${i + 1}: ${r.picksBySeat[i]} (${pct(r.picksBySeat[i] / r.total)})`)
}
console.log(`No-pick (Leaster):  ${r.noPick} (${pct(r.noPickRate)})`)
console.log(`Target ~15%; current delta: ${((r.noPickRate - 0.15) * 100).toFixed(2)}%`)
