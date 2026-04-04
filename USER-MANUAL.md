# Crabshell User Manual (v21.19.0)

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
- Delta extracted from L1 session log, Haiku summarizes it, appended to `logbook.md`
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

### Structured Work (D/P/T/I Documents)

| Command | What It Does |
|---------|-------------|
| `/crabshell:discussing "topic"` | Create or update a Discussion document (D) |
| `/crabshell:planning "topic"` | Create or update a Plan document (P) |
| `/crabshell:ticketing P001 "title"` | Create or update a Ticket document (T) linked to a plan |
| `/crabshell:investigating "topic"` | Run a multi-agent Investigation (I) |

### Workflows

| Command | What It Does |
|---------|-------------|
| `/crabshell:regressing "topic" N` | Iterative optimization: N cycles of Plan-then-Ticket, wrapped in a Discussion |
| `/crabshell:light-workflow` | Lightweight one-shot agent orchestration for standalone tasks |
| `/crabshell:verifying` | Create or run project-specific verification tools |
| `/crabshell:lessons` | Manage project-specific lessons (format guidelines, creation) |
| `/crabshell:status` | Healthcheck of plugin state (memory, regressing, verification, version) |

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
| `SessionEnd` | `counter.js final` | Session ends | Creates final L1 backup, extracts remaining delta |

---

## Guards

Guard scripts are PreToolUse/Stop hooks that prevent common mistakes:

| Guard | What It Protects Against |
|-------|------------------------|
| `sycophancy-guard.js` | Claude agreeing with user claims without independently verifying them first (dual-layer: Stop response + PreToolUse mid-turn transcript) |
| `docs-guard.js` | Direct writes to `docs/` directories outside of an active skill (discussing, planning, ticketing, etc.) |
| `log-guard.js` | Marking documents as done/verified/concluded in INDEX.md without log entries in the document; creating new cycle documents without logging the previous cycle |
| `verify-guard.js` | Writing "Final Verification" results to ticket files without actually running `/verifying` first. Hybrid: Edit always enforces; Write only enforces on existing files (new ticket creation is allowed) |
| `path-guard.js` | File operations targeting a wrong `.crabshell/memory/` path (e.g., a different project's memory directory) |
| `verification-sequence.js` | Source files edited without running tests before git commit; edit-grep cycles (editing and grepping instead of testing) |
| `doc-watchdog.js` | Document update omissions during regressing: soft warning when 5+ code edits without D/P/T document update; blocks session end when ticket has no work log since last code edit |
| `skill-tracker.js` | Supporting guard: sets the `skill-active` flag when a Skill tool call is detected, so `docs-guard` and `verify-guard` know when writes are authorized |

Guards run automatically via hooks. No configuration needed.

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
  "quietStop": true
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `saveInterval` | 15 | Tool uses before auto-save triggers |
| `keepRaw` | false | Keep `.raw.jsonl` files after L1 conversion |
| `rulesInjectionFrequency` | 1 | Inject rules every N prompts (1 = every prompt) |
| `quietStop` | true | Brief session-end message instead of verbose instructions |

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

## Lessons

When Claude notices repeated patterns (2+ times), it proposes a lesson:
- Saved to `.crabshell/lessons/` as markdown files
- Checked on each session for project-specific rules
- Use `/crabshell:lessons` for format guidelines when creating lessons manually
- Lessons must follow the **Problem/Rule/Example** format — reflective narratives and abstract principles are rejected

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
| 19.49.0 | 1.0+ | 18+ |
| 19.48.0 | 1.0+ | 18+ |
| 19.47.0 | 1.0+ | 18+ |
| 19.46.0 | 1.0+ | 18+ |
| 19.45.0 | 1.0+ | 18+ |
| 19.44.0 | 1.0+ | 18+ |
| 19.43.0 | 1.0+ | 18+ |
| 19.42.0 | 1.0+ | 18+ |
| 19.41.0 | 1.0+ | 18+ |
| 19.40.0 | 1.0+ | 18+ |
| 19.39.0 | 1.0+ | 18+ |
| 19.38.0 | 1.0+ | 18+ |
| 19.37.0 | 1.0+ | 18+ |
| 19.36.0 | 1.0+ | 18+ |
| 19.35.0 | 1.0+ | 18+ |
| 19.34.0 | 1.0+ | 18+ |
| 19.33.0 | 1.0+ | 18+ |
| 19.32.0 | 1.0+ | 18+ |
| 19.31.0 | 1.0+ | 18+ |
| 19.30.0 | 1.0+ | 18+ |
| 19.29.0 | 1.0+ | 18+ |
| 19.28.0 | 1.0+ | 18+ |
| 19.27.0 | 1.0+ | 18+ |
| 19.26.0 | 1.0+ | 18+ |
| 19.25.0 | 1.0+ | 18+ |
| 19.24.0 | 1.0+ | 18+ |
| 19.22.0 | 1.0+ | 18+ |
| 19.20.0 | 1.0+ | 18+ |
| 19.18.0 | 1.0+ | 18+ |
| 19.9.0 | 1.0+ | 18+ |
| 19.0.0 | 1.0+ | 18+ |
| 18.0.0 | 1.0+ | 18+ |
| 13.9.x-17.x | 1.0+ | 18+ |
