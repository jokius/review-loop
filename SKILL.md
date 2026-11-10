---
name: review-loop
description: >
  Independent code review loop. A reviewer that is not you (a new Orca tab, another Claude
  session briefed over session-to-session messages, or fresh subagents from this session) runs
  5 review cycles per round and returns a verdict. Fix → re-review repeats until APPROVED or
  until 20 total cycles trip the emergency stop. Rules come from the user's and the project's
  instruction files and review-loop.md settings. Use when the user says "run reviewers",
  "review loop", "review until approved", "запусти ревьюеров", "прогони ревьюеров",
  "ревью-цикл", "гоняй ревьюеров до апрува", or asks for an independent second-opinion review
  of a branch or diff before a PR. AUDIT MODE (audit-mode.md): fresh auditors sweep the whole
  codebase against a written canon, record every verified violation in the tracker, and repeat
  until N consecutive clean cycles. Use for "audit every violation of the canon", "keep
  auditing until 5 clean cycles", "найди все нарушения", "гоняй аудиторов, пока 5 циклов не
  будут чистыми".
---

> **Is the target a canon rather than a diff?** (e.g. "every handler that skips the auth check")
> Then follow `audit-mode.md` instead of the procedure below.

# review-loop

Review by someone who is not you. You wrote the code, so your own review of it is a co-author
review. It shares your premises, including the wrong ones. This skill buys an independent look
and a loop that does not stop at the first "looks fine".

The skill carries the method. Everything specific to one codebase lives in that project and is
read from there on every run (**Project settings**): its conventions, where it tends to break,
its audit canons, where findings get recorded.

## Non-negotiables

- **The reviewer never touches the repo.** No edits, no commits, no `git add/stash/checkout/switch/reset/rebase/merge`, no push, no PR. It reads and reports. Its only writes are verdict files in `<SCRATCH>`. It reads the very checkout you are fixing, so a mutating reviewer would collide with your fixes.
- **You never write production code either.** You are the coordinator: you synthesize, verify, dispatch fixes to agents (`Agent`, or a team skill such as `team-swarm` if installed) and re-request review. Tests come from a separate agent, not from the one writing the fix.
- **You never review either**, inline mode included. You choose the reviewers and judge their findings. The findings themselves are theirs.
- **Verify before you fix.** A finding is a claim. Re-derive it from real source yourself before spending a round on it. Reviewers produce false positives with total confidence.
- **Counters are hard.** 5 cycles per round, 20 cycles total, so **4 rounds at most**. At 20 you stop and report what is still open. Do not negotiate an extension with yourself.
- **Same checkout.** Whatever the transport, there is no worktree and no child checkout.
- **Rules come from the instruction files and settings:** the user's and the project's `CLAUDE.md` / `AGENTS.md`, and `review-loop.md`. Never carry a convention over from another repo or from what you remember of one. If none of them states it, it is not a rule here.

## Inputs to pin before launching

| Input | How to get it | Never |
|---|---|---|
| `REPO` | `git rev-parse --show-toplevel`. In a workspace that holds several repos (cwd is not a git repo, or the settings list subrepos), REPO is the in-scope subrepo that holds the change. A change that spans several repos runs one loop per repo, one after another. Each loop gets its own `SCRATCH` subfolder (`<SCRATCH>/<repo name>/`) and its own 20-cycle budget | assume cwd. If it is unclear, ask once |
| `BASE` | the ref the diff is measured against. Use the settings if they name one, otherwise `git -C <REPO> symbolic-ref --short refs/remotes/origin/HEAD` (e.g. `origin/main`). If that ref is unset, use `git -C <REPO> ls-remote --symref origin HEAD` | guess. If still unclear, ask once |
| `HEAD_SHA` | `git -C <REPO> rev-parse --short HEAD` | let it drift mid-loop unnoticed |
| `STASHES` | `git -C <REPO> stash list \| wc -l` | proceed without recording it |
| `ROUND` | 1 at launch. A reviewer started mid-loop (a replacement, or every inline round) gets the current round number, plus the last verdict as `<PREVIOUS_VERDICT>` | reuse an old round number |
| `COORDINATOR_SESSION` | `orca`/`peer`: the bare session name from the first line of `ListAgents` (e.g. `my-repo-56`), without the `[ref]`. `inline`: write `none (inline)` | guess it |
| `SCRATCH` | your scratchpad directory, as an absolute path. In `orca`/`peer` mode the reviewer reads and writes there too | use a relative path or the repo |

Snapshot `HEAD_SHA` and `STASHES` before round 1 and re-check them after every round. A changed
stash count means something touched the tree that should not have.

## Project settings

Collect these before anything else. They are the only source of project-specific rules.

1. **Instruction files.** `CLAUDE.md` at every level, the user-level one included, and
   `AGENTS.md`, plus whatever they import. Pull out what a reviewer must hold the diff to:
   conventions (comment language, layering, error handling), test policy (what counts as a
   coverage gap), commit and deploy rules, migration rules, canons. They go into the brief's
   `<PROJECT_RULES>`. The reviewer loads `CLAUDE.md` on its own, but not necessarily the rest,
   and an explicit list is what its agents check against.
2. **`review-loop.md`**, optional free-form markdown. The user-wide one lives at
   `${CLAUDE_CONFIG_DIR:-~/.claude}/review-loop.md`. Per project it is `.claude/review-loop.md`
   in the repo or in any directory above it, so a workspace that holds several repos can keep a
   single one. The nearer file wins on conflict. To find them, set `<START>` to `<REPO>`, or to
   cwd while REPO is not pinned yet (for example in a workspace of several repos):

   ```bash
   f="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/review-loop.md"; [ -f "$f" ] && echo "$f"
   d=$(cd "<START>" 2>/dev/null && pwd) || { echo "not a directory: <START>"; exit 1; }
   while [ "$d" != / ]; do [ -f "$d/.claude/review-loop.md" ] && echo "$d/.claude/review-loop.md"; d=$(dirname "$d"); done
   ```

   It may hold any of these:
   - `reviewer: orca | peer | inline` (see **Transport**);
   - a default `BASE`;
   - a review focus: where this codebase breaks and what deserves the hardest look;
   - which cycle-4 angles apply;
   - the scope, i.e. which subrepos to include or skip;
   - audit canons, each with its exceptions, lenses, failure framing and the place to record
     findings (`audit-mode.md`).
3. **Project tooling.** Agents and skills in `<REPO>/.claude/agents` and `<REPO>/.claude/skills`,
   and plugins enabled in `<REPO>/.claude/settings.json`, reach the reviewer just like
   user-level ones. Step 2 picks them up.

Finding nothing is a valid state: run the generic brief. Do not invent rules to fill the slot.

## Transport: who the reviewer is

| Mode | Reviewer | Independence | Needs |
|---|---|---|---|
| `orca` | a fresh Claude session that you open in a new Orca tab | full: a separate session with its own context | this session running inside Orca, with the repo in an Orca workspace; cross-session messaging |
| `peer` | a fresh Claude session that the user starts in `<REPO>`, briefed by you over `SendMessage` | full | cross-session messaging, and the user starts one session |
| `inline` | fresh subagents launched from this session, one of which assembles the verdict | partial: they share none of your context, but you dispatch them | nothing extra |

Pick the mode in this order:
1. the user's words in this request ("in this session" / "в этой сессии", "via Orca" / "через
   орку", "in another session" / "в другой сессии");
2. `reviewer:` in the settings (the nearest file wins);
3. auto: `orca` if its check passes, otherwise `inline`. When auto lands on `inline`, add one
   line saying that `peer` gives full independence without Orca.

State the mode before launching, then run that mode's check.

**If the check or the launch fails:**
- If the mode came from auto, fall back to `inline` and say so in one line.
- If the user or the settings named `orca` or `peer`, stop and say what is missing. Do not swap
  in a weaker reviewer that nobody chose. Offer the alternatives in one line.

- **Cross-session check** (`orca`, `peer`): `ListAgents` and `SendMessage` are available. If
  they are deferred, load them with `ToolSearch("select:SendMessage,ListAgents")`. The first
  line of `ListAgents` must name this session.
- **Orca check** (`orca`):
  1. `ORCA_WORKTREE_ID` is set, which means this session runs inside Orca. Test this first and
     never call the binary without it: on Linux desktops `orca` may be the GNOME screen reader.
  2. `orca status` reports `runtimeState: ready`.
  3. `(cd <REPO> && orca worktree show --worktree current --json)` returns `"ok": true`, which
     means an Orca workspace encloses the repo.

  Under WSL, Orca exports `ORCA_CLI_COMMAND`; use that instead of `orca`. Orca is an optional
  integration, and nothing outside `orca` mode calls it.

## State file

The loop outlives context compaction, so bookkeeping lives on disk, not in your head.
Write `<SCRATCH>/review-loop-state.json` after every round:

```json
{"repo":"…","base":"origin/main","head":"a1b2c3d","transport":"orca","reviewer":"my-repo-71",
 "reviewer_handle":"term_…","round":2,"cycles_used":10,"max_cycles":20,"verdict":"CHANGES_REQUESTED",
 "open_blocking":["…"],"fixed":["…"],"withdrawn":["…"],"stashes":4}
```

## Procedure

### 1. Preflight

Do these in order:
1. Collect the project settings. They may name the scope, `BASE` and the transport.
2. Pin `REPO` (using the scope from the settings), then `BASE`, `HEAD_SHA` and `STASHES`.
3. Check what the reviewer will see. It diffs `<BASE>...HEAD`, so uncommitted work is invisible
   to it.
   - If `git -C <REPO> status --porcelain` shows changes that belong to the review, ask the user
     once whether to commit them. If the project's rules say to commit right away, follow them
     instead of asking.
   - If `git -C <REPO> diff --stat <BASE>...HEAD` is empty, there is nothing to review: say so
     and stop.
4. Pick the transport and run its check.

### 2. Inventory the review tooling. Do not assume

The reviewer starts with the same config in the same repo, so it gets the agent types and
skills you have. Your own `Agent` tool's list of available agent types, together with your
skill list, is the inventory. It covers user, plugin and project-level entries, and it reflects
what is actually installed, not what a marketplace or a plugin's README advertises. If your
session started outside `<REPO>`, also look in `<REPO>/.claude/agents` and
`<REPO>/.claude/skills`.

Map the inventory onto the cycles in `reviewer-brief.md`:

| Cycle | Angle | Example, with `compound-engineering` and `ponytail` installed |
|---|---|---|
| 1 | correctness, maintainability, tests, project standards | `compound-engineering:review:ce-correctness-reviewer`, `…:ce-maintainability-reviewer`, `…:ce-testing-reviewer`, `…:ce-project-standards-reviewer` |
| 2 | adversarial | `…:ce-adversarial-reviewer` |
| 3 | claims audit | always done by hand |
| 4 | data, migrations, reliability, deploy | `…:ce-data-migrations-reviewer`, `…:ce-data-integrity-guardian`, `…:ce-data-migration-expert`, `…:ce-reliability-reviewer`, `…:ce-deployment-verification-agent` |
| 5 | simplicity | `…:ce-code-simplicity-reviewer`, and the skill `ponytail:ponytail-review` |

Name in the brief only what the inventory has, and only read-only tools. A skill or agent that
applies fixes (the built-in `simplify`, or `code-review --fix`) would edit the tree under your
hands. The built-in `code-review` without `--fix` is a fair cycle-1 entry when no review plugin
is installed. A cycle with nothing behind it is done by hand. Write that into its slot instead
of leaving the reviewer to improvise.

### 3. Write the brief

Copy `reviewer-brief.md` from this skill directory to `<SCRATCH>/reviewer-brief.md`. Fill every
UPPER_CASE `<PLACEHOLDER>`. The lower-case slots in the verdict envelope belong to the reviewer.
- The inputs from the table above. Delete `<PREVIOUS_VERDICT>` in round 1.
- `<PROJECT_RULES>` and `<REVIEW_FOCUS>`, from the project settings. Scope inside the repo
  (paths to skip) goes into `<REVIEW_FOCUS>`.
- `<CYCLE_n_AGENTS>`, from step 2.
- Context: anything the reviewer cannot get from the diff. What the change is for, which
  behaviours are deliberate, and what was already decided and is not up for re-litigation. If
  you produced wrong premises earlier in the task, say so explicitly. A reviewer told "the
  author's plan was wrong three times" reads harder.

### 4. Start the reviewer

**`orca`.** Open a new agent tab in the workspace that encloses the repo, and give it a
recognisable title:

```bash
cd <REPO> && orca agent launch --agent claude --worktree current --surface terminal \
  --prompt "Read <SCRATCH>/reviewer-brief.md and follow it exactly." --json
orca terminal rename --terminal <handle> --title "REVIEWERS · <BASE>...HEAD" --json
```

- `<handle>` is `result.outcome.handle`. Keep it in the state file.
- `--surface terminal` is required because the reviewer must be an interactive CLI session:
  that is what shows up in `ListAgents` and receives `SendMessage`.
- Orca starts the session the way a new agent tab does, with Orca's environment rather than
  your shell's.
- Add `--model`/`--effort` only if the user asked for a particular reviewer model. `--effort`
  requires `--model`.
- Add `--focus` only if the user wants to watch.

**`peer`.** Ask the user to open a new terminal and start a fresh session:

```bash
cd <REPO> && claude
```

It has to be fresh, not an existing session with its own history, because a busy context is
not an independent one. It has to run on this machine, because it reads the brief and writes
verdicts in your `<SCRATCH>`. When it shows up in `ListAgents` as a new `interactive` row, send
the brief:

```
SendMessage({to: "<its name>", message: "Read <SCRATCH>/reviewer-brief.md and follow it exactly."})
```

**`inline`.** There is no second session. Each round runs from here:

1. Launch every agent named in the cycle slots. Send them in one message, in the background.
   Each one gets the brief's Hard rules, its Project rules and the exact diff command. A slot
   that names a skill gets a `general-purpose` agent told to run that skill read-only.
2. When they are back, launch one fresh `general-purpose` agent as the reviewer. It gets the
   filled brief (with `ROUND` and `PREVIOUS_VERDICT` set), all the raw agent outputs, and this
   header:

   > *"Inline mode. The agents listed in the cycle slots already ran; their raw outputs are
   > below. Skip FIRST ACTION and SendMessage. Do everything else the brief gives you: your own
   > break attempt in cycle 2, every cycle or slot marked by hand, cycle 3, and the
   > self-verification half of cycle 5. Then return the verdict envelope as your final answer."*

Then go to step 6.

### 5. Establish the channel (`orca`, `peer`)

The reviewer boots with the brief, so its first action is to message you. Confirm that the
reviewer has appeared as a peer:

```
ListAgents          # a new peer appears, e.g. "my-repo-71 [ab12cd]" · interactive
```

If no ACK arrives within a couple of minutes, look at what actually happened:
- Does `<SCRATCH>/reviewer-channel-broken.md` exist? The reviewer writes it when `SendMessage`
  fails.
- Is it a boot error, a permission prompt, or a trust dialog? In `orca` mode run
  `orca terminal read --terminal <handle> --screen --json`. In `peer` mode ask the user to look
  at their terminal.

Do not re-launch blind. A channel that stays broken counts as a failed launch, so the
**Transport** fallback rules apply.

`SendMessage` is the channel by mandate. It is a deferred tool in a fresh session, which makes
it the single most common silent failure: the reviewer finishes its work and cannot answer. The
brief makes `ToolSearch("select:SendMessage,ListAgents")` its literal first action and requires
an ACK message before any reviewing. **No ACK, no round.** The verdict file is a durable backup
and an audit trail, not the primary channel.

### 6. Wait for the verdict

- **`orca` / `peer`.** The reviewer sends one message per round, in the envelope defined in the
  brief. It arrives on its own, so end your turn. Use `Monitor` with an until-loop only if you
  need an active wait.
- **`inline`.** Background agents notify you when they finish.

Either way, do not poll and do not start fixes. A round is atomic, and the tree must stay still
while the reviewer reads it.

### 7. Approval gate

Count the round here: `cycles_used += 5`.

**APPROVED** = zero blocking findings. A finding is blocking only if all three hold:

1. **P0 or P1.** Critical breakage or data loss, or a high-impact defect hit in normal usage.
2. **Introduced by this diff.** Not pre-existing on `BASE`. Pre-existing findings go to a follow-up note, never into the loop.
3. **Survived the reviewer's own verification cycle** and your independent re-derivation from source.

P2/P3 are advisory: reported, recorded, not looped on. A round that returns only P2/P3 is an
APPROVAL with notes. Say that plainly instead of burning a round on nitpicks.

A verdict of `CHANGES_REQUESTED: review incomplete` is never an approval, whatever its BLOCKING
section says. The round still counts, and it is run again.

### 8. Fix, then re-request

If `cycles_used` is 20, go to step 9 and do not dispatch fixes.

For each surviving blocking finding, dispatch the fix (to agents, not yourself), and have a
separate agent cover with tests whatever needs covering. Then, once for the whole round:
1. Run the suite yourself.
2. Commit the fixes, following the project's commit rules. The reviewer diffs
   `<BASE>...HEAD`, so uncommitted work is invisible to it.
3. Request the next round. Name (a) what changed, with file:line, (b) which findings you
   rejected and the evidence, (c) the new `HEAD`.
   - In `orca`/`peer` mode, send the request by `SendMessage` and go to step 6.
   - In `inline` mode, or when you replace a reviewer, go to step 3. Refill the brief with
     `ROUND` + 1, the new `HEAD_SHA`, and the last verdict plus (a)–(c) as
     `PREVIOUS_VERDICT`.

A rejected finding is normal, but it must be argued, not ignored. The reviewer re-checks your
counter-argument in the next round and either withdraws the finding or defends it with fresh
evidence.

Update the state file after every round.

### 9. Termination

- **APPROVED.** Report to the user: rounds used, what got fixed, what stayed advisory, what is pre-existing. Then stop.
- **20 cycles reached.** Emergency stop. Report the open blocking findings verbatim, your assessment of each, and what you would do next. This is a real outcome, not a failure to hide.
- **Push and PR.** Push only if the project's rules or the user's current message say so. Open a PR only on an explicit request.
- **Wrap-up.** In `orca`/`peer` mode, tell the reviewer the loop is over. In `orca` mode close its tab with `orca terminal close --terminal <handle> --tab`. In `peer` mode, tell the user they can close theirs. Keep the verdict files.

## Failure modes worth naming

| Symptom | What it actually is | Move |
|---|---|---|
| The reviewer returns zero findings on round 1 in under a minute | It never ran. A killed or interrupted reviewer also reports "nothing" | Check its transcript (in inline mode, the agent outputs) before believing an empty result |
| The same finding every round, with no new evidence | Anchoring | Demand evidence at file:line, or replace the reviewer for one round (a new brief with `ROUND` and `PREVIOUS_VERDICT`) |
| Findings drift into style and taste | Out of scope | Re-send the severity bar. Taste is P3 |
| A finding contradicts the project's own policy (e.g. a coverage gap its test policy does not count) | The rule never reached the reviewer | Put it in `<PROJECT_RULES>` and cite it when rejecting |
| The reviewer's side says the ACK was sent, but nothing arrives here | Sessions in different permission modes hold each other's messages for the user's approval (documented `SendMessage` behaviour) | Approve the held message, or put both sessions in the same mode |
| The reviewer names agents or skills you do not have, or lacks yours | It runs with a different config dir (in `orca` mode, Orca's environment rather than your shell's) | Align `CLAUDE_CONFIG_DIR`, or rebuild the cycle lists from what the reviewer has |
| The verdict never arrives and the reviewer looks busy | A long review, or a stuck permission prompt | Look at its terminal, then decide. Do not kill a working reviewer |
