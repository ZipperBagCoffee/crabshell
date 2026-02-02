# Changelog

## v13.9.9 (2026-02-02)
### New Critical Rule
- **30-second thinking rule**: Added mandatory thinking time before any action
  - Rule: "Before ANY action: use `date` command to check start time, think for at least 30 seconds, verify 30 seconds passed with `date` again."
  - Forces deliberate verification before acting
  - Prevents assumption-based mistakes

## v13.9.7 (2026-02-01)
### Bug Fix
- **lastMemoryUpdateTs preservation**: Fixed `ensureMemoryStructure()` in init.js
  - Previously: only preserved known fields (counter, rotatedFiles, stats, current, version)
  - Now: preserves ALL existing fields using spread operator
  - Prevents `lastMemoryUpdateTs` and `deltaCreatedAtMemoryMtime` from being erased on session start

## v13.9.6 (2026-02-01)
### SKILL.md Fix
- **Single command for dual timestamps**: Combined date commands into printf
  - Previous: separate commands without variable storage
  - Now: `$(date -u +'%Y-%m-%d_%H%M')` and `$(date +'%m-%d_%H%M')` inline
  - Clearer instruction with example output

## v13.9.5 (2026-02-01)
### Dual Timestamp Headers
- **UTC + local time**: Memory headers now show both timestamps
  - Format: `## 2026-02-01_1738 (local 02-01_0938)`
  - UTC as main timestamp, local as reference
  - Uses system local time (no timezone assumption)

## v13.9.4 (2026-02-01)
### Delta Extraction Improvements
- **Append mode**: Delta extraction now appends to existing file instead of overwriting
  - Prevents data loss when Claude skips delta processing
  - Previous delta content preserved until cleanup
- **UTC timestamp headers**: Each extraction batch prefixed with `--- [ISO_TIMESTAMP] ---`
  - Enables tracking of when each delta batch was extracted
  - Helps debugging extraction timing issues

### Haiku Agent Path Fix
- **Absolute path support**: Haiku agent now receives absolute file path
  - Fixed: delta-summarizer.md no longer hardcodes relative path
  - Fixed: SKILL.md passes PWD-based absolute path to Haiku
  - Resolves "file not found" errors when agent cwd differs from project

## v13.9.3 (2026-02-01)
### Delta Cleanup Protection
- **Physical memory.md update verification**: Cleanup now blocked unless memory.md was actually modified
  - Records memory.md mtime when delta is created (`deltaCreatedAtMemoryMtime`)
  - Cleanup verifies memory.md mtime is newer than recorded value
  - Prevents delta deletion before content is saved to memory.md
  - Added field preservation in `readIndexSafe()` across all scripts

## v13.9.2 (2026-02-01)
### Timezone Fixes
- **UTC timestamp unification**: All timestamps now use UTC
  - Fixed `getTimestamp()` in constants.js and utils.js to use `getUTC*()` methods
  - memory-delta skill uses `date -u` for UTC timestamps
  - Prevents timezone confusion between L1 files and memory.md headers

### New Tool
- **migrate-timezone.js**: Legacy timestamp migration utility
  - Converts local timestamps to UTC in memory.md headers
  - Supports `--offset`, `--before`, `--apply` options
  - Creates `.bak` backup before modifying files

### Config Change
- **Tool interval**: DEFAULT_INTERVAL changed from 5 to 25 in counter.js

## v13.8.7 (2026-01-14)
### Cleanup
- **Removed context warning feature**: Experimental auto-compact replacement deemed not viable
  - Removed `findCurrentTranscript()` and `estimateContextUsage()` from inject-rules.js
  - Removed context usage thresholds and warning messages
  - Core memory-keeper functionality unchanged

## v13.8.6 (2026-01-14)
### Delta Summarization
- **Proportional summarization**: Changed from fixed "1-2 sentences" to proportional
  - 1 sentence per ~200 words of content
  - Scales linearly: 400 words → 2 sentences, 1000 → 5, etc.
  - Uses bullets for 8+ sentences
  - Updated: agents/delta-summarizer.md, skills/memory-delta/SKILL.md

## v13.8.5 (2026-01-14)
### Instruction Blocking
- **Stronger blocking language**: Updated DELTA_INSTRUCTION and ROTATION_INSTRUCTION
  - "BLOCKING PREREQUISITE - EXECUTE FIRST" header
  - "STOP. Before generating ANY text response"
  - Reframed as SYSTEM MAINTENANCE TASK
  - Claude more likely to respect blocking instructions

## v13.8.4 (2026-01-14)
### Script Path Resolution
- **Fixed skill path issues**: All skills now include explicit script path resolution instructions
  - Scripts are in plugin cache, not current project directory
  - Added "Script Path Resolution" section to: memory-delta, memory-save, load-memory, search-memory, clear-memory
  - Prevents errors when skills invoked from projects other than memory-keeper source

## v13.8.3 (2026-01-14)
### New Rule
- **'Don't cut corners' rule**: Added to critical rules in inject-rules.js and CLAUDE.md
  - "Do it properly, verify from actual sources, not summaries"

## v13.8.2 (2026-01-14)
### Bug Fix
- **memory-index.json field preservation**: Fixed field loss on parse errors
  - Added `readIndexSafe()` function to utils.js, counter.js, extract-delta.js, inject-rules.js
  - All scripts now preserve existing fields when reading/writing index

## v13.8.1 (2026-01-14)
### Bug Fix
- **Windows compatibility**: Replaced `echo -e` with `printf` across all files
  - `echo -e` doesn't work reliably on Windows Git Bash (outputs literal "n" instead of newline)
  - Fixed in: memory-delta, save-memory, memory-save skills, save-memory command, counter.js

## v13.8.0 (2026-01-14)
### Rotation Pending Detection
- **Auto-trigger L3 generation**: inject-rules.js now detects pending rotation summaries
  - Checks `summaryGenerated: false` in memory-index.json
  - Outputs `[MEMORY_KEEPER_ROTATE]` trigger for Claude to execute memory-rotate skill
  - No manual intervention needed - L3 summaries generated automatically after rotation

## v13.7.0 (2026-01-14)
### Bug Fixes
- **Path detection fix**: inject-rules.js now correctly detects delta_temp.txt from plugin cache
  - Plugin runs from installed cache location, not source directory
  - Fixed path resolution to work regardless of execution context
- **Skill subagent_type**: Fixed agent type references in skill files

## v13.6.0 (2026-01-14)
### Delta Trigger Improvement
- **UserPromptSubmit-based triggers**: Moved delta delivery from PostToolUse to UserPromptSubmit
  - PostToolUse stdout is limited and unreliable for delivering instructions
  - UserPromptSubmit's `additionalContext` is the only reliable method
  - Delta instructions now injected with critical rules every prompt

## v13.5.0 (2026-01-14)
### Smarter Auto-Save with Delta Updates
- **Delta-based summarization**: Auto-save now extracts actual changes from L1 session log
- **Haiku summarization**: Delta content summarized by Haiku agent for accurate memory.md updates
- **Session-end processing**: Remaining unsaved content processed before session ends

### Rules Injection via UserPromptSubmit Hook
- **Persistent rules**: Critical rules injected every prompt (not just session start)
- **User indicator**: `[rules injected]` shown in terminal
- **Configurable frequency**: Set `rulesInjectionFrequency` in config.json (default: 1 = every prompt)

### New Files
- `scripts/inject-rules.js` - UserPromptSubmit hook handler
- `scripts/extract-delta.js` - L1 delta extraction with CLI
- `agents/delta-summarizer.md` - Haiku agent for delta summarization
- `skills/memory-delta/SKILL.md` - Auto-trigger skill for delta processing

### Cleanup
- Removed `ensureClaudeMdRules()` from load-memory.js (replaced by inject-rules.js)

## v13.3.0 (2026-01-14)
### L1 Deduplication Command
- **New command**: `dedupe-l1` removes duplicate L1 files (keeps largest per session)
- **Documentation update**: All docs updated to v13.2.0+ (facts.json removed, new commands)

### Fixes
- Removed all references to deprecated `facts.json`
- Removed deprecated commands: `add-decision`, `add-pattern`, `add-issue`, `search` (legacy)
- Updated README, ARCHITECTURE, USER-MANUAL, STRUCTURE docs

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
