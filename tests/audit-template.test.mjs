// Runs the Workflow template from audit-mode.md against stub agents: node tests/audit-template.test.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const md = readFileSync(new URL('../audit-mode.md', import.meta.url), 'utf8')
const body = md.split('```js')[1].split('```')[0].replace(/^export const meta = \{[\s\S]*?^\}$/m, '')
const parallel = thunks => Promise.all(thunks.map(t => t().catch(() => null)))
const run = (agent, args) =>
  new Function('agent', 'parallel', 'log', 'args', `return (async () => {${body}})()`)(agent, parallel, () => {}, args)
const args = { canon: 'c', exceptions: 'e', lenses: [{ key: 'a', prompt: 'p' }, { key: 'b', prompt: 'q' }],
  recordCmd: 'r', cleanTarget: 3, maxCycles: 10 }
const v = { title: 't', where: 'a.go:1', failure: 'f', clause: 'k' }

// 1. Every agent dies (outage, machine asleep). Dead cycles prove nothing: the run hits the cap, never "dry".
let r = await run(async () => null, args)
assert.equal(r.stoppedBy, 'cap')
assert.equal(r.cycles, 10)

// 2. Healthy agents, nothing to find: stops after cleanTarget clean cycles.
r = await run(async (_p, o) => (o.phase === 'Audit' ? { findings: [] } : null), args)
assert.equal(r.stoppedBy, 'dry')
assert.equal(r.cycles, 3)

// 3. One real violation; the dedupe dies on the first sighting. It is re-found, recorded once, then 3 clean cycles.
let sightings = 0, dedupes = 0
r = await run(async (p, o) => {
  if (o.phase === 'Audit') return { findings: o.label.endsWith(':a') && !p.includes('a.go:1') ? (sightings++, [v]) : [] }
  if (o.phase === 'Dedupe') return dedupes++ ? { candidates: [v] } : null
  if (o.phase === 'Verify') return { real: true, reason: 'reproduced' }
  if (o.phase === 'Record') return { issue: 'X-1' }
}, args)
assert.equal(sightings, 2)
assert.deepEqual(r.recorded.map(x => x.issue), ['X-1'])
assert.equal(r.stoppedBy, 'dry')
assert.equal(r.cycles, 5)

// 4. The record agent dies: the violation is not lost silently (RECORD FAILED) and is not re-recorded.
r = await run(async (_p, o) => {
  if (o.phase === 'Audit') return { findings: o.label === 'c1:a' ? [v] : [] }
  if (o.phase === 'Dedupe') return { candidates: [v] }
  if (o.phase === 'Verify') return { real: true, reason: 'reproduced' }
  return null
}, args)
assert.deepEqual(r.recorded.map(x => x.issue), ['RECORD FAILED'])
assert.equal(r.stoppedBy, 'dry')

console.log('ok')
