# Memory Keeper User Manual (v19.24.0)

## Why Do You Need This?

Claude Code **forgets everything when a session ends:**
- Work you did yesterday
- Decisions and their reasons
- Project structure
- Bugs found and how you fixed them

Every new session, you have to repeat: "This project is built with React, uses Zustand for state management, JWT for auth..." and so on.

Memory Keeper solves this problem.

## Installation

```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper
```

**That's it.** It works automatically after installation.

---

## Basic Usage (Automatic)

### What Happens After Installation

**1. Session Start:**
- Previous session summary (`memory.md`) loaded into Claude's context
- L3 summaries of archived memory loaded
- Project info you set (`project.md`, `architecture.md`, `conventions.md`) loaded
- CLAUDE.md rules synced and injected

**2. During Work:**
- Auto-save triggers every 15 tool uses (configurable)
- Delta extracted from L1 session log, Haiku summarizes it, appended to `memory.md`
- Auto-rotation when `memory.md` exceeds ~23,750 tokens
- Rules re-injected every prompt via COMPRESSED_CHECKLIST
- CLAUDE.md rules section kept in sync automatically

**3. Session End:**
- Full conversation backed up (`.l1.jsonl`)
- Final delta extraction and save

### What Gets Saved

```
.claude/memory/
├── memory.md            # Active rolling memory (auto-rotates)
├── memory_*.md          # Rotated archives (L2)
├── *.summary.json       # L3 summaries (Haiku-generated)
├── memory-index.json    # Rotation tracking & counter
├── config.json          # Per-project configuration
├── project.md           # Project overview (optional)
├── architecture.md      # Architecture (optional)
├── conventions.md       # Coding rules (optional)
├── logs/                # Debug and refine logs
└── sessions/            # Per-session records (auto)
    └── *.l1.jsonl       # L1 session transcripts (deduplicated)
```

---

## Memory Rotation

When `memory.md` grows beyond **23,750 tokens** (~95KB):
1. Current content archived to `memory_YYYYMMDD_HHMMSS.md`
2. Last **2,375 tokens** kept as carryover
3. Haiku agent generates L3 JSON summary of the archived content

### Search Across All Layers

**Use slash command (recommended):**
```
/memory-keeper:search-memory auth
```

**Or ask Claude directly:**
> "Search memory for authentication related work"

---

## Slash Commands

All available skills (slash commands):

### Memory Management

| Command | What It Does |
|---------|-------------|
| `/memory-keeper:save-memory` | Trigger an immediate memory save |
| `/memory-keeper:load-memory` | Reload memory context (useful after manual edits or compaction) |
| `/memory-keeper:search-memory keyword` | Search past sessions across L1/L2/L3 layers |
| `/memory-keeper:clear-memory` | Clean up old memory files |

### Structured Work (D/P/T/I Documents)

| Command | What It Does |
|---------|-------------|
| `/memory-keeper:discussing "topic"` | Create or update a Discussion document (D) |
| `/memory-keeper:planning "topic"` | Create or update a Plan document (P) |
| `/memory-keeper:ticketing P001 "title"` | Create or update a Ticket document (T) linked to a plan |
| `/memory-keeper:investigating "topic"` | Run a multi-agent Investigation (I) |

### Workflows

| Command | What It Does |
|---------|-------------|
| `/memory-keeper:regressing "topic" N` | Iterative optimization: N cycles of Plan-then-Ticket, wrapped in a Discussion |
| `/memory-keeper:light-workflow` | Lightweight one-shot agent orchestration for standalone tasks |
| `/memory-keeper:verifying` | Create or run project-specific verification tools |
| `/memory-keeper:lessons` | Manage project-specific lessons (format guidelines, creation) |

> **Tip:** For basic memory operations, you can also just ask Claude directly (e.g., "save memory now", "search memory for auth").

---

## Document System (D/P/T/I)

Memory Keeper includes a structured document system for organizing complex work.

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

Use `/memory-keeper:regressing "topic" N` for tasks that need multiple rounds of refinement:
- Creates a single Discussion (D) as wrapper
- Runs N cycles, each consisting of Plan (P) then Ticket (T)
- Each cycle's scope is determined by the previous cycle's verification results, not pre-allocated

### Light Workflow (One-Shot Tasks)

Use `/memory-keeper:light-workflow` for simple standalone tasks that do not need the full D/P/T document trail. It provides agent orchestration (Work Agent + Review Agent) without the overhead of tracked documents.

---

## Core Philosophy

Memory Keeper enforces several behavioral rules via CLAUDE.md injection. You do not need to configure these; they activate automatically.

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
| `SessionStart` | `load-memory.js` | Session begins | Loads memory.md, L3 summaries, project files into context |
| `PostToolUse` | `counter.js check` | After each tool use | Increments counter; triggers auto-save + delta extraction at interval |
| `PreToolUse` | `regressing-guard.js` | Before Write/Edit | Enforces phase-based restrictions during active regressing sessions |
| `SessionEnd` | `counter.js final` | Session ends | Creates final L1 backup, extracts remaining delta |

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

- **Above the line**: Auto-managed by the plugin. Updated every prompt via `syncRulesToClaudeMd()`. Contains PRINCIPLES, SCOPE DEFINITIONS, UNDERSTANDING-FIRST, VERIFICATION-FIRST, INTERFERENCE PATTERNS, REQUIREMENTS, VIOLATIONS, and ADDITIONAL RULES.
- **Below the line**: Your project-specific content. The plugin never modifies anything below this marker.

### Dual Injection

The plugin uses two injection mechanisms:
1. **CLAUDE.md sync**: Full rules written to the file on disk (persists across sessions, visible to you)
2. **COMPRESSED_CHECKLIST**: A condensed reminder injected into Claude's context every prompt via the `UserPromptSubmit` hook (not written to disk, reduces token usage by ~77% vs. full rules)

---

## Configuration

`.claude/memory/config.json` (per-project) or `~/.claude/memory-keeper/config.json` (global):

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
echo "Next.js 14 + TypeScript + Prisma" > .claude/memory/project.md
echo "src/app - App Router, src/components - UI" > .claude/memory/architecture.md
echo "Functional components, kebab-case files" > .claude/memory/conventions.md
```

---

## Lessons

When Claude notices repeated patterns (2+ times), it proposes a lesson:
- Saved to `.claude/lessons/` as markdown files
- Checked on each session for project-specific rules
- Use `/memory-keeper:lessons` for format guidelines when creating lessons manually

---

## Troubleshooting

### Memory Not Loading
1. Check `.claude/memory/` folder exists
2. Check `memory.md` file exists
3. Run `/memory-keeper:load-memory`

### Auto-save Not Triggering
1. Check counter in `.claude/memory/memory-index.json`
2. Ask Claude: "Reset the memory counter"

### L1 Files Taking Too Much Space
Ask Claude: "Remove duplicate L1 files"

L1 files are deduplicated automatically when created, but manual cleanup may sometimes be needed.

### Rules Not Being Injected
1. Check that `CLAUDE.md` exists in your project root
2. Look for the `## CRITICAL RULES (Core Principles Alignment)` marker
3. Check `.claude/memory/logs/inject-debug.log` for errors

---

## Version Compatibility

| Version | Claude Code | Node.js |
|---------|-------------|---------|
| 19.24.0 | 1.0+ | 18+ |
| 19.22.0 | 1.0+ | 18+ |
| 19.20.0 | 1.0+ | 18+ |
| 19.18.0 | 1.0+ | 18+ |
| 19.9.0 | 1.0+ | 18+ |
| 19.0.0 | 1.0+ | 18+ |
| 18.0.0 | 1.0+ | 18+ |
| 13.9.x-17.x | 1.0+ | 18+ |
