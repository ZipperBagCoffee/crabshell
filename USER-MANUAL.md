# Crabshell User Manual (v21.82.0)

## Why Do You Need This?

Claude Code **forgets everything when a session ends:**
- Work you did yesterday
- Decisions and their reasons
- Project structure
- Bugs found and how you fixed them

Every new session, you have to repeat: "This project is built with React, uses Zustand for state management, JWT for auth..." and so on.

Crabshell solves this problem.

## Installation

```bash
/plugin marketplace add ZipperBagCoffee/crabshell
/plugin install crabshell
```

**That's it.** It works automatically after installation.

---

## Basic Usage (Automatic)

### What Happens After Installation

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
- Full conversation backed up (`.l1.jsonl`)
- Final delta extraction and save

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
| `/crabshell:regressing "topic" N` | Iterative optimization: N cycles of Plan-then-Ticket, wrapped in a Discussion |
| `/crabshell:light-workflow` | Lightweight one-shot agent orchestration for standalone tasks |
| `/crabshell:verifying` | Create or run project-specific verification tools |
| `/crabshell:status` | Healthcheck of plugin state (memory, regressing, verification, version) |
| `/crabshell:lint` | Run Obsidian document lint checks (orphans, broken wikilinks, stale status, missing frontmatter, INDEX inconsistencies) |
| `/crabshell:search-docs query` | BM25 full-text search across all D/P/T/I/W/K documents — ranked results with title/tags/id/body field boosts |
| `/crabshell:knowledge "title"` | Create a K-page (verified fact or operational tip) in .crabshell/knowledge/; or `/crabshell:knowledge K001` to view |

### Setup

| Command | What It Does |
|---------|-------------|
| `/crabshell:setup-project` | Initialize project configuration (project.md, config) |
| `/crabshell:setup-rtk` | Install and configure RTK (Rust Token Killer) for token-optimized CLI output |

> **Tip:** For basic memory operations, you can also just ask Claude directly (e.g., "save memory now", "search memory for auth").

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

Use `/crabshell:regressing "topic" N` for tasks that need multiple rounds of refinement:
- Creates a single Discussion (D) as wrapper
- Runs N cycles, each consisting of Plan (P) then Ticket (T)
- Each cycle's scope is determined by the previous cycle's verification results, not pre-allocated

### Light Workflow (One-Shot Tasks)

Use `/crabshell:light-workflow` for simple standalone tasks that do not need the full D/P/T document trail. It provides agent orchestration (Work Agent + Review Agent) without the overhead of tracked documents.

---

## Core Philosophy

Crabshell enforces several behavioral rules via CLAUDE.md injection. You do not need to configure these; they activate automatically.

### Understanding-First
Claude confirms its understanding of your intent before acting. This prevents wasted work on wrong assumptions. If intent is unclear, Claude asks first rather than guessing.

### Verification-First
Before claiming any result is verified, Claude must:
1. **Predict** what it expects to observe
2. **Execute** (run code, use tools) to get actual results
3. **Compare** prediction vs. observation

Results are reported in a Prediction/Observation/Gap (P/O/G) table. Reading a file and declaring it correct is not verification.

### Agent Pairing
For non-trivial tasks, Claude uses a Work Agent + Review Agent pattern:
- Every Work Agent has a paired Review Agent
- They run as separate agents to maintain independence
- The Orchestrator (Claude itself) synthesizes results but does not perform work or review directly

**RA agent rate-limit fallback (v21.77.2+):** If Task-tool dispatch for the Review Agent fails due to API rate-limit (e.g., long sustained sessions), the Orchestrator may perform self-verification using the same P/O/G + Devil's Advocate template the Review Agent would have used. The fallback section in the ticket document is labelled `**Note: RA agent rate-limited, Orchestrator self-verification fallback applied.**` so the deviation is auditable. Standard mode remains RA dispatch retry; this fallback applies only when retry is impractical and convergence pressure is high.

These rules are automatically injected into CLAUDE.md and reinforced every prompt.

---

## Hooks

The plugin uses Claude Code hooks to run automatically:

| Hook | Script | When It Runs | What It Does |
|------|--------|-------------|-------------|
| `UserPromptSubmit` | `inject-rules.js` | Every prompt | Syncs rules to CLAUDE.md; injects COMPRESSED_CHECKLIST + delta/rotation instructions into context |
| `SessionStart` | `load-memory.js` | Session begins | Loads logbook.md, L3 summaries, project files into context |
| `PostToolUse` | `counter.js check` | After each tool use | Increments counter; triggers auto-save + delta extraction at interval |
| `PreToolUse` | `regressing-guard.js` | Before Write/Edit | Enforces phase-based restrictions during active regressing sessions |
| `Stop` | `sycophancy-guard.js` | Before response finalized | Detects agreement-without-verification patterns in responses |
| `PreToolUse` | `sycophancy-guard.js` | Before Write/Edit | Mid-turn sycophancy detection via transcript parsing |
| `PreToolUse` | `docs-guard.js` | Before Write/Edit to docs/ | Blocks writes to docs/ directories without active skill flag |
| `PreToolUse` | `log-guard.js` | Before Write/Edit | Blocks INDEX.md terminal status without log entries; blocks cycle docs without previous cycle logs |
| `PreToolUse` | `verify-guard.js` | Before Write/Edit to tickets | Hybrid: Edit always enforces; Write enforces only for existing files (new file creation skips). Blocks Final Verification without prior `/verifying` run |
| `PreToolUse` | `path-guard.js` | Before Read/Grep/Glob/Bash/Write/Edit | Blocks wrong path, Edit on logbook.md, Write shrink on logbook.md |
| `PostToolUse` | `verification-sequence.js record` | After each tool use | Tracks source file edits, test runs, grep cycles |
| `PreToolUse` | `verification-sequence.js gate` | Before Write/Edit/Bash | Blocks git commit without tests, blocks edits after 3+ grep cycles |
| `PreToolUse` | `doc-watchdog.js gate` | Before Write/Edit | Soft warning (additionalContext) when 5+ code edits without D/P/T doc update (regressing only) |
| `Stop` | `doc-watchdog.js stop` | Before session ends | Blocks session end when regressing active + ticket has no work log entry since last code edit |
| `PostToolUse` | `doc-watchdog.js record` | After Write/Edit | Tracks code file edits (increment counter) and D/P/T doc edits (reset counter) in doc-watchdog.json |
| `PostToolUse` | `skill-tracker.js` | After Skill tool call | Sets skill-active flag on Skill tool calls for guard scripts |
| `PreToolUse` | `pressure-guard.js` | Before ANY tool (matcher: `.*`) | Graduated tool blocking based on consecutive negative feedback pressure level (L2: primary tools, L3: all tools) |
| `PreToolUse` | `role-collapse-guard.js` | Before Write/Edit | Blocks Orchestrator from directly writing source code files (should delegate to Work Agents) |
| `Stop` | `scope-guard.js` | Before response finalized | Detects scope reduction in responses (delivering fewer items than user requested) |
| `Stop` | `regressing-loop-guard.js` | Before session ends | Blocks session end during active regressing/light-workflow; enforces continuation |
| `Stop` | `deferral-guard.js` | Before response finalized | Detects trailing deferral questions in responses (e.g., "다음 세션에서 할까요?") |
| `Stop` | `behavior-verifier.js` | Before response finalized | Writes pending state + sentinel; next-turn UserPromptSubmit dispatches background sub-agent for 4-dimension verdict (understanding/verification/logic/simple — §3.logic body extended in v21.81.0 with 3 sub-clauses: Direction change / Session-length deferral / Trailing deferral; §1.understanding extended in **v21.82.0** with Format markers sub-clause: response > 200 chars without ANY-ONE-set of `[의도]/[답]/[자기 평가]` or `[Intent]/[Answer]/[Self-Assessment]` → FAIL), result injected as `## Behavior Correction` on the following turn. **v21.82.0 (D103 cycle 2)**: Stop hook also reads prior state, scans transcript via `getRecentTaskCalls`, sets `state.dispatchOverdue=true` when prior `status='pending'` + zero Task tool_use since prior `launchedAt` (clarification + length<50 bypasses preserved); inject-rules consumer prepends `**[DISPATCH OVERDUE]** Previous turn did not invoke Task. Invoke NOW.` before the dispatch instruction (D102 P132 v21.80.0; §3.logic absorption D103 P134 v21.81.0; dispatch overdue + format markers D103 P135 v21.82.0) |
| `PreCompact` | `pre-compact.js` | Before context compaction | Outputs memory state, active documents, and regressing state as context to preserve across compaction |
| `PostCompact` | `post-compact.js` | After context compaction | Logs compaction event for debugging (side-effect only, no context output) |
| `SubagentStart` | `subagent-context.js` | When subagent spawns | Injects project concept, COMPRESSED_CHECKLIST, regressing state, and project root anchor into subagent context |
| `SessionEnd` | `counter.js final` | Session ends | Creates final L1 backup, extracts remaining delta |

---

## Guards

Guard scripts are PreToolUse/Stop hooks that prevent common mistakes:

| Guard | What It Protects Against |
|-------|------------------------|
| `sycophancy-guard.js` | Claude agreeing with user claims without independently verifying them first (dual-layer: Stop response + PreToolUse mid-turn transcript). v21.80.0 narrowed Stop-side verification-claim path to warn-only. **v21.81.0 (D103 cycle 1)**: the remaining 4 Stop branches (context-length deferral / too-good P/O/G all-None / oscillation reversal / bare agreement) also flipped to warn-only — Stop-time hard-block on these signals is gone. PreToolUse mid-tool block (Write/Edit guard) is preserved. Counter side-effects (`tooGoodSkepticism.retryCount`, `feedbackPressure.oscillationCount`) RMW preserved before warn emit (hybrid: hook tracks state, behavior-verifier sub-agent interprets). |
| `docs-guard.js` | Direct writes to `docs/` directories outside of an active skill (discussing, planning, ticketing, etc.) |
| `log-guard.js` | Marking documents as done/verified/concluded in INDEX.md without log entries in the document; creating new cycle documents without logging the previous cycle |
| `verify-guard.js` | Writing "Final Verification" results to ticket files without actually running `/verifying` first. Hybrid: Edit always enforces; Write only enforces on existing files (new ticket creation is allowed) |
| `path-guard.js` | File operations targeting a wrong `.crabshell/memory/` path (e.g., a different project's memory directory) |
| `verification-sequence.js` | Source files edited without running tests before git commit; edit-grep cycles (editing and grepping instead of testing) |
| `doc-watchdog.js` | Document update omissions during regressing: soft warning when 5+ code edits without D/P/T document update; blocks session end when ticket has no work log since last code edit |
| `skill-tracker.js` | Supporting guard: sets the `skill-active` flag when a Skill tool call is detected, so `docs-guard` and `verify-guard` know when writes are authorized |
| `pressure-guard.js` | Graduated tool blocking when consecutive negative feedback detected. L2: blocks 6 primary tools (Read/Grep/Glob/Bash/Write/Edit). L3: blocks ALL tools. Resets via positive feedback decay or user bailout keywords ("봉인해제" / "UNLEASH"). See [Pressure System](#pressure-system) |
| `role-collapse-guard.js` | Blocks Orchestrator from directly writing source code files (.js/.json/.sh/.ts) — should delegate to Work Agents during regressing/light-workflow |
| `deferral-guard.js` | Detects trailing deferral questions ("다음 세션에서 할까요?", "shall I proceed?") in responses — prevents the assistant from asking permission instead of acting |
| `scope-guard.js` | Detects scope reduction in responses (delivering fewer items than user requested, using "too many" / "시간 관계상" as justification) |
| `regressing-guard.js` | Phase-based write restrictions during active regressing sessions — blocks out-of-phase edits to plan/ticket documents |
| `regressing-loop-guard.js` | Blocks session end during active regressing/light-workflow; enforces Stop hook continuation until workflow completes |
| `behavior-verifier.js` | Sub-agent dispatch on Stop: writes pending state + sentinel; next-turn UserPromptSubmit instructs Claude to launch a background sub-agent that emits a 4-dimension verdict (understanding/verification/logic/simple); the following turn injects `## Behavior Correction` if any dimension failed. **v21.81.0**: §3.logic body extended with 3 sub-clauses (Direction change / Session-length deferral / Trailing deferral) — sub-agent now performs Stop-branch absorption semantically (D103 cycle 1). **v21.82.0 (D103 cycle 2)**: Stop hook now also detects when the *prior* turn left `status='pending'` but the next response did not invoke the Task tool (using `getRecentTaskCalls` against the current turn's transcript). When that happens, the new state record is written with `dispatchOverdue=true` and the next UserPromptSubmit prepends `**[DISPATCH OVERDUE]** Previous turn did not invoke Task. Invoke NOW.` before the existing dispatch instruction. Clarification-only and length<50 turns are bypassed upstream so they cannot produce false positives. Concurrent extension: §1.understanding gains a **Format markers** sub-clause (response > 200 chars without ANY-ONE-set of `[의도]/[답]/[자기 평가]` Korean or `[Intent]/[Answer]/[Self-Assessment]` English → FAIL); JSON 4-key schema preserved. Fail-open at every step. (D102 P132 v21.80.0; D103 P134 v21.81.0; D103 P135 v21.82.0) |

Guards run automatically via hooks. No configuration needed.

---

## Pressure System

Crabshell tracks three pressure counters (feedbackPressure.level, feedbackPressure.oscillationCount, tooGoodSkepticism.retryCount) in `.crabshell/memory/memory-index.json`. Together they form a graduated response mechanism that restricts tool access when Claude drifts — either via consecutive negative user feedback or via the assistant's own output patterns (reversals, all-None P/O/G).

### Three Counters

| Counter | Raised By | Trigger | Reset By |
|---------|-----------|---------|----------|
| feedbackPressure.level (0-3) | inject-rules.js @ UserPromptSubmit | User message matches NEGATIVE_PATTERNS (W021: profanity-only) | Positive-feedback decay (3 clean prompts) · UNLEASH keyword · TaskCreate tool (L1-L2 only) · SessionStart (L2+ → 1) |
| feedbackPressure.oscillationCount | sycophancy-guard.js @ Stop | Assistant response contains REVERSAL_PATTERNS (e.g., "actually, let me", "다시 생각해보니") — **no user input required** | UNLEASH keyword · SessionStart |
| tooGoodSkepticism.retryCount | sycophancy-guard.js @ Stop | Assistant response contains a P/O/G table where all Gap cells are None/없음/N/A — **no user input required** | Clean P/O/G (Gap ≠ None) in a later Stop · retryCount > 3 overflow · SessionStart · UNLEASH keyword (originally BAILOUT, renamed v21.79.0) |

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

The UNLEASH keyword resets three pressure counters (feedbackPressure.level, feedbackPressure.oscillationCount, tooGoodSkepticism.retryCount) to zero. On reset, stderr logs `[PRESSURE BAILOUT: reset all 3 counters]` (internal label retained for backward log-compatibility).

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
- **Agent rules**: `.claude/rules/agent-orchestration.md` contains 11 agent orchestration rules (pairing, perspective diversity, cross-review, coherence, etc.) and is always loaded by Claude Code automatically.

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

## Version Compatibility

| Version | Claude Code | Node.js |
|---------|-------------|---------|
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
