# Audit mode: sweep a codebase against a canon until it runs dry

Use audit mode when the target is not a diff but a **rule applied to the whole codebase**, for
example "audit every violation of <canon>", "найди все нарушения <канон>", or "гоняй аудиторов,
пока 5 циклов не будут чистыми".

It runs on Claude Code's `Workflow` tool, using the template below. Without that tool, run the
same loop by hand with `Agent` calls. The counters and the dead-agent rule still apply.

## Inputs come from the project

The canon, its exceptions, the lenses, the failure framing and the place to record findings are
project settings, not part of this skill. Look for the canon in the project's instruction files
and for its audit entry in `.claude/review-loop.md` (see SKILL.md › Project settings). Ask the
user once, before launching, for anything missing. The exceptions matter most: without them,
every legitimate carve-out comes back as a "violation". Offer to save the answers into the
project's `.claude/review-loop.md` so the next audit starts from them.

## How it differs from the diff loop

| | Diff loop (SKILL.md) | Audit mode |
|---|---|---|
| Target | `git diff <BASE>...HEAD` | whole repo(s) × a written canon |
| Independence | a reviewer that is not you, because you wrote the diff | fresh Workflow agents, since nobody here wrote the code under audit |
| Output | verdict APPROVED / CHANGES_REQUESTED | one tracker issue per verified violation |
| Stop | APPROVED, or 20 cycles | **N consecutive clean cycles** (default 5), or a hard cap |
| Fixes | inside the loop | never inside the loop. The audit only records |

## The loop

1. **Cycle.** Every lens fans out at once, each in a fresh agent with no memory of earlier
   cycles. Each auditor gets the canon verbatim, the explicit canon exceptions, its lens, and the
   list of everything already **seen** (recorded or refuted). Its job is to find something that
   is NOT on that list.
2. **Dedupe** the cycle's raw findings in one agent: merge findings that share a root cause or a
   write path, and drop anything already seen. This is the only barrier, because it needs every
   finding from the cycle at once.
3. **Verify** each candidate adversarially. The skeptic is told to refute and defaults to
   refuted. It checks two things: does the failure reproduce from real source (`file:line`), and
   is it a violation rather than a listed canon exception?
4. **Record** survivors immediately, one tracker issue each, one at a time (trackers
   rate-limit). Recording happens BEFORE the next cycle, so the next auditors see the finding as
   known.
5. **Counters.** A cycle that recorded at least one new issue resets the clean streak to 0. A
   cycle that recorded nothing increments it. Stop at `cleanTarget` consecutive clean cycles.
   Also stop at `maxCycles`, and report that as an emergency stop, not as done.
6. **Dead agents are not answers.** Refuted findings go into `seen` too. Otherwise the same false
   positive comes back every cycle and the loop never converges. But a verifier that DIED is not
   a refutation (a null result: an API error, or the machine went to sleep mid-run). Keep its
   finding out of `seen`. The same goes for a whole cycle: if an agent died and nothing was
   recorded, the cycle proves nothing. It neither extends nor resets the clean streak. Otherwise
   an outage reads as "ran dry". A cycle that recorded anything resets the streak, as in point
   5, including a `RECORD FAILED` entry. A dead record agent leaves that entry in `seen` because
   it may have filed the issue before it died. Check each one by hand.
7. **Keep the machine awake.** Long loops outlive a lid close. Before launching, tell the user to
   keep the machine awake (macOS: `caffeinate -dimsu`; Linux:
   `systemd-inhibit --what=sleep:idle sleep infinity`) or to accept a paused run.

## Non-negotiables

- Auditors, skeptics and the dedupe agent are **read-only**. Only the record step writes, and it
  writes only to the tracker.
- Quote the canon verbatim and list its exceptions explicitly.
- Every finding carries a `file:line`, the concrete failure in the framing the project asks for
  (default: state → wrong outcome), and the canon clause it breaks.
- Lenses are search angles, not severity buckets: independent ways to slice the codebase (by
  entry point, by data store, by external call site, by contract, by background job…). Use the
  project's lenses for this canon when it defines them.
- `log()` every cycle: raw / candidates / recorded / died / streak. Never raise the cap
  silently.

## Workflow template

Pass `args` as a real object:
`{canon, exceptions, lenses:[{key,prompt}], seen:[{title,where,issue?}], recordCmd, failure?, cleanTarget, maxCycles}`.
`recordCmd` is an instruction for an agent, not a shell command: how to file one issue in the
project's tracker and return its id. `failure` is the project's failure framing, if it has one.
`tests/audit-template.test.mjs` runs this template against stub agents.

```js
export const meta = {
  name: 'canon-audit-loop',
  description: 'Audit a codebase against a canon until N consecutive clean cycles; record every new violation',
  phases: [{ title: 'Audit' }, { title: 'Dedupe' }, { title: 'Verify' }, { title: 'Record' }],
}
const { canon, exceptions, lenses, recordCmd } = args
const cleanTarget = args.cleanTarget || 5, maxCycles = args.maxCycles || 30
const failure = args.failure || 'a concrete failure (state → wrong outcome)'
const seen = [...(args.seen || [])]        // recorded + refuted, fed back to every auditor
const recorded = []
const F = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  title: { type: 'string' }, where: { type: 'string' }, failure: { type: 'string' }, clause: { type: 'string' },
}, required: ['title', 'where', 'failure', 'clause'] } } }, required: ['findings'] }
const D = { type: 'object', properties: { candidates: F.properties.findings }, required: ['candidates'] }
const V = { type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real', 'reason'] }
const R = { type: 'object', properties: { issue: { type: 'string' } }, required: ['issue'] }
const base = `CANON (verbatim):\n${canon}\n\nNOT violations (canon exceptions):\n${exceptions}\n\nRead-only: no edits, no git writes.`
let clean = 0, cycle = 0
while (clean < cleanTarget && cycle < maxCycles) {
  cycle++
  let died = 0
  const known = JSON.stringify(seen.map(s => ({ title: s.title, where: s.where })))
  const lensResults = await parallel(lenses.map(l => () => agent(
    `${base}\n\nLENS: ${l.prompt}\n\nAlready seen — do NOT report these again, find something else:\n${known}\n\nReturn only violations with file:line, ${failure}, and the clause broken. Empty is a valid answer.`,
    { label: `c${cycle}:${l.key}`, phase: 'Audit', schema: F })))
  died += lensResults.filter(r => !r).length
  const raw = lensResults.filter(Boolean).flatMap(r => r.findings)
  let candidates = []
  if (raw.length) {
    const d = await agent(
      `Merge findings sharing a root cause or write path; drop any already covered by the seen list.\nSeen:\n${known}\n\nRaw:\n${JSON.stringify(raw)}`,
      { label: `c${cycle}:dedupe`, phase: 'Dedupe', schema: D })
    // A dead dedupe loses nothing for good: these findings are not in `seen`, so they are re-found.
    if (d) candidates = d.candidates
    else { died++; log(`c${cycle}: dedupe died — ${raw.length} raw findings will be re-found`) }
  }
  const verdicts = await parallel(candidates.map(f => () => agent(
    `${base}\n\nTry to REFUTE this finding. Open the cited code. Real only if the failure reproduces from source AND it is not a canon exception. Default real=false when unsure.\n\n${JSON.stringify(f)}`,
    { label: `c${cycle}:verify:${f.where}`, phase: 'Verify', schema: V })))
  let fresh = 0
  for (let i = 0; i < candidates.length; i++) {
    const f = candidates[i], v = verdicts[i]
    // A dead verifier (null: API error, machine asleep) is NOT a refutation. Leave it out of `seen`
    // so the next cycle re-finds and re-verifies it. Marking it refuted would silently lose a violation.
    if (!v) { died++; log(`c${cycle}: verifier died for "${f.title}" — will be re-found`); continue }
    if (!v.real) { seen.push({ ...f, refuted: v.reason }); continue }
    const r = await agent(`${recordCmd}\n\nFinding:\n${JSON.stringify({ ...f, evidence: v.reason })}`,
      { label: `c${cycle}:record`, phase: 'Record', schema: R })
    if (!r) { died++; log(`c${cycle}: record died for "${f.title}" — check the tracker by hand`) }
    const entry = { ...f, issue: r ? r.issue : 'RECORD FAILED' }
    seen.push(entry); recorded.push(entry); fresh++
  }
  // Anything recorded resets the streak. Otherwise a cycle with a dead agent proved nothing: it neither extends nor resets it.
  clean = fresh ? 0 : died ? clean : clean + 1
  log(`cycle ${cycle}: raw ${raw.length}, candidates ${candidates.length}, recorded ${fresh}, died ${died}, clean streak ${clean}/${cleanTarget}`)
}
return { cycles: cycle, stoppedBy: clean >= cleanTarget ? 'dry' : 'cap', recorded, refuted: seen.filter(s => s.refuted) }
```

## Report

Report how many cycles ran, why the run stopped (dry / cap), every recorded issue (id, title,
where), the refuted findings with their refutations, how many agents died, and what the lenses
deliberately did not cover. List every `RECORD FAILED` entry separately: file each one by hand,
or confirm that it already exists.
