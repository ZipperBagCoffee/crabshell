# Crabshell User Manual (v21.111.1)

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
- Delta extracted from L1 session log, Haiku summarizes in background (non-blocking), appended to `logbook.md`
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
- UserPromptSubmit applies the same question/execution boundary and shared turn contract, including the trailing `[의도]`/`[이해]`/`[설명]` block, through Codex-native output.
- PreCompact/PostCompact recover memory and workflow context; SubagentStart supplies the current task/non-goals/references/success contract.
- PostToolUse records decisive parent command results. SubagentStop is only a child claim; Stop requires parent evidence and bounds identical retry failures.
- Use `crabshell:save-memory` for an explicit Codex session note. Codex does not invoke Claude's SessionEnd capture or pressure counters.

### What Gets Saved

```
.crabshell/memory/
├── logbook.md           # Active rolling memory (auto-rotates)
├── logbook_*.md          # Rotated archives (L2)
├── *.summary.json       # L3 summaries (Haiku-generated)
├── memory-index.json    # Rotation tracking & delta state
├── counter.json         # PostToolUse counter
├── config.json          # Per-project configuration
├── project.md           # Project overview (optional)
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

### Structured Work (D/P/T/I/H Documents)

| Command | What It Does |
|---------|-------------|
| `/crabshell:discussing "topic"` | Create or update a Discussion document (D) |
| `/crabshell:planning "topic"` | Create or update a Plan document (P) |
| `/crabshell:ticketing P001 "title"` | Create or update a Ticket document (T) linked to a plan |
| `/crabshell:investigating "topic"` | Run a multi-agent Investigation (I) |
| `/crabshell:hotfix "description"` | Record a lightweight hotfix (H) — one-line fixes with Problem/Fix/Verification; or `/crabshell:hotfix H001` to update |

### Workflows

| Command | What It Does |
|---------|-------------|
| `/crabshell:regressing "topic"` | Iterative current-gap Plan→Ticket→Verify cycles until convergence; an explicit count is only a maximum |
| `/crabshell:light-workflow` | Five-stage parent-owned workflow for standalone tasks |
| `/crabshell:verifying` | Create or run project-specific verification tools |
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

Installed Codex skills are invoked by name, including `crabshell:load-memory`, `crabshell:save-memory`, `crabshell:search-memory`, and `crabshell:status`. Their scripts resolve from the installed plugin cache and target the active project, so the project does not need its own copy of `scripts/`. SessionStart already performs automatic read-only memory/workflow loading; the skills provide explicit reload/save/search and the full D/P/T/I/H/K/W workflow surface.

---

## Document System (D/P/T/I)

Crabshell includes a structured document system for organizing complex work.

### Document Types

| Type | Name | Purpose |
|------|------|---------|
| **D** | Discussion | Explore a topic, capture decisions, frame the problem |
| **P** | Plan | Concrete implementation plan derived from a Discussion |
| **T** | Ticket | Specific work item derived from a Plan |
| **I** | Investigation | Independent multi-agent research on a topic |

### Hierarchy

```
D (Discussion) → P (Plan) → T (Ticket)
I (Investigation) — independent, not part of the D→P→T chain
```

- Status cascades upward: when all Tickets under a Plan complete, the Plan completes; when all Plans under a Discussion complete, the Discussion completes.
- Documents are stored in `docs/` (local only, not committed to git).
- Each document has a log section that tracks all work done against it.

### Regressing (Iterative Improvement)

Use `/crabshell:regressing "topic"` for tasks that need multiple rounds of refinement:
- Creates a single Discussion (D) as wrapper with measurable `## Convergence Criteria`
- Runs one current-gap Plan (P) then Ticket (T) cycle at a time until the result converges
- Each cycle's scope is determined by the previous cycle's verification results, not pre-allocated
- Prints a ready-to-paste `/goal` line — start host goal mode (Claude Code 2.1.139+ or Codex CLI 0.128.0+) and the host keeps the session running until the D's Convergence Criteria are met or the cycle cap is reached

### Light Workflow (One-Shot Tasks)

Use `/crabshell:light-workflow` for a standalone task that does not need the full D/P/T trail. It creates a W worklog and runs five stages: understand internally, inspect, implement, verify behavior, and report. The parent may delegate bounded work when useful, but delegation and Work/Review pairing are not completion gates.

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

Results are reported in a Prediction/Observation/Gap (P/O/G) table. Reading a file and declaring it correct is not verification.

### Parent-Owned Orchestration
The parent agent may delegate independent inspection, implementation, or review tasks when that lowers risk or latency. Worker prompts must include the relevant original request, task and non-goal, authoritative references, read/write scope, expected observation, and verification method. Explore/review workers are read-only and workers do not fan out.

Completion remains with the parent. A worker's `done`/`PASS`, agent count, or spot-check is not decisive evidence; the parent resolves named references, inspects the resulting diff, runs the decisive command or behavior check, checks forbidden side effects, and reports the observed gap.

### Portable Behavioral Verification

The verifying skill installs one schema-v2 runner from `skills/verifying/scripts/run-verify.js`. Manifest commands use repo-relative `file` and `args` fields. Behavioral entries must assert independently observed JSON/file state and may protect paths with before/after snapshots. A zero exit or stdout containing `PASS` cannot satisfy the contract by itself.

These rules are automatically injected into CLAUDE.md and reinforced every prompt.

---

## Hooks

The plugin uses Claude Code hooks to run automatically:

| Hook | Script | When It Runs | What It Does |
|------|--------|-------------|-------------|
| `UserPromptSubmit` | `inject-rules.js` | Every prompt | Emits the shared turn contract, the Claude-host-only `## Codex Delegation` guidance block, and the mandatory three-field response ending; `봉인해제` / `UNLEASH` immediately resets pressure regardless of intent classification; other execution prompts run once-per-session cleanup/reset and Claude rule/memory-warning synchronization |
| `SessionStart` | `load-memory.js` | Session begins | Read-only load of logbook, summaries, project memory, and active workflow context |
| `PostToolUse` | `counter.js check` | After each tool use | Increments counter; triggers auto-save + delta extraction at interval |
| `PreToolUse` | `regressing-guard.js` | Before Write/Edit | Enforces phase-based restrictions during active regressing sessions |
| `PreToolUse` | `sycophancy-guard.js` | Before Write/Edit | Mid-turn sycophancy detection via transcript parsing |
| `PreToolUse` | `docs-guard.js` | Before Write/Edit to docs/ | Blocks writes to docs/ directories without active skill flag |
| `PreToolUse` | `log-guard.js` | Before Write/Edit | Blocks INDEX.md terminal status without log entries; blocks cycle docs without previous cycle logs |
| `PreToolUse` | `verify-guard.js` | Before Write/Edit to tickets | Hybrid: Edit always enforces; Write enforces only for existing files (new file creation skips). Blocks Final Verification without prior `/verifying` run |
| `PreToolUse` | `path-guard.js` | Before Read/Grep/Glob/Bash/Write/Edit | Blocks wrong path, Edit on logbook.md, Write shrink on logbook.md |
| `PostToolUse` | `verification-sequence.js record` | After each tool use | Tracks source file edits and test runs |
| `PreToolUse` | `verification-sequence.js gate` | Before Write/Edit/Bash | Blocks git commit without tests |
| `PreToolUse` | `doc-watchdog.js gate` | Before Write/Edit | Soft warning (additionalContext) when 5+ code edits without D/P/T doc update (regressing only) |
| `PostToolUse` | `doc-watchdog.js record` | After Write/Edit | Tracks code file edits (increment counter) and D/P/T doc edits (reset counter) in doc-watchdog.json |
| `PostToolUse` | `completion-controller.js` | After Bash | Records conclusive parent command results only after a child completion claim |
| `PostToolUse` | `skill-tracker.js` | After Skill tool call | Sets skill-active flag on Skill tool calls for guard scripts |
| `PreToolUse` | `pressure-guard.js` | Before ANY tool (matcher: `.*`) | Graduated tool blocking based on consecutive negative feedback pressure level (L2: primary tools, L3: all tools) |
| `Stop`, `SubagentStop` | `completion-controller.js` | Child/parent completion boundary | One state owner: child claim is not proof; requires parent evidence, bounds identical failures, preserves workflow continuation, and runs retained Claude sycophancy/doc-watchdog/scope Stop validators |
Hook launcher v21.99.3 note: `hooks/hooks.json` now invokes hook scripts through direct `node` commands. `scripts/find-node.sh` remains available as a hardened fallback utility, not the default launcher.

| `PreCompact` | `pre-compact.js` | Before context compaction | Outputs memory state, active documents, and regressing state as context to preserve across compaction |
| `PostCompact` | `post-compact.js` | After context compaction | Logs compaction event for debugging (side-effect only, no context output) |
| `SubagentStart` | `subagent-context.js` | When subagent spawns | Injects project concept, COMPRESSED_CHECKLIST, regressing state, and project root anchor into subagent context |
| `SessionEnd` | `counter.js final` | Execution-authorized session ends | Creates final L1 backup and extracts remaining delta; question-only sessions remain read-only |

### Codex Hook Surface

| Hook | Script | When It Runs | What It Does |
|------|--------|-------------|-------------|
| `SessionStart` | `adapters/codex/session-start.js` | Session begins | Read-only shared memory and active workflow recovery |
| `UserPromptSubmit` | `adapters/codex/user-prompt-submit.js` | Every prompt | Shared question/execution contract and mandatory three-field response ending (without the Claude-only Codex delegation block); execution lifecycle writes only to Codex plugin data/project state |
| `PreToolUse` | `adapters/codex/pre-tool-use.js` | Matching local file/shell tools | Applies the shared `.crabshell/` path policy and returns native `hookSpecificOutput` deny JSON for wrong-project memory paths |
| `PostToolUse` | `adapters/codex/post-tool-use.js` | After Bash | Records conclusive parent command evidence for a pending child claim |
| `PreCompact` | `adapters/codex/pre-compact.js` | Before compaction | Emits shared memory/workflow recovery context without writes |
| `PostCompact` | `adapters/codex/post-compact.js` | After compaction | Restores shared context while keeping Claude-specific compaction effects in Claude only |
| `SubagentStart` | `adapters/codex/subagent-start.js` | Child starts | Supplies exact current intent, task, non-goals, references, allowed changes, and observable success |
| `SubagentStop` | `adapters/codex/stop.js` | Child stops | Records the child result as a claim, never as completion proof |
| `Stop` | `adapters/codex/stop.js` | Parent attempts completion | Applies the shared parent-evidence and bounded-continuation decision using Codex-native block JSON |

Codex reads `hooks/codex-hooks.json` through the explicit `.codex-plugin/plugin.json` `hooks` field. That prevents accidental discovery of Claude's `hooks/hooks.json`. The nine Codex events are synchronous and native; every launcher catches adapter-load and rejected-`main()` failures so infrastructure errors exit 0 without interrupting the triggering tool call. Shared semantics live in host-neutral cores, while Claude-specific pressure/sycophancy and SessionEnd capture stay in Claude. Retired fixed-count, role-collapse, and behavior-verifier hooks are absent from both manifests.

### Internal Task Contract and Shared Response Ending

As of v21.108.0, both native `UserPromptSubmit` paths append one mandatory response-ending contract from `scripts/core/first-turn-context.js`. Every user-facing response keeps its natural answer body first and ends with exactly three short lines in this order:

```text
[의도]: the user's request, restated in the user's words
[이해]: the assistant's interpretation and any remaining gap; `gap 없음` when none remains
[설명]: one concrete, easy-to-understand explanation in the user's words
```

This is not a return to the v21.102.0 caveman-style `SKELETON_3FIELD`. The fields summarize the answer and do not expose private chain-of-thought; analogy is not the default. The v21.105.0 internal eight-field task contract and evidence-backed execution remain active behind the response.

The main report remains natural prose appropriate to the task. It leads with the outcome, includes decisive observations and remaining gaps, and uses P/O/G when verification results need to be audited.

As of v21.106.0, the dormant behavior-verifier script, prompt, state consumer, fixed WA-count hook, and role-collapse parent-write gate are removed. Existing `behavior-verifier-state.json`, `verifier.lock`, and `wa-count.json` files are not deleted; current code ignores them. The old designs remain documented in release history only.

These defaults are not user-facing configuration knobs. They are centralized in `scripts/shared-context.js`, while `scripts/core/orchestration-policy.js` exposes deterministic helpers for the task contract, question boundary, named-reference resolution, and completion evidence.

**Related:** [Hooks](#hooks), [Configuration](#configuration), and [Pressure System](#pressure-system).

---

## Guards

Guard scripts are PreToolUse/Stop hooks that prevent common mistakes:

| Guard | What It Protects Against |
|-------|------------------------|
| `sycophancy-guard.js` | Claude agreeing with user claims without independently verifying them first (dual-layer: Stop response + PreToolUse mid-turn transcript). Stop-side signals are warn-only; the PreToolUse mid-turn Write/Edit block remains. Counter side-effects (`tooGoodSkepticism.retryCount`, `feedbackPressure.oscillationCount`) remain, and the parent must re-check decisive evidence before completion. |
| `docs-guard.js` | Direct writes to `docs/` directories outside of an active skill (discussing, planning, ticketing, etc.) |
| `log-guard.js` | Marking documents as done/verified/concluded in INDEX.md without log entries in the document; creating new cycle documents without logging the previous cycle |
| `verify-guard.js` | Writing "Final Verification" results to ticket files without actually running `/verifying` first. Hybrid: Edit always enforces; Write only enforces on existing files (new ticket creation is allowed) |
| `path-guard.js` | File operations targeting a wrong `.crabshell/memory/` path (e.g., a different project's memory directory) |
| `core/path-policy.js` + Codex adapter | The same wrong-project memory paths in Codex; the core decides policy while each host wrapper emits its own native response format |
| `core/completion-control.js` + host adapters | Child false-done, ambiguous/missing parent command evidence, repeated identical failures, and premature active-workflow completion on both hosts |
| `verification-sequence.js` | Source files edited without running tests before git commit |
| `doc-watchdog.js` | Document update omissions during regressing: soft warning when 5+ code edits without D/P/T document update; blocks session end when ticket has no work log since last code edit |
| `skill-tracker.js` | Supporting guard: sets the `skill-active` flag when a Skill tool call is detected, so `docs-guard` and `verify-guard` know when writes are authorized |
| `pressure-guard.js` | Graduated tool blocking when consecutive negative feedback detected. L2: blocks 6 primary tools (Read/Grep/Glob/Bash/Write/Edit). L3: blocks ALL tools. Resets via positive feedback decay or intent-independent user bailout keywords ("봉인해제" / "UNLEASH"). See [Pressure System](#pressure-system) |
| `scope-guard.js` | Detects scope reduction in responses (delivering fewer items than user requested, using "too many" / "시간 관계상" as justification) |
| `regressing-guard.js` | Phase-based write restrictions during active regressing sessions — blocks out-of-phase edits to plan/ticket documents |
| `regressing-loop-guard.js` | Retained compatibility/test helper for the old count-independent continuation path; `completion-controller.js` is now the sole manifest Stop owner. Regressing continuation is goal-driven (v21.110.0): the regressing skill prints a `/goal` handoff line for host goal mode. |

Guards run automatically via hooks. No configuration needed.
For Codex, the shared path policy and shared completion control have native adapters. The remaining pressure, sycophancy, documentation, and edit/commit guards are Claude-only.

---

## Pressure System

Crabshell tracks three pressure counters (feedbackPressure.level, feedbackPressure.oscillationCount, tooGoodSkepticism.retryCount) in `.crabshell/memory/memory-index.json`. Together they form a graduated response mechanism that restricts tool access when Claude drifts — either via consecutive negative user feedback or via the assistant's own output patterns (reversals, all-None P/O/G).

Pressure enforcement is Claude-only. Codex does not load `pressure-guard.js` or `sycophancy-guard.js`; however, both hosts use the shared UserPromptSubmit path, so `봉인해제` / `UNLEASH` clears the shared pressure state from either host.

### Three Counters

| Counter | Raised By | Trigger | Reset By |
|---------|-----------|---------|----------|
| feedbackPressure.level (0-3) | inject-rules.js @ UserPromptSubmit | User message matches NEGATIVE_PATTERNS (W021: profanity-only) | Positive-feedback decay (3 clean prompts) · `봉인해제` / `UNLEASH` · TaskCreate tool (L1-L2 only) |
| feedbackPressure.oscillationCount | sycophancy-guard.js @ Stop | Assistant response contains REVERSAL_PATTERNS (e.g., "actually, let me", "다시 생각해보니") — **no user input required** | `봉인해제` / `UNLEASH` |
| tooGoodSkepticism.retryCount | sycophancy-guard.js @ Stop | Assistant response contains a P/O/G table where all Gap cells are None/없음/N/A — **no user input required** | Clean P/O/G (Gap ≠ None) in a later Stop · retryCount > 3 overflow · `봉인해제` / `UNLEASH` (originally BAILOUT, renamed v21.79.0) |

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
- **Enforcement:** The `pressure-guard.js` hook (PreToolUse, matcher: `.*`) checks `feedbackPressure.level` before every tool call and blocks accordingly.
- **Decay:** Positive feedback from the user reduces `feedbackPressure.level` naturally. The assistant-side counters decay only on their own reset paths (see table above).
- **Exception:** Operations targeting `.crabshell/` or `.claude/` paths are always allowed, even at L3 (so the plugin can still manage its own state).

### Bailout

If tool access is locked at L2 or L3, the user can type one of these keywords to reset the pressure system:

- **`봉인해제`** (Korean)
- **`UNLEASH`** (English; renamed from `BAILOUT` in v21.79.0 / W021)

Either keyword resets the pressure counters (feedbackPressure.level, consecutiveCount, decayCounter, oscillationCount, lastShownLevel, and tooGoodSkepticism.retryCount) to zero. The reset runs before question/execution intent gating, so the bare keyword and a keyword embedded in a question both work. On reset, stderr logs `[PRESSURE BAILOUT: reset all 3 counters]` (internal label retained for backward log-compatibility).

This is the **only** way to immediately escape L2/L3 without waiting for natural decay. When you're stuck at L2/L3, Claude will inform you about these keywords.

**Note:** As of v21.77.0, the bailout keyword (then `BAILOUT`, since renamed `UNLEASH` in v21.79.0) also resets `tooGoodSkepticism.retryCount` (previously only `feedbackPressure.*` was reset).

---

## CLAUDE.md Integration

The plugin automatically manages a rules section in your project's `CLAUDE.md`:

```markdown
## CRITICAL RULES (Core Principles Alignment)
...plugin-managed rules (SCOPE DEFINITIONS, UNDERSTANDING-FIRST, VERIFICATION-FIRST, etc.)...
---Add your project-specific rules below this line---

- Your project rule 1
- Your project rule 2
```

- **Above the line**: Auto-managed by the plugin. Updated every prompt via `syncRulesToClaudeMd()`. Contains PRINCIPLES, SCOPE DEFINITIONS, UNDERSTANDING-FIRST, VERIFICATION-FIRST, PROBLEM-SOLVING PRINCIPLES, INTERFERENCE PATTERNS, REQUIREMENTS, VIOLATIONS, and ADDITIONAL RULES.
- **Below the line**: Your project-specific content. The plugin never modifies anything below this marker.
- **Orchestration defaults**: the auto-managed rules and compressed checklist carry the same internal task contract, bounded delegation, and parent-owned verification defaults. There is no separate always-loaded agent-count rules file in this repository.

### Dual Injection

The plugin uses two injection mechanisms:
1. **CLAUDE.md sync**: Full rules written to the file on disk (persists across sessions, visible to you)
2. **COMPRESSED_CHECKLIST**: A condensed reminder injected into Claude's context every prompt via the `UserPromptSubmit` hook (not written to disk, reduces token usage by ~77% vs. full rules)

---

## Configuration

`.crabshell/memory/config.json` (per-project) or `~/.crabshell/config.json` (global):

```json
{
  "saveInterval": 15,
  "keepRaw": false,
  "rulesInjectionFrequency": 1,
  "quietStop": true,
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
| `quietStop` | true | Brief session-end message instead of verbose instructions |
| `memoryRotation.thresholdTokens` | 25000 | Token threshold for logbook.md rotation (with 0.95 safety margin) |
| `memoryRotation.carryoverTokens` | 2500 | Tokens to keep as carryover after rotation (with 0.95 safety margin) |

### Orchestration Defaults

The eight-field task contract, risk boundary for user questions, bounded worker prompt, and parent-owned completion rule are product defaults rather than per-project settings. They are centralized in `scripts/shared-context.js` and `scripts/core/orchestration-policy.js`; changing memory configuration does not weaken them. The live regression corpus can be run with `node scripts/run-orchestration-corpus.js --live --json` in a disposable fixture.

### Codex Plugin Configuration

- `.agents/plugins/marketplace.json` is the repo-scoped native marketplace source.
- `.codex-plugin/plugin.json` explicitly points to `codex-skills/` and `hooks/codex-hooks.json`.
- Both `command` and `commandWindows` entries use the same Node Promise fail-open boundary; shell-independent `PLUGIN_ROOT` lookup, missing-module failure, and rejected adapters are covered by the Windows hook regression.
- Codex stores installed plugin material under its plugin cache and writable runtime data under `plugins/data/<plugin>-<marketplace>` inside `CODEX_HOME`; plugin source files are not used as writable state.
- Hook definitions are not runnable until Codex records trust for their current hash. Any definition change produces `modified` until reviewed again.
- Run `crabshell:status` for live Claude/Codex installed, activated, trusted, behavior-verified, degraded, drifted, and unsupported results. It uses current CLI/plugin/cache/hook observations, not a Crabshell-maintained version compatibility table; Codex app remains a separate row.

### lock-contention.json — F-4 Instrumentation State

`.crabshell/memory/lock-contention.json`. Per-lock object (keyed by lock filename), 9 fields: `acquireCount`, `releaseCount`, `contendedCount`, `totalWaitMs`, `totalHeldMs`, `maxWaitMs`, `maxHeldMs`, `lastAcquiredPid`, `lastUpdatedAt`; top-level `measurementWindowStart` ISO marker. F-4 lock contention measurement → F-3 ratification. Additive top-level keys safe (`_recordContention` reads `state[lockName]` only). **Related:** `### _recordContention`.

### _recordContention — Lock Hold/Wait Measurement

`scripts/utils.js` L145-181. Three call sites (D107 D4): `acquireIndexLock` success L190, failure L205, `releaseIndexLock` L221. Unprotected `writeJson` avoids recursive-lock deadlock (L139-141). Race: concurrent writes may drop increments → conservative undercount (real ≥ measured); cycle 7+ ratification factors margin. Fail-open. **Related:** `### lock-contention.json`.

---

## Setting Project Information

Set information you want Claude to know at the start of every session.

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
1. Check counter in `.crabshell/memory/counter.json`
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
