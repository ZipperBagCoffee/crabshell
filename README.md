# Memory Keeper

**Claude Code forgets everything when a session ends.** What decisions you made yesterday, what bugs you fixed, how your project is structured - you have to explain it all over again every new session.

Memory Keeper solves this. **It automatically saves session content and loads it in the next session.**

## Installation

```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper
```

After installation, **you don't need to do anything**. It works automatically.

## How It Works

1. **Session start** - Loads saved content from previous sessions into Claude's context
2. **During work** - Auto-save triggers every 5 tool uses, Claude records decisions/patterns/issues directly
3. **Session end** - Full conversation backup + final save

## What Gets Saved

### Automatic (No action needed)
- `memory.md` - Session summaries accumulate here (auto-rotates at 23,750 tokens)
- `memory_*.md` - Rotated archives (L2)
- `*.summary.json` - L3 summaries (Haiku-generated)
- `sessions/*.l1.jsonl` - Detailed session transcripts (L1)

### Manual Setup (Optional)
If there's information you want Claude to know every session, **directly edit the files**:

```bash
# Create/edit files in your project's .claude/memory/ folder
echo "React + TypeScript web app." > .claude/memory/project.md
echo "src/ - components, hooks, services" > .claude/memory/architecture.md
echo "Functional components only" > .claude/memory/conventions.md
```

Or just ask Claude: "Save the project info to project.md"

With this setup, **Claude starts every new session knowing this information**.

## Real Usage Examples

### Auto-save Trigger
After the 5th tool use, Claude receives this message:
```
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - 5 tool uses reached
```
Claude then automatically appends a summary to memory.md.

### Search Memory
```bash
# Search across all layers (memory.md, L2 archives, L3 summaries)
node scripts/counter.js search-memory "auth"

# Include L1 session transcripts (slower, more thorough)
node scripts/counter.js search-memory "auth" --deep

# Example output:
# [memory.md]
#   L15: Implemented JWT authentication for API endpoints
# [L3 summaries]
#   [decision] Use refresh tokens for better security
```

## Slash Commands (Recommended)

**Works in any project where the plugin is installed:**

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Save now (don't wait for auto-save) |
| `/memory-keeper:load-memory` | Reload memory (after manual edits) |
| `/memory-keeper:search-memory query` | Search past sessions |
| `/memory-keeper:clear-memory old` | Clean up files older than 30 days |

> **Note:** Slash commands work in any project with the plugin installed. Use these instead of CLI commands.

## Storage Location

```
[project]/.claude/memory/
├── memory.md              # Active rolling memory (auto-rotates at 23,750 tokens)
├── memory_*.md            # Rotated archives (L2)
├── *.summary.json         # L3 summaries (Haiku-generated)
├── memory-index.json      # Rotation tracking & counter
├── project.md             # Project overview (via memory-set)
├── architecture.md        # Architecture (via memory-set)
├── conventions.md         # Coding rules (via memory-set)
├── logs/                  # Refine logs
└── sessions/
    └── *.l1.jsonl         # L1 session transcripts (deduplicated)
```

## Configuration

`.claude/memory/config.json`:
```json
{
  "saveInterval": 5,
  "keepRaw": false
}
```
- `saveInterval`: How many tool uses before save (default: 5)
- `keepRaw`: Keep raw.jsonl files after L1 conversion (default: false)

## CLI Commands (Advanced)

> ⚠️ **Warning:** These commands only work **inside the plugin directory**.
> For normal use, use the **Slash Commands** above.

```bash
# Navigate to plugin directory first
cd ~/.claude/plugins/cache/memory-keeper-plugin  # or your plugin install path

# Core
node scripts/counter.js check                  # Increment counter, trigger auto-save
node scripts/counter.js final                  # Session end handler
node scripts/counter.js reset                  # Reset counter to 0

# View/Set memory
node scripts/counter.js memory-list            # List memory files
node scripts/counter.js memory-get             # View all memory content
node scripts/counter.js memory-get project     # View project.md only
node scripts/counter.js memory-set project "content"
node scripts/counter.js memory-set architecture "content"
node scripts/counter.js memory-set conventions "content"

# Search (hierarchical L3 -> L2 -> L1)
node scripts/counter.js search-memory "query"       # Search memory.md, L2, L3
node scripts/counter.js search-memory "query" --deep  # Include L1 sessions

# Memory rotation
node scripts/counter.js generate-l3 <archive.md>   # Generate L3 summary for archive
node scripts/counter.js migrate-legacy             # Split oversized memory files
node scripts/counter.js compress                   # Archive old sessions (30+ days)
node scripts/counter.js refine-all                 # Process raw.jsonl to L1
node scripts/counter.js dedupe-l1                  # Remove duplicate L1 files
```

**To run CLI from other projects:**
```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/counter.js" <command>
```

## Documentation

- [User Manual](docs/USER-MANUAL.md) - Detailed usage
- [Architecture](docs/ARCHITECTURE.md) - System design

## Hierarchical Memory Architecture

```
L1 (sessions/*.l1.jsonl)  - Refined session transcripts (~95% size reduction)
     ↓
L2 (memory_*.md)          - Rotated archives (auto at 23,750 tokens)
     ↓
L3 (*.summary.json)       - Haiku-generated summaries
     ↓
memory.md                 - Active rolling memory (loaded at startup)
```

- **L1**: Raw transcripts refined to keep only meaningful content
- **L2**: memory.md auto-rotates when too large, archives preserved
- **L3**: AI-generated summaries of archived content
- **Search**: `search-memory` traverses L3 → L2 → memory.md (add `--deep` for L1)

## Version

| Version | Changes |
|---------|---------|
| 13.3.1 | Fix memory-index.json structure handling bug |
| 13.2.0 | L1 deduplication, facts.json removal, file deletion warnings |
| 13.0.0 | Token-based memory rotation (L2 archives, L3 summaries) |
| 12.x | Stop hook blocking, L2/L3/L4 workflow improvements |
| 8.x | L1-L4 hierarchical memory system |
| 7.x | Hierarchical memory (project/architecture/conventions) |

## License

MIT
