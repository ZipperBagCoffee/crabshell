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
├── memory.md            # Active rolling memory (auto-rotates)
├── memory_*.md          # Rotated archives (L2)
├── *.summary.json       # L3 summaries (Haiku-generated)
├── memory-index.json    # Rotation tracking & counter
├── project.md           # Project overview (optional)
├── architecture.md      # Architecture (optional)
├── conventions.md       # Coding rules (optional)
├── logs/                # Refine logs
└── sessions/            # Per-session records (auto)
    └── *.l1.jsonl       # L1 session transcripts (deduplicated)
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

### Reset Counter

```bash
node scripts/counter.js reset
```

### Process Raw Files to L1

```bash
node scripts/counter.js refine-all
```

---

## Troubleshooting

### Memory Not Loading

1. Check `.claude/memory/` folder exists
2. Check `memory.md` file exists
3. Run `/memory-keeper:load-memory`

### Auto-save Not Triggering

1. Check counter in `memory-index.json`
2. Reset counter with `node scripts/counter.js reset`

### L1 Files Taking Too Much Space

L1 files are deduplicated automatically when created, but manual cleanup may be needed:
```bash
# Remove duplicate L1 files (keeps largest per session)
node scripts/counter.js dedupe-l1
```

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
| 13.2.x | 1.0+ | 18+ |
