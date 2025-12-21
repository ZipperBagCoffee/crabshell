# Memory Keeper User Manual

## Installation

### From GitHub (Recommended)
```bash
# Add marketplace
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin

# Install plugin
/plugin install memory-keeper
```

### Local Development
```bash
claude --plugin-dir /path/to/memory-keeper-plugin
```

## How It Works

### Automatic Flow

1. **Session Start**: Previous memory loaded automatically
2. **During Session**: Every 5 tool uses triggers auto-save
3. **Session End**: Final comprehensive save + transcript backup

### What Gets Saved

| Type | Location | Content |
|------|----------|---------|
| Rolling Summary | `.claude/memory/memory.md` | Cumulative session summaries |
| Session Details | `.claude/memory/sessions/YYYY-MM-DD_HHMM.md` | Full session summary |
| Raw Transcript | `.claude/memory/sessions/YYYY-MM-DD_HHMM.raw.jsonl` | Complete conversation |
| Structured Facts | `.claude/memory/facts.json` | Decisions, patterns, issues |

## Usage

### Automatic (Default)

Memory Keeper works automatically. Just use Claude Code normally:

1. Start a session - previous context loads automatically
2. Work on your project - memory saves every 5 tool uses
3. End session - final save happens automatically

When auto-save triggers, Claude will:
1. Save summary to `memory.md`
2. Create structured session file
3. Extract facts automatically

### Manual Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Force immediate save |
| `/memory-keeper:load-memory` | Reload memory context |
| `/memory-keeper:search-memory [query]` | Search past sessions |
| `/memory-keeper:clear-memory [all\|old]` | Clean up old files |

### CLI Commands

Run directly from terminal:

```bash
# Search facts
node scripts/counter.js search "query"

# View summary
node scripts/counter.js search

# Hierarchical Memory (v7.0.0)
node scripts/counter.js memory-set project "Project description..."
node scripts/counter.js memory-set architecture "Architecture decisions..."
node scripts/counter.js memory-set conventions "Coding conventions..."
node scripts/counter.js memory-get project
node scripts/counter.js memory-get              # View all memory files
node scripts/counter.js memory-list             # List memory file status

# Add facts manually
node scripts/counter.js add-decision "decision" "reason"
node scripts/counter.js add-pattern "pattern"
node scripts/counter.js add-issue "issue" "open"

# Extract facts from session file
node scripts/counter.js extract-facts 2025-12-21_0300

# Clear facts
node scripts/counter.js clear-facts

# Archive old files
node scripts/counter.js compress
```

## Configuration

Create `.claude/memory/config.json`:

```json
{
  "saveInterval": 5
}
```

- `saveInterval`: Number of tool uses before auto-save (default: 5)

## Session File Format

When Claude saves a session, it uses this format:

```markdown
# Session 2025-12-21_0300

## Summary
Implemented new feature X with tests.

## Decisions
- Use React hooks: Better state management
- Skip Redux: Overkill for this project

## Patterns
- Always run tests before commit
- Use TypeScript for new files

## Issues
- Build fails on Windows: resolved
- Memory leak in dashboard: open
```

Facts are automatically extracted from these sections.

## Storage Structure

```
[your-project]/
└── .claude/
    └── memory/
        ├── memory.md              # Rolling summary
        ├── project.md             # Project overview (v7.0.0+)
        ├── architecture.md        # Architecture decisions (v7.0.0+)
        ├── conventions.md         # Coding conventions (v7.0.0+)
        ├── facts.json             # Structured facts + concepts index
        ├── config.json            # Settings (optional)
        └── sessions/
            ├── 2025-12-21_0300.md      # Session summary
            ├── 2025-12-21_0300.raw.jsonl # Raw transcript
            └── archive/
                └── 2025-12.md          # Monthly archive
```

## Hierarchical Memory (v7.0.0)

| File | Purpose | When to Update |
|------|---------|----------------|
| `project.md` | Project overview, goals, tech stack | Project start/changes |
| `architecture.md` | Architecture decisions, diagrams | Structure changes |
| `conventions.md` | Coding style, naming rules | Rule additions |
| `memory.md` | Session summaries (rolling) | Every session |

## Searching Memory

### Search Facts
```bash
node scripts/counter.js search "react"
```
Output:
```
[DECISION d001] 2025-12-21: Use React hooks
  Reason: Better state management
[PATTERN p003] 2025-12-21: Use TypeScript for new files
```

### Search Sessions
```bash
grep -r -i "react" .claude/memory/sessions/*.md
```

### View Summary
```bash
node scripts/counter.js search
```
Output:
```
[MEMORY_KEEPER] Memory Summary:
  Decisions: 5
  Patterns: 3
  Issues: 2
  Sessions: 12
```

## Troubleshooting

### Memory Not Loading
1. Check `.claude/memory/memory.md` exists
2. Run `/memory-keeper:load-memory` manually

### Facts Not Saved
1. Ensure session file uses correct format (## Decisions, ## Patterns, ## Issues)
2. Check `.claude/memory/facts.json` for errors
3. Run `node scripts/counter.js extract-facts` manually

### Auto-save Not Triggering
1. Check `facts.json._meta.counter` value
2. Verify `saveInterval` in config (default: 5)
3. Reset counter: `node scripts/counter.js reset`

### Windows Issues
- Use forward slashes in paths
- Use Node.js scripts, not bash
- Check PowerShell execution policy

## Best Practices

1. **Let it run automatically** - Manual intervention rarely needed
2. **Check facts periodically** - `node scripts/counter.js search`
3. **Review sessions** - Read `.claude/memory/sessions/` for context
4. **Archive monthly** - `node scripts/counter.js compress`

## Version Compatibility

| Version | Claude Code | Node.js |
|---------|-------------|---------|
| 7.0.0 | 1.0+ | 18+ |
| 6.5.0 | 1.0+ | 18+ |
| 6.4.0 | 1.0+ | 18+ |
| 6.3.0 | 1.0+ | 18+ |
