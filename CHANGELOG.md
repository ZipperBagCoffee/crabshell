# Changelog

## v13.0.0 (2026-01-13)
### Token-Based Memory Rotation
- **L2 Auto-rotation**: memory.md automatically rotates when exceeding 23,750 tokens
- **Archive naming**: `memory_YYYYMMDD_HHMMSS.md` with 2,375 token carryover
- **L3 Haiku summaries**: Rotated archives summarized to JSON via Haiku agent
- **Integrated search**: `search-memory` searches across L1/L2/L3 layers
- **Legacy migration**: `migrate-legacy` splits oversized memory files

### New Files
- `scripts/constants.js` - Centralized configuration (thresholds, paths)
- `scripts/memory-rotation.js` - Token-based rotation logic
- `scripts/legacy-migration.js` - Large file splitting utility
- `scripts/search.js` - Multi-layer search implementation
- `scripts/init.js` - Project initialization
- `agents/memory-summarizer.md` - Haiku agent for L3 summaries
- `skills/memory-rotate/SKILL.md` - Auto-trigger skill

### New Commands
- `search-memory [query]` - Search L1/L2/L3 with filters
- `generate-l3 <file>` - Generate L3 summary for archive
- `migrate-legacy` - Split oversized memory files

## v12.3.0 (2026-01-13)
### Clearer Hook Instructions
- Fixed check() auto-save: correct subagent_type "memory-keeper:l2-summarizer"
- Fixed final() blocking: clear step-by-step L1→L2→L3→L4 workflow
- Explains that L1 is auto-created (no manual action needed)
- Each layer shows exact command/Tool call needed
- Updated l2-summarizer.md with clearer instructions

## v12.2.0 (2026-01-13)
### Complete L2/L3/L4 Blocking
- Stop hook now checks ALL: L2 file, L3 concepts, L4 compress, memory.md
- Shows status: ✓L2 | ✓L3 | ✗L4 | ✓mem
- Only allows stop when ALL complete
- Fixes issue where L3/L4 were being ignored

## v12.1.0 (2026-01-13)
### Blocking Stop Hook for L2 Enforcement
- Stop hook now uses `decision: block` to FORCE L2 save before session ends
- Uses built-in Task tool with `model: "haiku"` (no API key required)
- Creates `.l2-pending` marker file to track save state
- Fixes issue where L2 instructions were ignored

### Bug Fixes
- Reset corrupted concepts.json (41 duplicate entries cleaned)
- Removed invalid `customAgents` field from plugin.json

## v12.0.2 (2026-01-13)
- Fix: tmpclaude-*-cwd cleanup in subdirectories (Claude Code bug #17600 workaround)

## v12.0.1 (2026-01-13)
- Fix: Improved tmpclaude cleanup to check multiple directories

## v12.0.0 (2026-01-13)
### Haiku Proactive Subagent
- Automatic L2 generation via proactive haiku subagent
- No manual intervention - spawns on auto-save trigger

### L2: ProMem Algorithm
- 3-step fact extraction: Extract → Verify → Save
- Max 10 facts per session
- Based on arxiv:2601.04463 (73%+ memory integrity)

### L3: LiSA Semantic Assignment
- Claude assigns conceptId/conceptName directly
- Removed keyword overlap calculation
- 70% similarity threshold

### L4: Reflection Process
- Pattern detection from L2 files (3+ occurrences)
- Utility-based cleanup (old rules, high contradictions)
- Auto-promotion candidates in compress output

## v9.0.x (2026-01-12)
- Fix: getProjectDir() cwd folder creation bug
- Fix: facts.json unified structure
- Fix: CLAUDE_PLUGIN_ROOT in command skills

## v8.2.0 (2026-01-11)
- L4 permanent memory with auto-triggers
- Self-correction: confidence + contradictions tracking
- Keyword indexing for fast search

## v8.1.0 (2026-01-11)
- L2 exchange summaries (`.l2.json`)
- L3 concept grouping (`concepts.json`)

## v8.0.0 (2026-01-11)
- L1 refined transcripts (95% size reduction)
- Removes metadata, keeps user/assistant text + tool summaries

## v7.0.0 (2025-12-21)
- Hierarchical memory files (project/architecture/conventions)
- Direct fact extraction

## v6.x (2025-12-21)
- File references + concept tagging
- Type classification + privacy tags
