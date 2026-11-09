# Crabshell User Manual (v21.166.2)

## Why Do You Need This?

Claude Code **forgets everything when a session ends:**
- Work you did yesterday
- Decisions and their reasons
- Project structure
- Bugs found and how you fixed them

Every new session, you have to repeat: "This project is built with React, uses Zustand for state management, JWT for auth..." and so on.

Crabshell solves this problem.

## Installation

In Claude Code:

```text
/plugin marketplace add ZipperBagCoffee/crabshell
/plugin install crabshell
```

**That's it.** It works automatically after installation.

### Codex Native Installation

On Windows or Linux, install from the GitHub marketplace:

```bash
codex plugin marketplace add ZipperBagCoffee/crabshell --ref master
codex plugin add crabshell@crabshell-repo
codex plugin list
```

For local development, `codex plugin marketplace add .` works only when `.` is the Crabshell repository root containing `.agents/plugins/marketplace.json`; it does not work from an unrelated target project.

Start a new Codex session, review/trust the Crabshell hook definition, and invoke `crabshell:status`. It reports live installed, activated, trusted, behavior-verified, degraded, drifted, and unsupported states for Claude Code CLI and Codex CLI. Codex desktop-app evidence is kept separate. The old `/crabshell:install-codex` command remains a legacy/development bridge.

Codex automatically loads existing memory/workflow context at SessionStart and uses native prompt, compaction, subagent, command-observation, and completion hooks. Explicit load/save/search skills remain available. Claude retains its automatic SessionEnd capture and pressure/sycophancy system; neither host launches the other.

### What an install contains

Both hosts copy the whole plugin folder into their plugin cache (Claude Code: `~/.claude/plugins/cache`, Codex: `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`). This marketplace lists the plugin with `"source": "./"`, a source type with no exclude list, so the tests (`scripts/_test-*.js`), their fixtures and helpers are installed too — about 38% of the tracked files by size. They never run during hooks; they cost only disk space and copy time. Leaving them out would take a different distribution: a `git-subdir` source (the plugin in its own subfolder, tests outside it), an npm package with a `files` list (both hosts can install npm sources), or a `command` source that builds the folder on the user's machine.

---

## Basic Usage (Automatic)

### What Happens in Claude Code

**1. Session Start:**
- Previous session summary (`logbook.md`) loaded into Claude's context
- L3 summaries of archived memory loaded
- Project info you set (`project.md`) loaded
- CLAUDE.md rules synced and injected

**2. During Work:**
- Auto-save triggers every 15 tool uses (configurable)
- Delta extracted from L1 session log, summarized by the memory-delta skill, which Claude must run when the pending notice appears (its delta-summarizer agents run on Haiku in the background; since v21.156.0 the notice comes once per turn — on a question Claude answers first and runs it in the same response, on a work request or after a skipped save it runs first), appended to `logbook.md`
- Auto-rotation when `logbook.md` exceeds ~23,750 tokens
- Rules re-injected every prompt via COMPRESSED_CHECKLIST
- CLAUDE.md rules section kept in sync automatically
- Project concept anchor: `project.md` injected into context every prompt for drift prevention
- Prompt-aware memory snippets loaded into context based on relevance

**3. Session End:**
- After an execution-authorized turn, the full conversation is backed up (`.l1.jsonl`) and the final delta is extracted.
- A question-only session does not create Crabshell bookkeeping writes.

### What Happens in Codex

- SessionStart reads the same project memory and active D/P/T/W workflow context without modifying it.
- UserPromptSubmit supplies the shared scoped task contract and concise core rules. Polite action requests authorize that work; quoted commands and inspection questions do not authorize edits.
- PreCompact/PostCompact recover memory and workflow context; SubagentStart supplies the current task/non-goals/references/success contract.
- PostToolUse records decisive parent command results. SubagentStop is only a child claim; Stop requires parent evidence and bounds identical retry failures.
- Interrupt preserves a paused record and invalidates earlier test success. Historical work records never authorize resuming stopped work.
- Use `crabshell:save-memory` for an explicit Codex session note. Codex does not invoke Claude's SessionEnd capture or pressure counters.

### What Gets Saved

```
.crabshell/memory/
├── logbook.md           # Active rolling memory (auto-rotates)
├── logbook_*.md          # Rotated archives (L2)
├── *.summary.json       # L3 summaries (Haiku-generated)
├── memory-index.json    # Rotation tracking & delta state
├── delta-jobs/          # Fixed delta inputs and attempt-specific summary files
├── completion-control.json # Parent evidence and bounded recovery record, one entry per session
├── verification-state.json # Required-check results and interruption state
├── counter.json         # Legacy counter for payloads without a session id
├── session-state/       # Per-session counter, L1 read position, skill flag, turn record, doc-watchdog edits
├── config.json          # Per-project configuration
├── project.md           # Legacy description if present; canonical file is ../project.md
├── logs/                # Debug and refine logs
└── sessions/            # Per-session records (auto)
    └── *.l1.jsonl       # L1 session transcripts (deduplicated)
```

---

## Memory Rotation

When `logbook.md` grows beyond **23,750 tokens** (~95KB):
1. Current content archived to `logbook_YYYYMMDD_HHMMSS.md`
2. Last **2,375 tokens** kept as carryover
3. Haiku agent generates L3 JSON summary of the archived content

### Search Across All Layers

**Use slash command (recommended):**
```
/crabshell:search-memory auth
```

**Or ask Claude directly:**
> "Search memory for authentication related work"

---

## Slash Commands

All available skills (slash commands):

### Memory Management

| Command | What It Does |
|---------|-------------|
| `/crabshell:save-memory` | Trigger an immediate memory save |
| `/crabshell:load-memory` | Reload memory context (useful after manual edits or compaction) |
| `/crabshell:search-memory keyword` | Search past sessions across L1/L2/L3 layers. Flags: `--regex`, `--context=N`, `--limit=N` |
| `/crabshell:clear-memory` | Clean up old memory files |

### Structure for the Reader

| Command | What It Does |
|---------|-------------|
| `/crabshell:structuring` | The order for anything a person will see or read: their tasks, what belongs under what, what stays, reading order, their words, the lists to show before building, and who checked it. Opens by itself when the work matches |

### Structured Work (D-T Documents)

| Command | What It Does |
|---------|-------------|
| `/crabshell:discussing "topic"` | Create or update a Discussion document (D) |
| `/crabshell:planning P001` | Append to an existing Plan document (P); new plans are written into the discussion |
| `/crabshell:ticketing D001 "title"` | Create or update a Ticket (T) under a discussion (`D001_T001`; `P001` for an existing plan) |
| `/crabshell:investigating "topic"` | Run a multi-agent Investigation (I) |
| `/crabshell:hotfix "description"` | One-pass work: a discussion whose Plan you confirm, one ticket with the fix in its Implementation Details, then the change; `/crabshell:hotfix H001` appends to an existing H record |

### Workflows

| Command | What It Does |
|---------|-------------|
| `/crabshell:regressing "topic"` | Iterative current-gap Plan→Ticket→Verify cycles until convergence; an explicit count is only a maximum |
| `/crabshell:verifying` | Create or run project-specific verification tools |
| `/crabshell:verifying wiring` | Refresh the pipeline connection inventory: re-discover hooks, trigger tokens, and agents, approve new or removed hops into `wiring-contract.json`, and regenerate the optional architecture map when `arch-explorer:build` is installed (v21.121.0) |
| `/crabshell:status` | Live host/plugin state: installed, activated, trusted, behavior-verified, degraded, drifted, unsupported |
| `/crabshell:lint` | Run Obsidian document lint checks (orphans, broken wikilinks, stale status, missing frontmatter, INDEX inconsistencies) |
| `/crabshell:search-docs query` | BM25 full-text search across all D/P/T/I/W/K documents — ranked results with title/tags/id/body field boosts |
| `/crabshell:knowledge "title"` | Create a K-page (verified fact or operational tip) in .crabshell/knowledge/; or `/crabshell:knowledge K001` to view |

### Setup

| Command | What It Does |
|---------|-------------|
| `/crabshell:setup-project` | Initialize project configuration (project.md, config) |
| `/crabshell:install-codex` | Legacy/development bridge into Codex locations; prefer native Codex marketplace installation |
| `/crabshell:setup-rtk` | Install and configure RTK (Rust Token Killer) for token-optimized CLI output |

> **Tip:** For basic memory operations, you can also just ask Claude directly (e.g., "save memory now", "search memory for auth").

### Codex Bundled Skills

Installed Codex skills are invoked by name, including `crabshell:load-memory`, `crabshell:save-memory`, `crabshell:search-memory`, and `crabshell:status`. Memory and document launchers resolve from the installed plugin and target the active project, so the project does not need its own `scripts/`. The seven document skills require an absolute `--project-dir` and invoke the shared document engine from their own skill directory. SessionStart loads shared memory/workflow state; when only a legacy project description exists, it copies that file to the canonical path without deleting the original.

---

## Document System (D-T)

Crabshell includes a structured document system for organizing complex work.

### Document Types

| Type | Name | Purpose |
|------|------|---------|
| **D** | Discussion | Explore a topic, capture decisions, frame the problem, and carry the plan in its `## Plan` (how it will be built — confirmed by you before tickets) |
| **T** | Ticket | Specific work item under a Discussion (`D001_T001`): its part of the plan in `## Implementation Details`, and the result compared with the Discussion in `## Intent Fidelity` |
| **P** | Plan | Existing plans only — new plans go into the Discussion's `## Plan` |
| **I** | Investigation | Independent multi-agent research on a topic |

### Hierarchy

```
D (Discussion, carries the plan) → T (Ticket)
I (Investigation) — independent, not part of the D→T chain
Existing P (Plan) and H (Hotfix) documents stay readable and searchable
```

- A new ticket under a Discussion with no plan, or with empty Implementation Details, is blocked (the Codex document tool refuses it too); a ticket cannot be marked verified while its Intent Fidelity table is empty.
- A Discussion is concluded by its final report (or an explicit status change), never automatically by its tickets. For existing plans the old cascade still applies: all Tickets verified → Plan done → linked Discussion concluded.
- Documents are stored in `docs/` (local only, not committed to git).
- Each document has a log section that tracks all work done against it.

### Regressing (Iterative Improvement)

Use `/crabshell:regressing "topic"` for tasks that need multiple rounds of refinement:
- Creates a single Discussion (D) as wrapper with measurable `## Convergence Criteria`
- Runs one cycle at a time: a `Cycle N plan` entry in the Discussion (the same fields as a Plan), then Tickets under the Discussion; each ticket compares its result with the Discussion, and deviations carry into the next cycle, until the result converges
- Each cycle's scope is determined by the previous cycle's verification results, not pre-allocated
- Prints a ready-to-paste `/goal` line — start host goal mode (Claude Code 2.1.139+ or Codex CLI 0.128.0+) and the host keeps the session running until the D's Convergence Criteria are met or the cycle cap is reached

### One-Pass Tasks

For a standalone task that does not need iteration, plan it in a discussion first (a short Plan you confirm), create one ticket, then make the change (`/crabshell:hotfix "description"` walks through it; the fix goes into the ticket's Implementation Details and the check into its results). Existing H documents stay readable and accept log entries through `/crabshell:hotfix H001`. The former `/crabshell:light-workflow` skill was retired in v21.112.0 — existing W worklogs under `.crabshell/worklog/` remain readable history, and in-flight W documents from earlier versions are still honored by workflow restart context.

---

## Core Philosophy

Crabshell supplies the same core task and evidence rules through each host's native hooks. Claude also synchronizes its managed CLAUDE.md section; Codex receives native hook context and uses project AGENTS.md guidance. You do not need to make one host launch the other.

### Internal Understanding
Claude builds an internal eight-field task contract before implementation: the original request, required outcomes, non-goals, named references, allowed changes, forbidden side effects, observable success, and blocking unknowns. It continues through discoverable or non-blocking uncertainty and asks only when a destructive/irreversible action, outside-workspace change, external installation, or undiscoverable product choice requires user authority.

### Verification-First
Before claiming any result is verified, Claude must:
1. **Predict** what it expects to observe
2. **Execute** (run code, use tools) to get actual results
3. **Compare** prediction vs. observation

The document record (a ticket's `## Verification Results`) holds, per acceptance criterion, the command run or file read, its output line, and pass/fail; a behavior claim is backed by an execution result, a structure claim by what was read (v21.158.0; it used to be a Prediction/Observation/Gap table). The chat report is `"M of N passed"` plus the failed items — never a table, never a list of passing items, never raw observations (v21.115.0/.1, I085). Reading a file and declaring it correct is still not verification.

### Parent-Owned Orchestration
The parent agent may delegate independent inspection, implementation, or review tasks when that lowers risk or latency. Worker prompts must include the relevant original request, task and non-goal, authoritative references, read/write scope, expected observation, and verification method. Explore/review workers are read-only and workers do not fan out.

Completion remains with the parent. A worker's `done`/`PASS`, agent count, or spot-check is not decisive evidence; the parent resolves named references, inspects the resulting diff, runs the decisive command or behavior check, checks forbidden side effects, and reports the observed gap.

### Portable Behavioral Verification

The verifying skill installs one schema-v2 runner from `skills/verifying/scripts/run-verify.js`. Manifest commands use repo-relative `file` and `args` fields. Behavioral entries must assert independently observed JSON/file state and may protect paths with before/after snapshots. A zero exit or stdout containing `PASS` cannot satisfy the contract by itself.

As of v21.121.0 (D116) the skill also checks that a project's **pipeline is still wired**. For a Claude Code plugin project it copies `skills/verifying/scripts/check-pipeline-wiring.js` next to the runner, runs `discover` to list candidate hops — every `hooks/hooks.json` command (event, matcher, script, args), every `[CRABSHELL_*]` trigger token with the scripts that emit it and the skills that consume it, and every `agents/*.md` name referenced by a skill — and the parent approves that list into `.crabshell/verification/wiring-contract.json`. Each approved hop becomes one `structural` manifest entry (`check --contract … --hop <id>`), plus one completeness entry (`--completeness`) that fails whenever a hook, token, or agent file exists in the source but is neither approved nor listed under `ignore`. The contract is approved, never copied from discovery: discovery only sees the current source, so a deleted hop disappears from discovery too, and only the approved list can catch the deletion. To prove the probe bites, run it with `--hooks <fixture copy>` where one entry has been removed and watch `passed:false` / `hook-entry-missing` — the live hooks.json is never edited. If the `arch-explorer:build` skill is installed, Step 2a also generates a clickable architecture map at `.crabshell/verification/architecture/index.html`; it is documentation and a coverage hint for approving hops, never parsed and never a pass/fail input, and its state (`generated`, `unavailable`, `generation-failed`) is only recorded.

As of v21.116.0 the skill also decides *what* to assert, so verifiers survive releases instead of needing an edit each time (D114/I086):

- **Match the method to the claim.** "Running this produces that" must be executed and observed. "This artifact has this structure or wiring" is read and parsed. A static check standing in for a behavioral claim is the common defect — grepping for `process.exit(0)` does not verify fail-open, injecting a malformed input and watching the exit code does.
- **Never write down a value the next release will change.** Compare a version against the authoritative source rather than a literal; assert `discovered > 0` and `failures == 0` instead of a test count; assert required shape instead of full printed text; assert a relation across two runs instead of one input/output pair. Exact literals stay correct where the spelling itself is the contract — protocol event names, JSON property names, CLI flags.
- **A failing entry means the code is wrong until shown otherwise.** Run mode classifies first: unchanged contract → fix the code; deliberately changed contract → edit the verifier and state that in the report; incidental copied output → rewrite the assertion as structure or relation. Silently re-recording current output is not verification.

These rules are automatically injected into CLAUDE.md and reinforced every prompt.

---

## Hooks

The plugin uses Claude Code hooks to run automatically:

| Hook | Script | When It Runs | What It Does |
|------|--------|-------------|-------------|
| `UserPromptSubmit` | `inject-rules.js` | Every prompt | Emits the compact shared turn contract (11-line Rules Quick-Check, including "Is this your best?" and the no-hardcoding line since v21.153.0, "Is it simple and clear?" asked with it before every answer since v21.157.0, and the parallel-work line since v21.158.0); Claude-host `## Codex Delegation` guidance on execution turns only; `봉인해제` / `UNLEASH` immediately resets pressure counters; execution prompts run once-per-session cleanup/reset and Claude rule/memory-warning synchronization. Since v21.154.0 the fixed block is added once per turn (Claude `prompt_id`, Codex `turn_id`): a message that arrives mid-turn gets only the changing notices, and text the user did not write (another session's message, task reports, pasted text next to the user's own words) is not read as an instruction. Since v21.156.0 the memory notices (pending save, archive summaries) go on the turn's first prompt only, whatever `rulesInjectionFrequency` is: answer first on non-execution turns, before other work on execution turns and after a skipped save. Three-field response ending and pressure texts retired v21.113.0 (I083) |
| `SessionStart` | `load-memory.js` | Session begins (also after compaction) | Loads logbook, summaries, canonical project memory, and active workflow; legacy-only descriptions are copied without overwriting existing data. After compaction (`source: "compact"`) it clears this session's skill flag (Claude Code re-attaches only the first 5,000 tokens of each invoked skill) and logs the compaction — Claude has no PreCompact/PostCompact hooks since v21.125.0 because their output reaches no model. Since v21.153.0 it also keeps a project's runner copy current: changed `runner/` modules are copied, a launcher Crabshell released is replaced, and a launcher the user edited is kept and named once (Codex SessionStart does the same). Since v21.155.0 Claude SessionStart also rewrites the managed rules block of an existing CLAUDE.md when it differs from the installed rules |
| `PreToolUse` | `adapters/claude/pre-tool-use.js` | Before every tool except Read, Grep and Glob (since v21.153.0) | One process runs every guard in order, each loaded in its own try/catch (a failing guard is skipped; the check runner is `core/dispatch.js`, shared with Codex). Guards are routed by the call's shape — a shell call or a file write — whatever the tool is named (v21.153.0): rerun guard (a declared check run by hand on the files it last passed with is answered from its record; `CRABSHELL_RERUN=1` runs it anyway), completion-controller check preparation, path-guard, web-guard, regressing-guard, docs-guard, log-guard, verification gate (records declared check starts; it no longer blocks `git commit`), the before-run look for declaration hints (since v21.158.0 also: a declared check run by hand is told once to run through the runner so its pass is kept), a commit reminder (v21.158.0: one notice when a `git commit` follows changes the checks have not passed on; never blocks), doc-watchdog notice. A check that records a start stands down after a deny. verify-guard is no longer wired (v21.153.0). Denies with exit 0 + `permissionDecision: "deny"` listing every reason (v21.125.0) |
| `PostToolUse` | `adapters/claude/post-tool-use.js` | After every tool use | One process: counter (auto-save + delta extraction at interval), verification record, completion-controller evidence (shell calls and file writes), declaration hints after a hand-run check (`inputs`, `slow`, `outputs`; an undeclared long command run twice on the same files — v21.153.0), doc-watchdog edit count (file writes), skill flag (Skill, set before the next tool call), and a notice when a read reaches another project's `.crabshell` (v21.125.0) |
| `PostToolUseFailure` | `adapters/claude/post-tool-use.js` | After a failed call of every tool except Read, Grep and Glob | Verification record + completion-controller for shell calls: records failure/interruption and invalidates prior success; Stop remains the blocking boundary |
| `Stop`, `SubagentStop` | `completion-controller.js` | Child/parent completion boundary | One state owner: child claim is not proof; requires parent evidence, bounds identical failures, preserves workflow continuation, and runs the retained doc-watchdog Stop check in the same process (sycophancy/scope/pressure guards unwired v21.113.0). Since v21.154.0 a question or reprimand from the user after the request ends the turn without a continue demand; the authorization stays |
| `SubagentStart` | `subagent-context.js` | When subagent spawns | Injects project concept, COMPRESSED_CHECKLIST, regressing state, and project root anchor into subagent context |
| `SessionEnd` | `counter.js final` | Execution-authorized session ends | Creates final L1 backup and extracts remaining delta; question-only sessions remain read-only |

Hook launchers invoke Node directly; `scripts/find-node.sh` is a fallback utility. Since v21.125.0 one tool call starts at most two Claude hook processes (Edit 10 → 2, Bash 6 → 2, Read 3 → 1); each guard script still runs alone for tests. While the dispatchers run their checks, anything a module prints goes to stderr, so the host always reads one JSON object. PreToolUse Bash also tells the controller which check started, so late results cannot replace a newer invocation.

### Codex Hook Surface

| Hook | Script | When It Runs | What It Does |
|------|--------|-------------|-------------|
| `SessionStart` | `adapters/codex/session-start.js` | Session begins | Shared memory and workflow recovery, including preserving legacy-description copy when needed |
| `UserPromptSubmit` | `adapters/codex/user-prompt-submit.js` | Every prompt | Shared compact turn contract without the Claude-only Codex delegation block; execution lifecycle writes to Codex plugin data/project state |
| `PreToolUse` | `adapters/codex/pre-tool-use.js` | Matching local file/shell tools | Applies shared memory path policy, records check starts and blocks commit without a current passing check; the same commit reminder and declaration hints as Claude (v21.158.0) |
| `PostToolUse` | `adapters/codex/post-tool-use.js` | After Bash, Write, or Edit | Normalizes commands; binds output-only hooks to explicit native transcript exit codes; updates parent and commit evidence with shared content identity |
| `PreCompact` | `adapters/codex/pre-compact.js` | Before compaction | Emits shared memory/workflow recovery context without writes |
| `PostCompact` | `adapters/codex/post-compact.js` | After compaction | Restores shared context and runs the shared post-compaction effects (`core/post-compact-effects.js`: pressure notice re-injection reset, compaction log); Claude runs the same effects at SessionStart `compact` |
| `SubagentStart` | `adapters/codex/subagent-start.js` | Child starts | Supplies exact current intent, task, non-goals, references, allowed changes, and observable success |
| `SubagentStop` | `adapters/codex/stop.js` | Child stops | Records the child result as a claim, never as completion proof |
| `Stop` | `adapters/codex/stop.js` | Parent attempts completion | Applies the shared parent-evidence and bounded-continuation decision using Codex-native block JSON |
| `Interrupt` | `adapters/codex/stop.js` | User interrupts an active turn | Saves paused work and invalidates success; records only, without blocking the interruption |

Codex reads `hooks/codex-hooks.json` through the explicit `.codex-plugin/plugin.json` `hooks` field. That prevents accidental discovery of Claude's `hooks/hooks.json`. Its events are synchronous and native; every launcher catches adapter-load and rejected-`main()` failures so infrastructure errors exit 0 without interrupting the triggering tool call. Shared semantics live in host-neutral cores, while Claude-specific SessionEnd capture stays in Claude. Retired fixed-count, role-collapse, and behavior-verifier hooks are absent from both manifests.

### Internal Task Contract and Shared Response Ending

Both native `UserPromptSubmit` paths use the shared compact contract from `scripts/core/first-turn-context.js` and the Rules Quick-Check from `scripts/shared-context.js`. The mandatory three-field ending introduced in v21.108.0 was retired in v21.113.0. The internal eight-field task contract and evidence-backed execution remain active; the response closes with clear per-item work state and next action rather than fixed labels.

The main report follows the v21.115.0 slot contract: `[conclusion] → [evidence] → [critical exception] → [next action]`, first sentence being the direct answer. Decisive observations and remaining gaps stay; the intro, work-process narration, repeated conclusions, and ceremonial closings go. The per-criterion verification record lives in the D/P/T/I/H document and the chat carries `"M of N passed"` plus failures.

As of v21.106.0, the dormant behavior-verifier script, prompt, state consumer, fixed WA-count hook, and role-collapse parent-write gate are removed. Existing `behavior-verifier-state.json`, `verifier.lock`, and `wa-count.json` files are not deleted; current code ignores them. The old designs remain documented in release history only.

These defaults are not user-facing configuration knobs. They are centralized in `scripts/shared-context.js`, while `scripts/core/orchestration-policy.js` exposes deterministic helpers for the task contract, question boundary, named-reference resolution, and completion evidence.

**Related:** [Hooks](#hooks), [Configuration](#configuration), and [Pressure System](#pressure-system).

---

## Guards

Guards run inside the Claude PreToolUse, PostToolUse and Stop hooks (one process per event since v21.125.0) and prevent common mistakes:

| Guard | What It Protects Against |
|-------|------------------------|
| `docs-guard.js` | Writes to `.crabshell/` document folders without this session's document skill loaded (invoke the matching skill — for an existing document, in update mode with its ID); the flag clears at compaction and session end. A new discussion ticket also needs the discussion's Plan and its own Implementation Details (v21.135.0), and a filled `**Reader Structure:**` line: what a person will do and every visible text, or `none: <reason>` (v21.144.0), and the five design lines **Values:**, **Structure:**, **Start state:**, **User burden:**, **Design review:** (`none: <reason>` counts; v21.153.0; Codex: the `codex-docs.js` ticket command checks the same). The guard sees only that the lines are filled in; the user judges it when confirming the plan |
| `log-guard.js` | Marking a ticket done in INDEX.md while its Execution Results is still template text, or verified while any result section is — Intent Fidelity included since v21.135.0, Reader Check since v21.144.0 (other documents are not checked) |
| `verify-guard.js` | Not wired since v21.153.0: writing a ticket's Final Verification no longer runs checks (it re-ran the same check the work had just run). The file stays for tests and audits |
| `path-guard.js` | Bash commands that write into another project's `.crabshell` (redirects, rm/mv/mkdir/tee, cp/rsync/ln destinations, sed -i, find -delete, xargs rm, tar/curl/dd, powershell/cmd, code that writes). Reading another project's `.crabshell` is allowed with a notice; prose, grep patterns, heredoc text, temp folders and unknown variables are never blocked (v21.125.0). Also: Edit or shrinking Write on `logbook.md`, direct skill-flag writes. Not covered: Write/Edit tool calls into another project, values from earlier commands |
| `web-guard.js` | Built-in WebFetch/WebSearch small-model summarization (Anthropic docs: "lossy by design"; hallucinated citations in research). WebFetch is blocked with ready-to-run raw-fetch commands for the same URL; WebSearch is redirected to the search MCPs this project can use (user-wide, this project's `~/.claude.json` entry, or `.mcp.json`; provider names such as exa/tavily/brave must be a whole word of the server name, v21.125.0). Since v21.165.0 the message names every one found, exa first and then tavily by default, and says to move to the next when one is unavailable, rate-limited or finds too little; instructions that rank them differently win. Since v21.166.0 WebSearch runs as the last resort once the current turn has called every configured search MCP. With no search MCP, WebSearch is allowed with a "snippets are pointers, fetch before citing" warning, so machines without one never lose search entirely. Modes: `block` (default) / `warn` / `off` via `webGuard` in config.json (v21.114.0) |
| `core/path-policy.js` + Codex adapter | The same wrong-project memory paths in Codex; the core decides policy while each host wrapper emits its own native response format |
| `core/completion-control.js` + host adapters | Child false-done, undeclared/inconclusive checks, repeated identical failures, stale content evidence, and premature active-workflow completion. One result event reuses one content fingerprint |
| `verification-sequence.js` | Edits to code/configuration before git commit without a passing declared check (any session's edit counts; prose, stylesheet and image edits do not); unchanged content preserves existing verification; a project with no check configuration gets advice instead of a block |
| `doc-watchdog.js` | Document update omissions during regressing (edits inside the project only; any non-prose file counts as code, v21.125.0): soft notice when 5+ code edits without D/P/T document update; at Stop, in this session's execution turn only, names the unfinished workflow tickets (status from the ticket INDEX) that were not updated after this session's last code edit — tickets this session wrote first; the edit record is per session, so another session's edits or workflow never trigger it (v21.154.0) |
| `skill-tracker.js` | Supporting guard: sets the calling session's skill flag when a Skill tool call is detected, so `docs-guard` knows that session's document writes are authorized; another session's flag never counts |
| `regressing-guard.js` | Phase-based write restrictions during active regressing sessions — blocks out-of-phase edits to plan/ticket documents |
| `sycophancy-guard.js` | Agreeing with the person without checking anything ("맞아요", "you're right"). Restored v21.166.0 (deleted v21.130.0): at Stop, an answer that agrees while no tool ran in the current turn is sent back once to check the claim and keep or change the position on evidence; at PreToolUse, a file write right after such agreement is blocked. A phrase in code or quotes, agreement after a check in the turn, and the answer after a block pass. Claude only. |
| (deleted v21.130.0) | `pressure-guard.js`, `scope-guard.js` (retired v21.113.0) and `regressing-loop-guard.js` were removed with their tests; `completion-controller.js` is the sole Stop owner and regressing continuation is goal-driven (v21.110.0) |

Guards run automatically via hooks. No configuration needed.
For Codex, shared path policy, completion control and the edit/commit verification state have native adapters. The document guards remain Claude-only.

---

## Pressure System

> **Status v21.113.0 (I083 R4): telemetry-only.** Model-visible pressure messages (L1/L2/L3 texts) and tool blocking (`pressure-guard.js`) are retired — surfacing pressure gauges to the model causes context-anxiety-type degradation per current model guidance. The counters below are still tracked in `memory-index.json` for the user's own diagnosis (`/status`), and `봉인해제` / `UNLEASH` still resets them. The description below documents the counters; enforcement paragraphs are historical.

Crabshell tracks three pressure counters (feedbackPressure.level, feedbackPressure.oscillationCount, tooGoodSkepticism.retryCount) in `.crabshell/memory/memory-index.json`. Together they form a graduated response mechanism that restricts tool access when Claude drifts — either via consecutive negative user feedback or via the assistant's own output patterns (reversals, all-None P/O/G).

Pressure is telemetry only on both hosts (the enforcement script `pressure-guard.js` was deleted in v21.130.0; the sycophancy guard restored in v21.166.0 does not read pressure); both hosts use the shared UserPromptSubmit path, so `봉인해제` / `UNLEASH` clears the shared pressure state from either host.

### Three Counters

| Counter | Raised By | Trigger | Reset By |
|---------|-----------|---------|----------|
| feedbackPressure.level (0-3) | inject-rules.js @ UserPromptSubmit | User message matches NEGATIVE_PATTERNS (W021: profanity-only) | Positive-feedback decay (3 clean prompts) · `봉인해제` / `UNLEASH` · TaskCreate tool (L1-L2 only) |
| feedbackPressure.oscillationCount | (no longer updated — its producer, the old sycophancy-guard.js, was deleted v21.130.0; the v21.166.0 guard does not update it) | Assistant response contains REVERSAL_PATTERNS (e.g., "actually, let me", "다시 생각해보니") — **no user input required** | `봉인해제` / `UNLEASH` |
| tooGoodSkepticism.retryCount | (no longer updated — its producer, the old sycophancy-guard.js, was deleted v21.130.0; the v21.166.0 guard does not update it) | Assistant response contains a P/O/G table where all Gap cells are None/없음/N/A — **no user input required** | Clean P/O/G (Gap ≠ None) in a later Stop · retryCount > 3 overflow · `봉인해제` / `UNLEASH` (originally BAILOUT, renamed v21.79.0) |

**Note:** Two of the three counters (oscillationCount, tooGoodSkepticism.retryCount) rise from the assistant's own output independent of the user. Use `/crabshell:status` to inspect current values.

### Pressure Levels (feedbackPressure.level)

| Level | Name | Trigger | Effect |
|-------|------|---------|--------|
| **L0** | Normal | Default state | All tools available |
| **L1** | Warning | 1 consecutive negative feedback | Warning text injected into context; all tools still available |
| **L2** | Partial Block | 2 consecutive negative feedbacks | 6 primary tools blocked (Read, Grep, Glob, Bash, Write, Edit); conversation-only tools remain |
| **L3** | Full Lockdown | 3+ consecutive negative feedbacks | ALL tools blocked; structured self-diagnosis required (What I did wrong / Why it was wrong / What I will do differently); must resolve through conversation only |

### How It Works

- **Detection:** The `inject-rules.js` hook (UserPromptSubmit) analyzes user prompts for negative feedback signals and updates `feedbackPressure.level` in `memory-index.json`. The `sycophancy-guard.js` hook (Stop) independently analyzes assistant output and updates `feedbackPressure.oscillationCount` and `tooGoodSkepticism.retryCount`.
- **Enforcement:** none since v21.113.0 (the `pressure-guard.js` hook that blocked tools was retired then and deleted in v21.130.0).
- **Decay:** Positive feedback from the user reduces `feedbackPressure.level` naturally. The assistant-side counters decay only on their own reset paths (see table above).
- **Exception:** Operations targeting `.crabshell/` or `.claude/` paths are always allowed, even at L3 (so the plugin can still manage its own state).

### Bailout

If tool access is locked at L2 or L3, the user can type one of these keywords to reset the pressure system:

- **`봉인해제`** (Korean)
- **`UNLEASH`** (English; renamed from `BAILOUT` in v21.79.0 / W021)

Either keyword resets the pressure counters (feedbackPressure.level, consecutiveCount, decayCounter, oscillationCount, and tooGoodSkepticism.retryCount) to zero. The reset runs before question/execution intent gating, so the bare keyword and a keyword embedded in a question both work. On reset, stderr logs `[PRESSURE BAILOUT: reset all 3 counters]` (internal label retained for backward log-compatibility).

This is the **only** way to immediately escape L2/L3 without waiting for natural decay. When you're stuck at L2/L3, Claude will inform you about these keywords.

**Note:** As of v21.77.0, the bailout keyword (then `BAILOUT`, since renamed `UNLEASH` in v21.79.0) also resets `tooGoodSkepticism.retryCount` (previously only `feedbackPressure.*` was reset).

---

## CLAUDE.md Integration

The plugin automatically manages a rules section in your project's `CLAUDE.md`:

```markdown
## CRITICAL RULES (Core Principles Alignment)
...plugin-managed rules (PRINCIPLES, INTERNAL TASK CONTRACT, VERIFICATION, WORKING RULES, ADDITIONAL RULES)...
---Add your project-specific rules below this line---

- Your project rule 1
- Your project rule 2
```

- **Above the line**: Auto-managed by the plugin. Compared with the installed rules at every session start and on every work request, and rewritten when it differs (v21.155.0; session start replaces only an existing marked block and never creates the file). Claude Code reads CLAUDE.md when a session starts, so updated rules apply from the next session. Contains PRINCIPLES, INTERNAL TASK CONTRACT, VERIFICATION, WORKING RULES and ADDITIONAL RULES. In the plugin's own source checkout an installed copy at another path does not rewrite it.
- **Below the line**: Your project-specific content. The plugin never modifies anything below this marker.
- **Orchestration defaults**: the auto-managed rules and compressed checklist carry the same internal task contract, parallel work for independent parts (since v21.158.0), and parent-owned verification defaults. There is no separate always-loaded agent-count rules file in this repository.

### Dual Injection

The plugin uses two injection mechanisms:
1. **CLAUDE.md sync**: Full rules written to the file on disk (persists across sessions, visible to you)
2. **COMPRESSED_CHECKLIST**: A condensed reminder injected into Claude's context every prompt via the `UserPromptSubmit` hook (not written to disk; about 75% shorter than the full rules)

---

## Configuration

`.crabshell/memory/config.json` (per-project) or `~/.crabshell/config.json` (global):

```json
{
  "saveInterval": 15,
  "keepRaw": false,
  "rulesInjectionFrequency": 1,
  "memoryRotation": {
    "thresholdTokens": 25000,
    "carryoverTokens": 2500
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `saveInterval` | 15 | Tool uses before auto-save triggers |
| `keepRaw` | false | Keep `.raw.jsonl` files after L1 conversion |
| `rulesInjectionFrequency` | 1 | Inject rules every N prompts (1 = every prompt) |
| `deltaMinBytes` | 20480 | Queued session input (bytes) before the memory-save notice appears; read from the per-project file (v21.156.0, was fixed) |
| `memoryRotation.thresholdTokens` | 25000 | Token threshold for logbook.md rotation (with 0.95 safety margin) |
| `memoryRotation.carryoverTokens` | 2500 | Tokens to keep as carryover after rotation (with 0.95 safety margin) |
| `webGuard` | "block" | Web guard mode: `block` (WebFetch blocked, WebSearch blocked only when a search MCP is configured), `warn` (never blocks, injects verification warnings), `off` (guard disabled) (v21.114.0) |

### Orchestration Defaults

The eight-field task contract, risk boundary for user questions, bounded worker prompt, and parent-owned completion rule are product defaults rather than per-project settings. They are centralized in `scripts/shared-context.js` and `scripts/core/orchestration-policy.js`; changing memory configuration does not weaken them. The live regression corpus can be run with `node scripts/run-orchestration-corpus.js --live --json` in a disposable fixture.

### Declaring verification commands

Parent evidence recognizes only commands the manifest declares (`.crabshell/verification/manifest.json`: `tools` or non-manual `entries`, discovered ones included); since v21.153.0 package.json is not read, so a project whose check was its package.json `test` declares that command in `tools` (the verifying skill moves a project's own check commands — package.json scripts, Makefile targets, CI steps, any language — into the manifest). A single invocation must match; compound shell commands and printed command names are not check identity. A check also counts with one `cd <dir> &&` before it (the folder where it is declared), environment assignments before it (`X=1 cmd`, PowerShell `$env:X = 1; cmd`), output redirection after it (`> file`, `>> file`, `2>&1`, `&> file`), or a program the manifest lists in `wrappers` before it (this repository: `["rtk"]`); pipes, `;` and `||` stay unaccepted because the exit status would come from another command. Entry assertions also apply; forbidden-change assertions require the declared runner because a post-tool event cannot reconstruct their before-state.

Since v21.153.0 nothing blocks a commit and nothing reruns a check that already passed on the same files: a passing declared command is recorded as completion evidence, and running a declared check by hand on the files it last passed with is answered from its record (`CRABSHELL_RERUN=1` before the command runs it anyway). Run `node .crabshell/verification/run-verify.js --changed` once after the last edit and read its full JSON from `last-run.json`; a release runs `node .crabshell/verification/run-verify.js --changed --slow` once after its last edit, version files included (passes on unchanged inputs are kept; heavy checks whose inputs changed are included), and every check runs only when the user asks (v21.158.0; it used to be `--no-reuse`, which threw every pass away). While editing, run only the test being written, by name through the runner (`run-verify.js <id> <id> …`), so its pass is kept; a declared check run by hand gets one hint saying so, and a `git commit` with files changed since the checks last passed gets one reminder to run `--changed` (v21.158.0; neither blocks). Each run says how many check runs there were since the last commit. After a declared check run by hand, Crabshell hints once each when the entry needs `inputs` (a non-Node program with unknown inputs), `slow` (longer than `slowAfterSeconds`) or `outputs` (files it wrote in two runs in a row); an undeclared command longer than `suggestAfterSeconds` (default 15) that runs twice on the same files gets one hint to declare it.

The runner chooses by content, not by Git (v21.153.0): a check runs again only when its fingerprint — the entry fields that decide the run (`type`, `command`, `contract`, `timeout`), the program it runs, the runner's decision code (comment lines excluded), the platform, and the content of its inputs — is not among the ones it passed with (`passHistory`, default 10). Inputs are traced for Node checks (files and folders read, required, listed or copied), declared with `inputs` for other programs, or unknown (the whole project, for that check only). So `--changed` runs new checks, checks that failed last time, `always: true` and `reuse: false` entries and checks whose inputs changed; a changed file that no check reads or declares runs the declared-input checks once. A record of another schema counts as none, so every check runs once after an update that changes the schema (v21.153.0, and v21.159.0 with schema 4); a later change to the runner's decision code is named "runner decision code changed". Since v21.159.0 the decision code is only `contract.js`, `execute.js` and the tracer source (`TRACER_SOURCE` in `trace.js`): other runner updates keep recorded passes, and the schema is raised by hand when the runner starts recording more of what a check reads. Crabshell's storage (`.crabshell/` outside the verification folder), `exclude` paths and entry `outputs` are not inputs; a check that reads such a file still has it as an input, and the runner names a check that reads Crabshell's state ("give it a temporary project"). In a git work tree the walk skips the folders git ignores (the list is kept beside the records and refreshed when a rule file changes or a new folder appears); a check with unknown inputs therefore does not see changes to git-ignored files — declare them in `inputs`. Order: the check that failed last time, then new checks, then the quickest; the run stops at a new failure (the rest run next time). A check that fails on inputs it passed with runs again up to `retries` (default 1) and is named `Flaky:`; `jobs`, `memoryShare`, `exclusive` and `group` run checks side by side. `slow` checks (and any whose median pass time exceeds `slowAfterSeconds`, default 300) wait for `--slow`, a full run or the release. `--explain` prints each check `--changed` would run with its first reason; `--dry-run` prints the selection as JSON. A failed check keeps its prior dependency record and its pass history, gets `lastFailedAt` and `failKey`, and stays selected (`failed in the last run`) until an executed pass clears it; stderr names the unresolved failures.

A selected check reuses its PASS when its fingerprint is in its pass history; a pass is not recorded when one of its inputs was written while checks ran. Failed or timed-out checks, manual entries, `always: true`, `reuse: false` and explicit IDs never reuse; `--no-reuse` forces execution of the selection. For external tools or untracked inputs, disable reuse on that entry; discovery entries can instead list exact repo-relative files in `reuseExclude`.

Checks run side by side by default since v21.158.0: half of what the machine can run in parallel (`jobs` overrides), started one at a time `startSpacingMs` apart (default 250) and only while `minFreeMemoryMB` is free (default 2048; `memoryShare` also applies when set). Without a declared `jobs`, a check that its last run did not trace as running on the runner's Node runs alone, so checks in other languages stay one at a time until their entries set `"exclusive": false` (a `group` only keeps its members from overlapping). A changed test that ran and holds quoted prose from its own inputs word for word (at least `copyLiteralMinChars` characters, default 40; commands, code and paths are spellings, not prose, and are not counted) is named in the run's notices: rewording that text in the product would break the test, so read the expected text from the source or check the behavior instead.

Also since v21.158.0: a changed file under the manifest's `riskPaths` (files, folders or globs; none by default) brings the heavy checks whose own inputs changed into a routine `--changed` run. A check that failed and then passed on the same inputs is quarantined from routine runs and named in the summary until its test file changes (named, `--slow` and full runs still include it; a check whose last run failed is never left out). A failure whose only reason is a `contract.forbiddenChanges` path runs once more: if the second run writes none of those paths, it passes with a notice that another process wrote the file. A folder a check only listed or probed is an input by its names (adding or removing a file reruns the check, editing one does not); a folder it copied or listed recursively stands for every file in it. `changed.global` adds files to every check's inputs, so list only files the tracer cannot see (this repository no longer lists `scripts/constants.js` and `scripts/utils.js`). `node .crabshell/verification/run-verify.js --replay N` estimates from the records what routine runs would have cost on each of the last N commits, running nothing.

Since v21.159.0 a check can report what it used, so it reruns only when that changed, not when any file it read changed (a program that loads all its data at start otherwise reruns for every data edit). The runner sets `CRABSHELL_USED_REPORT` to the path of the check's report file; child processes inherit it, and a program in any language appends TAB-separated lines: `file<TAB>path` (the whole file; a path ending in `/` or naming a folder means its list of names), `item<TAB>path<TAB>item<TAB>fingerprint` (one item of a file; an empty fingerprint means looked up, not there), `result<TAB>case<TAB>pass|fail` (one per case), optional `begin<TAB>writer` when several processes write, and `done` as the last line (each writer name needs as many `done` lines as `begin` lines). Paths are relative to the project root or absolute inside it and must exist (a missing file is reported through its folder); inside a field `%`, TAB, CR and LF are written `%25`, `%09`, `%0D`, `%0A`; the check writes the report fresh on every run. A report that is empty or holds only `begin`/`done`, does not end with `done`, has a bad escape or NUL, or names a path outside the project or one that does not exist is broken; a broken report or none means the check is chosen as before, and the record keeps the reason as `reportProblem`. Only a passing run's report narrows the next choice (record kind `reported`); a failing run never removes an input or a case. Manifest fields (shapes in the verifying skill's `references/manifest-entries.md`, design in `references/select-by-use.md`):
- `reportScope` (entry): files, folders or globs inside which the report decides what the check used. Default: the entry's `inputs`; an empty scope means the report is ignored; files the check reads outside it stay inputs. An entry with no `inputs` needs it for its report to narrow anything.
- `itemIdentity` (top level, `{ "file": "<program>", "args": [...], "timeout": 30 }`): a project command run from the project root with the files appended as relative paths; it prints `item<TAB>path<TAB>item<TAB>fingerprint` for every item and `rest<TAB>path<TAB>fingerprint` for the rest of each file, with the same fingerprint function as the reports. Without it, or on a non-zero exit, a file with any used item counts as used whole. Hooks never run it.
- `"gate": true` (entry): the check that runs the program's start-up validation. A check narrowed by its report is reused only while the gate has passed on the current files; when the gate fails those checks are NOT_RUN; a run that does not include the gate runs the waiting checks themselves.
- `{cases}` (an argument in `command.args` that is exactly `{cases}`, not a field): replaced with the case names to run again, or dropped for a whole run; each case keeps its own files and result, the case list comes from the last report, and when the test file changes every case runs.

Also since v21.159.0, a traced check that starts a program the tracer cannot follow but declares `inputs` is recorded as declared (its traced reads plus its declared inputs).

Since v21.163.0 the verifying skill's `references/check-cost.md` covers a run that is long even though it runs only the touched checks: sort the checks by their recorded `durations`, then start the program once for many cases (`{cases}`), wait for events instead of the clock, let checks that share nothing run side by side (`"exclusive": false`; checks sharing a file, port or database share a `group`), and mark work that is heavy by nature `slow`.

Since v21.164.0 `--explain` and `--dry-run` estimate the run's own length (`estimatedWallSeconds`): checks that may share run side by side up to the number the run starts at once on this machine, the others one after another; `estimatedSeconds` stays the sum of check times. The verifying skill's select-by-use section ⑩ asks for one measurement per kind of change, the user's own example included, and a report that names the kinds not measured ("partial") until every kind is measured.

If one check also runs another check's test, the child may declare `"coveredBy": "<id>"`; discovery entries use `"coveredBy": { "<file>": "<id>" }`. A covered child must have no `contract.assertions`, and every exact `contract.forbiddenChanges` path must also be in the covering check's list; violations name both IDs. A child with no record, missing `files` or empty `files` executes to establish its own inputs. Otherwise, when both are selected, the covering check runs first. Its executed or reused PASS skips the duplicate command and records the child as PASS with `coveredBy`, zero duration and no pass fingerprint of its own. For `reuse: false`, `reuseExclude` or `always: true`, the covering check must actually execute and pass in this run; a reused PASS makes the child execute. Failure or timeout also forces the child's own execution. Explicit IDs, changed tests with fail-before enabled, and `--no-reuse` disable coverage. Unknown targets and cycles are errors; a merely covered result cannot cover another check. Results retain manifest order.

Discovery entries can use `"fileAssertions": { "<file>": [assertion, ...] }` to append assertions to just that file's shared contract. Keys accept either slash style and must match discovered files after exclusions and explicit-entry precedence. `{"kind": "stdoutMatches", "pattern": "named observation", "flags": "i"}` checks stdout with a regular expression; flags are optional. Missing observations fail with `stdout: expected /<pattern>/`. Unknown file keys and invalid regexes stop the run before any command. Here V059 carries the cross-runtime tests' observations individually; `scripts/verify-cross-runtime.js` reads that same list for manual sequential runs, with fail-open last.

Default output is a one-line verdict showing passed checks, executed and reused counts, `N covered by <id>` (or `N covered by other checks`), manual checks awaiting a person, and elapsed seconds, followed by failure details and the existing `Verification Results` totals. Covered checks are not counted as executed; zero count parts are omitted. Empty selection prints `No checks selected — nothing changed that a check reads.` and exits 0. A person's nonempty run writes full results to a temporary file beside the runner and renames it to `last-run.json`; the final line reports `Full results: <path>` on success, otherwise `Full results: not saved (<error>)`. Internal calls using `CRABSHELL_VERIFY_JSON=1` or `--no-fail-before`, and empty runs, preserve the previous file and print no `Full results:` line. `--json` still saves a person's nonempty run. Both JSON modes print the current array; `--no-fail-before` retains that output for older guards.

A reused PASS is earlier evidence for unchanged inputs, not a fresh execution; a covered PASS cites the covering check's evidence. Each result has actual `durationMs`; the map retains `lastDurationMs` through reuse and coverage. An `ETIMEDOUT` result has `timedOut: true` and keeps the previous estimate duration, or leaves it absent when none exists. Failed, timed-out and covered checks never add a pass fingerprint. `--dry-run` prints selection JSON with per-check `reasons`, `wouldReuse`, `wouldCover`, `estimatedSeconds` (the sum of known durations) and `estimatedWallSeconds` (the run's own length, with the checks that may share run side by side up to the run's limit on this machine); unknown durations contribute zero. In `--changed` mode with fail-before enabled, `failBeforeTargets` counts selected changed tests whose recorded inputs cover changed non-test files, excluding matching hash exemptions. Each adds twice its duration when the test exists in HEAD (baseline and attempt), once when new to HEAD; Git lookup errors assume twice. Full mode and `--no-fail-before` report zero targets and add no comparison time. Coverage estimates assume the covering check passes and omit the covered child's duration.

Fail-before is opt-in since v21.153.0 (`--fail-before`; it used to run by default and re-ran changed tests twice more). It checks whether a changed test catches the change: if it passes and reads a changed non-test file, it also runs on a temporary copy of HEAD and must fail there. Passing there produces a failing `FAIL_BEFORE:<id>` result, records no pass for that check and marks it for retry. An intentional behavior-preserving change can be exempted in `.crabshell/verification/fail-before-exempt.json` as `{ "<test file>": { "sha256": "…", "reason": "…" } }`, valid only for that test content. The failure message prints the entry to record. See the verifying skill for details and selection blind spots.

A manifest that has its runner (`.crabshell/verification/run-verify.js`) counts `node .crabshell/verification/run-verify.js` and `node .crabshell/verification/run-verify.js --changed` as declared checks even without `tools` (v21.135.0, v21.139.0). A check started in the background never counts: no hook reports its end (v21.140.0).

Claude's captured successful `PostToolUse` Bash object has no exit-code field. An explicit code overrides success inference; failure, interruption, and running indicators prevent it. Claude failures arrive as a top-level `error` plus `is_interrupt`. The captured Codex CLI PostToolUse contains only output text: `host-tool-result.js` obtains an explicit `exit_code` from the matching completed command in its transcript. Session, turn, command ID and cwd must agree; missing or conflicting evidence stays unconfirmed. Captures and provenance are under `scripts/fixtures/hook-payloads/native/`.

Project content identity (completion evidence) is the runner's own view since v21.153.0: the same snapshot and exclusion rule as the runner (Crabshell's storage outside the verification folder, `exclude`, entry `outputs`, and — in a git work tree — git-ignored folders are left out), content hashes reused from a cache while a file's size and times are unchanged. Evidence recorded without a known identity is no evidence; a blocking check without the runner's judgment (its modules unavailable) does not block.

### Hook Input Capture and Recovery

Available since v21.123.0. Set
`CRABSHELL_HOOK_CAPTURE_DIR=.crabshell/hook-captures` when reproducing a host payload
issue. Capture is off by default. It saves raw stdin and separate host/event/hash
metadata only inside the project's `.crabshell`; failures leave the hook running.
Captured input can contain command output or prompts. Keep it local and select only
the needed fixture before sharing. `HOOK_DATA` and timed-out input are labeled
separately from complete stdin. See [capture procedure](scripts/fixtures/hook-payloads/CAPTURE.md).

The existing completion state includes a bounded recovery record: initial/latest
request excerpts, last observed check and unfinished/paused status. SessionStart and
compaction read it without creating fresh task permission. An explicit stop or a
supported interrupt invalidates earlier success and prevents late results from
resuming work. A new explicit action can resume, followed by a fresh check. Missing
events after forced process termination cannot guarantee saving.

### Prepared Delta Finalization

Claude's `memory-delta` skill uses `append-memory.js --prepare-delta` before summary
generation. Its returned input stays fixed while later extraction uses a separate
queue; a large input comes back split into `parts` (at most 1,500 lines and 150,000
bytes each), one background summarizer per part. When they return,
one `--finalize-delta --job-id=... --summary-file=...` command then saves the summary,
advances only the captured input cutoff and cleans its own temporary files. Failed
or unavailable summarization leaves input pending. Do not manually delete the new
queue or run legacy cleanup on an active prepared job. Codex gets a pending notice
because the automatic summarizer skills are not bundled. Legacy explicit summary
append remains available when no prepared job exists. Retry protection covers a
completed append followed by a failed metadata write; arbitrary partial disk writes
or storage loss are not promised to be atomic.

### Codex Plugin Configuration

- `.agents/plugins/marketplace.json` is the repo-scoped native marketplace source.
- `.codex-plugin/plugin.json` explicitly points to `codex-skills/` and `hooks/codex-hooks.json`.
- Both `command` and `commandWindows` entries use the same Node Promise fail-open boundary; shell-independent `PLUGIN_ROOT` lookup, missing-module failure, and rejected adapters are covered by the Windows hook regression.
- Codex stores installed plugin material under its plugin cache and writable runtime data under `plugins/data/<plugin>-<marketplace>` inside `CODEX_HOME`; plugin source files are not used as writable state.
- Hook definitions are not runnable until Codex records trust for their current hash. Any definition change produces `modified` until reviewed again.
- Run `crabshell:status` for live Claude/Codex installed, activated, trusted, behavior-verified, degraded, drifted, and unsupported results. It uses current CLI/plugin/cache/hook observations, not a Crabshell-maintained version compatibility table; Codex app remains a separate row.

### lock-contention.json — F-4 Instrumentation State

`.crabshell/memory/lock-contention.json`. Per-lock object (keyed by lock filename), fields: `acquireCount`, `releaseCount`, `skipCount` (v21.124.0: attempts that gave up), `contendedCount` (acquires that found another live holder), `totalWaitMs`, `totalHeldMs`, `maxWaitMs`, `maxHeldMs`, `lastAcquiredPid`, `lastUpdatedAt`; top-level `measurementWindowStart` ISO marker. F-4 lock contention measurement → F-3 ratification. Additive top-level keys safe (`_recordContention` reads `state[lockName]` only). **Related:** `### _recordContention`.

### _recordContention — Lock Hold/Wait Measurement

`scripts/utils.js` L145-181. Three call sites (D107 D4): `acquireIndexLock` success L190, failure L205, `releaseIndexLock` L221. Unprotected `writeJson` avoids recursive-lock deadlock (L139-141). Race: concurrent writes may drop increments → conservative undercount (real ≥ measured); cycle 7+ ratification factors margin. Fail-open. **Related:** `### lock-contention.json`.

---

## Setting Project Information

Set information you want Claude to know at the start of every session.

Both hosts use `.crabshell/project.md`. The supported `counter.js memory-set/get/list` commands use that same path. When only `.crabshell/memory/project.md` exists, the reader copies it to the root path while preserving the old file. If both exist, the root file wins; explicit replacement writes a `project.md.bak` backup first.

**Option 1: Ask Claude (Recommended)**
> "Save this to project.md: This is a Next.js 14 app with TypeScript and Prisma."

**Option 2: Edit files directly**
```bash
echo "Next.js 14 + TypeScript + Prisma" > .crabshell/project.md
```

---

## Obsidian Integration (Optional)

Crabshell supports using [Obsidian](https://obsidian.md) as a visual interface for your `.crabshell/` documents. This is entirely opt-in — no configuration required to use Crabshell without Obsidian.

### How to Enable

Open your project's `.crabshell/` folder as an Obsidian vault:

1. Open Obsidian → "Open folder as vault"
2. Select `[your-project]/.crabshell/`

All D/P/T/I/W documents will be visible and navigable with graph view and backlinks.

### What You Get

**YAML Frontmatter** — every new D/P/T/I/W document includes a 6-field header:

```yaml
---
id: D001
type: discussion
status: open
created: 2026-04-12
project: my-project
tags: [crabshell, discussion]
---
```

**Wikilinks** — tickets reference their parent plans, plans reference their discussion:

```markdown
## Context
Parent plan: [[P001]]
Discussion: [[D094]]
```

These wikilinks appear as edges in Obsidian's graph view, letting you see the full decision → plan → ticket chain visually.

### Retroactive Migration

To add frontmatter and wikilinks to existing documents, run:

```bash
node scripts/migrate-obsidian.js --project-dir=PATH [--dry-run] [--backup]
```

| Flag | Description |
|------|-------------|
| `--project-dir=PATH` | Path to the project root (the folder containing `.crabshell/`) |
| `--dry-run` | Preview changes without writing any files |
| `--backup` | Create `.bak` backups before modifying each file |

**Example:**

```bash
# Preview what would change
node scripts/migrate-obsidian.js --project-dir=/my/project --dry-run

# Run with backups
node scripts/migrate-obsidian.js --project-dir=/my/project --backup
```

The script processes all documents under `.crabshell/discussion/`, `.crabshell/plan/`, `.crabshell/ticket/`, `.crabshell/investigation/`, and `.crabshell/worklog/`. Documents that already have frontmatter are skipped.

---

## Troubleshooting

### Memory Not Loading
1. Check `.crabshell/memory/` folder exists
2. Check `logbook.md` file exists
3. Run `/crabshell:load-memory`

### Auto-save Not Triggering
1. Check the session's counter in `.crabshell/memory/session-state/<first 8 characters of session id>/counter.json` (legacy `counter.json` only for payloads without a session id)
2. Ask Claude: "Reset the memory counter"

### L1 Files Taking Too Much Space
Ask Claude: "Remove duplicate L1 files"

L1 files are deduplicated automatically when created, but manual cleanup may sometimes be needed.

### Rules Not Being Injected
1. Check that `CLAUDE.md` exists in your project root
2. Look for the `## CRITICAL RULES (Core Principles Alignment)` marker
3. Check `.crabshell/memory/logs/inject-debug.log` for errors

---

## Doc Debt

The following cycle 5 (D107) features were shipped in v21.88.0 but their dedicated USER-MANUAL.md sections are pending — explicit deferral per P149_T001 D1 directive (path b) to avoid cycle 7 scope creep and the v21.83.0 ARCHITECTURE.md backfill class bug (commit `de04944`). Cycle 8+ doc cycle to write the proper sections.

| # | Feature | Source | What it does | Section it belongs to | Status |
|---|---------|--------|--------------|-----------------------|--------|
| 1 | Response skeleton lineage | `scripts/inject-rules.js` / `scripts/core/first-turn-context.js` / release history | Former 5-field, 7-field, and caveman-style 3-field designs remain retired; v21.108.0 restores a concise three-field response ending from the shared host-neutral core. | [Internal Task Contract and Shared Response Ending](#internal-task-contract-and-shared-response-ending) | Restored in v21.108.0 without restoring the retired verifier or caveman presentation. |
| 2 | ~~`ANTI_PATTERNS_INLINE`~~ | ~~`scripts/inject-rules.js`~~ | **Removed in v21.91.0** (D108/I069). Per-turn inline injection of 9 PROHIBITED + 4 AVOID patterns (~1,701 B). Current coverage comes from the auto-managed rules, parent-owned verification, and active safety guards; the later verifier fallback was retired in v21.106.0. | N/A | Removed |
| 3 | `.crabshell/memory/lock-contention.json` | F-4 instrumentation state file (NEW) | Per-lock metrics file: `acquireCount`, `releaseCount`, `contendedCount`, `totalWaitMs`, `totalHeldMs`, `maxWaitMs`, `maxHeldMs`, `lastAcquiredPid`, `lastUpdatedAt`, plus top-level `measurementWindowStart` ISO marker (cycle 6). Powers F-3 path-choice ratification analysis. | Configuration §Memory Files | Done — section: `### lock-contention.json` (under `## Configuration`) |
| 4 | `_recordContention` (utils.js F-4 instrumentation) | `scripts/utils.js` (~47 lines, called from inside `acquireIndexLock` / `releaseIndexLock`) | Lock-contention measurement helper. Intentionally uses unprotected `writeJson` to avoid recursive lock acquisition (deadlock prevention) — accepts conservative undercount bias as a documented trade-off. | Hooks/Guards §Lock Contention Measurement | Done — section: `### _recordContention` (under `## Configuration`) |

This table is a historical documentation ledger. Current behavior is defined by the active source and sections linked above; retired verifier proposals are not implementation specifications.

---

## Version Compatibility

| Version | Host CLI evidence | Node.js |
|---------|-------------------|---------|
| 21.108.0 | Restored response contract exercised through isolated installed Claude Code and Codex CLI prompt hooks plus Windows/Linux clean-profile matrix; Codex app not directly exercised | 20/22 exercised |
| 21.107.0 | Claude Code 2.1.215 + Codex CLI 0.144.6 exercised on Windows/Linux; Codex app not directly exercised | 20/22 exercised |
| 21.76.0 | 1.0+ | 18+ |
| 21.75.1 | 1.0+ | 18+ |
| 21.75.0 | 1.0+ | 18+ |
| 21.74.0 | 1.0+ | 18+ |
| 21.73.0 | 1.0+ | 18+ |
| 21.72.0 | 1.0+ | 18+ |
| 21.71.0 | 1.0+ | 18+ |
| 21.70.0 | 1.0+ | 18+ |
| 21.69.0 | 1.0+ | 18+ |
| 21.68.0 | 1.0+ | 18+ |
| 21.67.0 | 1.0+ | 18+ |
| 21.66.0 | 1.0+ | 18+ |
| 21.60.0 | 1.0+ | 18+ |
| 21.50.0 | 1.0+ | 18+ |
| 21.0.0 | 1.0+ | 18+ |
| 19.49.0 | 1.0+ | 18+ |
| 19.0.0 | 1.0+ | 18+ |
| 18.0.0 | 1.0+ | 18+ |
