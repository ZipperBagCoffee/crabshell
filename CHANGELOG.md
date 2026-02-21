# Changelog

## v14.8.0 (2026-02-20)
- **change**: Workflow template updated to 3-layer architecture (Work Agent + Review Agent + Orchestrator) with 11 phases, Review gap type, Template-Based Work section, and 18 anti-patterns

## v14.7.1 (2026-02-16)
- **fix**: Async stdin reading for Windows compatibility — replace fs.readSync(0) with process.stdin to avoid pipe blocking, includes 3s safety timeout

## v14.7.0 (2026-02-16)
- **feat**: Post-compaction detection — load-memory.js reads stdin `source` field from SessionStart hook, injects POST_COMPACT_WARNING when `source=compact` to counter continuation bias after context compaction

## v14.6.0 (2026-02-14)
- **refactor**: PRINCIPLES rewritten as imperative commands — "X이니까 Y해라" structure instead of abstract definitions

## v14.5.0 (2026-02-14)
- **change**: Rename "Action Bias" → "Completion Drive" in PRINCIPLES — uses Claude's native term for better activation

## v14.4.0 (2026-02-14)
- **fix**: UNDERSTANDING-FIRST steps — step (1) now explicitly requires stating to user (not internal), step (3) changed from optional "ask" to required user confirmation, Example 2 fixed to show question instead of action

## v14.3.0 (2026-02-14)
- **fix**: processUser() now handles string content (user-typed messages) in addition to array content (system-injected) — previously all user input was silently dropped from L1

## v14.2.0 (2026-02-14)
- **refactor**: PRINCIPLES section - understanding-driven rewrite anchored to Claude's internal principles (HHH, Anti-Deception, Human Oversight, Action Bias) with operational verification tests

## v14.1.0 (2026-02-14)
- **add**: Action Bias principle to injected RULES - counters system prompt speed optimization with understanding-first framing

## v14.0.0 (2026-02-14)
### Hook Architecture Refactoring
- **feat**: L1 creation moved from Stop to PostToolUse (counter-gated) - L1 now updates during session, not just at end
- **fix**: `lastMemoryUpdateTs` now uses L1 entry timestamp instead of wall clock time (prevents entry gaps)
- **fix**: `readIndexSafe()` changed to spread-based merge (auto-preserves new fields like `deltaReady`)
- **refactor**: `findTranscriptPath()` extracted from `final()` for reuse in `check()`
- **add**: `refineRawSync()` - synchronous L1 generation for PostToolUse hook
- **add**: `lastL1TranscriptMtime` tracking to skip redundant L1 creation
- **add**: `pendingLastProcessedTs` in index for L1-based timestamp handoff

## v13.9.26 (2026-02-13)
- change: DEFAULT_INTERVAL 100 → 50

## v13.9.25 (2026-02-13)
### Workflow Role Division
- **refactor**: Workflow now explicitly assigns Orchestrator vs Agent roles per phase
- Agent: Phase 2 (Analyze), Phase 4 (Plan), Phase 6 (Implement)
- Orchestrator: Phase 1, 3, 5, 7, 8 (Understanding, Review, Verification, Report)
- Added concrete verification methods and anti-patterns

## v13.9.24 (2026-02-13)
### Counter-based Delta Gating
- **fix**: Delta processing now requires `deltaReady` flag, not just file existence
- **change**: DEFAULT_INTERVAL 25 → 100
- **add**: Stale `delta_temp.txt` cleanup at session start (load-memory.js)
- **add**: Understanding rule to injected RULES

## v13.9.23 (2026-02-08)
### UNDERSTANDING-FIRST Rule Improvement
- **Gap-based verification**: Replaced "Cannot explain → Cannot act" with "Cannot verify gap is closed → Cannot act"
  - Understanding redefined as closing the gap between user intent and LLM inference through iterative verification
  - 3-step process: (1) infer user intent, (2) identify gap, (3) narrow gap before acting
  - `Understanding ≠ ability to explain` — LLM can generate plausible explanations without actual understanding
- **Examples updated**: Added explicit "Gap:" identification step to both examples

## v13.9.22 (2026-02-05)
### Timestamp Bug Fix & MEMORY.md Auto-Warning
- **Timestamp double-escaping fix**: Date format in SKILL.md and save-memory.md separated into variables to prevent Claude from escaping `%Y` to `%%Y`
  - Root cause: `$(date +'%Y...')` inside `printf` context caused Claude to double-escape percent signs
  - Fix: `TS_UTC=$(date -u +%Y-%m-%d_%H%M) && printf ... "$TS_UTC"` — date separated from printf
  - 7 broken timestamps in memory.md recovered from L1 session logs
- **MEMORY.md auto-warning**: `ensureAutoMemoryWarning()` added to load-memory.js (SessionStart hook)
  - Writes warning to Claude Code's built-in `~/.claude/projects/{project}/memory/MEMORY.md`
  - Prevents confusion between Claude Code auto-memory (200-line limit) and Memory Keeper plugin memory (25K token rotation)
  - Runs once per session start, idempotent (skips if warning already exists)
- **Context recovery rule sync**: Plugin cache inject-rules.js synchronized with source (commit 508b788)

## v13.9.21 (2026-02-05)
### Context Recovery Fix
- **Session restart**: Added "Session Restart" alongside "After Compacting" in recovery rule
  - Rule now covers both context compaction and session restart scenarios

## v13.9.20 (2026-02-05)
### Workflow & Lessons System
- **Workflow system**: Added `.claude/workflow/workflow.md` auto-copied from template on init
  - Understanding-First workflow with gap-closing methodology
  - Covers planning, implementation, and verification phases
- **Lessons system**: Added `.claude/lessons/` with `lessons-README.md` template
  - Project-specific rules proposed when patterns repeat 2+ times
  - Organized by category with clear naming conventions
- **Auto-init**: `init.js` now creates workflow and lessons directories, copies templates on first run
- **New ADDITIONAL RULES**: Workflow, Lessons, and post-compacting/session-restart context recovery rules added to inject-rules.js
- **New directory**: `templates/` containing `workflow.md` and `lessons-README.md`

## v13.9.16 (2026-02-03)
### CLAUDE.md Auto-Sync Restored & New Rules
- **syncRulesToClaudeMd() restored**: Fixed v13.9.15 regression that removed CLAUDE.md auto-injection
  - Runs at start of main() in inject-rules.js
  - Improved deduplication with removeSection() helper
- **"Unclear → Ask first"**: Added to UNDERSTANDING-FIRST section
- **Example 2**: Added scenario for checking own code before blaming user after version update
- **3 new REQUIREMENTS**:
  - Memory search newest to oldest (recent context first)
  - Investigate actual cause before blaming user environment
  - Verify independently, never blindly agree with user claims
- **1 new VIOLATION**: Search memory oldest-to-newest (wrong order)

## v13.9.19 (2026-02-05)
### CLAUDE.md Marker-Based Sync
- **Marker system**: Plugin now uses explicit markers to manage its section in CLAUDE.md
  - Start marker: `## CRITICAL RULES (Core Principles Alignment)` (same as rules heading)
  - End marker: `---Add your project-specific rules below this line---`
- **Project content preserved**: Anything below the end marker is never touched by the plugin
  - Users can add project-specific rules, build pipelines, conventions, etc.
  - Plugin only replaces content between its markers
- **No more `# Project Notes` boilerplate**: Removed auto-generated heading
- **Legacy migration**: Files without markers auto-migrate on first run
  - Old `## CRITICAL RULES` / `## Memory Keeper Plugin Rules` sections detected and replaced
- **sync-rules-to-claude.js**: Updated to use same marker system

## v13.9.12 (2026-02-02)
### Critical Rules Refinement
- **Understanding-first principle**: Added "All actions must be based on understanding" as foundational rule
- **Scope clarification**: Changed "Before ANY action" → "Before any substantive decision or file modification"
- **Permission → Understanding**: Changed "explicit permission" → "demonstrating understanding of system and impact"
- **Criticism handling**: Explicit 4-step process: pause → explain understanding → state intended action → confirm understanding

## v13.9.11 (2026-02-02)
### Delta Trigger Fix
- **Explicit trigger pattern**: Fixed mismatch between SKILL.md documentation and inject-rules.js implementation
  - stderr now outputs `[MEMORY_KEEPER_DELTA] file=delta_temp.txt` (was `[rules + delta pending]`)
  - DELTA_INSTRUCTION header includes explicit trigger pattern
  - SKILL.md updated to mention both stderr and context pattern detection
- **Root cause fix**: lastMemoryUpdateTs was always null because Claude couldn't find trigger pattern

## v13.9.10 (2026-02-02)
### Commands Fix
- **Path resolution**: Added Script Path Resolution section to all commands
- **Legacy cleanup**: Removed facts.json references (deleted in v13.0.0)
- **File extensions**: Updated session files .md → .l1.jsonl
- **Dead commands**: Removed non-existent add-decision, add-pattern, clear-facts

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
