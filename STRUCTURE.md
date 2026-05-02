# Crabshell Plugin Structure

**Version**: 21.96.1 | **Author**: TaWa | **License**: MIT

## Overview

Crabshell is a Claude Code plugin with two pillars: (1) session memory — L1 delta extraction, Haiku summarization, logbook.md rotation, auto-restore on restart; (2) LLM behavioral correction — injects VERIFICATION-FIRST, UNDERSTANDING-FIRST, INTERFERENCE PATTERNS every prompt, twelve guard hooks block violations at runtime. D/P/T/I/W/K document system, 21 skills, Node.js hooks. All output under .crabshell/.

Codex compatibility is provided in the same repository through a separate `.codex-plugin/plugin.json`, `codex-skills/`, and explicit wrapper scripts. Claude Code and Codex ship from the same repo but activate different manifests; both can share the `.crabshell/` memory and document store.

## Directory Structure

```
crabshell/
├── .crabshell/                       # Crabshell local storage
│   ├── memory/                       # Project memory storage
│   │   ├── logbook.md                # Rolling session summary (auto-rotates)
│   │   ├── logbook_*.md               # Rotated archives (L2)
│   │   ├── *.summary.json            # L3 summaries (Haiku-generated)
│   │   ├── memory-index.json         # Rotation tracking & delta state
│   │   ├── counter.json              # PostToolUse counter (separated v20.5.0)
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
│   ├── investigation/                # Investigation documents (I001, I002...)
│   │   └── INDEX.md
│   ├── worklog/                      # Worklog documents (W001, W002...) — light-workflow tracing
│   │   └── INDEX.md
│   └── knowledge/                    # Knowledge pages (K001, K002...) — verified facts + operational tips
│       └── INDEX.md
│
├── .claude-plugin/                   # Plugin configuration
│   ├── plugin.json                   # Plugin metadata
│   └── marketplace.json              # Marketplace registration
│
├── agents/                           # Agent definitions
│   ├── memory-summarizer.md          # L3 summary generator (claude-haiku-4-5-20251001)
│   └── delta-summarizer.md           # Delta content summarizer (claude-haiku-4-5-20251001)
│
├── commands/                         # CLI commands
│   ├── save-memory.md                # Manual save command
│   ├── load-memory.md                # Memory load command
│   ├── search-memory.md              # Session search command
│   ├── clear-memory.md               # Cleanup command
│   └── install-codex.md              # Manual Codex bridge command (v21.94.0)
│
├── hooks/                            # Lifecycle hooks
│   └── hooks.json                    # Hook config
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
│   ├── transcript-utils.js           # Shared stdin/transcript utilities (v21.0.0)
│   ├── refine-raw.js                 # raw.jsonl -> l1.jsonl conversion
│   ├── regressing-state.js            # Regressing phase tracker (v19.23.0)
│   ├── append-memory.js              # Atomic logbook.md append (v19.53.0)
│   ├── regressing-guard.js           # PreToolUse regressing skill enforcement (v19.23.0)
│   ├── sycophancy-guard.js           # Stop + PreToolUse dual-layer sycophancy detection + verification claim detection (v19.29.0, v20.7.0, v21.1.0). Also writes feedbackPressure.oscillationCount (reversal phrases) and tooGoodSkepticism.retryCount (all-None P/O/G) at Stop hook — these are pressure-adjacent counters independent of feedbackPressure.level. See three pressure counters (feedbackPressure.level, feedbackPressure.oscillationCount, tooGoodSkepticism.retryCount) in USER-MANUAL.md §Pressure System.
│   ├── path-guard.js                # PreToolUse path validation + shell var resolution + logbook.md Edit block + Write shrink guard (v19.31.0, v20.3.0, v20.6.0, v21.8.0)
│   ├── docs-guard.js                # PreToolUse D/P/T/I skill bypass prevention (v19.33.0)
│   ├── verify-guard.js              # PreToolUse Final Verification + behavioral AC (v19.34.0, v20.3.0)
│   ├── pressure-guard.js            # PreToolUse feedback pressure L3 blocking — all 6 tools (v19.47.0, v21.1.0)
│   ├── log-guard.js                # PreToolUse D/P/T log enforcement — terminal status + cycle log guard (v21.4.0)
│   ├── verification-sequence.js     # PostToolUse state tracker + PreToolUse commit/edit gate (v21.0.0)
│   ├── skill-tracker.js             # PostToolUse skill-active flag setter (v19.33.0)
│   ├── _test-path-guard.js           # Path-guard unit tests + shell var resolution tests (v20.0.0, v21.8.0)
│   ├── _test-sycophancy-guard.js     # Sycophancy-guard unit tests (v20.4.0)
│   ├── _test-sycophancy-pretooluse.js # Sycophancy-guard PreToolUse integration tests (v20.7.0)
│   ├── _test-sycophancy-guard-manifest.js # Sycophancy-guard manifest behavioral test (v20.7.0)
│   ├── _test-sycophancy-claim-detection.js # Verification claim detection tests (v21.1.0)
│   ├── _test-verification-sequence.js # Verification-sequence unit/integration tests (v21.0.0)
│   ├── _test-log-guard.js           # Log-guard unit/integration tests (v21.4.0, v21.11.0)
│   ├── _test-feedback-detection.js  # Feedback detection + pressure system tests (v21.5.0)
│   ├── _test-inject-rules.js        # inject-rules.js export + behavioral tests (v21.6.0)
│   ├── _test-counter.js             # counter.js export + subprocess + lock + pruning + offset tests (v21.10.0)
│   ├── _test-verify-guard.js        # verify-guard.js integration tests — Write/Edit new/existing distinction (v21.16.0)
│   ├── doc-watchdog.js              # PostToolUse/PreToolUse/Stop doc-update omission FSM (v21.18.0)
│   ├── _test-doc-watchdog.js        # doc-watchdog.js 12-test integration suite (v21.18.0)
│   ├── scope-guard.js               # Stop hook — scope reduction detection (user qty vs response qty) (v21.19.0)
│   ├── _test-scope-guard.js         # scope-guard.js 20-test integration suite (v21.19.0)
│   ├── shared-context.js            # Shared constants/functions for cross-hook reuse (v21.21.0)
│   ├── pre-compact.js               # PreCompact hook — memory preservation instructions into compaction prompt (v21.21.0)
│   ├── post-compact.js              # PostCompact hook — compaction event logging + regressing state preservation (v21.21.0)
│   ├── subagent-context.js          # SubagentStart hook — inject project constraints + rules into sub-agents (v21.21.0)
│   ├── _test-shared-context.js      # shared-context.js test suite (v21.21.0)
│   ├── _test-pre-compact.js         # pre-compact.js test suite (v21.21.0)
│   ├── _test-post-compact.js        # post-compact.js test suite (v21.21.0)
│   ├── _test-subagent-context.js    # subagent-context.js test suite (v21.21.0)
│   ├── _test-regressing-guard.js    # regressing-guard.js 7-test suite — phase gates + IA-2 agent section validation (v21.41.0)
│   ├── _test-regressing-guard-edge-cases.js # regressing-guard.js 14 edge-case tests — absent heading, fail-open paths (v21.41.0)
│   ├── regressing-loop-guard.js     # Stop hook — regressing/light-workflow enforcement (v21.50.0)
│   ├── _test-regressing-loop-guard.js
│   ├── _test-inject-rules-classification.js
│   ├── _test-wa-count-enforcement.js
│   ├── _test-parallel-reminder.js
│   ├── _test-too-good-pog.js
│   ├── utils.js                      # Shared utilities (getStorageRoot, getProjectDir)
│   ├── lint-obsidian.js              # 5-check Obsidian document linter (orphans, wikilinks, stale, frontmatter, INDEX) (v21.70.0)
│   ├── search-docs.js                # BM25 full-text search across D/P/T/I/H/W/K documents (v21.72.0, hotfix/ added v21.75.0)
│   ├── install-codex.js              # Manual Claude-installed checkout -> Codex marketplace/skills bridge (v21.94.0)
│   └── migrate-obsidian.js           # Frontmatter + wikilink migration; --generate-digest; hotfix + knowledge sections (v21.75.0)
│
├── skills/                           # Slash command skills (22 total)
│   ├── memory-autosave/SKILL.md      # Auto-trigger memory save
│   ├── memory-delta/SKILL.md         # Auto-trigger delta summarization (background non-blocking, Phase A/B)
│   ├── memory-rotate/SKILL.md        # Auto-trigger L3 generation
│   ├── save-memory/SKILL.md          # /crabshell:save-memory
│   ├── load-memory/SKILL.md          # /crabshell:load-memory
│   ├── search-memory/SKILL.md        # /crabshell:search-memory
│   ├── clear-memory/SKILL.md         # /crabshell:clear-memory
│   ├── setup-project/SKILL.md        # /crabshell:setup-project
│   ├── setup-rtk/SKILL.md            # /crabshell:setup-rtk
│   ├── discussing/SKILL.md           # /crabshell:discussing (D documents)
│   ├── planning/SKILL.md             # /crabshell:planning (P documents)
│   ├── ticketing/SKILL.md            # /crabshell:ticketing (T documents)
│   ├── investigating/SKILL.md        # /crabshell:investigating (I documents)
│   ├── regressing/SKILL.md           # /crabshell:regressing (D→P→T cycles)
│   ├── light-workflow/SKILL.md       # /crabshell:light-workflow (one-shot)
│   ├── verifying/SKILL.md            # /crabshell:verifying (verification tools)
│   ├── status/SKILL.md               # /crabshell:status (plugin healthcheck)
│   ├── lint/SKILL.md                 # /crabshell:lint (Obsidian document lint checks) (v21.70.0)
│   ├── search-docs/SKILL.md          # /crabshell:search-docs (BM25 document search) (v21.72.0)
│   ├── knowledge/SKILL.md            # /crabshell:knowledge (K-page creation + view) (v21.74.0)
│   └── hotfix/SKILL.md              # /crabshell:hotfix (H-page lightweight fix recording) (v21.75.0)
│
├── templates/                        # Auto-init templates (v13.9.20)
│   └── workflow.md                   # Understanding-First workflow template
│
│
├── ARCHITECTURE.md                   # System architecture
├── USER-MANUAL.md                    # User manual
├── CLAUDE.md                         # Critical rules (auto-managed by plugin)
├── README.md                         # Project documentation
├── CHANGELOG.md                      # Version history
├── .gitattributes                    # LF line ending enforcement (v21.6.0)
└── STRUCTURE.md                      # This file
```

## Codex Compatibility Layout

The repository intentionally keeps Claude and Codex runtime surfaces side by side:

| Path | Runtime | Purpose |
|------|---------|---------|
| `.claude-plugin/plugin.json` | Claude Code | Claude plugin metadata and install entrypoint |
| `hooks/hooks.json` | Claude Code | Automatic lifecycle hooks |
| `commands/` | Claude Code | Slash command definitions |
| `skills/` | Claude Code | Claude-oriented skill instructions |
| `.codex-plugin/plugin.json` | Codex | Codex plugin metadata and `codex-skills/` pointer |
| `codex-skills/` | Codex | Explicit Codex skill wrappers |
| `scripts/codex-memory.js` | Codex | Manual memory load/save/search/status wrapper |
| `scripts/codex-docs.js` | Codex | Manual W/H/D/P/T/I document creation wrapper |
| `scripts/claude-to-agents.js` | Codex | `CLAUDE.md` to `AGENTS.md` conversion |
| `scripts/install-codex.js` | Claude Code -> Codex | Manual bridge from Claude marketplace checkout to Codex home-local plugin and skills |

Installing one runtime does not activate the other runtime. Both runtimes can share `.crabshell/` storage when used in the same project.

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
- `final`: Session end handler, create L1, cleanup duplicates, prune old L1 (>30 days)
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
- `refineRawSync(inputPath, outputPath, startOffset)`: Sync version for PostToolUse hook, optional byte offset for incremental reads (v14.0.0, v21.10.0)

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
- Detect pending delta → inject DELTA_INSTRUCTION (non-blocking background, v21.34.0)
- Detect pending rotation → inject ROTATION_INSTRUCTION
- Detect active regressing session → inject phase-specific reminder (v19.23.0)
- Check ticket statuses for active regressing → inject warning for todo/in-progress tickets (v21.12.0)

### scripts/path-guard.js
PreToolUse path validation (v19.31.0, v20.3.0 Edit block, v20.6.0 Write shrink guard, v21.8.0 shell var resolution):
- Block Read/Grep/Glob/Bash/Write/Edit calls targeting `.crabshell/` outside `CLAUDE_PROJECT_DIR`
- Shell variable resolution: $CLAUDE_PROJECT_DIR, $PROJECT_DIR, $HOME, $USERPROFILE, ~ resolved before validation; unresolved vars + .crabshell/ = fail-closed (v21.8.0)
- Block Edit on `memory/logbook.md` — logbook.md is append-only
- Block Write shrink on `memory/logbook.md` — line count decrease detection (v20.6.0)
- Bash command string inspection: regex extraction of `.crabshell/` paths within command strings
- Fail-open on parse errors (user experience protection)
- Windows path normalization (backslash → forward slash)

### scripts/log-guard.js
PreToolUse D/P/T log enforcement (v21.4.0, v21.11.0):
- Dual-trigger guard on Write|Edit to `.crabshell/` paths
- Trigger 1: Block INDEX.md terminal status changes (→done/verified/concluded) when the referenced document has no log entries
- Pending section check (v21.11.0): After log validation passes, block ticket terminal transitions when Execution Results/Verification Results/Orchestrator Evaluation sections still contain "(pending)"
- Trigger 2: Block new cycle documents (P/T) in regressing when the previous cycle's documents lack log entries
- Fail-open on parse errors (user experience protection)

### scripts/verify-guard.js
PreToolUse Final Verification enforcement (v19.34.0, v19.39.0 deterministic, v20.3.0 behavioral AC, v21.16.0 hybrid):
- Hybrid approach: Edit always enforces verification; Write enforces only for existing files (new file creation skips — fs.existsSync-based)
- Block when ticket path (`.crabshell/ticket/P###_T###*`) contains `## Final Verification`
- Directly executes `run-verify.js` via execSync (10s timeout) — blocks on FAIL entries
- Require at least 1 behavioral (type: "direct") AC in verification manifest — structural-only is insufficient
- "Verification tool N/A:" exception for projects without verification tools
- Fail-open on parse errors (user experience protection)

### scripts/extract-delta.js
L1 delta extraction:
- `extractDelta()`: Extract changes since last logbook.md update
- `markMemoryUpdated()`: Update timestamp watermark
- `cleanupDeltaTemp()`: Remove temp file after processing

### scripts/refine-raw.js
L1 generation:
- `refineRaw()`: Async raw.jsonl to l1.jsonl conversion
- `refineRawSync(inputPath, outputPath, startOffset)`: Sync version with optional byte offset for incremental reads

## Memory Hierarchy (v13.0.0)

| Layer | File | Description |
|-------|------|-------------|
| L1 | `sessions/*.l1.jsonl` | Raw session transcripts |
| L2 | `logbook.md` | Active rolling memory (auto-rotates at 23,750 tokens) |
| L2 | `logbook_*.md` | Archived memory files |
| L3 | `*.summary.json` | Haiku-generated JSON summaries |

## Hook Flow

```
1. SessionStart
   └─> load-memory.js
       └─> Load logbook.md + L3 summaries + project files

2. UserPromptSubmit (every prompt)
   └─> inject-rules.js
       ├─> Inject critical rules via additionalContext
       ├─> Check for pending delta (delta_temp.txt exists)
       │   └─> If yes (and !deltaProcessing): Inject DELTA_INSTRUCTION → Claude launches background memory-delta agent
       ├─> Check for pending rotation (summaryGenerated: false)
       │   └─> If yes: Inject ROTATION_INSTRUCTION → Claude executes memory-rotate skill
       ├─> Check for active regressing session (regressing-state.json)
       │   └─> If yes: Inject phase-specific reminder (planning/ticketing → MANDATORY SKILL TOOL CALL)
       └─> Output indicator: [rules injected], [rules + delta pending], [rules + rotation pending]

3. PreToolUse — multiple guards (ordered: cheapest first)
   ├─> path-guard.js (Read|Grep|Glob|Bash|Write|Edit) — block wrong project root
   │   ├─> Block Edit on memory/logbook.md — append-only enforcement (v20.3.0)
   │   └─> Block Write shrink on logbook.md — line count decrease detection (v20.6.0)
   ├─> regressing-guard.js (Write|Edit) — block direct plan/ticket writes during active regressing
   ├─> docs-guard.js (Write|Edit) — block writes to .crabshell/ D/P/T/I without active skill flag
   ├─> log-guard.js (Write|Edit) — block INDEX.md terminal status without log + block tickets with pending result sections + block cycle docs without previous cycle logs (v21.4.0, v21.11.0)
   ├─> verify-guard.js (Write|Edit) — block Final Verification without /verifying run
   │   └─> Require at least 1 behavioral (type: "direct") AC in manifest (v20.3.0)
   ├─> verification-sequence.js gate (Write|Edit|Bash) — source edit→test→commit enforcement (v21.0.0)
   │   ├─> Block git commit if source files edited but no test run
   │   └─> Block source file edits after 3+ edit-grep cycles without testing
   ├─> doc-watchdog.js gate (Write|Edit) — soft warning when code edits >= 5 without D/P/T doc update during regressing (v21.18.0)
   ├─> pressure-guard.js (Read|Grep|Glob|Bash|Write|Edit) — detect feedback pressure escalation
   └─> sycophancy-guard.js (Write|Edit) — mid-turn transcript parsing for sycophancy + verification claim detection (v20.7.0, v21.1.0)

3.5. Stop
   ├─> sycophancy-guard.js (v19.29.0, v20.7.0 dual-layer)
   │   └─> Detect agreement-without-verification patterns → block with re-examination
   ├─> doc-watchdog.js stop (v21.18.0)
   │   └─> Block session end when regressing active + ticket has no work log entry since last code edit
   ├─> scope-guard.js (v21.19.0)
   │   └─> Compare user-requested quantity vs response count; block scope reduction without approval
   └─> regressing-loop-guard.js (v21.55.0)
       └─> Block stop when regressing active + inject phase-specific context; enforce ≥2 parallel WAs; light-workflow + single-WA enforcement

4. PostToolUse
   ├─> counter.js check (.*)
   │   ├─> Detect regressing skill calls → auto-advance phase (v19.23.0)
   │   ├─> Increment counter
   │   ├─> checkAndRotate() - archive if > 23,750 tokens
   │   └─> At threshold: create/update L1 (session-aware reuse + incremental offset read) → extractDelta() → creates delta_temp.txt
   ├─> verification-sequence.js record (.*) — track source edits, test runs, grep cycles (v21.0.0)
   ├─> skill-tracker.js (Skill, async) — set skill-active flag on Skill tool calls (v19.33.0)
   └─> doc-watchdog.js record (Write|Edit, async) — track code edits and D/P/T doc edits (v21.18.0)

5. PreCompact (v21.21.0)
   └─> pre-compact.js — inject memory preservation instructions into compaction prompt

6. PostCompact (v21.21.0)
   └─> post-compact.js — log compaction event + preserve regressing state

7. SubagentStart (v21.21.0)
   └─> subagent-context.js — inject project constraints + rules + model routing table (T1/T2/T3 via readModelRouting()) into sub-agents

8. SessionEnd
   └─> counter.js final
       ├─> Create final L1 session transcript (full reprocess, no offset)
       ├─> Cleanup duplicate L1 files
       ├─> pruneOldL1() — delete L1 files >30 days old (v21.10.0)
       ├─> extractDelta() for remaining content
       └─> Clear lastL1TranscriptOffset/Mtime (next session starts fresh)
```

## Version History

| Version | Key Changes |
|---------|-------------|
| 21.96.1 | fix: H013 — verifier rubric path absolutized. `scripts/inject-rules.js:911` emits `__dirname`-derived plugin install path instead of relative `prompts/...` literal, preventing dispatch failure + escalation loop in any project without a sibling `prompts/` folder. Test regex generalised. 5/5 cycle3 compliance PASS. |
| 21.96.0 | fix: behavior-verifier workflow-active idle echo loop; skip verifier/monitor wait echoes before writing pending state, with trigger-model regression coverage. |
| 21.95.0 | feat: Codex `investigating` skill + `scripts/codex-docs.js investigation`/`investigating` commands; creates I documents with investigation sections and INDEX row. |
| 21.94.0 | feat: `/crabshell:install-codex` manual bridge command + `scripts/install-codex.js`; links Claude-installed Crabshell checkout into Codex marketplace and skill locations with dry-run, idempotency, marketplace backup, and non-link replacement guard. |
| 21.93.0 | feat: Codex 호환층 추가 — `.codex-plugin/plugin.json` + `codex-skills/` 10 skills + `scripts/codex-memory.js` + `scripts/codex-docs.js` + `scripts/claude-to-agents.js` + `AGENTS.md`. dual-runtime README/STRUCTURE 문서화. H009 hotfix: `wikiTarget()` regex + ticket `--plan` fail-fast + claude-to-agents `--force` overwrite protection. |
| 21.92.0 | feat: I070 결함 수정 — SKELETON_6FIELD 6-field 확장 + dispatch 위치 상향 + §1/§0.5 marker 통일 + stale ref 제거 + dead code 제거 + test 수정. inject-rules 114/114 + sycophancy-guard 23/23 PASS. |
| 21.91.0 | feat: D108 cycle 1 — I069 토큰 절약 즉시 실행. ANTI_PATTERNS_INLINE 제거 (~1,701 B) + Root Anchor 압축 (~504 B) + Verification Reminder 삭제 (~184 B). deferral-guard.js 폐지 (77 LOC + hooks.json). sycophancy-guard.js Stop 3 branch 제거. Per-turn static savings ~2,389 B. Guard 12→11. /verifying 29/29 + fail-open 7/7. |
| 21.90.0 | feat: H008 hotfix — behavior-verifier dispatch model: opus 명시. `scripts/inject-rules.js:961` 한 줄 추가, project.md T1 routing rule enforcement (verification requiring interpretation = §0.5 form-game detection). /verifying 29/29 + fail-open 7/7 preserved. |
| 21.89.0 | feat: D107 cycle 8+9 — USER-MANUAL.md doc cycle (Doc Debt resolution) + cycle 9 lightweight bundle (cross-ref fix + baseline status). **Cycle 8 (P150_T001)**: 4 dedicated USER-MANUAL.md subsections written for cycle 5 features (SKELETON_5FIELD L229 / ANTI_PATTERNS_INLINE L247 / lock-contention.json L387 / _recordContention L391). Doc Debt 4/4 rows Done. AC-7 +110 B / 1.79% overrun ratified (doc-only, no commit). **Cycle 9 (P151_T001)**: WA1 cross-ref `#critical-rules-core-principles-alignment` invalid same-page anchor → project-wide CLAUDE.md reference; `prompts/f3-fsm-reconciliation-evaluation.md` baseline status note (acquireCount=71 / 14.2% of floor 500 / observed rate 44.56/h / projected days-to-floor ~0.4d). Vbump v21.88.0 → v21.89.0. **F-3 implementation D108+ defer** per Orchestrator C recommendation (evidence-based, 14.2% baseline insufficient for path a/b ratification per cycle 4 RA1 rule). /verifying 29/29 + fail-open 7/7 + behavior-verifier-prompt.md 36835 B preserved. |
| 21.88.0 | feat: D107 cycle 5+6 — F-4 lock contention instrumentation + measurement window opening + race undercount doc (P143 + P148 + P149 cycle 7 operator gate resolution). **Cycle 5 (P143_T001)**: `scripts/utils.js` `_recordContention` 신규 (deadlock-prevention — invoked from inside lock primitive, unprotected `writeJson`; race-condition increment loss = conservative undercount caveat). `acquireIndexLock` / `releaseIndexLock` 에 hold-duration 측정 + per-lock metrics wiring (`acquireCount` / `contendedCount` / `totalWaitMs` / `totalHeldMs` / `maxWaitMs` / `maxHeldMs`). `.crabshell/memory/lock-contention.json` NEW state file (F-4 baseline accumulation). `scripts/inject-rules.js` D107 IA-1 (`SKELETON_5FIELD` ~458B 5-field response skeleton injection) + IA-2 (`ANTI_PATTERNS_INLINE` ~1701B anti-patterns inline injection) — every-prompt default-behavior persistent additions. **Cycle 6 (P148_T001)**: `lock-contention.json` top-level `measurementWindowStart` ISO 8601 marker (additive, sibling to per-lock metric sub-objects; atomic write while holding `.memory-index.lock` to serialize against concurrent `_recordContention` writers). One-shot helper `scripts/_p148-t001-marker-write.js` 사용 (cycle 7에서 cleanup). `prompts/f3-fsm-reconciliation-evaluation.md` `### Cycle 6 measurement window opening` subsection 신규 (close-criterion deferred to cycle 7+ entry assessment + RA1 race undercount caveat: `_recordContention` race loss = conservative undercount, F-3 ratification 시 measured contention frequency at-or-below threshold ≠ real-at-or-below threshold, margin needed). **Cycle 7 (P149_T001) — operator gate resolution + housekeeping**: helper `scripts/_p148-t001-marker-write.js` 삭제 (one-shot purpose served), vbump v21.87.0 → v21.88.0 (`.claude-plugin/plugin.json` only — no root `plugin.json`), F-5 self-instrumentation tautology disclosure note (`prompts/f3-fsm-reconciliation-evaluation.md`: ~3 acquireCount floor sample from helper itself, cycle 7+ ratification analysis MAY subtract this floor for pure-organic baseline), F-4 close-criterion threshold candidates enrichment (preserving existing L208 deferred bullet, adding sub-bullets: (a) sample threshold `acquireCount ≥ N` (N TBD) / (b) elapsed-time threshold `now − measurementWindowStart ≥ T` (T TBD) / (c) contention-rate threshold `contendedCount / acquireCount ≥ R` (R TBD); cycle 8+ to populate values when F-4 baseline data accumulates). CHANGELOG/README/STRUCTURE/ARCHITECTURE/USER-MANUAL/manifest version-string sweep. 신규 test files (`_test-d107-cycle1-inject-enhancement.js` / `_test-d107-cycle2-verifier-audit.js` / `_test-d107-cycle3-llm-compliance.js`), `_test-fail-open-edge-cases.js` Case 7 추가 (F-4 instrumentation fail-open 보장). `prompts/marker-set-unification-audit.md` + `prompts/output-schema-2tier-proposal.md` audit docs 신규. /verifying 29/29 PASS post-vbump (manifest AC-6 version probe `21.87.0` → `21.88.0`). fail-open 7/7 PASS. **Known doc gap (path b explicit deferral, D1 directive)**: USER-MANUAL.md cycle 5 features (`SKELETON_5FIELD` / `ANTI_PATTERNS_INLINE` / `lock-contention.json` / `_recordContention`) 본문 sections 미작성, `## Doc Debt` section에 4 items TODO 등록, cycle 8+ doc cycle에서 정식 sections 작성 — cycle 7 lightweight scope에서 v21.83.0 ARCHITECTURE.md backfill (commit `de04944`)와 동일 class bug 회피하기 위한 의도적 explicit deferral. **Excluded (cycle 8+)**: F-3 path implementation (path a lock-merge OR path b hand-off — explicit user path selection prerequisite, "커밋하고 계속진행"은 operator gate parts 1+2 only), §1+§0.5 marker set unification Option ii cross-ref implementation, close-criterion threshold values (N/T/R) 구체화 (depends on F-4 baseline data accumulation), F-1 trigger axis unification (cycle 9+), Tier 2 narrative producer (post-F-3 ship). |
| 21.87.0 | feat: D106 cycle 5 — code/doc IA bulk processing (P142 T001+T002+T003). **T001 IA-9**: dead code 4 file 삭제 (`scripts/test-cwd-isolation.js` 274 + `scripts/delta-background.js` 200 + `scripts/_test-delta-background.js` ~565 + `scripts/_prototype-measure.js` 130 = 약 1,169 LOC). STRUCTURE.md "retained for reference" 정책 reversal + I063 future-work 정책 reversal. **T002 IA-10**: `scripts/utils.js` `isBackground()` + `parseProjectDirArg()` 추가, 22 hook file inline `process.env.CRABSHELL_BACKGROUND === '1'` early-exit 보존 (F1 mitigation 옵션 A) + utils require + F1 mitigation 주석, 12 inline `getProjectDir` 제거, 3 readStdin wrapper 제거 (counter/inject-rules/load-memory), `append-memory.js` Variant B → `parseProjectDirArg(process.argv.slice(2))`. WA-fix critical: 11 hook + 6 transitive consumer 의 require 가 inline env check 앞에 실행되던 invariant 위반 — 순서 reorder 로 fail-open invariant 보존. **T003 IA-13/15/16**: `scripts/find-node.sh` CRLF → LF, 49+3=52 split sites → split(/\r?\n/), `.gitignore` `*.stackdump`. 회귀: `_test-fail-open-edge-cases.js` Case 6 (utils.js load fail simulation, 22 hook fail-open 보장). /verifying 26/26 PASS. fail-open edge cases 6/6 PASS. Cleanup: 6 .bak file 삭제. wa-count-pretool readStdin alias P143+ defer. (v21.86.0 hotfix `scripts/regressing-guard.js` regex bug 단독 fix; v21.87.0이 cycle 5 ship). |
| 21.85.0 | feat: D106 cycle 3+4 — verifier FALLBACK 강화 (P140 + P141). **Cycle 3 (P140 T001+T002)**: `prompts/behavior-verifier-prompt.md` §0 Memory Feedback Cross-Check 신규 (6 regex 패턴: no_permission_asking / no_record_asking / no_option_dump / no_api_billing / philosophy_framing / agent_count — bypass surface PRECEDES, MEMORY.md feedback 매치 시 forced FAIL) + §Edge Cases trivial bypass AND-narrowed (4 conditions: length<50 + no deferral verb + no §0 match + no scope-expansion tokens) + §1/§3/§4 Key composition directive에 §0 cross-check AND clause 추가. `scripts/inject-rules.js` MEMORY.md absolute path injection (`memoryFeedbackPath` 변수 with try/catch fail-open). `scripts/transcript-utils.js:189` hardened filter (`block.name === 'Agent' && block.input?.subagent_type === 'general-purpose'`) — 이전 `block.name === 'Task'`이 production transcript JSONL 직렬화(`name: 'Agent'`)와 mismatch로 100% dispatch detection miss → `dispatchOverdue` 영구 stuck. Hardened variant은 `crabshell:delta-summarizer` agent (delta dispatch) false-positive 방지. `scripts/_test-dispatch-overdue-detection.js` 3 fixture 갱신 + production-shape Test 9 추가 → 9/9 PASS. `.crabshell/verification/manifest.json` V017 (cross-check section 구조) + V018 (NARROWED bypass) + V019 (dispatch tracking behavioral test runner) 3 entries 추가. H006 hotfix carry-over (`scripts/load-memory.js` feedbackPressure SessionStart 강제 decay 제거). **Cycle 4 (P141 T001)**: `prompts/` §1.understanding Scope-expansion signals 신규 (4 minimal regex: autonomous-closure / reasonable-assumption / cascade auto-decision / assumption-disclaimer override — RA1이 sentence-pattern over-reach `\S+\s+(진행|결정|적용|실행)` Korean prose FP risk verified로 DROP) + Authorization Tokens Allowlist (`다 처리`/`cascade OK`/`proceed`/`진행해`/`알아서`/`일임`/`마무리해`/`종결해` literal user prompt match만, verifier inference PROHIBITED) + 신규 §Hook-vs-Human Heuristic section (`Stop hook feedback:` / `Document update pending:` / `## REGRESSING ACTIVE` 패턴 매치 시 hook-synthetic classify, NOT user authorization) + Key composition directive Rigor enforcement (PASS reason MUST quote literal user prompt noun phrase + response action `"PASS — user '<≤40-char quote>' → response '<≤40-char action>' (frame match)"`, "frame OK" downgrade FAIL, length-bypass invariant) + §Turn-Type Conditional Gating workflow-internal row fix (`apply (format markers ≥200 chars only + frame-fidelity always + scope-expansion always)` — 이전 ticket-id 포함 turn에서 frame-fidelity silent skip 차단) + Sample 4 추가 (autonomous closure with assumption-decision FAIL example, sub-200 chars). 신규 `_test-v020-novel-scope-expansion.js` 5 fixtures (A autonomous closure / B cascade chain / C user "알아서 진행하세요" PASS / D user "알아서 해결해" PASS / E user replied "C" to assistant A/B/C question PASS) → 5/5 PASS. Manifest V020 (behavioral type) 추가. **Production behavioral evidence**: cycle 3 종결 시점 state file `dispatchOverdue: true → false`, `missedCount: 1 → 0`, `escalationLevel: 1 → 0`, `triggerReason: escalation → periodic` 직접 reset 확인 (T001 6 fixture dispatches + T002 RA의 7개 Agent dispatch가 hook에 정상 detect). Cycle 4 verifier가 본인 작성 over-reach (이번 세션 line 104 `"Autonomous 진행. Reasonable assumption: Option C"`) 3-axis 자기-catch (understanding + verification + logic 모두 FAIL with specific signal cite + missing authorization token). `/verifying` 19→26 entries (V014/V015/V016 P139 carry + V017/V018/V019 P140 + V020 P141), 26/26 PASS. **Behavioral effect**: IA-26 FALLBACK 3-layer 완성 — (1) known user feedback patterns catch (cycle 3 §0), (2) production hook tracking 회복 (cycle 3 dispatch fix), (3) novel scope-expansion catch + 자기-catch 능력 (cycle 4 §1 + Hook-vs-Human + workflow-internal fix). cycle 1/2 ringBuffer 8/8 all-PASS (사실상 verifier 작동 X) → cycle 4 ringBuffer 정상 catch + production state file dispatch detection 정상화. D106 IA 21개 (1/2/4/8~25) 미처리 → cycle 5+ candidate (consumer-side post-hoc rigor validation, IA-1/2 default 행동, IA-4 NEGATIVE_PATTERNS source trace, IA-8~25 코드/문서 카탈로그). |
| 21.84.0 | feat: D105 cycle 1 — 외부화 함정 source 제거 (spec 정정 + 회피 원칙 + 거절 catalog + 회피 4회 기록). `scripts/inject-rules.js` RULES Simple Communication 4 항목 replace "use an analogy"; PROHIBITED #9 Default-First. `prompts/anti-patterns.md` 신규 7 TRAPs + 4 AVOIDs. Test cascade 145 신규 assertions. /verifying 19/19 PASS. |
| 21.83.0 | feat: D104 cycle 1 — 감시자 (Behavior Verifier) Phase 1 (P136 T001+T002+T003). **T001**: `scripts/behavior-verifier.js` bypass cascade (`workflowActive=true` force layer overrides length<50 / clarification bypass), `classifyTurnType()` 5-class detection (clarification/trivial/notification/workflow-internal/user-facing — line-start anchor `/^<task-notification>/m` for false-positive avoidance), periodic skip (`priorState.lastFiredTurn != null && verifierCounter < lastFiredTurn + VERIFIER_INTERVAL`, workflow-active 시만 무시), state schema 7→14 fields (`triggerReason`/`lastFiredAt`/`lastFiredTurn`/`missedCount`/`escalationLevel`/`ringBuffer`/`turnType`). `scripts/inject-rules.js` consumer extension: `## Watcher Recent Verdicts` ring buffer reader (≤800 chars cap), `**[DISPATCH OVERDUE — escalation L1]**` marker on `missedCount>=2`, `## 감시자 (Behavior Verifier) Dispatch Required` 한글 bilingual dispatch header. `scripts/counter.js` `memory-index.json.verifierCounter` field PostToolUse 누적 (별도 field, counter.json saveInterval=15 conflict 회피). `scripts/constants.js` `RING_BUFFER_SIZE=8` + `VERIFIER_INTERVAL=8`. `hooks/hooks.json` Stop section 순서 swap (behavior-verifier above regressing-loop-guard, Q1=A applied, RA8 MISS-1 mitigation). 3 new tests: `_test-trigger-model.js` / `_test-turn-classification.js` / `_test-verdict-ring-buffer.js`. **T002**: `prompts/behavior-verifier-prompt.md` G2 Sample 3 (format-markers 위반 ~350 chars Korean) + G3 Schema Stability single-source (분산 directive 통합, 다른 section은 cross-reference만) + per-criterion turnType conditional gating directive. `scripts/deferral-guard.js` stderr 메시지 통일: `[BEHAVIOR-WARN] Trailing deferral question detected (PROHIBITED #7). (warn-only — sub-agent verifier §3.logic Trailing-deferral sub-clause will retroactively correct in next turn)` (sycophancy 4 Stop branches와 prefix/후행구 일치, pLevel 부재 절충). 2 new tests: `_test-deferral-consistency.js` (5 case) + `_test-fail-open-edge-cases.js` (5+ case). V011 manifest regex tightened to bold-header form (`/\*\*Direction change\*\*|\*\*Session-length deferral\*\*|\*\*Trailing deferral\*\*/`) to avoid §Schema Stability cross-reference false-fire. **T003**: 한글 facing rename docs/manual layer — `USER-MANUAL.md` Hooks/Guards table에 `behavior-verifier.js (감시자)` alias, `README.md` / `STRUCTURE.md` version table description "감시자" 표기, `prompts/behavior-verifier-prompt.md` L1 header `# 감시자 (Behavior Verifier) Sub-Agent Prompt`. 코드 식별자 (filename / `BEHAVIOR_VERIFIER_*` / `<VERIFIER_JSON>` / `[CRABSHELL_BEHAVIOR_VERIFY]` / `CRABSHELL_AGENT='behavior-verifier'` / function names) byte-identical 보존 (Phase 3 v22 major carry-over). 1 new test: `_test-role-rename-display.js` (5 case). 48/48 `_test-*.js` PASS; 18/18 `/verifying` PASS. AC-6 manifest 21.82.0→21.83.0. **Behavioral effect**: verifier 매 응답 발동 X (periodic N=8 skip), workflow-active 시 강제 발동, turn classification per criteria gating (clarification/trivial 모든 criteria skip / workflow-internal simple skip / notification verification light), ring buffer cross-turn 맥락 ~50-100 tokens/turn. deferral-guard 메시지 sycophancy 패턴 일치. |
| 21.82.0 | feat: D103 cycle 2 — dispatch overdue detection + verifier prompt §1.understanding format-marker sub-clause (P135_T001). `scripts/transcript-utils.js`: new `getRecentTaskCalls(transcriptPath, sinceTimestamp)` helper (mirrors `getRecentBashCommands`, matches `block.name === 'Task'`, 32KB tail-read, fail-open `null`). `scripts/behavior-verifier.js`: Stop hook reads prior state BEFORE `writeJson`, calls `getRecentTaskCalls(transcriptPath, priorState.launchedAt)`; when prior `status='pending'` AND `recentTasks.length === 0` AND response is substantive (length≥50 + non-clarification, both bypasses already filtered upstream), the new state is written with `dispatchOverdue=true`. RA amendment 1 (clarification bypass) preserved by the existing line-78 length<50 + line-81 isClarificationOnly early exits. `scripts/inject-rules.js`: pending branch (line 764) prepends `**[DISPATCH OVERDUE]** Previous turn did not invoke Task. Invoke NOW.\\n` BEFORE the existing `## Behavior Verifier Dispatch Required` header when `bvState.dispatchOverdue === true`. `prompts/behavior-verifier-prompt.md` §1.understanding gains **Format markers** sub-clause: response > 200 chars without ANY-ONE marker set → FAIL. Bilingual EITHER-set: Korean (`[의도]/[답]/[자기 평가]`, optional `[정정]`) OR English (`[Intent]/[Answer]/[Self-Assessment]`, optional `[Correction]`) — RA amendment 2 (DA-2 length threshold + DA-3 ANY-ONE-set). Key composition directive folds the new sub-clause into a single `understanding.pass`/`understanding.reason`. JSON schema unchanged (4 keys). Test cascade: `_test-dispatch-overdue-detection.js` (8 cases) + `_test-format-clause-detection.js` (5 cases). `manifest.json` V012 entry (cycle 2 absorption probe — Node `-e` cross-platform: `dispatchOverdue` ≥2 + `Format markers` ≥1 + Korean ≥3 + English ≥3); AC-6 21.81.0→21.82.0; entries 17→18. 42/42 `_test-*.js` PASS. **Behavioral effect**: missed Task dispatch now flagged with markdown-emphasized marker on the next turn (D103 IA-1 closure); response format violations surface as `## Behavior Correction` (D103 IA-3 closure). |
| 21.81.0 | feat: D103 cycle 1 — sycophancy 4 Stop branches → warn-only + verifier prompt §3.logic 3 sub-clause (P134_T001). `scripts/sycophancy-guard.js` `handleStop` 4 branches (context-length deferral / too-good P/O/G / oscillation / bare agreement) → `[BEHAVIOR-WARN]` stderr + `exit(0)`; PreToolUse handler retained `exit(2)` for Write/Edit mid-tool blocking; counter RMW (`incrementTooGoodRetryCount` / `incrementOscillationCount`) preserved before warn-only emit. `prompts/behavior-verifier-prompt.md` §3.logic body extended with 3 sub-clauses (Direction change PROHIBITED #8 / Session-length deferral #6 / Trailing deferral #7) + key composition directive (single `logic.pass`/`logic.reason`). JSON schema unchanged. Test cascade: `_test-sycophancy-claim-detection.js` case 15 → testWarn + new 15a/15b/15c (oscillation/too-good/context-length); `_test-sycophancy-guard.js` 13 affected cases → `runTestWarn`; `_test-sycophancy-guard-manifest.js` rewritten. `manifest.json` V008 expectation 32→35, new V011 entry (cycle 1 absorption probe), AC-6 21.80.0→21.81.0; total entries 17. 40/40 `_test-*.js` PASS. **Behavioral effect**: 4 absorbed Stop branches no longer hard-block; behavior-verifier sub-agent corrects retroactively on next turn (graceful degradation per I064 Output 4 §"Phase 2"). |
| 21.80.0 | feat: 감시자 (behavior-verifier) sub-agent dispatch architecture (D102 P132 cycle 1) — new `scripts/behavior-verifier.js` Stop hook (B-2 trigger), `inject-rules.js` consumer (dispatch-instruction + correction inject + RMW transition-then-emit), `sycophancy-guard.js` L799-805 warn-only, `prompts/behavior-verifier-prompt.md` 4-criterion evaluation + self-write, `scripts/_prototype-measure.js` measurement scaffolding, `scripts/_test-behavior-verifier-{stop,consumer}.js` 18 behavioral cases, `.crabshell/verification/manifest.json` V006-V009 entries, `.crabshell/investigation/I063-behavior-verifier-prototype-measurement.md`. **Behavioral effect**: verification-claim no longer hard-blocks at Stop; sub-agent verdict retroactively corrects on next turn via `## Behavior Correction` injection (600B/item, 1500B total). |
| 21.79.0 | feat: NEGATIVE_PATTERNS 욕설-only 축소 + BAILOUT keyword UNLEASH 교체 (W021) — `inject-rules.js` `NEGATIVE_PATTERNS`에서 정정/assessment/논리적-disagreement 패턴 모두 제거, 욕설만 keep. `BAILOUT_KEYWORDS` 영어 키워드 'BAILOUT'→'UNLEASH', '봉인해제' 유지. `pressure-guard.js` L2/L3 메시지 갱신. **행동 효과**: 사용자 정상 정정 표현이 더 이상 pressure escalation 트리거 안 함. W021 100% 수렴 + 229/229 회귀 PASS. |
| 21.78.4 | fix: NEG 검사 false-positive 차단 (W020) — `inject-rules.js`에 `stripSystemReminders` helper 추가. `detectNegativeFeedback`이 `<system-reminder>...</system-reminder>` 블록을 사전 제거 후 NEGATIVE_PATTERNS 매치. Claude Code가 매 prompt 자동 주입하는 reminder 안 단어(error/wrong/break)에 의한 사용자-무관 압력 상승 차단. WA1+RA1 검증 8/8 IA + 5/5 행동 케이스 + 107/107 회귀 PASS. |
| 21.78.3 | hotfix: load-memory.js L1 tail 줄 수 20 → 50 (H005) — `getUnreflectedL1Content`의 `slice(-20)` → `slice(-50)`. 세션 시작 시 자동 로드되는 unreflected L1 컨텐츠 범위가 좁아 최근 컨텍스트 손실 가능성. 필터(assistant only + len>50 + logbook 미반영)는 유지, 후보 라인 수만 확장. |
| 21.78.2 | feat: COMPRESSED_CHECKLIST 9·10번 항목 추가 — Be Logical(증거 기반 결론, 패턴매치/plausibility 금지) + Simple Communication(한 문장 코어 + 아날로지); RULES PRINCIPLES가 매턴 additionalContext에도 가시화; 190/190 PASS |
| 21.78.1 | hotfix: RULES PRINCIPLES — Deep Thinking → Be Logical 재명명/재프레임; 논리성 goal, 깊이 means (H004) |
| 21.78.0 | feat: RULES PRINCIPLES — Deep Thinking + Simple Communication 불릿 추가 (HHH 위); 얕은 추론 차단 + 아날로지 기반 간결 설명 요구 (W019) |
| 21.76.0 | feat: lessons system retired — /knowledge replaces /lessons, CLAUDE.md absorbs behavioral rules; skills/lessons/ deleted; 21 skills |
| 21.75.1 | fix: skill-tracker.js DOCS_SKILLS missing 'hotfix' — /hotfix now activates skill-active.json, unblocks docs-guard on H*.md writes (H001) |
| 21.75.0 | feat: H (Hotfix) document type — /hotfix skill, .crabshell/hotfix/, 8 scripts + 3 guards updated, CLAUDE.md D/P/T/I/H; 22 skills |
| 21.74.0 | feat: knowledge/ system — /knowledge skill, K001-K003 from lessons migration, search-docs + digest integration; CLAUDE.md lessons→knowledge; 21 skills |
| 21.73.0 | feat: background agent stop exemption — backgroundAgentPending tracking in counter.js, TTL-based exemption in regressing-loop-guard.js |
| 21.72.0 | feat: --generate-digest (moc-digest.md), search-docs.js BM25, /search-docs skill, load-memory moc-digest injection; 20 skills |
| 21.71.0 | feat: pressure message once-only (lastShownLevel tracking); PRESSURE_L2/L3 content rewritten to problem analysis + corrective plan; pressure-guard short block messages |
| 21.70.0 | feat: lint-obsidian.js — 5-check Obsidian document linter; lint skill (/crabshell:lint); MOC pages; discussing convergence auto-apply |
| 21.69.0 | feat: Obsidian L2 integration — YAML frontmatter + wikilinks in D/P/T/I/W templates; migrate-obsidian.js; fix: light-workflow INDEX.md init logic |
| 21.68.0 | fix: bailout guidance once-only, L3 structured self-diagnosis |
| 21.67.0 | feat: USER-MANUAL.md full update, bailout keyword disclosure, version bump checklist step 5b |
| 21.66.0 | fix: discussing SKILL.md convergence criteria default for regressing |
| 21.65.0 | feat: D/I document templates add `## Constraints` section for persistent constraint reference |
| 21.64.0 | fix: skill-active.json TTL expiry check — prevents Stop hook false-blocking after workflow completes |
| 21.63.0 | fix: BAILOUT now resets oscillationCount to 0 (complete pressure reset) |
| 21.62.0 | feat: Model Routing splits verification into mechanical (Sonnet) vs judgment (Opus); workflow selection blocks light-workflow when open D exists; light-workflow SKILL.md pre-check + Rule 7; L2/L3 pressure messages include bailout user-authority note |
| 21.61.0 | feat: discussing SKILL.md 4th question (Convergence Criteria) + template section; regressing Rule 7 Convergence Criteria reference; inject-rules.js pressure bailout keywords "봉인해제"/"BAILOUT" — instant L0 reset |
| 21.60.0 | feat: role-collapse-guard.js (Orchestrator source-write block), deferral-guard.js (warn-only trailing question detection); fix: context-length "세션" + stoppage patterns, narrowed English session patterns; fix: memory-delta SKILL.md "foreground" → "wait for completion" |
| 21.59.0 | feat: Discussion Edit guard during regressing (docs-guard.js), context-length deferral detection (sycophancy-guard.js Step 0), discussing SKILL.md Rule 1 conditional, regressing SKILL.md pre-partitioning warning in Step 2.5 |
| 21.58.0 | feat: Pressure system redesign — L2 blocks 6 tools, L3 full lockdown (all tools including TaskCreate); block messages include user feedback solicitation; fix: counter.js TaskCreate reset gated to level < 3; hooks.json pressure-guard matcher `.*`; verify-guard timeout 30s→60s |
| 21.57.0 | feat: anti-retreat pressure rules — PRESSURE_L1 blocks "I don't know" without tool use; PRESSURE_L2 blocks "검증 불가능" without searching, mandates sub-agent spot-checking |
| 21.56.0 | feat: oscillation enforcement — block on first direction change (pressure-independent), 3 precision REVERSAL_PATTERNS, PRESSURE_L1 prior-response review mandate + "will be blocked" |
| 21.55.0 | feat: Stop hook phase-specific context via buildRegressingReminder(); fix: counter.js WA tracking 'TaskCreate'→'Agent' |
| 21.54.0 | fix: I051 audit doc consistency fixes — regressing-loop-guard.js in Hook Flow 3.5 and Scripts Reference, scope-guard.js Scripts Reference, ASCII diagram Stop box expanded, 6 new files + setup-rtk skill, CLAUDE.md 2 guard baseline entries, PROHIBITED PATTERNS 1-7→1-8, skills count 17→18 |
| 21.53.0 | fix: hooks.json trailing comma fix — version bump for cache refresh |
| 21.52.0 | feat: WA count enforcement — classifyAgent, wa-count.json tracking, ticketing reset, Stop hook single-WA block, PARALLEL_REMINDER "parallel and multiple" |
| 21.51.0 | fix: PARALLEL_REMINDER — WA parallel vs WA→RA sequential distinction, Single-WA tightened to single-file mechanical only |
| 21.50.0 | feat: input classification + guard cleanup — DEFAULT_NO_EXECUTION, EXECUTION_JUDGMENT, regressing-loop-guard rename, completion-drive-write-guard removal |
| 21.49.0 | fix: regressing Stop hook blocks instead of skips — forces autonomous execution continuation |
| 21.48.0 | feat: completion drive Write/Edit guard, positive path tests, PARALLEL_REMINDER rewrite, 3 SKILL.md completion drive warnings |
| 21.47.0 | feat: completion-drive-guard, too-good P/O/G skepticism, parallel processing reminder, regressing Rule 14, 39 new unit tests |
| 21.46.0 | feat: 3-tier model routing — centralized project.md table, SubagentStart injection, SKILL.md deduplication |
| 21.45.0 | feat: setup-rtk skill; fix: investigating default Sonnet→Opus |
| 21.44.0 | feat: document-first rule all skills; refactor: CLAUDE_RULES trim; fix: TTL 5→15min; chore: MEMORY.md/CLAUDE.md compression |
| 21.43.0 | feat: orchestrator document-update fallback — investigating/planning/ticketing/light-workflow skills enforce section content write after each agent step |
| 21.42.0 | feat: oscillation mitigation — PRESSURE_L1/L2 awareness text; PROHIBITED PATTERNS #8; checkReversalPhrases (14 patterns); oscillationCount in memory-index.json; Stop hook blocks count≥3 + pressure≥1 |
| 21.41.0 | feat: planning/ticketing SKILL.md document-first rule; feat: regressing-guard IA-2 agent section validation; fix: verify-guard V002 bare node→process.execPath; test: 21 regressing-guard tests |
| 21.40.0 | fix: docs-guard.js dead code removal (INDEX.md check in checkInvestigationConstraints); feat: CLAUDE.md checklist step 7; feat: ticketing SKILL.md — Skeptical calibration + Edge-case AC guidance |
| 21.39.0 | test: 32 new tests — _test-extract-delta (15), _test-append-memory (7), _test-memory-rotation (10) |
| 21.38.0 | feat: path-guard skill-active.json block; ticketing Step C document-first rule; calm-framing in inject-rules + sycophancy-guard (PRESSURE labels, DIAGNOSTIC RESET); counter.js lock early return + ensureDir |
| 21.37.0 | fix: docs-guard.js INDEX.md early return (bypasses skill-active TTL check); 3 new tests (TC5c/d/e), 18 total |
| 21.36.0 | feat: RA Deletion Check — mandatory `git diff` scan before verification in ticketing/light-workflow; Evidence Gate 5→6 checkbox (unintended deletion check); fallback paths for empty diff |
| 21.35.0 | fix: docs-guard.js INDEX.md exclusion from investigation Constraints check; 2 new tests (15 total) |
| 21.34.0 | feat: delta-summarizer background non-blocking (Agent `run_in_background: true`); SKILL.md Phase A/B split; DELTA_INSTRUCTION NON-BLOCKING; markDeltaProcessing() + mark-processing CLI in extract-delta.js; deltaProcessing flag in memory-index.json |
| 21.33.0 | fix: verification-sequence.js + sycophancy-guard.js node.exe pattern (`\bnode\s+` → `\bnode(?:\.exe)?["']?\s+`) for Windows full path with quotes; 5 new tests (34 total) |
| 21.32.0 | feat: pressure-sycophancy integration — graduated strictness L0-L3, pressureHint(), PRESSURE_L1/L2/L3 behavioral rules, profanity patterns in NEGATIVE_PATTERNS, quote stripping in stripProtectedZones, 20-test suite |
| 21.31.0 | feat: docs-guard Constraints enforcement for I documents, 13 tests |
| 21.30.0 | feat: Phase 9 Evidence Gate harmonized (5-checkbox), Parameter Recommendation (Phase 0.7), 12-Phase workflow |
| 21.29.0 | feat: light-workflow philosophy port — PROHIBITED PATTERNS, L1-L4, Evidence Gate, Constraint Presentation, Devil's Advocate, Coherence Check |
| 21.28.0 | feat: light-workflow SKILL.md modernization — Workflow Selection, 9-section W template, Escalation Protocol, CLAUDE.md rules |
| 21.27.0 | fix: ARCHITECTURE.md stale DELTA comment; D065 concluded, P093 done |
| 21.26.0 | revert: restore foreground DELTA detection in inject-rules.js (DELTA_INSTRUCTION, checkDeltaPending, hasPendingDelta); remove delta-background.js PostToolUse hook (claude -p loads 34K+ token context causing Haiku to follow skill instructions; --bare breaks OAuth auth); proven foreground mechanism restored |
| 21.25.0 | fix: delta-background.js direct API → claude -p subprocess (fixes broken Haiku summarization under subscription auth); hooks.json async→asyncRewake (ghost response prevention); 17 hooks CRABSHELL_BACKGROUND guard (plugin pollution prevention); 4 new delta-background tests (14 total) |
| 21.24.0 | feat: proactive constraint presentation in investigating/discussing skills (project + inferred); feat: worklog (W) document system for light-workflow tracing; docs: D/P/T/I/W 5-document system |
| 21.23.0 | feat: async background delta processing via delta-background.js (Haiku API + raw fallback); task constraint confirmation in investigating/discussing skills; remove CRABSHELL_DELTA foreground trigger from inject-rules.js; delta no longer consumes model turns |
| 21.22.0 | refactor: inject-rules.js readProjectConcept() from shared-context.js; RULES Korean descriptive text translated to English |
| 21.21.0 | feat: PreCompact/PostCompact/SubagentStart hooks (3 new); shared-context.js cross-hook utilities; project.md constraints injection; async:true on skill-tracker + doc-watchdog record; 12 guard hooks total |
| 21.20.0 | feat: Type B/C behavioral rewrites (HHH, Anti-Deception, Understanding-First, Contradiction Detection, Problem-Solving); VIOLATIONS removed; SCOPE DEFINITIONS consolidated; CHECKLIST synced |
| 21.19.0 | feat: CLAUDE.md metacognitive→behavioral rule rewrite (R4 Scope Preservation, R26 Prohibited Patterns); scope-guard.js Stop hook; getLastUserMessage(); 20-test suite; I040 6-agent research |
| 21.18.0 | feat: doc-watchdog.js FSM — record/gate/stop modes for document-update omission prevention; 12-test suite; DOC_WATCHDOG_FILE/THRESHOLD constants; 3 new hook registrations |
| 21.17.0 | feat: /status healthcheck skill — reports plugin state with ✓/!/✗ indicators; fix: marketplace.json version drift corrected (was 21.15.0) |
| 21.16.0 | fix: verify-guard hybrid approach — Write to new file skips verification, Write to existing file + Edit enforce 3-stage check (fs.existsSync-based); feat: _test-verify-guard.js 7-test integration suite |
| 21.15.0 | fix: regressing/investigating SKILL.md — actually include Step 2.5/3.5 Parameter Recommendation content (missing from v21.14.0 commit) |
| 21.14.0 | Parameter Recommendation step added to regressing + investigating skills — users specify optimization target / confirm scope before agent work begins |
| 21.13.0 | regressing/planning/ticketing SKILL.md Phase-based multi-agent rewrite — Loop structure, Machine Verification priority, iteration cap + stall detection, Verify Agent Independence Protocol, 11 anti-patterns, cycle→iteration terminology |
| 21.12.0 | checkTicketStatuses() — ticket status reminder for active regressing sessions, injects warning for todo/in-progress tickets, 114-test suite (was 110) |
| 21.11.0 | log-guard.js validatePendingSections() — blocks ticket terminal transitions when result sections contain "(pending)", 77-test suite (was 67) |
| 21.10.0 | L1 session file pruning (>30 days), refineRawSync offset mode (O(n^2)→O(n)), session-aware L1 reuse in check(), final() offset/mtime clearing, prune→delta ordering, local-time date parsing fix, 102-test suite (10 integration) |
| 21.9.0 | RULES constant compressed 14,153→5,392 chars (62%), COMPRESSED_CHECKLIST 1,375→703 chars (49%), information architecture restructured for density |
| 21.8.0 | path-guard.js shell variable resolution (fail-closed for unknown vars targeting .crabshell/), _test-path-guard.js 111-test suite (subprocess+unit), marketplace.json+plugin.json description sync, run-hook.cmd cleanup |
| 21.7.0 | feat: counter.js conditional exports (require.main guard), _test-counter.js 67-test suite (unit+subprocess+edge), acquireIndexLock for memory-index.json writes, INDEX_LOCK_FILE constant, pressure reset fix |
| 21.6.0 | feat: .gitattributes LF enforcement, inject-rules.js 12 new exports, _test-inject-rules.js 110-test integration suite (subprocess, Korean+English keywords, regressing 5 phases+compat, delta+rotation shared root, CLAUDE.md sync+legacy+resync) |
| 21.5.0 | feat: pressure detection fixes — exclusion strip architecture, narrowed `왜 이렇게`, 8 diagnostic exclusions, widened `break(ing|s)`, SessionStart decay to L1, self-directed PRESSURE_L1/L2/L3, test exports, 66-test suite |
| 21.4.0 | feat: log-guard.js dual-trigger D/P/T log enforcement (terminal status + cycle log), guard count 7→8, hooks.json position 4/8 |
| 21.3.0 | feat: /verifying manifest v21 entries (V001-V004), guard consolidation analysis (keep 4, safety > count), Stop hook text block gap documented |
| 21.2.0 | feat: L1-L4 observation resolution hierarchy (VERIFICATION-FIRST) + verifying SKILL.md manifest schema expansion |
| 21.1.0 | feat: verification claim detection (sycophancy-guard 4-tier classification) + pressure L3 expansion (Read/Grep/Glob/Bash/Write/Edit blocked, expertise framing) |
| 21.0.0 | feat: verification-sequence guard — source edit→test→commit enforcement, edit-grep cycle detection, transcript-utils.js shared utilities, hooks.json order optimization |
| 20.7.0 | feat: sycophancy-guard dual-layer — removed 100-char exemption, added PreToolUse mid-turn transcript parsing |
| 20.6.0 | feat: memory.md → logbook.md rename (docs, skills, commands), memory-delta SKILL.md Step 4 append-memory.js CLI |
| 20.5.0 | feat: counter file separation (counter.json), extract-delta.js mark-appended CLI, memory-delta SKILL.md Bash CLI steps |
| 20.4.0 | feat: sycophancy-guard evidence type split (behavioral vs structural), inject-rules.js positional optimization (COMPRESSED_CHECKLIST first, verify items #1/#2, verification reminder) |
| 20.3.0 | feat: enforcement guards — path-guard Edit block on logbook.md, verify-guard behavioral AC requirement, sycophancy-guard "맞다." + English "Correct."/"Right." patterns |
| 20.2.0 | feat: delta foreground conversion — remove background delta-processor, TZ_OFFSET auto-injection in inject-rules.js, foreground-only memory-delta SKILL.md |
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
| 13.9.3 | Delta cleanup blocked unless logbook.md physically updated |
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
