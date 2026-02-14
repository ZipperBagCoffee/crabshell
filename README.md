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
2. **During work** - Auto-save triggers every 25 tool uses, Claude records decisions/patterns/issues directly
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
  "saveInterval": 100,
  "keepRaw": false,
  "rulesInjectionFrequency": 1
}
```
- `saveInterval`: How many tool uses before save (default: 100)
- `keepRaw`: Keep raw.jsonl files after L1 conversion (default: false)
- `rulesInjectionFrequency`: Inject rules every N prompts (default: 1 = every prompt)

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

## CLAUDE.md Integration

The plugin automatically manages a rules section in your project's `CLAUDE.md`:

```markdown
## CRITICAL RULES (Core Principles Alignment)
...plugin-managed rules...
---Add your project-specific rules below this line---

## Your Project Rules (plugin never touches this)
Build pipeline: src → build → dist
Coding conventions: ...
```

- **Above the line**: Auto-managed by the plugin (updated on every session start)
- **Below the line**: Your project-specific content (never modified by the plugin)

> **Note:** The plugin also writes a warning to Claude Code's built-in `MEMORY.md` (at `~/.claude/projects/{project}/memory/MEMORY.md`) to prevent confusion between the two memory systems. This is separate from the plugin's own `memory.md`.

## Version

| Version | Changes |
|---------|---------|
| 13.9.25 | Workflow: Orchestrator vs Agent role division |
| 13.9.24 | Counter-based delta gating, interval 25→100 |
| 13.9.23 | UNDERSTANDING-FIRST rule: gap-based verification |
| 13.9.22 | Timestamp double-escaping fix, MEMORY.md auto-warning (Claude Code distinction) |
| 13.9.21 | Session restart context recovery rule |
| 13.9.20 | Workflow & lessons system with auto-init templates |
| 13.9.19 | CLAUDE.md marker-based sync (preserves project-specific content) |
| 13.9.16 | Restore CLAUDE.md auto-sync, add "Unclear → Ask first", Example 2, 3 new requirements |
| 13.9.9 | 30-second thinking rule with date command verification |
| 13.9.7 | lastMemoryUpdateTs preservation fix |
| 13.9.5 | Dual timestamp headers: `## UTC (local MM-DD_HHMM)` |
| 13.9.4 | Delta extraction append mode |
| 13.9.2 | UTC timestamps, saveInterval 5→25, migrate-timezone.js |
| 13.8.7 | Removed experimental context warning feature |
| 13.8.6 | Proportional delta summarization (1 sentence per ~200 words) |
| 13.8.5 | Stronger delta instruction blocking language |
| 13.8.4 | Script path resolution for all skills |
| 13.8.3 | Added 'don't cut corners' rule |
| 13.8.2 | Fixed memory-index.json field preservation on parse errors |
| 13.8.1 | Windows `echo -e` bug fix (replaced with `printf`) |
| 13.8.0 | Auto-trigger L3 generation after rotation |
| 13.7.0 | Path detection fix for plugin cache execution |
| 13.6.0 | UserPromptSubmit-based delta triggers (more reliable) |
| 13.5.0 | Delta-based auto-save (Haiku summarization), rules injection every prompt |
| 13.0.0 | Token-based memory rotation (L2 archives, L3 summaries) |
| 12.x | Stop hook blocking, L2/L3/L4 workflow improvements |
| 8.x | L1-L4 hierarchical memory system |

## License

MIT
