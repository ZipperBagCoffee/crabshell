# Memory Keeper User Manual

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
- Previous session summary (`memory.md`) sent to Claude
- L3 summaries of archived memory sent to Claude
- Stored decisions/patterns/issues (`facts.json`) sent to Claude
- Project info you set (`project.md` etc.) sent to Claude

**2. During Work:**
- Auto-save triggers every 5 tool uses
- Claude records decisions/patterns/issues directly via CLI commands
- Summary appended to `memory.md`
- Auto-rotation when memory.md exceeds 23,750 tokens

**3. Session End:**
- Full conversation backed up (`.l1.jsonl`)
- Final session summary saved

### What Gets Saved

```
.claude/memory/
├── memory.md           # Active rolling memory (auto-rotates)
├── memory_*.md         # Rotated archives (L2)
├── *.summary.json      # L3 summaries (Haiku-generated)
├── index.json          # Rotation tracking
├── facts.json          # Decisions/patterns/issues (auto)
└── sessions/           # Per-session records (auto)
    └── *.l1.jsonl      # L1 session transcripts
```

---

## Memory Rotation (v13.0.0)

When `memory.md` grows beyond **23,750 tokens** (~95KB):
1. Current content archived to `memory_YYYYMMDD_HHMMSS.md`
2. Last **2,375 tokens** kept as carryover
3. Haiku agent generates L3 JSON summary

### Search Across All Layers

```bash
# Search L1/L2/L3 layers
node scripts/counter.js search-memory "query"

# Include L1 raw sessions (slower but thorough)
node scripts/counter.js search-memory "query" --deep

# Filter by type
node scripts/counter.js search-memory --type=decision
```

### Manual L3 Generation

```bash
# Generate L3 summary for archived file
node scripts/counter.js generate-l3 memory_20260113_120000.md
```

### Split Oversized Legacy Files

```bash
node scripts/counter.js migrate-legacy
```

---

## Advanced Usage (Manual)

### Setting Project Information

Set information you want Claude to know **at the start of every session**.

#### project.md - Project Overview

```bash
node scripts/counter.js memory-set project "
Project: Online Shopping Mall
Tech Stack: Next.js 14, TypeScript, Prisma, PostgreSQL
Current Status: MVP development, implementing payment feature
"
```

#### architecture.md - System Structure

```bash
node scripts/counter.js memory-set architecture "
Directory Structure:
src/
  app/           - Next.js 14 App Router
  components/    - React components
  lib/           - Utilities
  services/      - API call wrappers
"
```

#### conventions.md - Coding Rules

```bash
node scripts/counter.js memory-set conventions "
Code Style:
- Functional components only
- Filenames: kebab-case
- Component names: PascalCase
"
```

### Check Settings

```bash
# List all memory files
node scripts/counter.js memory-list

# View specific memory content
node scripts/counter.js memory-get project
node scripts/counter.js memory-get              # View all
```

---

## Decision Management

### Manual Addition

```bash
# Basic
node scripts/counter.js add-decision "decision content" "reason"

# With type
node scripts/counter.js add-decision "Use PostgreSQL" "Complex queries" technology

# With related files and concepts
node scripts/counter.js add-decision "Add Redis caching" "Speed" technology "src/lib/cache.ts" "caching,performance"
```

**Type options:** `architecture`, `technology`, `approach`

### Search

```bash
# Legacy search (facts.json only)
node scripts/counter.js search "auth"
node scripts/counter.js search --type=technology

# New integrated search (L1/L2/L3)
node scripts/counter.js search-memory "auth"
node scripts/counter.js search-memory "auth" --deep
```

---

## Pattern Management

```bash
node scripts/counter.js add-pattern "Wrap all API responses in try-catch"
node scripts/counter.js add-pattern "One component per file" convention
```

**Type options:** `convention`, `best-practice`, `anti-pattern`

---

## Issue Management

```bash
node scripts/counter.js add-issue "Payment page slow" "open" performance
node scripts/counter.js add-issue "Login bug" "resolved" bugfix
```

**Type options:** `bugfix`, `performance`, `security`, `feature`

---

## Slash Commands

| Command | When to Use |
|---------|-------------|
| `/memory-keeper:save-memory` | Save immediately |
| `/memory-keeper:load-memory` | Reload after manual file edits |
| `/memory-keeper:search-memory keyword` | Find past work |
| `/memory-keeper:clear-memory old` | Clean up old files |

---

## Maintenance

### Clean Up Old Files

```bash
node scripts/counter.js compress
```

### Reset Facts

```bash
node scripts/counter.js clear-facts
```

### Reset Counter

```bash
node scripts/counter.js reset
```

---

## Troubleshooting

### Memory Not Loading

1. Check `.claude/memory/` folder exists
2. Check `memory.md` file exists
3. Run `/memory-keeper:load-memory`

### Auto-save Not Triggering

1. Check `facts.json._meta.counter` value
2. Reset counter with `node scripts/counter.js reset`

---

## Configuration

`.claude/memory/config.json`:

```json
{
  "saveInterval": 5,
  "keepRaw": false
}
```

---

## Version Compatibility

| Version | Claude Code | Node.js |
|---------|-------------|---------|
| 13.0.x | 1.0+ | 18+ |
| 12.x | 1.0+ | 18+ |
| 8.x | 1.0+ | 18+ |
