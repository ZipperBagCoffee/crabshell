# Crabshell Plugin Structure

**Version**: 20.1.0 | **Author**: TaWa | **License**: MIT

## Overview

Crabshell is a Claude Code plugin that automatically saves and manages session memory. Supports token-based rotation, L3 Haiku summaries, hierarchical L1-L2-L3 structure, and integrated search.

## Directory Structure

```
memory-keeper-plugin/
├── .crabshell/                       # Crabshell local storage
│   ├── memory/                       # Project memory storage
│   │   ├── memory.md                 # Rolling session summary (auto-rotates)
│   │   ├── memory_*.md               # Rotated archives (L2)
│   │   ├── *.summary.json            # L3 summaries (Haiku-generated)
│   │   ├── memory-index.json         # Rotation tracking & counter
│   │   ├── project.md                # Project overview (optional)
│   │   ├── logs/                     # Refine logs
│   │   └── sessions/                 # Per-session archive
│   │       └── *.l1.jsonl            # L1 session transcripts (deduplicated)
│   ├── discussion/                   # Discussion documents (D001, D002...)
│   │   └── INDEX.md
│   ├── plan/                         # Plan documents (P001, P002...)
│   │   └── INDEX.md
│   ├── ticket/                       # Ticket documents (P001_T001...)
│   │   └── INDEX.md
│   └── investigation/                # Investigation documents (I001, I002...)
│       └── INDEX.md
│
├── .claude-plugin/                   # Plugin configuration
│   ├── plugin.json                   # Plugin metadata
│   └── marketplace.json              # Marketplace registration
│
├── agents/                           # Background agent definitions
│   ├── memory-summarizer.md          # L3 summary generator (haiku)
│   ├── delta-summarizer.md           # Delta content summarizer (haiku, foreground fallback)
│   └── delta-processor.md            # Delta pipeline processor (haiku, background)
│
├── commands/                         # CLI commands
│   ├── save-memory.md                # Manual save command
│   ├── load-memory.md                # Memory load command
│   ├── search-memory.md              # Session search command
│   └── clear-memory.md               # Cleanup command
│
├── hooks/                            # Lifecycle hooks
│   ├── hooks.json                    # Hook config
│   └── run-hook.cmd                  # Windows hook execution wrapper
│
├── scripts/                          # Core implementation (Node.js)
│   ├── find-node.sh                  # Cross-platform Node.js locator (v18.0.0)
│   ├── counter.js                    # Main engine
│   ├── load-memory.js                # Load memory on session start
│   ├── inject-rules.js               # UserPromptSubmit rules injection
│   ├── extract-delta.js              # L1 delta extraction
│   ├── constants.js                  # Centralized configuration
│   ├── init.js                       # Project initialization
│   ├── search.js                     # L1/L2/L3 integrated search
│   ├── memory-rotation.js            # Token-based rotation
│   ├── legacy-migration.js           # Large file splitting
│   ├── migrate-timezone.js           # Legacy timestamp migration (local → UTC)
│   ├── refine-raw.js                 # raw.jsonl -> l1.jsonl conversion
│   ├── sync-rules-to-claude.js       # Manual CLAUDE.md sync (standalone)
│   ├── regressing-state.js            # Regressing phase tracker (v19.23.0)
│   ├── sycophancy-guard.js           # Stop hook sycophancy detection (v19.29.0)
│   ├── path-guard.js                # PreToolUse .crabshell/ path validation (v19.31.0)
│   ├── docs-guard.js                # PreToolUse .crabshell/ D/P/T/I skill bypass prevention (v19.33.0)
│   ├── verify-guard.js              # PreToolUse Final Verification /verifying run enforcement (v19.34.0)
│   ├── skill-tracker.js             # PostToolUse skill-active flag setter (v19.33.0)
│   ├── test-cwd-isolation.js         # Mock tests for cwd isolation (v17.0.0)
│   └── utils.js                      # Shared utilities
│
├── skills/                           # Slash command skills
│   ├── memory-autosave/SKILL.md      # Auto-trigger memory save
│   ├── memory-delta/SKILL.md         # Auto-trigger delta summarization
│   ├── save-memory/SKILL.md          # /crabshell:save-memory
│   ├── load-memory/SKILL.md          # /crabshell:load-memory
│   ├── search-memory/SKILL.md        # /crabshell:search-memory
│   ├── clear-memory/SKILL.md         # /crabshell:clear-memory
│   └── memory-rotate/SKILL.md        # Auto-trigger L3 generation
│
├── templates/                        # Auto-init templates (v13.9.20)
│   ├── workflow.md                   # Understanding-First workflow template
│   └── lessons-README.md             # Lessons system README template
│
├── docs/                             # Local documentation (gitignored)
│   └── internal/                     # Legacy internal docs
│
├── ARCHITECTURE.md                   # System architecture
├── USER-MANUAL.md                    # User manual
├── CLAUDE.md                         # Critical rules (auto-managed by plugin)
├── README.md                         # Project documentation
├── CHANGELOG.md                      # Version history
└── STRUCTURE.md                      # This file
```

## Core Scripts

### scripts/find-node.sh
Cross-platform Node.js locator for hook commands:
- 6-stage fallback: NODE_BIN env → PATH → Windows paths → nvm/volta/fnm → Homebrew → Linux paths
- Uses `exec` for zero-overhead stdin passthrough to Node.js
- Referenced by hooks/hooks.json for all hook commands

### scripts/regressing-state.js
Regressing phase tracker (v19.23.0):
- `getRegressingState()`: Read `.crabshell/memory/regressing-state.json`, return null if inactive
- `buildRegressingReminder()`: Build phase-specific reminder for UserPromptSubmit injection
- `detectRegressingSkillCall()`: Detect Skill tool calls for planning/ticketing/discussing from PostToolUse hookData
- `advancePhase()`: Auto-advance regressing phase on skill detection (planning→ticketing→execution)

### scripts/counter.js
Main automation engine with commands:
- `check`: Increment counter, create/update L1 + trigger save at threshold, check rotation, detect regressing skill calls
- `final`: Session end handler, create L1, cleanup duplicates
- `reset`: Reset counter to 0
- `search-memory`: Search L1/L2/L3 layers (--deep for L1)
- `generate-l3`: Create L3 summary for archive
- `migrate-legacy`: Split oversized memory files
- `compress`: Archive old files (30+ days)
- `refine-all`: Process raw.jsonl to L1
- `dedupe-l1`: Remove duplicate L1 files (keep largest per session)
- `memory-set/get/list`: Hierarchical memory management

### scripts/refine-raw.js
L1 generation:
- `refineRaw()`: Async raw.jsonl to l1.jsonl conversion
- `refineRawSync()`: Sync version for PostToolUse hook (v14.0.0)

### scripts/constants.js
Centralized configuration:
- `ROTATION_THRESHOLD_TOKENS`: 23750 (25000 * 0.95)
- `CARRYOVER_TOKENS`: 2375 (2500 * 0.95)
- `MEMORY_DIR`, `SESSIONS_DIR`, `INDEX_FILE`, `MEMORY_FILE`
- `DELTA_TEMP_FILE`, `HAIKU_SAFE_TOKENS`, `FIRST_RUN_MAX_ENTRIES`
- `REGRESSING_STATE_FILE`: regressing-state.json (v19.23.0)

### scripts/memory-rotation.js
Token-based rotation logic:
- `checkAndRotate()`: Check threshold, archive if needed

### scripts/search.js
Multi-layer search:
- `searchMemory()`: Search across L1/L2/L3

### scripts/load-memory.js
Session start loader:
- Load hierarchical memory files
- Load L3 summaries
- Load rolling memory tail
- `ensureAutoMemoryWarning()`: Write distinction warning to Claude Code's built-in MEMORY.md

### scripts/inject-rules.js
UserPromptSubmit hook:
- Inject critical rules every prompt via `additionalContext`
- Configurable frequency via `rulesInjectionFrequency`
- Auto-sync rules to CLAUDE.md via `syncRulesToClaudeMd()` (marker-based)
- Detect pending delta → inject DELTA_INSTRUCTION
- Detect pending rotation → inject ROTATION_INSTRUCTION
- Detect active regressing session → inject phase-specific reminder (v19.23.0)

### scripts/path-guard.js
PreToolUse path validation (v19.31.0):
- Block Read/Grep/Glob/Bash calls targeting `.crabshell/` outside `CLAUDE_PROJECT_DIR`
- Bash command string inspection: regex extraction of `.crabshell/` paths within command strings
- Fail-open on parse errors (user experience protection)
- Windows path normalization (backslash → forward slash)

### scripts/verify-guard.js
PreToolUse Final Verification enforcement (v19.34.0, v19.39.0 deterministic execution):
- Block Write/Edit to `.crabshell/ticket/P###_T###*` containing `## Final Verification`
- Directly executes `run-verify.js` via execSync (10s timeout) — blocks on FAIL entries
- "Verification tool N/A:" exception for projects without verification tools
- Fail-open on parse errors (user experience protection)

### scripts/extract-delta.js
L1 delta extraction:
- `extractDelta()`: Extract changes since last memory.md update
- `markMemoryUpdated()`: Update timestamp watermark
- `cleanupDeltaTemp()`: Remove temp file after processing

### scripts/refine-raw.js
L1 generation:
- `refineRaw()`: Convert raw.jsonl to l1.jsonl

## Memory Hierarchy (v13.0.0)

| Layer | File | Description |
|-------|------|-------------|
| L1 | `sessions/*.l1.jsonl` | Raw session transcripts |
| L2 | `memory.md` | Active rolling memory (auto-rotates at 23,750 tokens) |
| L2 | `memory_*.md` | Archived memory files |
| L3 | `*.summary.json` | Haiku-generated JSON summaries |

## Hook Flow

```
1. SessionStart
   └─> load-memory.js
       └─> Load memory.md + L3 summaries + project files

2. UserPromptSubmit (every prompt)
   └─> inject-rules.js
       ├─> Inject critical rules via additionalContext
       ├─> Check for pending delta (delta_temp.txt exists)
       │   └─> If yes: Inject DELTA_INSTRUCTION → Claude executes memory-delta skill
       ├─> Check for pending rotation (summaryGenerated: false)
       │   └─> If yes: Inject ROTATION_INSTRUCTION → Claude executes memory-rotate skill
       ├─> Check for active regressing session (regressing-state.json)
       │   └─> If yes: Inject phase-specific reminder (planning/ticketing → MANDATORY SKILL TOOL CALL)
       └─> Output indicator: [rules injected], [rules + delta pending], [rules + rotation pending]

3. PreToolUse (Write/Edit — ticket Final Verification)
   └─> verify-guard.js (v19.34.0)
       ├─> Check if file matches .crabshell/ticket/P###_T###
       ├─> Check if content contains ## Final Verification
       ├─> Allow if "Verification tool N/A:" found (exception)
       ├─> Execute run-verify.js via execSync (10s timeout)
       └─> Block with FAIL details if any test fails

4. PreToolUse (Read/Grep/Glob/Bash)
   └─> path-guard.js (v19.31.0)
       ├─> Check if tool call targets .crabshell/ path
       ├─> Verify path is under CLAUDE_PROJECT_DIR
       ├─> Bash: regex scan command string for .crabshell/ paths
       └─> Block with correction message if wrong project root

5. PostToolUse
   └─> counter.js check
       ├─> Detect regressing skill calls → auto-advance phase (v19.23.0)
       ├─> Increment counter
       ├─> checkAndRotate() - archive if > 23,750 tokens
       └─> At threshold: create/update L1 → extractDelta() → creates delta_temp.txt

6. Stop
   └─> sycophancy-guard.js (v19.29.0)
       ├─> Detect agreement-without-verification patterns in stop_response
       ├─> Check for evidence exemptions (P/O/G table, tool output references)
       └─> Block with re-examination instruction if sycophancy detected

7. SessionEnd
   └─> counter.js final
       ├─> Create final L1 session transcript (last chance)
       ├─> Cleanup duplicate L1 files
       └─> extractDelta() for remaining content
```

## Version History

| Version | Key Changes |
|---------|-------------|
| 20.1.0 | feat: D/P/T/I documents consolidated under .crabshell/ — docs/discussion,plan,ticket,investigation → .crabshell/discussion,plan,ticket,investigation; init.js auto-creates directories; all guards/skills updated |
| 20.0.0 | **BREAKING**: memory-keeper → crabshell rename, .claude/memory/ → .crabshell/ path migration, auto-migration on SessionStart, STORAGE_ROOT centralization |
| 19.56.0 | feat: project.md injection expanded to 10 lines/500 chars, CLAUDE_RULES practical guidelines (AI slop avoidance, config externalization) |
| 19.55.0 | feat: delta-processor Bash removal — Read+Write only, JSON lock protocol, inline timestamps, memoryAppendedInThisRun flag, SKILL.md fallback Bash-free |
| 19.54.0 | feat: contradiction detection — 3-level verification framework (Local/Related pipeline/System-wide), pipeline contradiction scan in coherence methods |
| 19.53.0 | fix: Bash escaping/permission — 9 files fixed; feat: regressing convergence loop; feat: feedback assessment-mode detection |
| 19.52.0 | feat: setup-project skill, fix counter.js path bug, remove architecture.md/conventions.md |
| 19.51.0 | feat: regressing skill — default 10 cycles, early convergence termination, 10-cycle checkpoint, sequential tasks in same cycle |
| 19.50.0 | feat: feedback pressure detection — L0-L3 escalating intervention, pressure-guard.js Write/Edit blocking at L3, TaskCreate auto-reset |
| 19.43.0 | fix: remove ensureGlobalHooks() — duplicate hook registration in global settings.json on every SessionStart |
| 19.42.0 | feat: lessons skill enforces actionable rule format — Problem/Rule/Example template, prohibits reflective narratives |
| 19.41.0 | fix: replace Bash rm with Node fs.unlinkSync in clear-memory skill and delta-processor agent to avoid sensitive file permission prompts |
| 19.40.0 | chore: remove orphaned verifying-called.json flag code (skill-tracker, load-memory, constants) |
| 19.39.0 | verify-guard deterministic execution (execSync run-verify.js, blocks on FAIL) + P/O/G Type column (behavioral/structural) + IA Source Mapping Table |
| 19.38.0 | Fix: HOOK_DATA fallback for path-guard.js and regressing-guard.js; sync-rules-to-claude.js duplicate MARKER_START header |
| 19.37.0 | search-memory CLI enhancements — `--regex`, `--context=N`, `--limit=N` flags; L1 structured entry/context display |
| 19.36.0 | Fix: sycophancy-guard HOOK_DATA fallback — guard failed silently via hook-runner.js path; added env var check matching other guard scripts |
| 19.35.0 | delta-processor background agent — non-blocking delta processing + lock file race condition prevention + foreground fallback |
| 19.34.0 | verify-guard PreToolUse hook (block Final Verification without /verifying run) + skill-tracker verifying-called flag + N/A exception |
| 19.33.0 | docs-guard PreToolUse hook (block docs/ Write/Edit without skill flag) + skill-tracker PostToolUse hook (set flag on Skill calls) + TTL cleanup |
| 19.32.0 | RA pairing enforcement (WA N = RA N), concrete coherence verification methods, overcorrection SCOPE DEFINITIONS framing |
| 19.31.0 | PreToolUse path-guard hook — block Read/Grep/Glob/Bash targeting wrong .claude/memory/ path, Bash command string inspection |
| 19.30.0 | Best practices fixes — P/O/G unification, R→I stale refs, stop_hook_active guard, regressing-guard JSON block, RA Independence Protocol |
| 19.29.0 | Stop hook sycophancy guard — detect agreement-without-verification in Stop responses, block with re-examination |
| 19.28.0 | Ticket execution ordering guide + final coherence verification (D025) |
| 19.27.0 | COMPRESSED_CHECKLIST coherence/multi-WA dedup + regressing 4-factor evaluation |
| 19.26.0 | Regressing execution quality — result improvement cycles, multi-WA diversity, coherence evaluation, IA anchor, anti-sycophancy |
| 19.25.0 | Regressing 1:N Plan:Ticket — ticketIds array, multi-ticket execution/feedback, P→T(1..M) rule |
| 19.24.0 | SCOPE DEFINITIONS framing + COMPRESSED_CHECKLIST + regressing-guard PreToolUse + skill Scope Notes |
| 19.23.0 | Regressing phase tracker — hook-based auto-enforcement of Skill tool usage |
| 19.22.0 | Feat: Verification tool check procedure in regressing/ticketing/light-workflow — /verifying invoked as procedural step, not rule |
| 19.21.0 | Feat: Verifying skill — create/run project-specific verification tools; inline verification definitions replaced with VERIFICATION-FIRST reference |
| 19.20.0 | Feat: RA Independence Protocol + Planning E/A/G verification + Orchestrator cross-reference step |
| 19.19.0 | Feat: Verification philosophy operationalization — P/O/G template + Evidence Gate + observation evidence mandate |
| 19.18.0 | Feat: Regressing quality enforcement — anti-pattern rules, agent independence, enriched feedback, anti-partitioning, cross-review integration |
| 19.17.0 | Feat: Anthropic best practices — 14 skill descriptions rewritten, fabricated params removed |
| 19.16.0 | Feat: Rename researching → investigating, new I(Investigation) document type |
| 19.15.0 | Feat: Regressing D-PT loop — single Discussion wraps all cycles |
| 19.14.0 | Feat: Rename workflow → light-workflow, remove stale references |
| 19.13.0 | Changed: i18n — translated Korean text in 6 skill documents to English |
| 19.12.0 | Changed: Verification philosophy — observation evidence gates |
| 19.11.0 | Feat: Regressing skill — autonomous D→P→T loop |
| 19.10.0 | Feat: Skill precision optimization — descriptions, triggers, workflow split |
| 19.9.0 | Feat: Mandatory work log for D/P/T/R documents |
| 19.7.0 | Feat: Status cascade — ticket verified auto-closes parent |
| 19.6.0 | Feat: Runtime verification added to workflow (Phase 8/9/10) — mandatory 4th verification element |
| 19.5.1 | Feat: Document templates include execution rules (ticket Execution section, workflow Post-Workflow checklist) |
| 19.5.0 | Feat: Ticket-Workflow 1:1 mapping, post-workflow mandatory documentation |
| 19.4.0 | Feat: 4 document management skills (/discussing, /planning, /ticketing, /researching) with append-only documents and INDEX.md tracking |
| 19.3.0 | Feat: Intent Anchor mechanism — enforceable Intent Comparison Protocol at all meta-review gates |
| 19.2.0 | Fix: Emergency stop hookData.input→hookData.prompt (correct UserPromptSubmit field) |
| 19.1.0 | Feat: Cross-Review as BLOCKING gate (Phase 3.5/6.5/9.5), spot-check scaling, adversarial cross-examination |
| 19.0.0 | Feat: workflow/lessons delivered via skills, workflow compressed 762→367 lines, B9/B10 verification standard in RULES, templates/ removed |
| 18.5.0 | Feat: Orchestrator as Intent Guardian — filter reviewer feedback through original intent, override drift |
| 18.4.0 | Feat: agent orchestration rules — pairing, cross-talk, orchestrator insight; workflow.md parallel execution |
| 18.3.0 | Feat: emergency stop keywords — context replacement on trigger, agent utilization rule |
| 18.2.0 | Feat: workflow agent enforcement rule — must use Task tool for Work/Review Agent phases |
| 18.1.0 | Fix: `CLAUDE_PROJECT_DIR` not propagated to Bash tool — `--project-dir` CLI arg for scripts, absolute paths in all skills |
| 18.0.0 | Fix: bare `node` PATH failure on Windows Git Bash — find-node.sh cross-platform locator, process.execPath in ensureGlobalHooks, {NODE_PATH} placeholders |
| 17.3.0 | Fix: anchor explicitly overrides Primary working directory |
| 17.2.0 | Feat: project root anchor injection — prevent directory loss after compaction |
| 17.1.0 | Fix: use CLAUDE_PROJECT_DIR instead of hookData.cwd for project root |
| 17.0.0 | Fix: Central cwd isolation via hook-runner.js v2, PROJECT_DIR from hookData.cwd, final() session isolation, regex parser compatibility |
| 16.0.x | Fix: Session-aware delta extraction, async check() with session_id, writeJson EPERM fallback, walk-up removal |
| 15.4.0 | Change: MIN_DELTA_SIZE 40KB → 10KB |
| 15.3.0 | Fix: stable hook-runner.js eliminates version-specific paths in settings.json |
| 15.2.0 | Fix: atomic writeJson, init.js preserves index on parse error |
| 15.1.0 | Workaround: auto-register hooks in settings.json via SessionStart (hook bug #10225, #6305), try/catch in counter.js check() |
| 15.0.0 | Fix: Stop→SessionEnd hook, counter interval 50→30 |
| 14.9.0 | Delta: conditional processing, only trigger at >= 40KB |
| 14.8.1 | Workflow: remove presentation-specific section from template |
| 14.8.0 | Workflow: 3-layer architecture (Work Agent + Review Agent + Orchestrator), 11 phases |
| 14.7.1 | Fix: async stdin for Windows pipe compatibility |
| 14.7.0 | Post-compaction detection: inject recovery warning via SessionStart |
| 14.6.0 | PRINCIPLES: imperative commands instead of definitions |
| 14.5.0 | Rename Action Bias → Completion Drive (Claude's native term) |
| 14.4.0 | Fix: UNDERSTANDING-FIRST requires external user confirmation |
| 14.3.0 | Fix: L1 now captures user-typed messages (string content) |
| 14.2.0 | PRINCIPLES: understanding-driven rewrite with verification tests |
| 14.1.0 | Action Bias principle in injected RULES |
| 14.0.0 | L1 creation on PostToolUse, L1-based lastMemoryUpdateTs, spread readIndexSafe |
| 13.9.26 | DEFAULT_INTERVAL 100→50 |
| 13.9.25 | Workflow: Orchestrator vs Agent role division |
| 13.9.24 | Counter-based delta gating, interval 25→100 |
| 13.9.23 | UNDERSTANDING-FIRST rule: gap-based verification |
| 13.9.22 | Timestamp double-escaping fix, MEMORY.md auto-warning |
| 13.9.21 | Session restart context recovery rule |
| 13.9.20 | Workflow & lessons system with auto-init templates |
| 13.9.19 | CLAUDE.md marker-based sync (preserves project-specific content) |
| 13.9.18 | Marker-based CLAUDE.md sync (initial implementation) |
| 13.9.16 | Restore CLAUDE.md auto-sync, "Unclear → Ask first", Example 2, new rules |
| 13.9.12 | Understanding-first principle, criticism handling 4-step process |
| 13.9.11 | Delta trigger pattern fix (lastMemoryUpdateTs null) |
| 13.9.10 | Commands path resolution fix, legacy cleanup |
| 13.9.9 | 30-second thinking rule with date command verification |
| 13.9.7 | lastMemoryUpdateTs preservation fix in init.js |
| 13.9.5 | Dual timestamp headers (UTC + local) |
| 13.9.4 | Delta extraction append mode, UTC timestamp headers |
| 13.9.3 | Delta cleanup blocked unless memory.md physically updated |
| 13.9.2 | UTC timestamp unification, migrate-timezone.js, interval 5→25 |
| 13.8.7 | Removed experimental context warning feature |
| 13.8.6 | Proportional delta summarization (1 sentence per ~200 words) |
| 13.8.5 | Stronger delta instruction blocking language |
| 13.8.4 | Script path resolution for all skills |
| 13.8.3 | Added 'don't cut corners' rule |
| 13.8.2 | Fixed memory-index.json field preservation on parse errors |
| 13.8.1 | Windows `echo -e` → `printf` fix |
| 13.8.0 | Auto-trigger L3 after rotation via inject-rules.js |
| 13.7.0 | Path detection fix for plugin cache |
| 13.6.0 | UserPromptSubmit-based delta triggers |
| 13.5.0 | Delta-based auto-save, rules injection via UserPromptSubmit |
| 13.0.0 | Token-based memory rotation, L3 Haiku summaries |
| 12.x | Stop hook blocking, L2/L3/L4 workflow |
| 8.x | L1-L4 hierarchical memory system |
