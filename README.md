# review-loop

A Claude Code skill for an **independent review loop**. Your diff is reviewed by someone who
did not write it: a separate Claude session, or fresh subagents. The review runs five cycles
per round, and the loop (fix → re-review) keeps going until the reviewer approves or a hard
20-cycle stop trips. It also has an **audit mode** that sweeps a whole codebase against a
written canon until N consecutive cycles come back clean.

Why: a review of your own diff shares your premises, including the wrong ones. A reviewer that
did not write the code, is told to verify instead of speculate, and has to withdraw what it
cannot reproduce from source catches what self-review waves through.

> **Heads up:** the skill is written in English. The trigger phrases are English and Russian.

## A round

1. **Correctness and craft.** Fan out to reviewer agents for correctness, maintainability,
   tests and project standards.
2. **Adversarial.** Concurrency, retries, partial failure, malformed input, deploy skew.
3. **Claims audit.** Every assertive comment and commit-message claim is checked against real
   source.
4. **Data, migrations, reliability.** Only what the diff warrants.
5. **Simplicity + self-verification.** The reviewer withdraws every finding it can no longer
   reproduce.

`APPROVED` means zero blocking findings. A blocking finding is P0/P1, introduced by this diff,
and has survived both the reviewer's self-check and the coordinator's re-derivation from source.
P2/P3 findings are reported but not looped on. Pre-existing issues go to a follow-up note.

## Three transports

| Mode | Reviewer | Needs |
| :--- | :------- | :---- |
| `orca` | a fresh Claude session the skill opens in a new [Orca](https://github.com/stablyai/orca) tab | Claude Code running inside Orca, with the repo in an Orca workspace; cross-session `SendMessage` |
| `peer` | a fresh Claude session you start yourself (`cd <repo> && claude`), briefed over session-to-session messages | cross-session `SendMessage` |
| `inline` | fresh subagents launched from the current session | nothing extra |

The mode is picked in this order: what you say ("in this session", "via Orca", "in another
session"), then `reviewer:` in your settings, then auto. Auto uses `orca` when the Orca check
passes and `inline` otherwise. If you named a mode and it is unavailable, the skill stops and
says why instead of quietly swapping in a weaker reviewer. Orca is an optional integration
behind its own check. Nothing else calls it.

## Project settings

The skill holds the method and the project holds its rules. Before every run the coordinator
reads:

- your and the project's `CLAUDE.md` / `AGENTS.md`: conventions, test policy, commit and
  deploy rules, canons;
- `.claude/review-loop.md` in the repo or in any directory above it (nearest wins), and
  `${CLAUDE_CONFIG_DIR:-~/.claude}/review-loop.md` for user-wide defaults;
- project-level agents, skills and plugins.

Nothing in the skill is tied to one codebase. If the project states no rule, there is no rule.

Example `.claude/review-loop.md`:

```markdown
reviewer: orca

## Review focus
- Every public function validates its input at the boundary; internal callers are trusted.
- Migrations ship before the code that needs them; a rerun is a no-op.

## Scope
Review `src/`; skip `vendor/` and generated code.

## Audit canons
### auth-boundary
- Canon: "Every handler under /api checks the session before touching data" (CLAUDE.md, Security).
- Exceptions: /api/health, /api/login.
- Lenses: by route, by middleware chain, by background job that calls handlers directly.
- Record: open a GitHub issue with `gh issue create --label audit` in this repo; return its URL.
```

## Install

Requirements:

- **Claude Code.** For the `orca` and `peer` transports you need cross-session `ListAgents` and
  `SendMessage` (verified on 2.1.322). `inline` needs only `Agent`.
- **Audit mode** needs the `Workflow` tool, or you can run its loop by hand with `Agent`.

Optional companions:

- [`compound-engineering`](https://github.com/EveryInc/compound-engineering-plugin) for
  specialised reviewer agents;
- [`ponytail`](https://github.com/DietrichGebert/ponytail) for `ponytail-review`;
- [`team-swarm`](https://github.com/jokius/team-swarm) for dispatching fixes.

The skill names only what is actually installed. If a cycle has no agent behind it, the
reviewer does that cycle by hand.

**From the marketplace:**

```
claude plugin install review-loop --marketplace jokius/review-loop
```

(or, inside a session, `/plugin marketplace add jokius/review-loop` then
`/plugin install review-loop@review-loop`). Marketplace skills are namespaced, so this one is
`review-loop:review-loop`.

**Into your skills folder:** clone it, or symlink a checkout you edit:

```
git clone https://github.com/jokius/review-loop ~/.claude/skills/review-loop
# or: ln -s /path/to/review-loop ~/.claude/skills/review-loop
```

If you set `CLAUDE_CONFIG_DIR`, use `$CLAUDE_CONFIG_DIR/skills/` instead. Keep one copy, not
both.

## Usage

- "run reviewers", "review loop", "review until approved", "запусти ревьюеров", "гоняй
  ревьюеров до апрува": starts the diff loop against the default branch.
- Add "in this session" / "via Orca" / "in another session" to pick the transport.
- "audit every violation of &lt;canon&gt;", "keep auditing until 5 clean cycles", "найди все
  нарушения &lt;канон&gt;": starts audit mode.

## Layout

```
SKILL.md                       coordinator procedure: settings, transport, rounds, approval gate
reviewer-brief.md              template brief for the reviewer
audit-mode.md                  canon audit loop + its Workflow template
tests/audit-template.test.mjs  runs the Workflow template against stub agents
```

Tests: `node tests/audit-template.test.mjs`.

## License

MIT
