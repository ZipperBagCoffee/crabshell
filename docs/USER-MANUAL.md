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
- Auto-save triggers every 25 tool uses
- Delta extracted from L1 session log → Haiku summarizes → appended to `memory.md`
- Auto-rotation when memory.md exceeds 23,750 tokens
- Rules re-injected every prompt to ensure Claude follows them

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

**Use slash command (recommended):**
```
/memory-keeper:search-memory auth
```

**Or ask Claude directly:**
> "Search memory for authentication related work"

---

---

## Advanced Usage (Manual)

### Setting Project Information

Set information you want Claude to know **at the start of every session**.

**Option 1: Ask Claude (Recommended)**
> "Save this to project.md: This is a Next.js 14 app with TypeScript and Prisma."

**Option 2: Edit files directly**
```bash
# In your project folder
echo "Next.js 14 + TypeScript + Prisma" > .claude/memory/project.md
echo "src/app - App Router, src/components - UI" > .claude/memory/architecture.md
echo "Functional components, kebab-case files" > .claude/memory/conventions.md
```

### Check Settings

**Ask Claude:**
> "Show me what's in memory"

**Or view files directly:**
```bash
cat .claude/memory/project.md
cat .claude/memory/architecture.md
```

---

## Slash Commands (Recommended)

**These work in any project with the plugin installed:**

| Command | When to Use |
|---------|-------------|
| `/memory-keeper:save-memory` | Save immediately |
| `/memory-keeper:load-memory` | Reload after manual file edits |
| `/memory-keeper:search-memory keyword` | Find past work |
| `/memory-keeper:clear-memory old` | Clean up old files |

> **Tip:** For most operations, just ask Claude directly instead of using commands.

---

## Maintenance

**Ask Claude for maintenance tasks:**
> "Clean up old memory files"
> "Reset the memory counter"

Or use slash command:
```
/memory-keeper:clear-memory old
```

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

---

## Configuration

`.claude/memory/config.json`:

```json
{
  "saveInterval": 50,
  "keepRaw": false,
  "rulesInjectionFrequency": 1
}
```

- `saveInterval`: Tool uses before auto-save trigger (default: 50)
- `keepRaw`: Keep raw.jsonl after L1 conversion (default: false)
- `rulesInjectionFrequency`: Inject rules every N prompts (default: 1 = every prompt)

---

## CLAUDE.md Integration (v13.9.16+)

The plugin automatically manages a rules section in your project's `CLAUDE.md`:

```markdown
## CRITICAL RULES (Core Principles Alignment)
...plugin-managed rules...
---Add your project-specific rules below this line---

## Your Project Rules (plugin never touches this)
Build pipeline: src → build → dist
```

- **Above the line**: Auto-managed by the plugin (updated every prompt)
- **Below the line**: Your project-specific content (never modified by the plugin)

## Workflow & Lessons System (v13.9.20+)

On first run, the plugin creates:

- `.claude/workflow/workflow.md` - Understanding-First workflow template
- `.claude/lessons/` - Project-specific rules directory

### Workflow
The workflow template provides a structured approach for complex tasks:
1. Understanding phase (gap closing)
2. Planning phase (plan document)
3. Implementation phase
4. Verification phase

### Lessons
When you notice repeated patterns (2+ times), propose a lesson:
- Claude saves it to `.claude/lessons/`
- Lessons are checked on each session for project-specific rules

## Version Compatibility

| Version | Claude Code | Node.js |
|---------|-------------|---------|
| 13.9.x | 1.0+ | 18+ |
