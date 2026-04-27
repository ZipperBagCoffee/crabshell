# Crabshell Architecture (v21.87.0)

## Overview

Crabshell is a Claude Code plugin that automatically saves session context using hooks, structured fact extraction, and tiered storage with automatic rotation. It also enforces behavioral rules (Understanding-First, Verification-First) and provides a skills-based workflow system for document management, iterative improvement (regressing), and verification.

## Core Philosophy

### Understanding-First
Before any action, Claude must externalize its inference of user intent and confirm it. Internal reasoning is not confirmation — only user response closes the gap.

### Verification-First
Before claiming any result verified, Claude must:
1. **Predict** — write expected observation BEFORE looking
2. **Execute** — run code, trigger behavior, use tools
3. **Compare** — prediction vs observation; the gap is where findings live

Every verification item requires a P/O/G (Prediction/Observation/Gap) table. "File contains X" is never verification. "Can verify but didn't" is a violation.

Observation resolution levels (v21.2.0): L1 (direct execution) > L2 (indirect execution) > L3 (structural check) > L4 (claim without evidence, prohibited). L3 alone is insufficient when L1 is possible.

### SCOPE DEFINITIONS
The plugin's RULES section includes Scope Definitions that reframe Claude's built-in system prompt directives (conciseness, efficiency, directness) so they do not conflict with verification requirements:
- "Be concise" applies to communication style, not verification steps
- "Execute immediately" means execute the understanding step immediately
- "Don't overdo it" — skipping verification is underdoing it
- "Simplest approach" — simplest VALID approach; reading is not verifying

### PROBLEM-SOLVING PRINCIPLES
Two meta-principles guide Claude's approach to obstacles:
- **Constraint Reporting**: When hitting a limitation, report the constraint clearly — never recommend surrendering or abandoning the goal. The user decides whether to change direction.
- **Cross-Domain Translation**: Before substituting a same-domain tool, characterize the problem's abstract structure first. This enables finding solutions from adjacent domains that may fit better.

### Dual Injection Optimization
- **CLAUDE.md** (session start): Full RULES text (~1400 tokens, 5.4KB) synced via `syncRulesToClaudeMd()` with marker-based replacement
- **additionalContext** (every prompt): COMPRESSED_CHECKLIST (~200 tokens, 703B) — a lightweight reminder of key rules and quick-check questions
- **Error fallback**: Full RULES injected via additionalContext only when the normal path throws an exception

## System Architecture

```
+--------------------------------------------------------------------------+
|                           Claude Code CLI                                 |
+--------------------------------------------------------------------------+
|  Hooks (hooks.json)                                                       |
|  +---------------+  +-------------------+  +--------------+  +----------+|
|  | SessionStart  |  | UserPromptSubmit  |  | PostToolUse  |  |SessionEnd||
|  | load-memory   |  | inject-rules      |  | counter check|  |counter   ||
|  +-------+-------+  +--------+----------+  | skill-tracker|  |  final   ||
|  |               |                  |       +------+-------+  +----+-----+|
|  |  +-----------+--+  +------------+  |              |              |      |
|  |  | PreToolUse   |  | Stop       |  |              |              |      |
|  |  | (Write|Edit) |  |sycophancy  |  |              |              |      |
|  |  | regressing-  |  | -guard.js  |  |              |              |      |
|  |  | guard.js     |  |scope-guard |  |              |              |      |
|  |  | docs-guard.js|  |regressing- |  |              |              |      |
|  |  | log-guard.js |  |loop-guard  |  |              |              |      |
|  |  | verify-guard |  +------------+  |              |              |      |
|  |  | (Read|Grep|  |                |              |              |      |
|  |  |  Glob|Bash)  |                |              |              |      |
|  |  | path-guard.js|                |              |              |      |
|  |  +------+-------+                |              |              |      |
+----------+-+------------------------+----------------+--------------+-----+
             |                        |                |              |
             v                        v                v              v
+--------------------------------------------------------------------------+
|  scripts/                                                                 |
|                                                                           |
|  +--------------------+  +--------------------------------------------+  |
|  | load-memory.js     |  | inject-rules.js                           |  |
|  | - Load logbook.md  |  | - syncRulesToClaudeMd() (RULES→CLAUDE.md) |  |
|  | - Load L3 summaries|  | - Inject COMPRESSED_CHECKLIST per prompt   |  |
|  | - Load project.md  |  |   (~300 tokens via additionalContext)      |  |
|  | - Load moc-digest  |  | - Inject Project Concept (10 lines/500ch) |  |
|  | - Write MEMORY.md  |  | - Inject prompt-aware memory snippets     |  |
|  |   warning          |  | - Full RULES only on error fallback       |  |
|  +--------------------+  | - Pressure lastShownLevel tracking        |  |
|                          | - Detect pending delta → INSTRUCTION      |  |
|                          | - Detect pending rotation → INSTRUCTION   |  |
|                          | - Detect regressing → phase reminder      |  |
|                          +--------------------------------------------+  |
|  +--------------------+  +--------------------------------------------+  |
|  | counter.js         |  | regressing-guard.js (PreToolUse)          |  |
|  | - check: counter++ |  | - Blocks Write|Edit to .crabshell/plan/ and     |  |
|  |   + L1 + rotation  |  |   .crabshell/ticket/ when regressing active     |  |
|  |   + detect skill   |  | - Forces Skill tool invocation instead    |  |
|  |   calls → advance  |  | - Fail-open on error (exit 0)            |  |
|  |   regressing phase |  +--------------------------------------------+  |
|  | - final: last L1   |                                                  |
|  | - search-memory    |  +--------------------------------------------+  |
|  | - generate-l3      |  | regressing-state.js                       |  |
|  +--------------------+  | - getRegressingState()                    |  |
|                          | - buildRegressingReminder()               |  |
|  +--------------------+  | - detectRegressingSkillCall()             |  |
|  | extract-delta.js   |  | - advancePhase() (planning→ticketing→    |  |
|  | - extractDelta()   |  |   execution)                              |  |
|  | - markMemoryUpdated|  +--------------------------------------------+  |
|  | - cleanupDeltaTemp |                                                  |
|  +--------------------+  +-------------------+  +--------------------+   |
|                          | search.js         |  | memory-rotation.js |   |
|  +--------------------+  | - L1/L2/L3 search |  | - checkAndRotate() |   |
|  | constants.js       |  +-------------------+  +--------------------+   |
|  | - thresholds       |                                                  |
|  | - file paths       |  +-------------------+  +--------------------+   |
|  +--------------------+  | find-node.sh      |  | search-docs.js     |   |
|                          | - 6-stage fallback|  | - BM25 full-text   |   |
|  +--------------------+  | - exec passthrough|  | - field boosting   |   |
|  | utils.js           |  +-------------------+  +--------------------+   |
|  | - shared helpers   |                                                  |
|  +--------------------+  +-------------------+  +--------------------+   |
|                          | lint-obsidian.js   |  | migrate-obsidian.js|   |
|  +--------------------+  | - 5-check linter  |  | - frontmatter+wiki |   |
|  | shared-context.js  |  | - report output   |  | - --generate-moc   |   |
|  | - readProjectConcept|  +-------------------+  | - --generate-digest|   |
|  +--------------------+                          +--------------------+   |
+--------------------------------------------------------------------------+
          |                    |                    |
          v                    v                    v
+--------------------------------------------------------------------------+
|  .crabshell/memory/ (Project Storage)                                     |
|  +-------------------------------------------+  +-------------------+    |
|  | Auto-created:                              |  | sessions/         |    |
|  | - logbook.md (rolling, auto-rotates)        |  | - *.l1.jsonl      |    |
|  | - logbook_*.md (L2 archives)                |  +-------------------+    |
|  | - *.summary.json (L3 summaries)            |  +-------------------+    |
|  | - memory-index.json (rotation/delta state) |
|  | - counter.json (PostToolUse counter)       |  | logs/             |    |
|  | - regressing-state.json (cycle tracker)    |  | - refine.log      |    |
|  |                                            |  | - inject-debug.log|    |
|  | Optional (create with /setup-project):     |  +-------------------+    |
|  | - project.md (per-prompt injected)         |                           |
|  +-------------------------------------------+                           |
+--------------------------------------------------------------------------+
          |
          v
+--------------------------------------------------------------------------+
|  Skills Layer (21 skills)                                                 |
|  +---------------------------------+  +--------------------------------+ |
|  | Operational Skills (13)         |  | Memory Skills (7)              | |
|  | - discussing    (D documents)   |  | - save-memory                  | |
|  | - planning      (P documents)   |  | - load-memory                  | |
|  | - ticketing     (T documents)   |  | - search-memory                | |
|  | - investigating (I documents)   |  | - clear-memory                 | |
|  | - hotfix        (H documents)   |  | - memory-autosave              | |
|  | - light-workflow (standalone)   |  | - memory-delta                 | |
|  | - regressing    (D→P→T loop)    |  | - memory-rotate                | |
|  | - verifying     (verification)  |  |                                | |
|  | - knowledge     (K pages)       |  |                                | |
|  | - status        (healthcheck)   |  | Setup Skills (1)               | |
|  | - setup-rtk     (RTK config)    |  | - setup-project                | |
|  | - lint          (doc linter)    |  |                                | |
|  | - search-docs   (BM25 search)  |  |                                | |
|  +---------------------------------+  +--------------------------------+ |
+--------------------------------------------------------------------------+
```

## Memory Hierarchy (v13.0.0+)

```
+--------------------------------------------------------------------------+
|  L1: Raw Session Transcripts                                              |
|  - sessions/*.l1.jsonl (refined conversation logs)                        |
+--------------------------------------------------------------------------+
|  L2: Rolling Memory (auto-rotates at 23,750 tokens)                       |
|  - logbook.md (active, grows with each session)                           |
|  - logbook_YYYYMMDD_HHMMSS.md (archived when rotated)                      |
+--------------------------------------------------------------------------+
|  L3: Compressed Summaries (Haiku-generated JSON)                          |
|  - logbook_YYYYMMDD_HHMMSS.summary.json                                    |
|    (themes, keyDecisions, issues, overallSummary)                         |
+--------------------------------------------------------------------------+
```

## Hook Flow

```
1. SessionStart
   └─> load-memory.js
       ├─> Load logbook.md + L3 summaries + project files
       ├─> Load moc-digest.md (AI knowledge context, ~490 tokens) — v21.72.0
       └─> ensureAutoMemoryWarning() — write MEMORY.md warning

2. UserPromptSubmit (every prompt)
   └─> inject-rules.js
       ├─> syncRulesToClaudeMd() — sync full RULES to CLAUDE.md (marker-based)
       ├─> Inject COMPRESSED_CHECKLIST (~300 tokens) via additionalContext
       │   (Full RULES ~5000 tokens only on error fallback)
       ├─> Inject Project Concept (first 10 lines of project.md, max 500 chars) via additionalContext
       ├─> Inject prompt-aware memory snippets (keyword-match top 3 sections)
       ├─> Check for pending rotation (summaryGenerated: false)
       │   └─> If yes: Inject ROTATION_INSTRUCTION → Claude executes memory-rotate skill
       ├─> Check for active regressing session (regressing-state.json)
       │   └─> If yes: Inject phase-specific reminder (MANDATORY SKILL TOOL CALL)
       ├─> Check ticket statuses for active regressing (ticket/INDEX.md) — v21.12.0
       │   └─> If todo/in-progress tickets: Inject warning reminder
       ├─> Check for emergency stop keywords → replace entire context
       └─> Output indicator: [rules injected], [rules + rotation pending], [REGRESSING ACTIVE]
           (CRABSHELL_DELTA non-blocking background trigger v21.34.0 — Agent run_in_background replaces foreground blocking; deltaProcessing flag prevents race conditions)

3. PreToolUse — multiple guards (ordered: cheapest first)
   ├─> path-guard.js (Read|Grep|Glob|Bash|Write|Edit) — v19.31.0+
   │   ├─> Block operations targeting wrong .crabshell/ path
   │   ├─> Block Edit on memory/logbook.md — append-only enforcement (v20.3.0)
   │   └─> Block Write shrink on logbook.md — line count decrease detection (v20.6.0)
   ├─> regressing-guard.js (Write|Edit) — v19.23.0+
   │   ├─> If regressing active + phase=planning + target is .crabshell/plan/
   │   │   └─> BLOCK (exit 2): must use /planning skill instead
   │   ├─> If regressing active + phase=ticketing + target is .crabshell/ticket/
   │   │   └─> BLOCK (exit 2): must use /ticketing skill instead
   │   ├─> If regressing active + target is ticket doc + parent P doc has empty agent sections (v21.41.0)
   │   │   └─> BLOCK (exit 2): complete planning phase first (structural emptiness + parenthetical detection)
   │   └─> Otherwise: allow (exit 0), fail-open on errors
   ├─> docs-guard.js (Write|Edit) — v19.33.0+
   │   └─> Block writes to .crabshell/ D/P/T/I/H subdirectories without active skill flag
   ├─> log-guard.js (Write|Edit) — v21.4.0+
   │   ├─> Block INDEX.md terminal status changes (→done/verified/concluded) without document log entries
   │   ├─> Block tickets with "(pending)" in result sections (Execution/Verification/Orchestrator) — v21.11.0
   │   └─> Block new cycle documents without previous cycle logs in regressing
   ├─> verify-guard.js (Write|Edit) — v19.34.0+
   │   ├─> Block Final Verification writes without prior /verifying run call
   │   └─> Require at least 1 behavioral (type: "direct") AC in manifest (v20.3.0)
   ├─> verification-sequence.js gate (Write|Edit|Bash) — v21.0.0+
   │   ├─> Block git commit if source files edited but no test run
   │   └─> Block source file edits after 3+ edit-grep cycles without testing
   ├─> doc-watchdog.js gate (Write|Edit) — v21.18.0+
   │   └─> Soft warning (additionalContext) when code edits >= 5 without D/P/T doc update (regressing only)
   ├─> pressure-guard.js (Read|Grep|Glob|Bash|Write|Edit) — v19.47.0+, v21.1.0 L3, v21.71.0 short msgs
   │   └─> Block all 6 tools at L2/L3 with short message (full text via inject-rules once-only)
   └─> sycophancy-guard.js (Write|Edit) — v20.7.0+, v21.1.0 claim detection
       └─> Mid-turn transcript parsing for sycophancy patterns + verification claim detection (4-tier) before tool writes

3.5. Stop — v19.29.0+
   ├─> sycophancy-guard.js (dual-layer: Stop + PreToolUse, v20.7.0)
   │   ├─> Detect agreement-without-verification patterns → block with re-examination
   │   └─> Write memory-index.json — three pressure counters (feedbackPressure.level, feedbackPressure.oscillationCount, tooGoodSkepticism.retryCount):
   │       increment feedbackPressure.oscillationCount on reversal phrases; increment/reset tooGoodSkepticism.retryCount on all-None P/O/G tables
   │       (pressure-adjacent counters, independent of feedbackPressure.level raised by pressure-guard/inject-rules)
   ├─> doc-watchdog.js stop (v21.18.0)
   │   └─> Block session end when regressing active + ticket has no work log entry since last code edit
   ├─> scope-guard.js (v21.19.0)
   │   └─> Compare user-requested quantity vs response count; block scope reduction without approval
   └─> regressing-loop-guard.js (v21.55.0)
       └─> Block stop when regressing active + inject phase-specific context (force continuation); enforce ≥2 parallel WAs; light-workflow + single-WA enforcement

4. PostToolUse (all tools)
   ├─> counter.js check
   │   ├─> Detect regressing skill calls → auto-advance phase (v19.23.0)
   │   ├─> Increment counter
   │   ├─> checkAndRotate() — archive if > 23,750 tokens
   │   └─> At threshold: create/update L1 (session-aware reuse + incremental offset read) → extractDelta() → creates delta_temp.txt
   ├─> verification-sequence.js record (.*) — v21.0.0+
   │   └─> Track source file edits, test executions, grep cycles in verification-state.json
   ├─> doc-watchdog.js record (Write|Edit) — v21.18.0+
   │   └─> Track code edits (increment) and D/P/T doc edits (reset) in doc-watchdog.json
   └─> skill-tracker.js (Skill) — v19.33.0+
       └─> Set skill-active flag on Skill tool calls (TTL-based, 5min expiry)

5. SessionEnd
   └─> counter.js final
       ├─> Create final L1 session transcript (full reprocess, no offset)
       ├─> Cleanup duplicate L1 files
       ├─> pruneOldL1() — delete L1 files >30 days old (v21.10.0)
       ├─> extractDelta() for remaining content
       └─> Clear lastL1TranscriptOffset/Mtime (next session starts fresh)

6. PreCompact — v21.21.0
   └─> pre-compact.js
       └─> Inject memory preservation instructions into compaction prompt via additionalContext

7. PostCompact — v21.21.0
   └─> post-compact.js
       └─> Log compaction event to logbook.md + preserve regressing state across compaction

8. SubagentStart — v21.21.0
   └─> subagent-context.js
       └─> Inject project constraints + rules into sub-agents; Part 3: model routing table via readModelRouting() (T1/T2/T3 tiers from project.md)
```

## Skills Architecture

### Document Skills (D/P/T/I/W)
Five skills manage append-only documents stored in `.crabshell/` (gitignored):

| Skill | Document Type | Code | Purpose |
|-------|--------------|------|---------|
| discussing | Discussion | D001, D002... | Explore decisions, capture context |
| planning | Plan | P001, P002... | Detailed execution plans |
| ticketing | Ticket | P001_T001... | Atomic work units (child of Plan) |
| investigating | Investigation | I001, I002... | Independent research/analysis |
| light-workflow | Worklog | W001, W002... | Light-workflow tracing (standalone tasks) |

Document hierarchy: D -> P -> T (Discussion spawns Plans, Plans spawn Tickets). Investigations and Worklogs are independent.

Each document type has an INDEX.md for tracking. Status cascades upward on completion (ticket verified -> plan closes -> discussion closes).

### Workflow Skills

| Skill | Purpose |
|-------|---------|
| light-workflow | Standalone 1-shot tasks without document trail. Agent classification: Light (spot-check) vs Full (1:1 review). |
| lint | Obsidian document linter — 5 checks (orphans, broken wikilinks, stale status, missing frontmatter, INDEX inconsistencies). |
| search-docs | BM25 full-text search across D/P/T/I/W documents with field boosting (title 3x, tags 2x, id 1.5x). |
| regressing | Iterative D->P->T loop. `/regressing "topic" N` runs N cycles wrapped by a single Discussion. Anti-partitioning enforced. |
| verifying | Create/run project-specific verification tools. Invoked as procedural step in ticketing/light-workflow/regressing. |

### Memory Skills

| Skill | Purpose |
|-------|---------|
| save-memory | Manual memory save trigger |
| load-memory | Rebuild full context after compaction/restart |
| search-memory | L1/L2/L3 search (--deep for L1 transcripts) |
| clear-memory | Cleanup memory files |
| memory-autosave | Auto-trigger memory save at counter threshold |
| memory-delta | Auto-trigger delta summarization from delta_temp.txt |
| memory-rotate | Auto-trigger L3 summary generation after rotation |

### Agent Structure
For complex work, the plugin enforces a 3-layer agent architecture:

```
+------------------+
|   Orchestrator   |  — Intent Guardian: preserves user's original intent
+--------+---------+  — Synthesizes/critiques reviewer feedback
         |            — Does NOT perform Work or Review itself
    +----+----+
    |         |
+---+---+ +---+---+
| Work  | |Review |   — Every Work Agent MUST have a paired Review Agent
| Agent | | Agent |   — Launched as SEPARATE Task tool invocations
+-------+ +---+---+   — Review Agent includes Devil's Advocate section
              |
    +---------+---------+
    | Cross-Review       |  — MANDATORY when 2+ review agents (BLOCKING)
    | (if 2+ reviewers)  |  — Produces contested findings, blind spots, consensus
    +--------------------+
```

Agent orchestration rules (11 rules covering pairing, cross-review, coherence, critical stance, overcorrection, etc.) are extracted to `.claude/rules/agent-orchestration.md` — an always-loaded rules file that provides structural separation from CLAUDE.md (v19.49.0).

## Scripts Reference

| Script | Hook | Purpose |
|--------|------|---------|
| `find-node.sh` | (bootstrap) | Cross-platform Node.js locator, 6-stage fallback, `exec` passthrough |
| `load-memory.js` | SessionStart | Load memory hierarchy, MEMORY.md warning |
| `inject-rules.js` | UserPromptSubmit | Dual injection (CLAUDE.md + additionalContext), delta/rotation/regressing detection |
| `counter.js` | PostToolUse, SessionEnd | Main engine: counter, L1 creation, rotation, regressing phase detection |
| `regressing-guard.js` | PreToolUse (Write\|Edit) | Block direct plan/ticket writes during active regressing; force Skill tool; validate P doc agent sections before ticketing (v21.41.0) |
| `docs-guard.js` | PreToolUse (Write\|Edit) | Block writes to .crabshell/ D/P/T/I/H subdirectories without active skill flag |
| `log-guard.js` | PreToolUse (Write\|Edit) | Block INDEX.md terminal status without document log entries; block tickets with "(pending)" result sections; block cycle docs without previous cycle logs |
| `verify-guard.js` | PreToolUse (Write\|Edit) | Hybrid: Edit always enforces verification; Write enforces only for existing files (new file creation skips). Block Final Verification without /verifying run; require behavioral AC in manifest |
| `pressure-guard.js` | PreToolUse (Read\|Grep\|Glob\|Bash\|Write\|Edit) | Detect feedback pressure escalation; block all 6 tools at L3 with .crabshell/.claude exemption |
| `path-guard.js` | PreToolUse (Read\|Grep\|Glob\|Bash\|Write\|Edit) | Block wrong .crabshell/ path; shell var resolution (fail-closed for .crabshell/ v21.8.0); block Edit on logbook.md; block Write shrink on logbook.md (v20.6.0) |
| `sycophancy-guard.js` | Stop, PreToolUse (Write\|Edit) | Dual-layer sycophancy detection + verification claim detection (4-tier classification): Stop response + mid-turn transcript parsing; block with re-examination |
| `scope-guard.js` | Stop | Compare user-requested quantity vs response count; block scope reduction without approval |
| `regressing-loop-guard.js` | Stop | Block stop when regressing active + inject phase-specific context via buildRegressingReminder(); enforce ≥2 parallel WAs in regressing + light-workflow; WA count tracking via wa-count.json |
| `behavior-verifier.js` | Stop | 감시자 sub-agent dispatch (v21.80.0+): write `behavior-verifier-state.json` `status='pending'` + `[CRABSHELL_BEHAVIOR_VERIFY]` sentinel. v21.83.0 trigger 3-layer (periodic N=8 + workflow-active force + escalation L0/L1) + 5-class turn classification + ring buffer FIFO N=8 + state schema 14 fields |
| `deferral-guard.js` | Stop | Detect trailing deferral questions (`진행할까요`, `shall I proceed`) via regex against last 300 chars + `hasAnalysisBody` (≥5 lines OR ≥400 chars). v21.81.0+ warn-only: stderr `[BEHAVIOR-WARN]` + exit 0; semantic enforcement absorbed by behavior-verifier §3.logic Trailing-deferral sub-clause |
| `skill-tracker.js` | PostToolUse (Skill) | Set skill-active flag on Skill tool calls (TTL-based, 5min expiry) |
| `regressing-state.js` | (library) | Phase tracker: getState, buildReminder, detectSkillCall, advancePhase |
| `extract-delta.js` | (library) | L1 delta extraction, timestamp watermarks, temp file management |
| `memory-rotation.js` | (library) | Token-based rotation: archive at 23,750 tokens, 2,375 token carryover |
| `search.js` | (library) | Multi-layer L1/L2/L3 search |
| `constants.js` | (library) | Centralized thresholds, file paths, regressing state file path |
| `utils.js` | (library) | Shared utilities: readJsonOrDefault, readIndexSafe, writeJson, getProjectDir |
| `init.js` | (library) | Project initialization, index preservation on parse error |
| `transcript-utils.js` | (library) | Shared stdin/transcript utilities: readStdin, findTranscriptPath, encodeProjectPath, normalizePath |
| `refine-raw.js` | (library) | raw.jsonl -> l1.jsonl conversion (async + sync with optional byte offset) |
| `legacy-migration.js` | (library) | Split oversized memory files |

## Configuration Constants (constants.js)

| Constant | Value | Description |
|----------|-------|-------------|
| ROTATION_THRESHOLD_TOKENS | 23750 | Effective rotation threshold (25000 * 0.95) |
| CARRYOVER_TOKENS | 2375 | Carryover on rotation (2500 * 0.95) |
| MEMORY_DIR | memory | Memory storage directory |
| SESSIONS_DIR | sessions | Session storage directory |
| INDEX_FILE | memory-index.json | Rotation tracking + delta state |
| COUNTER_FILE | counter.json | PostToolUse counter (separated from index) |
| MEMORY_FILE | logbook.md | Active memory file |
| REGRESSING_STATE_FILE | regressing-state.json | Regressing cycle tracker |
| SKILL_ACTIVE_FILE | skill-active.json | TTL-based skill flag for docs-guard/verify-guard |
| BEHAVIOR_VERIFIER_STATE_FILE | behavior-verifier-state.json | 감시자 sub-agent state: pending/completed lifecycle, 14 fields including ringBuffer/turnType/escalationLevel (v21.80.0+) |
| BEHAVIOR_VERIFIER_LOCK_FILE | verifier.lock | RMW lock for `completed→consumed` transition (at-most-once correction emit) |
| RING_BUFFER_SIZE | 8 | FIFO cap for `state.ringBuffer` (recent verdict UVLS lines, v21.83.0) |
| VERIFIER_INTERVAL | 8 | Periodic skip threshold: verifier fires when `verifierCounter ≥ lastFiredTurn + 8` (workflow-inactive only, v21.83.0) |

## Memory Rotation Flow

```
logbook.md grows with session summaries
        |
        v
checkAndRotate() called on each check
        |
        v
estimateTokens(content) > 23,750?
    +---+---+
    | YES   | NO
    v       v
Rotate    (continue)
    |
    v
1. Archive to logbook_YYYYMMDD_HHMMSS.md
2. Keep last 2,375 tokens as carryover
3. Update index.json
4. Output [CRABSHELL_ROTATE] trigger
    |
    v
Haiku agent generates L3 summary
    |
    v
Save to *.summary.json
```

## memory-index.json Structure

```json
{
  "version": 1,
  "current": "logbook.md",
  "rotatedFiles": [
    {
      "file": "logbook_20260113_120000.md",
      "rotatedAt": "2026-01-13T12:00:00.000Z",
      "tokenCount": 24500,
      "summary": "logbook_20260113_120000.summary.json",
      "summaryGenerated": true
    }
  ],
  "stats": {
    "totalRotations": 0,
    "lastRotation": null
  },
  "lastMemoryUpdateTs": "2026-02-01T12:00:00.000Z",
  "deltaCreatedAtMemoryMtime": 1234567890123.456
}
```

| Field | Description |
|-------|-------------|
| lastMemoryUpdateTs | ISO timestamp of last processed L1 entry (for delta extraction) |
| deltaCreatedAtMemoryMtime | logbook.md mtime when delta was created (for cleanup validation) |
| deltaReady | Flag: true when delta_temp.txt is ready for processing |
| pendingLastProcessedTs | Temp: max L1 entry ts from last extractDelta(), used by markMemoryUpdated() |
| lastL1TranscriptMtime | Transcript file mtime at last L1 creation (skip redundant L1 creation) |
| lastL1TranscriptOffset | Byte offset into transcript file after last L1 creation (incremental reads, v21.10.0) |
| verifierCounter | PostToolUse counter for behavior-verifier periodic skip (v21.83.0) — separate from `counter` to avoid saveInterval=15 reset conflict; snapshot to `state.lastFiredTurn` on Stop fire |
| feedbackPressure | Pressure system state: `level` (0-3), `consecutiveCount`, `oscillationCount`, `decayCounter`, `lastShownLevel`, `lastDetectedAt` — RMW under index lock |
| tooGoodSkepticism | Sycophancy guard "too good" P/O/G all-None retry counter: `retryCount` |

### counter.json Structure (v20.5.0)

```json
{
  "counter": 0
}
```

Separated from memory-index.json to eliminate Write race condition during delta processing. counter.js writes this on every PostToolUse; memory-index.json is now only written during rotation/delta operations.

## L3 Summary Structure

```json
{
  "sourceFile": "logbook_20260113_120000.md",
  "generatedAt": "2026-01-13T12:05:00.000Z",
  "themes": [
    { "name": "Authentication", "summary": "Implemented JWT-based auth..." }
  ],
  "keyDecisions": [
    { "decision": "Use bcrypt for passwords", "reason": "Industry standard" }
  ],
  "issues": [
    { "issue": "Login timeout bug", "status": "resolved" }
  ],
  "overallSummary": "This period focused on authentication system..."
}
```

## Known Limitations

### Stop Hook Text Block Gap
- The Stop hook's `stop_response` field contains only the **last text block** of multi-block responses. When Claude produces text, then calls a tool, then produces more text, only the final text block is visible to the Stop hook.
- **Impact on sycophancy detection**: Sycophancy patterns in early text blocks (before tool calls) are invisible to the Stop hook. A response that agrees without evidence in block 1, calls Write in block 2, and writes a summary in block 3 would only have block 3 checked by the Stop hook.
- **Partial mitigation**: The PreToolUse layer of `sycophancy-guard.js` parses mid-turn transcript text before each Write|Edit call. This catches sycophancy that precedes file writes, but only for Write|Edit — not for Read, Grep, Glob, or Bash tool calls.
- **Remaining gap**: If Claude agrees without evidence and then uses Read/Grep/Glob/Bash (but not Write/Edit), neither the Stop hook nor the PreToolUse guard catches the sycophancy. Expanding PreToolUse to check transcript text for all tool types is a potential future mitigation.

### Guard Consolidation (IA-6 Analysis)
The 5 PreToolUse Write|Edit guards (regressing-guard, docs-guard, log-guard, verify-guard, sycophancy-guard) remain separate. Consolidation was analyzed and rejected for safety:
- **Independent fail-open isolation**: Each guard catches errors and exits 0 independently. A merged script's crash in one guard's logic would silently disable all guards.
- **Different dependencies**: regressing-state.json, skill-active.json, run-verify.js + manifest.json, and transcript files respectively. A dependency failure in one should not affect others.
- **Different complexity profiles**: 60 lines (regressing) vs 497 lines (sycophancy). Merging makes simple guards harder to reason about.
- **Concurrent execution**: Separate processes run in parallel via hook system, which is faster than sequential checks in one process.

## Version History

| Version | Key Changes |
|---------|-------------|
| 21.60.0 | feat: role-collapse-guard.js (Orchestrator source-write block), deferral-guard.js (warn-only trailing question detection); fix: context-length "세션" + stoppage patterns, narrowed English session patterns; fix: memory-delta SKILL.md "foreground" → "wait for completion" |
| 21.59.0 | feat: Discussion Edit guard during regressing (docs-guard.js), context-length deferral detection (sycophancy-guard.js Step 0), discussing SKILL.md Rule 1 conditional, regressing SKILL.md pre-partitioning warning in Step 2.5 |
| 21.58.0 | feat: Pressure system redesign — L2 blocks 6 tools, L3 full lockdown (all tools including TaskCreate); block messages with user feedback solicitation; fix: counter.js TaskCreate reset gated, hooks.json matcher `.*`, verify-guard timeout 30s→60s |
| 21.57.0 | feat: anti-retreat pressure rules — PRESSURE_L1 blocks "I don't know" without tool use; PRESSURE_L2 blocks "검증 불가능" without searching, mandates sub-agent spot-checking |
| 21.56.0 | feat: oscillation enforcement — sycophancy-guard block on first direction change (pressure-independent), 3 precision REVERSAL_PATTERNS, PRESSURE_L1 prior-response review mandate |
| 21.55.0 | feat: regressing-loop-guard.js Stop hook phase-specific context via buildRegressingReminder(); fix: counter.js WA tracking 'TaskCreate'→'Agent' |
| 21.39.0 | test: 32 new tests — _test-extract-delta (15), _test-append-memory (7), _test-memory-rotation (10) |
| 21.38.0 | feat: path-guard skill-active.json block; calm-framing in inject-rules + sycophancy-guard; counter.js lock early return + ensureDir |
| 21.37.0 | fix: docs-guard.js INDEX.md early return (bypasses skill-active TTL check) |
| 21.36.0 | feat: RA Deletion Check — mandatory git diff before verification; Evidence Gate 5→6 checkbox |
| 21.35.0 | fix: docs-guard.js INDEX.md exclusion from investigation Constraints check |
| 21.34.0 | feat: delta-summarizer background non-blocking; markDeltaProcessing() + mark-processing CLI; deltaProcessing flag |
| 21.33.0 | fix: node.exe pattern for Windows full path with quotes in verification-sequence + sycophancy-guard |
| 21.32.0 | feat: pressure-sycophancy integration — graduated strictness L0-L3, pressureHint(), PRESSURE_L1/L2/L3 behavioral rules, profanity patterns in NEGATIVE_PATTERNS, quote stripping, 20-test suite |
| 21.31.0 | feat: docs-guard Constraints enforcement for I documents, 13 tests |
| 21.30.0 | feat: Phase 9 Evidence Gate harmonized (5-checkbox), Parameter Recommendation (Phase 0.7), 12-Phase workflow |
| 21.29.0 | feat: light-workflow philosophy port — PROHIBITED PATTERNS, L1-L4, Evidence Gate, Constraint Presentation, Devil's Advocate, Coherence Check |
| 21.28.0 | feat: light-workflow SKILL.md modernization — Workflow Selection, 9-section W template, Escalation Protocol, CLAUDE.md rules |
| 21.27.0 | fix: ARCHITECTURE.md stale DELTA comment; D065 concluded, P093 done |
| 21.26.0 | revert: restore foreground DELTA detection in inject-rules.js (DELTA_INSTRUCTION, checkDeltaPending, hasPendingDelta); remove delta-background.js PostToolUse hook (claude -p loads 34K+ token context causing Haiku to follow skill instructions; --bare breaks OAuth auth) |
| 21.25.0 | fix: delta-background.js direct API → claude -p subprocess (fixes broken Haiku summarization under subscription auth); hooks.json async→asyncRewake (ghost response prevention); 17 hooks CRABSHELL_BACKGROUND guard (plugin pollution prevention); 4 new delta-background tests (14 total) |
| 21.24.0 | feat: proactive constraint presentation in investigating/discussing skills (project + inferred); feat: worklog (W) document system for light-workflow tracing; docs: D/P/T/I/W 5-document system |
| 21.23.0 | feat: async background delta processing via delta-background.js (Haiku API + raw fallback); task constraint confirmation in investigating/discussing skills; remove CRABSHELL_DELTA foreground trigger from inject-rules.js; delta no longer consumes model turns |
| 21.22.0 | refactor: inject-rules.js readProjectConcept() from shared-context.js; RULES Korean descriptive text translated to English |
| 21.21.0 | feat: PreCompact/PostCompact/SubagentStart hooks (12 guard hooks total); shared-context.js cross-hook utilities; project.md constraints injection; async:true on skill-tracker + doc-watchdog record |
| 21.20.0 | feat: Type B/C behavioral rewrites (HHH, Anti-Deception, Understanding-First, Contradiction Detection, Problem-Solving); VIOLATIONS removed; SCOPE DEFINITIONS consolidated; CHECKLIST synced |
| 21.19.0 | feat: CLAUDE.md metacognitive→behavioral rule rewrite (R4 Scope Preservation, R26 Prohibited Patterns); scope-guard.js Stop hook; getLastUserMessage(); 20-test suite; I040 6-agent research |
| 21.18.0 | feat: doc-watchdog.js FSM — record/gate/stop modes for document-update omission prevention; 12-test suite; DOC_WATCHDOG_FILE/THRESHOLD constants; 3 new hook registrations |
| 21.17.0 | feat: /status healthcheck skill; fix: marketplace.json version drift |
| 21.16.0 | fix: verify-guard hybrid approach (new file creation skips); feat: _test-verify-guard.js 7-test suite |
| 21.15.0 | fix: regressing/investigating SKILL.md Parameter Recommendation content (missing from v21.14.0) |
| 21.14.0 | feat: Parameter Recommendation step added to regressing + investigating skills |
| 21.13.0 | feat: regressing/planning/ticketing SKILL.md Phase-based multi-agent rewrite; Loop structure; Machine Verification priority; 11 anti-patterns |
| 21.12.0 | checkTicketStatuses() — ticket status reminder for active regressing, injects warning for todo/in-progress tickets, 114-test suite (was 110) |
| 21.11.0 | log-guard.js validatePendingSections() — blocks ticket terminal transitions when result sections contain "(pending)", 77-test suite (was 67) |
| 21.10.0 | L1 session file pruning (>30 days), refineRawSync offset mode (O(n^2)→O(n)), session-aware L1 reuse in check(), final() offset/mtime clearing, prune→delta ordering, local-time date parsing fix, 102-test suite (10 integration) |
| 21.9.0 | RULES constant compressed 14,153→5,392 chars (62%), COMPRESSED_CHECKLIST 1,375→703 chars (49%), information architecture restructured for density |
| 21.8.0 | path-guard.js shell variable resolution (fail-closed for unknown vars targeting .crabshell/), _test-path-guard.js 111-test suite (subprocess+unit), marketplace.json+plugin.json description sync, run-hook.cmd cleanup |
| 21.7.0 | counter.js conditional exports (require.main guard), _test-counter.js 67-test suite (unit+subprocess+edge), acquireIndexLock for memory-index.json writes, INDEX_LOCK_FILE constant, pressure reset fix |
| 21.6.0 | .gitattributes LF enforcement, inject-rules.js 12 new exports, _test-inject-rules.js behavioral tests |
| 21.5.0 | Pressure detection fixes: exclusion strip architecture, narrowed `왜 이렇게`, 8 diagnostic exclusions, widened `break(ing|s)`, SessionStart decay to L1, self-directed PRESSURE_L1/L2/L3, exports for testing, 66-test suite |
| 21.4.0 | log-guard.js dual-trigger D/P/T log enforcement (terminal status + cycle log), guard count 7→8, hooks.json position 4/8 |
| 21.3.0 | /verifying manifest populated with v21 entries (V001-V004), guard consolidation analysis (keep 4, safety > count), Stop hook text block gap documented |
| 21.2.0 | L1-L4 observation resolution hierarchy (VERIFICATION-FIRST) + verifying SKILL.md manifest schema expansion (level, steps[], observation fields) |
| 21.1.0 | Verification claim detection (sycophancy-guard 4-tier classification) + pressure L3 expansion (all 6 tools blocked, expertise framing) |
| 21.0.0 | verification-sequence guard — source edit→test→commit enforcement, edit-grep cycle detection, transcript-utils.js shared utilities, hooks.json order optimization |
| 20.7.0 | sycophancy-guard dual-layer — removed 100-char exemption, added PreToolUse mid-turn transcript parsing |
| 20.6.0 | memory.md → logbook.md rename (docs, skills, commands), memory-delta SKILL.md Step 4 append-memory.js CLI |
| 20.5.0 | Counter file separation (counter.json), extract-delta.js mark-appended CLI, memory-delta SKILL.md Bash CLI steps |
| 20.4.0 | Sycophancy-guard evidence type split (behavioral vs structural), inject-rules.js positional optimization (COMPRESSED_CHECKLIST first, verify items #1/#2, verification reminder) |
| 20.3.0 | Enforcement guards — path-guard Edit block on logbook.md, verify-guard behavioral AC requirement, sycophancy-guard "맞다." + English "Correct."/"Right." patterns |
| 20.2.0 | Delta foreground conversion — remove background delta-processor agent, TZ_OFFSET auto-injection in inject-rules.js, foreground-only memory-delta SKILL.md |
| 20.1.0 | D/P/T/I documents consolidated under .crabshell/ — all guards, skills, and paths updated; init.js auto-creates directories |
| 19.49.0 | Per-prompt project concept anchor; extract 11 agent orchestration rules to .claude/rules/agent-orchestration.md; reduce emphasis markers 19→5 |
| 19.48.0 | Lossless compression of RULES + COMPRESSED_CHECKLIST — 8 edits preserving all rule semantics (CLAUDE.md 169→161 lines) |
| 19.47.0 | PROBLEM-SOLVING PRINCIPLES — Constraint Reporter + Cross-Domain Translation; SCOPE DEFINITIONS failure-context reframes |
| 19.46.0 | Fix: replace Bash write/delete with Node.js fs in all SKILL.md files |
| 19.45.0 | Feat: sycophancy-guard context-aware detection with position-based evidence, zone stripping, 2-pass detection |
| 19.44.0 | Fix: path-guard regex handles spaces in quoted paths — two-phase extraction method |
| 19.43.0 | Fix: remove ensureGlobalHooks() — was auto-registering duplicate hooks in global settings.json |
| 19.42.0 | Feat: lessons skill enforces actionable rule format — Problem/Rule/Example template |
| 19.41.0 | Fix: replace Bash rm with Node fs.unlinkSync in clear-memory/delta-processor to avoid permission prompts |
| 19.40.0 | Chore: remove orphaned verifying-called.json flag code from skill-tracker, load-memory, constants |
| 19.39.0 | Feat: verify-guard deterministic execution; P/O/G Type column (behavioral/structural) with Evidence Gate; IA Source Mapping Table |
| 19.38.0 | Fix: HOOK_DATA fallback for path-guard.js and regressing-guard.js; sync-rules-to-claude.js duplicate MARKER_START |
| 19.37.0 | Feat: search-memory CLI enhancements — --regex, --context=N, --limit=N; L1 structured output |
| 19.36.0 | Fix: sycophancy-guard.js HOOK_DATA fallback for hook-runner.js invocation path |
| 19.35.0 | Feat: delta-processor background agent — non-blocking delta processing; DELTA_PROCESSING_LOCK + DELTA_LOCK_STALE_MS constants |
| 19.34.0 | Feat: verify-guard PreToolUse hook — block Final Verification writes without /verifying run; skill-tracker extension |
| 19.33.0 | Feat: docs-guard PreToolUse hook + skill-tracker PostToolUse hook — TTL-based skill flag (5min expiry) |
| 19.32.0 | Feat: RA pairing enforcement (WA N = RA N), concrete coherence verification methods, overcorrection SCOPE DEFINITIONS |
| 19.31.0 | Feat: path-guard PreToolUse hook — block Read/Grep/Glob/Bash targeting wrong .claude/memory/ path |
| 19.30.0 | Feat: P/O/G unification, R→I stale refs fix, stop_hook_active guard, RA Independence Protocol |
| 19.29.0 | Feat: Stop hook sycophancy guard — detect agreement-without-verification patterns |
| 19.28.0 | Feat: ticket execution ordering guide; final coherence verification for regressing |
| 19.27.0 | Feat: COMPRESSED_CHECKLIST coherence; regressing 4-factor evaluation (correctness/completeness/coherence/improvement) |
| 19.26.0 | Feat: regressing execution quality — result improvement cycles, multi-WA perspective diversity, anti-sycophancy framing |
| 19.25.0 | Feat: regressing 1:N Plan:Ticket — ticketIds array; execution/feedback phases display all ticket IDs |
| 19.24.0 | SCOPE DEFINITIONS framing + COMPRESSED_CHECKLIST (~300 token per-prompt injection) + regressing-guard PreToolUse hook + skill Scope Notes |
| 19.23.0 | Regressing phase tracker — hook-based auto-enforcement of Skill tool usage, regressing-state.js, regressing-guard.js |
| 19.22.0 | Feat: Verification tool check procedure in regressing/ticketing/light-workflow — /verifying invoked as procedural step, not rule |
| 19.21.0 | Feat: Verifying skill — create/run project-specific verification tools; inline verification definitions replaced with VERIFICATION-FIRST reference |
| 19.20.0 | Feat: RA Independence Protocol + Planning E/A/G verification + Orchestrator cross-reference step |
| 19.19.0 | Feat: Verification philosophy operationalization — P/O/G template + Evidence Gate + observation evidence mandate |
| 19.18.0 | Feat: Regressing quality enforcement — anti-pattern rules, agent independence, enriched feedback, anti-partitioning, cross-review integration |
| 19.17.0 | Feat: Anthropic best practices — 14 skill descriptions rewritten, fabricated params removed |
| 19.16.0 | Feat: Rename researching -> investigating, new I(Investigation) document type |
| 19.15.0 | Feat: Regressing D-PT loop — single Discussion wraps all cycles |
| 19.14.0 | Feat: Rename workflow -> light-workflow, remove stale references |
| 19.13.0 | Changed: i18n — translated Korean text in 6 skill documents to English |
| 19.12.0 | Changed: Verification philosophy — observation evidence gates |
| 19.11.0 | Feat: Regressing skill — autonomous D->P->T loop |
| 19.10.0 | Feat: Skill precision optimization — descriptions, triggers, workflow split |
| 19.9.0 | Feat: Mandatory work log for D/P/T/R documents |
| 19.7.0 | Feat: Status cascade — ticket verified auto-closes parent plan and related D/R; reverse propagation constraints prevent premature closure |
| 19.6.0 | Feat: Runtime verification added to workflow (Phase 8/9/10) — mandatory 4th verification element |
| 19.5.1 | Feat: Document templates include execution rules (ticket Execution section, workflow Post-Workflow checklist) |
| 19.5.0 | Feat: Ticket-Workflow 1:1 mapping, post-workflow mandatory documentation |
| 19.4.0 | Feat: 4 document management skills (/discussing, /planning, /ticketing, /researching) with append-only documents and INDEX.md tracking |
| 19.3.0 | Feat: Intent Anchor mechanism — enforceable Intent Comparison Protocol at all meta-review gates |
| 19.2.0 | Fix: Emergency stop hookData.input->hookData.prompt (correct UserPromptSubmit field) |
| 19.1.0 | Feat: Cross-Review as BLOCKING gate (Phase 3.5/6.5/9.5), spot-check scaling, adversarial cross-examination |
| 19.0.0 | Feat: workflow/lessons delivered via skills, workflow compressed 762->367 lines, B9/B10 verification standard in RULES, templates/ removed |
| 18.5.0 | Feat: Orchestrator as Intent Guardian — filter reviewer feedback through original intent, override drift |
| 18.4.0 | Feat: agent orchestration rules — pairing, cross-talk, orchestrator insight; workflow.md parallel execution |
| 18.3.0 | Feat: emergency stop keywords — context replacement on trigger, agent utilization rule |
| 18.2.0 | Feat: workflow agent enforcement rule — must use Task tool for Work/Review Agent phases |
| 18.1.0 | Fix: `CLAUDE_PROJECT_DIR` not propagated to Bash tool — `--project-dir` CLI arg for extract-delta.js/counter.js/load-memory.js, absolute paths and Project Root Resolution in all 6 skills |
| 18.0.0 | Fix: bare `node` PATH failure on Windows Git Bash — find-node.sh cross-platform locator, process.execPath in ensureGlobalHooks, {NODE_PATH} placeholders in skills/commands |
| 17.3.0 | Fix: anchor explicitly overrides Primary working directory |
| 17.2.0 | Feat: project root anchor injection — prevent directory loss after compaction |
| 17.1.0 | Fix: use CLAUDE_PROJECT_DIR instead of hookData.cwd for project root |
| 17.0.0 | Fix: Central cwd isolation via hook-runner.js v2 (reads stdin, sets PROJECT_DIR from hookData.cwd), final() session isolation, CONFIG_PATH dynamic, regex parser compatibility, 20 mock tests |
| 16.0.x | Fix: writeJson() Windows EPERM fallback, getProjectDir walk-up removal, session-aware delta extraction, conditional delta_temp.txt preservation, async check() with session_id |
| 15.4.0 | Change: MIN_DELTA_SIZE 40KB -> 10KB |
| 15.3.0 | Fix: stable hook-runner.js eliminates version-specific paths in settings.json |
| 15.2.0 | Fix: atomic writeJson, init.js preserves index on parse error |
| 15.1.0 | Workaround: auto-register hooks in settings.json via SessionStart (hook bug #10225, #6305), try/catch in counter.js check() |
| 15.0.0 | Fix: Stop->SessionEnd hook, counter interval 50->30 |
| 14.9.0 | Delta: conditional processing, only trigger at >= 40KB |
| 14.8.1 | Workflow: remove presentation-specific section from template |
| 14.8.0 | Workflow: 3-layer architecture (Work Agent + Review Agent + Orchestrator), 11 phases |
| 14.7.1 | Fix: async stdin for Windows pipe compatibility |
| 14.7.0 | Post-compaction detection: inject recovery warning via SessionStart |
| 14.6.0 | PRINCIPLES: imperative commands instead of definitions |
| 14.5.0 | Rename Action Bias -> Completion Drive (Claude's native term) |
| 14.4.0 | Fix: UNDERSTANDING-FIRST requires external user confirmation |
| 14.3.0 | Fix: L1 captures user-typed messages (string content handling) |
| 14.2.0 | PRINCIPLES: understanding-driven rewrite with verification tests |
| 14.1.0 | Action Bias principle in injected RULES |
| 14.0.0 | L1 creation on PostToolUse, L1-based lastMemoryUpdateTs, spread readIndexSafe |
| 13.9.26 | DEFAULT_INTERVAL 100->50 |
| 13.9.25 | Workflow: Orchestrator vs Agent role division |
| 13.9.24 | Counter-based delta gating, interval 25->100 |
| 13.9.23 | UNDERSTANDING-FIRST rule: gap-based verification |
| 13.9.22 | Timestamp double-escaping fix, MEMORY.md auto-warning in SessionStart |
| 13.9.21 | Session restart context recovery rule |
| 13.9.20 | Workflow & lessons system with auto-init templates |
| 13.9.19 | CLAUDE.md marker-based sync (preserves project-specific content) |
| 13.9.18 | Marker-based CLAUDE.md sync (initial implementation) |
| 13.9.16 | Restore CLAUDE.md auto-sync, new rules (Unclear->Ask, Example 2, memory order) |
| 13.9.12 | Understanding-first principle, criticism handling process |
| 13.9.11 | Delta trigger pattern fix (lastMemoryUpdateTs null) |
| 13.9.10 | Commands path resolution fix, legacy cleanup |
| 13.9.9 | 30-second thinking rule with date command verification |
| 13.9.7 | lastMemoryUpdateTs preservation fix in init.js |
| 13.9.5 | Dual timestamp headers (UTC + local) |
| 13.9.4 | Delta extraction append mode, UTC timestamp headers |
| 13.9.3 | Delta cleanup blocked unless logbook.md physically updated |
| 13.9.2 | UTC timestamp unification, migrate-timezone.js tool, interval 5->25 |
| 13.8.7 | Removed experimental context warning feature |
| 13.8.6 | Proportional delta summarization (1 sentence per ~200 words) |
| 13.8.5 | Stronger delta instruction blocking language |
| 13.8.4 | Script path resolution for all skills |
| 13.8.3 | Added 'don't cut corners' rule |
| 13.8.2 | Fixed memory-index.json field preservation on parse errors |
| 13.8.1 | Windows `echo -e` -> `printf` fix |
| 13.8.0 | Auto-trigger L3 generation after rotation |
| 13.7.0 | Path detection fix for plugin cache execution |
| 13.6.0 | UserPromptSubmit-based delta/rotation triggers |
| 13.5.0 | Delta-based auto-save, rules injection via UserPromptSubmit |
| 13.0.0 | Token-based memory rotation, L3 Haiku summaries, integrated search |
| 12.x | Stop hook blocking, L2/L3/L4 workflow improvements |
| 8.x | L1-L4 hierarchical memory system |
