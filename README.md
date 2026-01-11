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
- `memory.md` - Session summaries accumulate here
- `facts.json` - Decisions, patterns, issues stored in structured format
- `sessions/` - Detailed records for each session

### Manual Setup (Optional)
If there's information you want Claude to know every session:

```bash
# Set project overview
node scripts/counter.js memory-set project "
React + TypeScript web app.
Backend: Node.js + PostgreSQL.
Currently developing user authentication.
"

# Set architecture
node scripts/counter.js memory-set architecture "
src/
  components/  - React components
  hooks/       - Custom hooks
  services/    - API calls
  utils/       - Utilities

State management: Zustand
API: REST, /api/v1/ prefix
"

# Set coding conventions
node scripts/counter.js memory-set conventions "
- Functional components only
- Tests required (Jest + React Testing Library)
- Lint must pass before commit
- Variable names: camelCase
"
```

With this setup, **Claude starts every new session knowing this information**.

## Real Usage Examples

### Auto-save Trigger
After the 5th tool use, Claude receives this message:
```
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - 5 tool uses reached
```
Claude then automatically saves the current work.

### Search Decisions
```bash
# Find auth-related decisions
node scripts/counter.js search "auth"

# Example output:
# [DECISION d001] [technology] 2025-12-21: Use JWT
#   Reason: Better scalability than sessions
# [DECISION d003] [architecture] 2025-12-21: Token refresh on client side
#   Reason: Reduce server load
```

### Manually Record Important Decisions
```bash
# Record a technology decision
node scripts/counter.js add-decision "Use MongoDB instead of PostgreSQL" "Document-based data is common" technology

# Record a pattern
node scripts/counter.js add-pattern "API errors always return { error: string, code: number }" convention

# Record a resolved issue
node scripts/counter.js add-issue "Login redirect not working" "resolved" bugfix
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Save now (don't wait for auto-save) |
| `/memory-keeper:load-memory` | Reload memory (after manual edits) |
| `/memory-keeper:search-memory query` | Search past sessions |
| `/memory-keeper:clear-memory old` | Clean up files older than 30 days |

## Storage Location

```
[project]/.claude/memory/
├── memory.md              # Session summaries (auto)
├── project.md             # Project overview (via memory-set)
├── architecture.md        # Architecture (via memory-set)
├── conventions.md         # Coding rules (via memory-set)
├── facts.json             # Structured decisions/patterns/issues (auto)
└── sessions/
    ├── 2025-12-21_0300.md      # Session summary
    └── 2025-12-21_0300.raw.jsonl # Full conversation backup
```

## Configuration

`.claude/memory/config.json`:
```json
{
  "saveInterval": 5
}
```
- `saveInterval`: How many tool uses before save (default: 5)

## CLI Commands

```bash
# View memory
node scripts/counter.js memory-list            # List memory files
node scripts/counter.js memory-get             # View all memory content
node scripts/counter.js memory-get project     # View project.md only

# Set memory
node scripts/counter.js memory-set project "content"
node scripts/counter.js memory-set architecture "content"
node scripts/counter.js memory-set conventions "content"

# Search
node scripts/counter.js search                 # Summary of stored facts
node scripts/counter.js search "keyword"       # Search by keyword
node scripts/counter.js search --type=architecture  # Filter by type
node scripts/counter.js search --concept=auth       # Filter by concept

# Manual recording
node scripts/counter.js add-decision "content" "reason" [type]
node scripts/counter.js add-pattern "pattern" [type]
node scripts/counter.js add-issue "issue" "open|resolved" [type]

# Maintenance
node scripts/counter.js compress               # Archive files older than 30 days
node scripts/counter.js clear-facts            # Reset facts.json
node scripts/counter.js reset                  # Reset counter
```

**Type options:**
- decisions: `architecture`, `technology`, `approach`
- patterns: `convention`, `best-practice`, `anti-pattern`
- issues: `bugfix`, `performance`, `security`, `feature`

## Documentation

- [User Manual](docs/USER-MANUAL.md) - Detailed usage
- [Architecture](docs/ARCHITECTURE.md) - System design

## v8.1.0 - L2-L3 Hierarchical Summarization

### L2: Exchange Summaries
- Session end prompts Claude to generate structured summaries
- Each user request → response cycle becomes an "exchange"
- Stored as `.l2.json` files with keywords and file references

### L3: Concept Grouping
- Related exchanges grouped by file/keyword overlap
- Concepts stored in `concepts.json`
- Automatic classification with 30% overlap threshold

### New Commands
- `save-l2 <session> <json>` - Save L2 summaries
- `update-concepts <l2-path>` - Update concepts from L2
- `list-concepts` - List all concepts

## v8.0.0 - Hierarchical Memory (L1)

### L1: Refined Raw Content

Raw transcripts are now automatically refined to remove junk metadata:
- Removes: queue-operation, file-history-snapshot, thinking blocks
- Keeps: user text, assistant text, tool summaries with diff
- Size reduction: ~95% (20MB → 1MB)

### New Commands

- `refine-all` - Process all existing raw files to create L1 versions

## Version

| Version | Changes |
|---------|---------|
| 8.1.0 | L2-L3 hierarchical summarization |
| 8.0.0 | L1 hierarchical memory refinement |
| 7.1.0 | Direct fact extraction (no session file step) |
| 7.0.1 | clearFacts bug fix, added slash command skills |
| 7.0.0 | Hierarchical memory (project/architecture/conventions) |
| 6.5.0 | File references + concept tagging |
| 6.4.0 | Type classification + privacy tags |

## License

MIT
