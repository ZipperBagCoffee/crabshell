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
- Stored decisions/patterns/issues (`facts.json`) sent to Claude
- Project info you set (`project.md` etc.) sent to Claude

**2. During Work:**
- Auto-save triggers every 5 tool uses
- Claude automatically saves current work summary

**3. Session End:**
- Full conversation backed up (`.raw.jsonl`)
- Final session summary saved
- Old files cleaned up

### What Gets Saved

```
.claude/memory/
├── memory.md       # Session summaries (auto)
├── facts.json      # Decisions/patterns/issues (auto)
└── sessions/       # Per-session records (auto)
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
Team: 2 frontend, 1 backend
"
```

#### architecture.md - System Structure

```bash
node scripts/counter.js memory-set architecture "
Directory Structure:
src/
  app/           - Next.js 14 App Router
  components/    - React components
    ui/          - Common UI (Button, Input, Modal)
    features/    - Feature components (Cart, Checkout)
  lib/           - Utilities
  services/      - API call wrappers

Database:
- users: User info
- products: Products
- orders: Orders
- cart_items: Shopping cart

API Rules:
- All APIs under /api/v1/
- Auth-required APIs under /api/v1/protected/
- Error format: { error: string, code: number }
"
```

#### conventions.md - Coding Rules

```bash
node scripts/counter.js memory-set conventions "
Code Style:
- Functional components only
- Prefer interface over type (type only for unions)
- Filenames: kebab-case
- Component names: PascalCase
- Variable/function names: camelCase

Testing:
- All util functions must have tests
- Components: only critical ones
- Test files: *.test.ts

Commits:
- Run pnpm lint && pnpm test before commit
- Commit messages: feat:, fix:, docs:, refactor:, test:
"
```

### Check Settings

```bash
# List all memory files
node scripts/counter.js memory-list

# Example output:
# [MEMORY_KEEPER] Memory Structure:
#   ✓ project.md (15 lines, 423 bytes)
#   ✓ architecture.md (28 lines, 892 bytes)
#   ○ conventions.md - not created
#   ✓ memory.md (156 lines, 4521 bytes) [rolling]
#   ✓ facts.json (12d/5p/3i)

# View specific memory content
node scripts/counter.js memory-get project
node scripts/counter.js memory-get architecture
node scripts/counter.js memory-get              # View all
```

---

## Decision Management

### Automatic Extraction

When Claude saves a session file in this format:

```markdown
## Decisions
- [technology] Use JWT: Better scalability than sessions
  - concepts: auth, security
- [architecture] API versioning: Maintain backward compatibility
  - files: src/app/api/v1/
```

It's automatically extracted to `facts.json`.

### Manual Addition

When you want to record an important decision immediately:

```bash
# Basic
node scripts/counter.js add-decision "decision content" "reason"

# With type
node scripts/counter.js add-decision "Use PostgreSQL" "Complex queries are common" technology

# With related files and concepts
node scripts/counter.js add-decision "Add Redis caching" "Improve API response speed" technology "src/lib/cache.ts" "caching,performance"
```

**Type options:**
- `architecture` - System structure related
- `technology` - Technology choices
- `approach` - Implementation approaches

### Search

```bash
# Summary
node scripts/counter.js search

# Keyword search
node scripts/counter.js search "auth"

# Filter by type
node scripts/counter.js search --type=technology

# Filter by concept
node scripts/counter.js search --concept=security

# Filter by file
node scripts/counter.js search --file=auth

# Combine filters
node scripts/counter.js search "cache" --type=architecture
```

---

## Pattern Management

Record recurring patterns or rules:

```bash
# Basic
node scripts/counter.js add-pattern "Wrap all API responses in try-catch"

# With type
node scripts/counter.js add-pattern "One component per file" convention
node scripts/counter.js add-pattern "DB queries inside transactions" best-practice
node scripts/counter.js add-pattern "Never use any type" anti-pattern
```

**Type options:**
- `convention` - Team rules
- `best-practice` - Good habits
- `anti-pattern` - Things to avoid

---

## Issue Management

Record bugs or problems:

```bash
# Open issue
node scripts/counter.js add-issue "Payment page slow" "open" performance

# Resolved issue
node scripts/counter.js add-issue "Login token not expiring" "resolved" security

# With related files
node scripts/counter.js add-issue "Cart sync bug" "resolved" bugfix "src/hooks/useCart.ts" "cart,state-management"
```

**Type options:**
- `bugfix` - Bugs
- `performance` - Performance issues
- `security` - Security issues
- `feature` - Feature related

---

## Slash Commands

Use directly in Claude Code:

| Command | When to Use |
|---------|-------------|
| `/memory-keeper:save-memory` | Save immediately |
| `/memory-keeper:load-memory` | Reload after manual file edits |
| `/memory-keeper:search-memory keyword` | Find past work |
| `/memory-keeper:clear-memory old` | Clean up old files |

---

## Maintenance

### Clean Up Old Files

Archive session files older than 30 days to monthly archives:

```bash
node scripts/counter.js compress

# sessions/2025-10-15_0300.md -> sessions/archive/2025-10.md
```

### Reset Facts

Reset facts.json (keeps memory files):

```bash
node scripts/counter.js clear-facts
```

### Reset Counter

Reset auto-save counter to 0:

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
2. Check `config.json` `saveInterval` (default 5)
3. Reset counter with `node scripts/counter.js reset`

### Session Files Missing

1. Ensure session ended properly (`/exit` not Ctrl+C)
2. Check `.claude/memory/debug-hook.json`
3. Check `.claude/memory/error.log`

---

## Configuration

`.claude/memory/config.json`:

```json
{
  "saveInterval": 5
}
```

- `saveInterval`: Tool uses before save (default: 5, range: 1-50)

---

## Version Compatibility

| Version | Claude Code | Node.js |
|---------|-------------|---------|
| 7.0.x | 1.0+ | 18+ |
| 6.x | 1.0+ | 18+ |
