# Changelog

## v21.42.0
- feat: inject-rules.js PRESSURE_L1 — oscillation-awareness text (state what changed and why before direction change)
- feat: inject-rules.js PRESSURE_L2 — stronger oscillation-awareness text (CRITICAL: state previous position + justifying evidence)
- feat: inject-rules.js PROHIBITED PATTERNS #8 — direction change without stated reasoning rule
- feat: inject-rules.js updateFeedbackPressure — oscillationCount field initialized to 0 (AC-5)
- feat: sycophancy-guard.js — checkReversalPhrases() with 14 patterns (8 English + 6 Korean), protected zone stripping via stripProtectedZones()
- feat: sycophancy-guard.js — oscillationCount read/increment (getOscillationCount, incrementOscillationCount) backed by memory-index.json
- feat: sycophancy-guard.js Stop hook — oscillation blocking: reversalCount > 0 → increment; count >= 3 AND pressure >= 1 → exit 2 with Direction Change Check message

## v21.41.0
- feat: planning SKILL.md — document-first rule added to Steps A/B/C (write to P doc BEFORE reporting)
- feat: ticketing SKILL.md — document-first rule added to Steps A/B (Step C already had it)
- feat: regressing-guard.js — IA-2 block: validates P document agent sections (Analysis Results, Review Results, Intent Check) non-empty before allowing ticket writes; structural emptiness check with parenthetical placeholder detection
- fix: verify-guard.js V002 — bare `node` in execSync replaced with `process.execPath` (Windows compatibility)
- feat: planning + ticketing SKILL.md — passive placeholder "(Appended after agent execution)" replaced with actionable instructions
- test: _test-regressing-guard.js — 7 tests (passthrough, planning gate, ticketing gate, empty block, populated allow, old placeholder block, non-ticket allow)
- test: _test-regressing-guard-edge-cases.js — 14 edge-case tests (absent heading, new placeholder, null planId, fail-open paths)

## v21.40.0
- fix: docs-guard.js — remove dead code (INDEX.md check in checkInvestigationConstraints, superseded by main() early return in v21.37.0)
- feat: CLAUDE.md version bump checklist — add source repo .claude-plugin/plugin.json as explicit step (7)
- feat: ticketing/SKILL.md Step B — Skeptical calibration bullet after Devil's Advocate
- feat: ticketing/SKILL.md Step 4 template — Edge-case coverage note in Acceptance Criteria section
- test: TC7g updated to match new checkInvestigationConstraints behavior (INDEX.md exclusion is main() responsibility)

## v21.39.0
- test: _test-extract-delta.js — 15 tests for extractDelta, markMemoryUpdated, cleanupDeltaTemp, markDeltaProcessing, markMemoryAppended
- test: _test-append-memory.js — 7 subprocess tests for append-memory.js (missing summary, empty, valid, logbook create/accumulate, cleanup)
- test: _test-memory-rotation.js — 10 tests for checkAndRotate (absent, threshold, carryover, archive name, index update, lock, custom config)

## v21.38.0
- feat: path-guard.js — block direct Write/Edit on skill-active.json; 3 new tests (114 total)
- feat: ticketing/SKILL.md Step C — document-first rule; remove trailing append line
- feat: inject-rules.js — calm-framing: PRESSURE_L1→Calibration Check, L2→Pattern Reset, L3→Diagnostic Mode, EMERGENCY_STOP→DIAGNOSTIC RESET
- feat: sycophancy-guard.js — calm-framing: "Sycophancy pattern" → "Agreement pattern", "you MUST" → "Close the gap", updated pressureHint L1/L2/L3 labels
- fix: counter.js — lock early return + ensureDir before acquireIndexLock (fail-open on lock contention)

## v21.37.0
- fix: docs-guard.js — INDEX.md early return before skill-active check (bypasses TTL check for listing files)
- test: _test-docs-guard.js — 3 new tests (TC5c, TC5d, TC5e), 18 total

## v21.36.0
- feat: RA Deletion Check — mandatory `git diff` scan before verification in ticketing and light-workflow
- feat: Evidence Gate expanded from 5-checkbox to 6-checkbox (added unintended deletion check)
- feat: fallback paths for empty diff (HEAD~1, git show, N/A with reason)

## v21.35.0
- fix: docs-guard.js — exclude INDEX.md from investigation Constraints check (was blocking investigation/INDEX.md edits)
- test: _test-docs-guard.js — 2 new tests (TC5b subprocess + TC7g unit), 15 total

## v21.34.0
- feat: delta-summarizer converted from foreground blocking to background non-blocking via Agent tool `run_in_background: true`
- feat: SKILL.md (memory-delta) rewritten with Phase A (foreground launch) + Phase B (background completion)
- feat: inject-rules.js DELTA_INSTRUCTION changed from BLOCKING to NON-BLOCKING
- feat: extract-delta.js — markDeltaProcessing() function + mark-processing CLI command
- feat: memory-index.json deltaProcessing flag (set in Phase A, cleared in cleanup) to prevent double-trigger

## v21.33.0
- fix: verification-sequence.js isTestExecution() node.exe pattern — `\bnode\s+` → `\bnode(?:\.exe)?["']?\s+` (Windows full path with quotes support)
- fix: sycophancy-guard.js TEST_EXECUTION_PATTERNS — same node.exe pattern fix
- test: _test-verification-sequence.js — 5 new test cases (34 total)

## v21.32.0
- feat: sycophancy-guard.js — pressure-aware graduated strictness (L0=default, L1=rethink warning, L2=PARTIAL blocks+structural ignored, L3=behavioral evidence override), reads feedbackPressure.level from memory-index.json
- feat: pressureHint() — pressure-aware block message helper
- feat: PRESSURE_L1/L2/L3 texts — 5 behavioral rules (no blind agreement, don't act immediately, rethink, find middle ground, verify)
- feat: sycophancy-guard.js — quote stripping added to stripProtectedZones
- feat: inject-rules.js — Korean/English profanity patterns added to NEGATIVE_PATTERNS
- test: _test-sycophancy-pressure.js — 20 tests for pressure-sycophancy integration

## v21.31.0
- feat: docs-guard.js — investigation document `## Constraints` section enforcement (blocks Edit without Constraints, allows first Write)
- feat: _test-docs-guard.js — 13 tests (subprocess + unit) for Constraints enforcement
- test: `claude -p --system-prompt` L1 test for background memory (reentrancy limitation documented)

## v21.30.0
- feat: EXECUTION-PHASES.md Phase 9 — Evidence Gate upgraded to 5-checkbox BLOCKING (harmonized with SKILL.md)
- feat: ANALYSIS-PHASES.md Phase 0.7 — Parameter Recommendation step (agent count, specialist roles, model tier)
- feat: SKILL.md 11-Phase → 12-Phase Workflow (includes Phase 0.7)

## v21.29.0
- feat: light-workflow SKILL.md — Pre-Response Output Scan (PROHIBITED PATTERNS 7-item), L1-L4 Observation Resolution Levels, Evidence Gate 5-checkbox BLOCKING
- feat: ANALYSIS-PHASES.md — Constraint Presentation in Phase 1, Devil's Advocate check, RA/WA Cross-Reference anchor, Coherence Check for single-reviewer in Phase 4
- feat: EXECUTION-PHASES.md — Phase 8 Escalation Protocol cross-reference, W document 9-section completion alignment
- fix: SKILL.md "On completion" aligned with 9-section W template

## v21.28.0
- feat: light-workflow SKILL.md — Workflow Selection section (≤5/6-7/8+ decision matrix, mandatory scope estimate)
- feat: light-workflow SKILL.md — W document 9-section template + 6 rejection criteria (replaces 4-field template)
- feat: light-workflow SKILL.md — Mid-Execution Escalation Protocol (>7 files or shared convention → STOP)
- feat: CLAUDE.md ADDITIONAL RULES — workflow selection criteria + urgency signal handling rule
- fix: verification manifest AC-6 stale version (21.23.0 → 21.27.0)

## v21.27.0
- fix: ARCHITECTURE.md stale comment — DELTA foreground trigger restored note (was incorrectly stating "removed v21.23.0")
- chore: D065 concluded, P093 done, regressing state cleaned

## v21.26.0
- revert: inject-rules.js — restore DELTA_INSTRUCTION, checkDeltaPending(), hasPendingDelta context injection (foreground DELTA detection mechanism)
- revert: hooks.json — remove delta-background.js PostToolUse hook entry
- reason: claude -p subprocess loads full plugin context (34K+ tokens), causing Haiku to follow skill instructions instead of summarizing; --bare flag breaks OAuth auth; reverted to proven foreground DELTA detection via inject-rules.js

## v21.25.0
- fix: delta-background.js — direct Anthropic API call replaced with `claude -p` subprocess (fixes broken Haiku summarization under subscription auth)
- fix: hooks.json — delta-background entry changed from `async:true` to `asyncRewake:true` (prevents ghost response on rewake)
- fix: 17 hook scripts — added `CRABSHELL_BACKGROUND=1` early-exit guard (prevents plugin pollution during background execution)
- feat: _test-delta-background.js — 4 new tests covering subprocess execution, CRABSHELL_BACKGROUND guard, asyncRewake behavior (14 tests total)

## v21.24.0
- feat: proactive constraint presentation in investigating/discussing skills (project + inferred)
- feat: worklog (W) document system for light-workflow tracing
- docs: D/P/T/I/W 5-document system

## v21.23.0
- feat: async background delta processing via delta-background.js (Haiku API + raw fallback)
- feat: task constraint confirmation in investigating and discussing skills
- refactor: remove CRABSHELL_DELTA foreground trigger from inject-rules.js
- perf: delta processing no longer consumes model turns (async PostToolUse hook)

## v21.22.0
- refactor: inject-rules.js readProjectConcept — replace inline project.md reading with readProjectConcept() from shared-context.js
- fix: inject-rules.js RULES + PROHIBITED PATTERNS — translate Korean descriptive text to English (detection regex patterns preserved)

## v21.21.0
- feat: PreCompact hook — inject memory preservation instructions into compaction prompt
- feat: PostCompact hook — compaction event logging and regressing state preservation
- feat: SubagentStart hook — inject project constraints + rules into sub-agents
- feat: shared-context.js — extract shared constants/functions for cross-hook reuse
- feat: project.md constraints section for project-specific constraint injection
- perf: async:true on skill-tracker and doc-watchdog record hooks for latency reduction

## v21.20.0
- feat: CLAUDE.md Type B/C metacognitive rules → behavioral trigger-action rewrites (R1 HHH, R2 Anti-Deception, R9, R10, R16, R22, R25, R30, R36)
- feat: VIOLATIONS section removed (redundant with PROHIBITED PATTERNS)
- feat: SCOPE DEFINITIONS consolidated (9→8 entries, interceptor keywords preserved + positive framing)
- feat: UNDERSTANDING-FIRST simplified (abstract gap-theory → concrete "list uncertainties")
- feat: REQUIREMENTS expanded (delete 3-step, P/O/G mandate, factual claim evidence)
- feat: PROBLEM-SOLVING concrete 3-try escalation trigger
- feat: Verification Checklist replaces abstract Contradiction Detection (3 concrete checks)
- feat: COMPRESSED_CHECKLIST fully synchronized with new rules + "Output scan" footer

## v21.19.0
- feat: CLAUDE.md R4 "Completion Drive" → "Scope Preservation" behavioral rule (trigger-action, quantity tracking, "시간" 핑계 금지)
- feat: CLAUDE.md R26 "INTERFERENCE PATTERNS (self-monitor)" → "PROHIBITED PATTERNS (check your output before sending)" — 7 output-scannable patterns replacing metacognitive self-monitoring
- feat: COMPRESSED_CHECKLIST item 4 updated to match Scope Preservation rule
- feat: scope-guard.js — new Stop hook detecting scope reduction (user quantity N vs response count M, "둘 다"/"전부"/"both"/"all" + reduction language detection)
- feat: transcript-utils.js getLastUserMessage() — extracts last human message from transcript JSONL
- feat: _test-scope-guard.js — 20 integration tests for scope-guard
- feat: hooks.json — scope-guard Stop hook registered (9th guard hook)
- research: I040 investigation (6 Opus agents) — LLM metacognition rules structurally inadequate; 7-tier rule effectiveness hierarchy established

## v21.18.0
- feat: doc-watchdog.js — FSM for document-update omission prevention: record (PostToolUse, tracks code edits), gate (PreToolUse, soft warning via additionalContext when threshold exceeded during regressing), stop (Stop hook, blocks session end when regressing active + ticket has no work log entry since last code edit)
- feat: _test-doc-watchdog.js — 12 integration tests for all three modes
- feat: DOC_WATCHDOG_FILE / DOC_WATCHDOG_THRESHOLD constants added to constants.js
- feat: hooks.json — 3 new entries: PostToolUse record, PreToolUse gate (after verification-sequence gate, before pressure-guard), Stop (after sycophancy-guard)

## v21.17.0
- feat: /status healthcheck skill — reports plugin state with ✓/!/✗ indicators
- fix: marketplace.json version drift corrected (was 21.15.0)

## v21.16.0
- fix: verify-guard hybrid approach — Write to new file (creation) skips verification, Write to existing file + Edit enforce 3-stage check (fs.existsSync-based)
- feat: _test-verify-guard.js — 7 integration tests for verify-guard Write/Edit distinction

## 21.15.0
- fix: regressing/investigating SKILL.md — actually include Step 2.5/3.5 Parameter Recommendation content (missing from v21.14.0 commit)

## 21.14.0
- feat: regressing SKILL.md — Parameter Recommendation step added (users specify optimization target before cycle loop begins)
- feat: investigating SKILL.md — Parameter Recommendation step added (users confirm investigation scope/sources before agent work begins)

## 21.13.0
- feat: regressing/planning/ticketing SKILL.md Phase-based multi-agent rewrite — WA-RA pair removed, Loop structure (verify→gap→plan→ticket→implement→verify), Machine Verification priority (Phase 2.9), iteration cap (default 10) + stall detection, Verify Agent Independence Protocol, anti-pattern table expanded to 11 entries, cycle→iteration terminology
- feat: inject-rules.js RULES constant — cycle→iteration in Workflows rule

## 21.12.0
- feat: checkTicketStatuses(projectDir) — reads regressing-state.json ticketIds, checks .crabshell/ticket/INDEX.md for "todo" or "in-progress" statuses, injects warning into additionalContext on UserPromptSubmit; fail-open (returns null on missing files/parse errors); backward compat for singular ticketId field
- feat: _test-inject-rules.js — 114 tests (was 110): checkTicketStatuses (4: todo-warning/all-done-null/no-regressing-null/missing-index-null)

## 21.11.0
- feat: log-guard.js validatePendingSections() — blocks ticket terminal transitions (done/verified) when Execution Results (Work Agent), Verification Results (Review Agent), or Orchestrator Evaluation sections still contain "(pending)"; only applies to tickets (P\d{3}_T\d{3}), discussions/plans/investigations are not checked; runs after validateLogForTerminal() passes using already-read document content
- feat: _test-log-guard.js — 77 tests (was 67): validatePendingSections unit tests (7: all-pending/single-pending/filled-sections/discussion-skip/plan-skip/null-content/no-sections), pending integration tests (3: pending-blocks/filled-allows/discussion-not-checked)

## 21.10.0
- feat: pruneOldL1() — deletes .l1.jsonl files >30 days old from sessions/ (local-time calendar day comparison matching compress(), YYYY-MM-DD and YYYYMMDD format parsing via regex, fail-open on permission errors), called in final() after L1 creation but before delta extraction, exported for testing
- feat: refineRawSync offset mode — accepts optional startOffset byte parameter, reads only new bytes via fs.openSync/readSync, appends to existing L1 output, returns { lineCount, newOffset } object (backward compatible: no-offset returns plain number); edge cases: partial JSON line at boundary skipped to next newline, offset beyond file size resets to 0, empty file returns 0, single line no newline skipped, offset at exact EOF returns 0
- feat: lastL1TranscriptOffset tracking in memory-index.json — counter.js check() passes offset to refineRawSync, updates after each incremental L1 creation, eliminates O(n^2) full-transcript re-reads every 15 tool calls
- fix: check() session-aware L1 reuse — finds existing L1 for current sessionId to append via offset instead of creating new L1 each interval (which caused only latest increment to be kept); new sessions (no existing L1) start from offset=0
- fix: final() clears lastL1TranscriptOffset and lastL1TranscriptMtime inside acquireIndexLock — ensures next session starts fresh from offset=0, prevents stale offset from carrying across sessions
- fix: pruneOldL1 date parsing — uses local-time Date constructor `new Date(year, month, day)` matching compress() behavior instead of `new Date("YYYY-MM-DD")` which creates UTC midnight (timezone mismatch caused boundary test failures)
- feat: _test-counter.js — 102 tests (was 67): pruneOldL1 (6), offset mode (4), export (1), L1 pruning edges (7), offset edges (8), integration (10: prune-doesn't-delete-today/search-after-prune/delta-after-prune/offset-in-lock/final-no-offset/final-clears-offset/prune-before-delta-order/session-L1-reuse/new-session-offset-0/offset-clear-in-lock)

## 21.9.0
- feat: RULES constant compressed 14,153→5,392 chars (62% reduction) — information architecture restructured: scope definitions collapsed to 1-liners, examples removed from Understanding-First and Verification-First, problem-solving merged to 2-sentence block, principles shortened, additional rules restored (lessons/session-restart/work-log/documents/version-bump) in compressed form
- feat: COMPRESSED_CHECKLIST compressed 1,375→703 chars (49% reduction) — 8 items (was 10), interference alert shortened

## 21.8.0
- feat: path-guard.js shell variable resolution — resolves $CLAUDE_PROJECT_DIR, $PROJECT_DIR, $HOME, $USERPROFILE, ~ before validation; blocks unresolved vars ($RANDOM, $FOO) + subshell patterns ($(), backticks) targeting .crabshell/; fail-closed for unknown vars (was fail-open); added resolveShellVariables, hasUnresolvedVariables, require.main guard + 6-function exports
- feat: _test-path-guard.js — 111 tests (was 29): 55 subprocess tests (Read/Grep/Glob/Bash, parent traversal, quoted paths, shell var resolution, unknown var blocking, mixed paths, non-.crabshell paths, backtick/subshell), 56 unit tests (hasShellVariable 10, resolveShellVariables 12, hasUnresolvedVariables 7, checkPath 16, resolveDotsInPath 5, extractMemoryPathsFromCommand 5, exports 6 — known var resolution, unknown var blocking, subshell/backtick, mixed paths, non-.crabshell exclusion, projectDir=homedir edge case)
- fix: marketplace.json — description updated to match current plugin scope (memory+guards+workflows), metadata description fixed (Memory Keeper→Crabshell), keywords updated
- fix: plugin.json — description and keywords updated to match current plugin scope
- chore: delete hooks/run-hook.cmd zombie file, remove from STRUCTURE.md

## 21.7.0
- feat: counter.js conditional exports — getCounter, setCounter, getConfig, cleanupDuplicateL1, dedupeL1, parseArg, compress (require.main guard)
- feat: _test-counter.js — 67 tests covering exports (7 functions + exclusion check), getCounter/setCounter (8 unit tests incl. corrupt/missing/zero/nofield), getConfig (3: defaults+project+corrupt), parseArg (7: key=value/missing/empty/equals-in-value/first-match), cleanupDuplicateL1 (6: dedup/diff-session/empty/invalid-json/larger-existing), dedupeL1 (3: dedup/no-dup/no-dir), compress (4: archive-old/keep-recent/ignore-prefixed/empty), subprocess check (5: increment/multi/interval-reset/custom-interval/below-interval), TaskCreate pressure (4: reset/no-pressure/L3/L0-noop), Skill phase advancement (7: planning/discussing/ticketing/non-match/no-state/non-skill/inactive), edge cases (6: no-dir/corrupt-counter/corrupt-index/empty-hookdata/no-session/empty-session), subprocess usage+reset (2), locking structural (6: counter/inject-rules/load-memory/constant/different-from-lock-file), module structure (3: guard/switch-inside/exports)
- feat: acquireIndexLock/releaseIndexLock for memory-index.json writes — counter.js check() wrapped in try/finally, counter.js final() delta write locked, inject-rules.js writeJson locked, load-memory.js pressure decay converted to writeJson+locked
- feat: INDEX_LOCK_FILE (.memory-index.lock) constant — separate from .rotation.lock to avoid deadlock with checkAndRotate()
- fix: counter.js check() pressure reset — replaced raw fs.writeFileSync+JSON.parse with readIndexSafe+writeJson

## 21.6.0
- feat: .gitattributes — enforce LF line endings for .sh, .js, .json, .md files
- feat: inject-rules.js exports expanded — checkEmergencyStop, syncRulesToClaudeMd, checkDeltaPending, checkRotationPending, buildRegressingReminder, getRelevantMemorySnippets, extractKeywords, parseMemorySections, stripCodeBlocks, EMERGENCY_KEYWORDS, NEGATIVE_PATTERNS, NEGATIVE_EXCLUSIONS
- feat: _test-inject-rules.js — 110 integration tests covering exports, emergency stop, delta+rotation shared storage root, CLAUDE.md sync (key sections, marker preservation, legacy migration, re-sync), regressing reminder (all 5 phases, backward compat ticketId, stale warning, inactive/missing fields), logbook.md date-header parsing, Korean+English mixed keyword extraction, subprocess execution (valid JSON output, context items, emergency stop), feedback pressure escalation+decay, code block stripping

## 21.5.0
- feat: pressure detection exclusion architecture fix — exclusions now strip/neutralize matched text instead of early-return, preventing false negatives when diagnostic phrases co-occur with real complaints
- feat: narrowed Pattern 6 (`왜 이렇게` → `왜 이렇게 (해|하|했|한|해놨|만들|만든)`), expanded Pattern 2 suffix (`잘못하고`), widened `break(ing|s)` pattern (removed `you` prefix requirement)
- feat: 8 diagnostic exclusion patterns (`뭔가.*잘못`, `잘못된 게 뭔지`, `what('s|is) wrong`, `went wrong`, `도대체 왜`, `잘못된 것 같`, `뭐가.*잘못된거지`, `is this wrong`)
- feat: SessionStart pressure decay — decays pressure to level 1 (not full reset to 0), preserving alertness across sessions
- feat: PRESSURE_L1/L2/L3 rewritten as self-directed LLM self-check (no "ask user to confirm", no "What did I get wrong?")
- feat: inject-rules.js exports `detectNegativeFeedback` and `updateFeedbackPressure` for testing (main() guarded with `require.main === module`)
- feat: _test-feedback-detection.js — 66 tests covering AC-1 through AC-9 (exclusion strip, agentive narrowing, breaking, diagnostics, pressure decay, self-directed messages, exports, regression, false positives, code block stripping)

## 21.4.0
- feat: log-guard.js dual-trigger D/P/T log enforcement — blocks INDEX.md terminal status changes (→done/verified/concluded) without document log entries, blocks new cycle documents without previous cycle logs in regressing
- feat: _test-log-guard.js — 67 tests covering both guard triggers
- feat: hooks.json — log-guard at position 4/8 in PreToolUse chain (Write|Edit matcher)
- guard count: 7→8

## 21.3.0
- feat: /verifying manifest populated with v21 feature entries (V001-V004) — verification-sequence gate, sycophancy claim detection, pressure-guard L3 Read block, L1-L4 hierarchy in CLAUDE.md
- analysis: guard consolidation (IA-6) — 4 PreToolUse Write|Edit guards kept separate (independent fail-open isolation, different dependencies, concurrent execution via hook system)
- docs: Known Limitations section in ARCHITECTURE.md — Stop hook text block gap (sycophancy in early blocks invisible), PreToolUse only catches Write|Edit not Read/Grep/Glob/Bash

## 21.2.0
- feat: L1-L4 observation resolution hierarchy added to VERIFICATION-FIRST section in inject-rules.js RULES
- feat: verifying SKILL.md manifest schema expanded with level, steps[], observation fields

## 21.1.0
- feat: sycophancy-guard verification claim detection — 4-tier classification (phantom/inflated/premature/overclaim), negation defense, protected zones, short response exemption
- feat: pressure-guard L3 expansion — blocks Read/Grep/Glob/Bash/Write/Edit (was Write/Edit only), .crabshell/.claude exemption for all tools including Bash command inspection
- feat: PRESSURE_L3 inject-rules.js text reframed from CRITICAL/BLOCKED to expertise/consensus guidance with context inoculation
- feat: _test-sycophancy-claim-detection.js — verification claim detection test suite

## 21.0.0
- feat: verification-sequence.js — dual-mode PostToolUse state tracker + PreToolUse gate (source file edit→test→commit enforcement, edit-grep cycle detection)
- feat: transcript-utils.js — shared stdin/transcript/path utilities extracted from sycophancy-guard.js
- feat: hooks.json — verification-sequence record (PostToolUse .*) + gate (PreToolUse Write|Edit|Bash), PreToolUse order optimized (path-guard first, sycophancy-guard last)
- feat: _test-verification-sequence.js — 30 tests covering source file detection, test execution detection, gate behavior, edit-grep cycles, integration flows

## 20.7.0
- sycophancy-guard dual-layer: removed 100-char exemption, added PreToolUse mid-turn transcript parsing
- Fixed 5 stale test expectations in _test-sycophancy-guard.js (structural evidence should BLOCK, not ALLOW)
- Added PreToolUse integration test suite (_test-sycophancy-pretooluse.js, 17 tests)
- Added manifest behavioral test script (_test-sycophancy-guard-manifest.js)

## 20.6.0
- feat: memory.md → logbook.md rename across all docs, skills, and commands
- feat: memory-delta SKILL.md Step 4 rewritten to use append-memory.js via Bash CLI (no direct Write to logbook.md)

## 20.5.0
- feat: counter file separation — counter.json replaces memory-index.json counter field, migration on init, getDefaultIndex() cleaned
- feat: extract-delta.js CLI — mark-appended command sets memoryAppendedInThisRun flag, cleanup also clears memoryAppendedInThisRun
- feat: memory-delta SKILL.md Steps 4-6 rewritten to use Bash CLI calls to extract-delta.js instead of Read/Write tools on memory-index.json

## 20.4.0
- feat: sycophancy-guard evidence type split — behavioral (execution/test output) vs structural (grep/read) evidence, distinct block messaging for structural-only cases
- feat: inject-rules.js positional optimization — COMPRESSED_CHECKLIST before project concept, predict/verify items promoted to #1/#2, verification reminder appended to context

## 20.3.0
- feat: path-guard blocks Edit on memory.md (append-only enforcement)
- feat: verify-guard requires at least 1 behavioral (direct type) AC in manifest before allowing Final Verification
- feat: sycophancy-guard pattern update — "맞다." Korean + "Correct." "Right." English patterns

## 20.2.0
- feat: delta foreground conversion — remove background delta-processor agent, promote foreground flow to primary in memory-delta SKILL.md
- feat: TZ_OFFSET auto-injection — inject-rules.js computes timezone offset and adds to context for delta timestamp generation
- remove: agents/delta-processor.md deleted (background agent no longer needed)

## 20.1.0
- feat: D/P/T/I documents consolidated under .crabshell/ — docs/{discussion,plan,ticket,investigation}/ → .crabshell/{discussion,plan,ticket,investigation}/
- refactor: docs-guard.js, verify-guard.js, regressing-guard.js, pressure-guard.js — all regex patterns updated for .crabshell/ paths
- refactor: 4 SKILL.md files (discussing, planning, ticketing, investigating) — all path references updated
- feat: init.js auto-creates .crabshell/{discussion,plan,ticket,investigation}/ directories on SessionStart
- refactor: inject-rules.js RULES string — `docs/ protection` → `D/P/T/I protection` under .crabshell/
- feat: constants.js — DISCUSSION_DIR, PLAN_DIR, TICKET_DIR, INVESTIGATION_DIR constants added

## 20.0.0 (BREAKING)
- **RENAME**: memory-keeper → crabshell. Plugin name, skill prefix, log tags all changed.
- **PATH MIGRATION**: `.claude/memory/` → `.crabshell/`. Auto-migration on SessionStart for legacy projects.
- refactor: STORAGE_ROOT constant + getStorageRoot() centralization — all 18 scripts use unified path resolution
- feat: init.js auto-migration (copyDirRecursive .claude/memory/ → .crabshell/memory/, .claude/lessons/ → .crabshell/lessons/, .claude/verification/ → .crabshell/verification/)
- feat: .gitignore auto-add .crabshell/, .crabshell/README.md auto-generation
- refactor: path-guard.js rewritten for .crabshell/ paths (28 tests pass)
- refactor: [MEMORY_KEEPER*] → [CRABSHELL*] log tags, Memory Keeper → Crabshell branding
- refactor: memory-keeper: → crabshell: skill prefix in all skills/scripts
- remove: save-memory session file generation (unused, auto-save covers this)
- feat: project.md injection expanded to 10 lines/500 chars (v19.56.0)
- feat: CLAUDE_RULES practical guidelines — AI slop avoidance + config externalization (v19.56.0)
- feat: delta-processor Read+Write only — no Bash dependency (v19.55.0)

## 19.56.0
- feat: project.md injection expanded to 10 lines/500 chars, CLAUDE_RULES practical guidelines (AI slop avoidance, config externalization)

## 19.55.0
- feat: delta-processor Bash dependency removal — all 5 Bash steps replaced with Read+Write tool operations, JSON content-based lock protocol, inline timestamp generation with TZ_OFFSET, memoryAppendedInThisRun flag guard, memory-delta SKILL.md foreground fallback also Bash-free, orphaned Node.js/Script path sections removed

## 19.54.0
- feat: contradiction detection as formal verification role — 3-level framework (Local/Related pipeline/System-wide) in VERIFICATION-FIRST section, pipeline contradiction scan method added to ticketing/planning/regressing coherence verification

## 19.53.0
- fix: Bash escaping/permission — 9 files fixed (setup-project, memory-delta, delta-processor, save-memory, memory-autosave), `cat`/`find`→Read tool, `{SUMMARY}` shell injection→append-memory.js script, `!fs.existsSync`→`mkdirSync({recursive:true})`
- feat: regressing Loop→Convergence — `for 1..N`→`repeat until convergence or cap`, `Cycle X/Y`→`Cycle X (cap: Y)`, `[regressing: N cycles]`→`[regressing: cap N]`, N is safety cap not target
- feat: feedback assessment-mode detection — 10 new patterns (5 Korean + 5 English) for meta-cognitive criticism ("이해를 안하고", "you don't understand", etc.)

## 19.52.0
- feat: setup-project skill — auto-generates project.md from package.json/README.md for per-prompt drift prevention
- fix: counter.js memory-set path bug — was writing to {root}/project.md instead of {root}/.claude/memory/project.md
- refactor: remove architecture.md/conventions.md — SessionStart-only, useless after compaction, never per-prompt injected

## 19.51.0
- feat: regressing skill — default 10 cycles (no asking), early termination on convergence, 10-cycle checkpoint for defaulted N, userSpecifiedN state field, "operational steps as separate cycles" anti-pattern, sequential tasks belong in same cycle as code change (CLAUDE.md + SKILL.md)

## 19.50.0
- feat: feedback pressure detection system — L0-L3 escalating intervention with mechanical Write/Edit blocking at Level 3
- feat: pressure-guard.js PreToolUse hook — blocks direct editing when 3+ consecutive negative feedback detected, requires Task delegation
- feat: inject-rules.js negative feedback detection — 17 Korean/English patterns with 6 exclusions, code block stripping, pressure state tracking in memory-index.json
- feat: counter.js TaskCreate pressure reset — delegates work to fresh agent context, automatically resets pressure to L0

## 19.49.0
- feat: per-prompt project concept anchor — reads project.md and injects into additionalContext for drift prevention
- refactor: extract 11 agent orchestration rules to .claude/rules/agent-orchestration.md (always loaded, structural separation)
- refactor: reduce emphasis markers 19→5 (MUST/NEVER/CRITICAL/PROHIBITED on safety-critical rules only)
- refactor: remove 5 redundant negation clauses where positive framing already present

## 19.48.0
- refactor: lossless compression of RULES + COMPRESSED_CHECKLIST — 8 edits preserving all rule semantics (CLAUDE.md 169→161 lines, CHECKLIST scope defs removed, directive merges, interference merge, agent pairing/coherence/overcorrection compression)

## 19.47.0
- feat: PROBLEM-SOLVING PRINCIPLES — Constraint Reporter (report constraints, never recommend surrender) + Cross-Domain Translation (characterize problem structure before same-domain tool substitution)
- feat: SCOPE DEFINITIONS failure-context reframes for "Prefer action" and "Simplest approach"
- feat: COMPRESSED_CHECKLIST items 9-10 + interference alert expansion for surrender/substitution patterns

## 19.46.0
- fix: replace Bash write/delete with Node.js fs in all SKILL.md files — 6 locations still using Bash for file operations instead of Node.js fs

## 19.45.0
- feat: sycophancy-guard context-aware detection with position-based evidence — zone stripping, evidence expansion, 2-pass position detection

## 19.44.0
- fix: path-guard regex handles spaces in quoted paths — two-phase extraction method for both quoted and unquoted paths

## 19.43.0
- fix: remove ensureGlobalHooks() from load-memory.js — was auto-registering duplicate hooks in global ~/.claude/settings.json on every SessionStart

## 19.42.0
- feat: lessons skill enforces actionable rule format — Problem/Rule/Example template, prohibits reflective narratives and abstract principles

## 19.41.0
- fix: replace Bash rm with Node fs.unlinkSync in clear-memory skill and delta-processor agent to avoid sensitive file permission prompts

## 19.40.0
- chore: remove orphaned verifying-called.json flag code from skill-tracker, load-memory, constants

## 19.39.0
- feat: verify-guard deterministic execution — execSync runs run-verify.js directly, blocks on FAIL
- feat: P/O/G Type column (behavioral/structural) with Evidence Gate behavioral≥1 check
- feat: IA Source Mapping Table in discussing skill for regressing mode

## 19.38.0
- Fix: HOOK_DATA fallback for path-guard.js and regressing-guard.js
- Fix: sync-rules-to-claude.js duplicate MARKER_START header

## 19.37.0
- Feat: search-memory CLI enhancements — `--regex` flag, `--context=N`, `--limit=N` options; L1 structured output with entry/context display; increased default display limit to 20

## 19.36.0
- Fix: sycophancy-guard.js HOOK_DATA fallback — guard failed silently when invoked through hook-runner.js (global settings path) because stdin was already consumed; added HOOK_DATA env var check matching pattern used by all other guard scripts

## 19.35.0
- Feat: delta-processor background agent — non-blocking delta processing (summarize + validate + append + mark-updated + cleanup)
- Feat: memory-delta SKILL.md rewritten to use delta-processor with run_in_background, lock file check, foreground fallback
- Feat: DELTA_PROCESSING_LOCK + DELTA_LOCK_STALE_MS constants for race condition prevention

## 19.34.0
- Feat: verify-guard PreToolUse hook — block Final Verification writes to ticket files without prior /verifying run call
- Feat: skill-tracker extension — detect /verifying run calls and write verifying-called.json flag (create vs run distinction)
- Feat: "Verification tool N/A:" exception for projects where verification tools are impractical
- Feat: ensureGlobalHooks registers verify-guard (PreToolUse Write|Edit) in settings.json
- Feat: Session start cleanup for verifying-called.json (load-memory.js)

## 19.33.0
- Feat: docs-guard PreToolUse hook — block Write/Edit to docs/{discussion,plan,ticket,investigation}/ without active skill flag
- Feat: skill-tracker PostToolUse hook — set skill-active flag on Skill tool calls (discussing, planning, ticketing, investigating, regressing, light-workflow, verifying)
- Feat: TTL-based flag cleanup (5min expiry) + session start cleanup in load-memory.js
- Feat: ensureGlobalHooks registers docs-guard (PreToolUse Write|Edit) + skill-tracker (PostToolUse Skill) in settings.json

## 19.32.0
- Feat: RA pairing enforcement (WA N = RA N), concrete coherence verification methods (4 methods, minimum 2 required), overcorrection SCOPE DEFINITIONS framing

## 19.31.0
- Feat: PreToolUse path-guard hook — block Read/Grep/Glob/Bash targeting wrong .claude/memory/ path, including Bash command string inspection

## 19.30.0
- Feat: Best practices fixes — P/O/G unification, R→I stale refs, stop_hook_active guard, regressing-guard JSON block, RA Independence Protocol

## 19.29.0
- Feat: Stop hook sycophancy guard — detect agreement-without-verification patterns in Stop responses, block with re-examination instruction
- Feat: Hook registration in hooks.json + ensureGlobalHooks() for sycophancy-guard.js

## 19.28.0
- Feat: Ticket execution ordering guide — dependent tickets sequential, independent tickets parallel
- Feat: Final coherence verification for regressing execution quality (D025)

## 19.27.0
- Feat: COMPRESSED_CHECKLIST coherence — multi-WA items deduplicated, checklist ordering aligned with RULES structure
- Feat: Regressing 4-factor evaluation — Review Agent evaluates correctness, completeness, coherence, improvement-over-previous

## 19.26.0
- Feat: Regressing execution quality — result improvement cycles with delta-based feedback
- Feat: Multi-WA perspective diversity — multiple Work Agents with distinct approaches per ticket
- Feat: 4-factor coherence evaluation — verify changes are coherent, not just individually correct
- Feat: /verifying IA anchor — verification tool intent preserved as read-only evaluation criterion
- Feat: Anti-sycophancy framing — Review Agent prompt explicitly counters agreement bias

## 19.25.0
- Feat: Regressing 1:N Plan:Ticket — `ticketId` → `ticketIds` array in regressing-state.js with backward compat
- Feat: Execution/feedback phases display all ticket IDs; feedback synthesizes from multiple tickets
- Changed: Regressing rule in RULES/CLAUDE.md updated to P→T(1..M) notation

## 19.24.0
- Feat: SCOPE DEFINITIONS section in RULES — reframes built-in system prompt directives for project context
- Feat: COMPRESSED_CHECKLIST replaces full RULES in additionalContext (77% token reduction per prompt)
- Feat: regressing-guard.js PreToolUse hook — phase-based hard block for unauthorized plan/ticket writes
- Changed: CLAUDE_RULES in load-memory.js reduced to operational notes only (removed 4 duplicate rules)
- Changed: 5 skill SKILL.md files gain Scope Note preamble for agent verification framing
- Fixed: regressing-state.js synced to cache (missing since v19.23.0)

## 19.23.0
- Feat: Regressing phase tracker — `regressing-state.json` tracks active regressing session phase
- Feat: UserPromptSubmit hook injects phase-specific reminders forcing Skill tool usage for /planning and /ticketing
- Feat: PostToolUse hook auto-advances regressing phase on Skill tool call detection (planning→ticketing→execution)
- Feat: Stale regressing state detection (24h) in SessionStart (load-memory.js)
- Changed: planning/ticketing SKILL.md manual phase transition replaced by automatic PostToolUse hook transition
- New file: `scripts/regressing-state.js` — getRegressingState, buildRegressingReminder, detectRegressingSkillCall, advancePhase

## 19.22.0
- Feat: Verification tool check procedure in regressing/ticketing/light-workflow — /verifying invoked as procedural step, not rule

## 19.21.0
- Feat: Verifying skill — create/run project-specific verification tools
- Feat: VERIFICATION-FIRST section references verifying skill
- Changed: Inline verification definitions in 4 skills replaced with VERIFICATION-FIRST reference

## 19.20.0
- Feat: RA Independence Protocol — Review Agent prompt must exclude Work Agent output for independent verification (regressing, ticketing, planning SKILL.md)
- Feat: Planning skill verification structure — Expected/Actual/Gap format + Evidence Gate for Orchestrator
- Feat: Orchestrator RA/WA cross-reference step added to regressing and ticketing

## 19.19.0 (2026-03-23)

### Changed
- **Regressing SKILL.md**: P/O/G (Prediction/Observation/Gap) verification output template added to Review Agent prompt — mandatory with 4 validation rules
- **Regressing SKILL.md**: Orchestrator Evidence Gate (BLOCKING) — 4-checkbox gate rejects verification without observation evidence
- **Regressing SKILL.md**: Philosophical context (3 sentences) added to Review Agent + Orchestrator sections
- **Ticketing SKILL.md**: Identical P/O/G template + Evidence Gate + philosophical context
- **inject-rules.js/CLAUDE.md**: Verification standard augmented — agent verification output must contain prediction/observation/gap; Orchestrator must reject evidence-free reports

### Added
- D019: Verification philosophy operationalization failure analysis (3-layer root cause)
- D020 + I002: Comprehensive investigation — 3 Work Agents + 2 Review Agents + cross-review
- P026: Implementation plan for verification enforcement

## 19.18.0 (2026-03-21)

### Changed
- **Regressing SKILL.md**: Added Anti-Patterns (PROHIBITED) table — Pre-partitioning, Sequential pipeline, Copy-paste feedback, Role collapse, Rubber-stamp verification
- **Regressing SKILL.md**: Rule 10 — Agent independence via Task tool (Work/Review Agents MUST be launched as separate Task tool invocations)
- **Regressing SKILL.md**: Rule 11 — Orchestrator anti-rubber-stamp (must enumerate what was examined; "ALL PASS" without justification prohibited)
- **Regressing SKILL.md**: Rule 12 — Cycles are iterative, not partitioned (P(1) must not pre-allocate work across cycles; each cycle responds to prior verification findings)
- **Regressing SKILL.md**: Rule 13 — Cross-review integration + Devil's Advocate (single Review Agent must provide Devil's Advocate; 2+ reviewers require cross-review before meta-review)
- **Regressing SKILL.md**: Next Direction enriched with mandatory Problems Found / Root Cause / Recommended Focus structure
- **Ticketing SKILL.md**: Task tool launch directives, Devil's Advocate in Step B, Step B.5 Cross-Review, enriched 3-factor evaluation, Next Direction sub-headers
- **Planning SKILL.md**: Orchestrator Critical Evaluation section, Rule 11 anti-partitioning
- **inject-rules.js/CLAUDE.md**: Agent pairing requires separate Task tool call + Devil's Advocate, cross-review applicability check, anti-partitioning rule added to RULES block

## 19.17.0 (2026-03-22)

### Changed
- **All skills**: Descriptions rewritten to 3rd person with trigger phrases, invocation format, and anti-patterns per Anthropic best practices
- **save-memory**: Description enhanced with explicit differentiation from memory-autosave
- **memory-rotate/delta**: Removed fabricated subagent_type parameters, replaced with agent definition references
- **memory-autosave**: Removed stale v13.1.0 version reference
- **All SKILL.md**: Verified under 500-line limit

## 19.16.0 (2026-03-22)

### Changed
- **Rename**: researching skill → investigating (multi-agent investigation with structured I-document output)
- **New document type**: I(Investigation) replaces R(Research) — multi-source, multi-agent, cross-review
- **Legacy**: docs/research/ and R documents preserved as legacy, not deleted
- **Regressing**: Pre-check updated R→I
- **inject-rules.js**: Document types updated R→I

## 19.15.0 (2026-03-22)

### Changed
- **Regressing**: Restructured from D-per-cycle to single-D wrapper (D-PT-PT-PT-D loop)
- **Regressing SKILL.md**: Complete rewrite — one Discussion wraps all cycles, cycles create P→T pairs only
- **Discussing SKILL.md**: Rule 9 updated for regressing top-level container mode
- **Ticketing SKILL.md**: Rule 12 updated for T→P direct feedback transfer
- **inject-rules.js/CLAUDE.md**: Regressing rule updated to "P→T wrapped by a single Discussion"

## 19.14.0 (2026-03-21)

### Changed
- **Rename**: workflow skill → light-workflow (D/P/T 체계와 혼동 방지)
- **Remove**: regressing/ticketing SKILL.md에서 `/workflow` 호출 제거 — D/P/T 자체 agent 구조로 실행
- **Fix**: 모든 스킬에서 stale "workflow" 참조 정리 (6건 수정)
- **Sync**: inject-rules.js, CLAUDE.md, 캐시 전체 동기화

## 19.13.0 (2026-03-21)

### Changed
- **i18n**: Translated all Korean text in 6 skill documents to English (regressing, ticketing, planning, discussing, researching, workflow SKILL.md). No meaning changes.

## 19.12.0 (2026-03-21)

### Changed
- **Verification philosophy**: Redefined verification standard across project — "Verification = closing the gap between belief and reality through observation." Priority: (1) direct execution + observation; (2) indirect methods when impractical.
- **Workflow EXECUTION-PHASES**: Added Verification Priority to Phase 8, Observation Evidence Gate to Phase 9, evidence gate to Phase 10.
- **Skill documents**: Added verification philosophy references to workflow, ticketing, planning, regressing SKILL.md.

## [19.11.0] - 2026-03-21
### Added
- Regressing skill: autonomous D→P→T loop with verification-based optimization (`/regressing "topic" N` runs N cycles)
- Regressing rule added to RULES in inject-rules.js

## [19.10.0] - 2026-03-20
### Changed
- Skill descriptions improved: search-memory, clear-memory, load-memory now include "Use when..." trigger conditions for better skill discovery
- "Task tool" → "Agent tool" terminology fix in memory-delta, memory-rotate SKILL.md
- RULES session recovery: "read memory.md" → "invoke load-memory skill" with fallback
- memory-save skill renamed to memory-autosave; [MEMORY_KEEPER] auto-save trigger → [MEMORY_KEEPER_SAVE] to eliminate prefix collision
- workflow SKILL.md split: 611-line monolith → SKILL.md (294 lines) + ANALYSIS-PHASES.md + EXECUTION-PHASES.md + COMPACTION.md using progressive disclosure
- Added D/P/T/R document type definitions to RULES
- Removed stale version 13.8.3 from boilerplate examples

## [19.9.0] - 2026-03-18
### Added
- Intent Anchor READ-ONLY structural isolation in Agent Prompt Template (from autoresearch immutable evaluation pattern)
- Phase 4/7 Compaction Protocol for inter-phase context compression (from rlm compaction pattern)
- Light/Full Agent Call Classification in Context Budget (from rlm dual-depth call pattern)
- Experiment Log in Phase 11 Report for failure history accumulation (from autoresearch results.tsv pattern)
- Internal Iteration Protocol in Phase 8: max 3 retries for execution-level failures (from rlm iteration loop)
- Graceful Degradation Protocol in Phase 10: partial failure handling with work preservation (from rlm graceful degradation)
- Anti-Patterns #26 (internal iteration for plan changes) and #27 (accepting partial verdicts)
- Three new RULES: Intent Anchor READ-ONLY, Agent call classification, Internal iteration boundary
- Quick Reference entries for compaction, agent classification, internal iteration, graceful degradation

## [19.8.0] - 2026-03-17
### Added
- Mandatory work log rule: all D/P/T/R documents require log append after any related work, regardless of explicit skill invocation

## [19.7.0] - 2026-03-16
### Added
- Status cascade: ticket verified → auto-check all sibling tickets → auto-close parent plan → auto-conclude related D/R
- Reverse propagation constraint: parent document cannot be closed while child documents are incomplete
- Planning Rule 6: P cannot transition to `done` unless ALL related tickets are `verified`
- Planning Rule 7: P `done` auto-concludes related D/R (triggered by ticketing cascade)
- Discussing Rule 5-6: D cannot be manually concluded while related P is not `done`; auto-concluded on cascade
- Researching Rule 5-6: R cannot be manually concluded while related P is not `done`; auto-concluded on cascade
- Multi-plan cross-check: D/R with multiple related plans only concludes when ALL plans are `done`

## [19.6.0] - 2026-03-15
### Added
- Runtime verification as mandatory 4th verification element in workflow (Phase 8, 9, 10)
- Work Agent must verify implementation works in practice after coding
- Review Agent independently verifies runtime behavior
- Orchestrator as final gatekeeper for runtime verification
- Anti-pattern #25: skipping runtime verification
- Updated RULES verification standard with runtime verification mandate
### Changed
- Verification terminology: "runtime path tracing" → "runtime verification" (실행 검증)
- Phase 8/9/10 procedures use general-purpose language (not code-only)

## v19.5.1 (2026-03-15)
- **feat**: Document templates now include execution rules — ticket template has `## Execution` section (1 Ticket = 1 Workflow), workflow Phase 11 report template has `## Post-Workflow Documentation` checklist

## v19.5.0 (2026-03-14)
- **feat**: Ticket-Workflow 1:1 mapping rule — each ticket gets its own independent workflow execution
- **feat**: Post-Workflow documentation step — mandatory skill-based documentation after workflow completion

## v19.4.0 (2026-03-12)
- **feat**: 4 document management skills — `/discussing`, `/planning`, `/ticketing`, `/researching`
- **feat**: Append-only document system with INDEX.md status tracking per folder
- **feat**: Discussion (D001), Plan (P001), Ticket (P001_T001), Research (R001) document types with templates
- **feat**: Auto-incrementing IDs, cross-referencing between document types
- **feat**: Ticket inherits from Plan with parent validation, verification-at-creation (TDD principle)
- **feat**: Per-type status enums (Discussion: open/concluded, Plan: draft/approved/in-progress/done, Ticket: todo/in-progress/done/verified, Research: open/concluded)

## v19.3.0 (2026-03-08)
- **feat**: Intent Anchor mechanism — Phase 1 produces numbered IA-N list of non-negotiable requirements, carried through all phases
- **feat**: Intent Comparison Protocol — meta-review gates (Phase 4/7/10) require per-recommendation `ALIGNED/CONFLICTS` comparison against Intent Anchor with documented reasoning
- **feat**: Self-enforcement Checklist — mandatory 6-item checklist at each meta-review gate before proceeding
- **feat**: Agent Prompt Template includes `## Intent Anchor (DO NOT violate)` section
- **change**: Integration Review anchored to IA-N items instead of vague "user's original request"
- **change**: Anti-pattern #24 updated to reference Intent Comparison Protocol
- **change**: Quick Reference updated with Intent Anchor and Intent Comparison at every gate

## v19.2.0 (2026-03-07)
- **fix**: Emergency stop keyword detection — `hookData.input` changed to `hookData.prompt` (correct Claude Code UserPromptSubmit field name)
- **fix**: Emergency stop (`아시발멈춰`/`BRAINMELT`) was never actually triggered by hook; Claude recognized keyword from message text, not from injected EMERGENCY_STOP_CONTEXT

## v19.1.0 (2026-03-06)
- **feat**: Cross-Review as BLOCKING gate — Phase 3.5/6.5/9.5 added to 11-Phase workflow, meta-review cannot proceed without Cross-Review Report when 2+ reviewers ran in parallel
- **feat**: Cross-Review output format defined — Contested Findings, Blind Spots, Consensus sections with reviewer position table
- **feat**: Spot-check scaling — 1 reviewer→1, 2-3→2, 4+→3 spot-checks per meta-review phase
- **feat**: "coherence check" reframed as adversarial cross-examination — reviewers challenge, contradict, and identify blind spots
- **change**: Anti-pattern #20 strengthened — skipping cross-review explicitly marked as invalid, completion drive called out
- **change**: inject-rules.js RULES: cross-talk rule replaced with cross-review (BLOCKING) rule including spot-check scaling

## v19.0.0 (2026-03-06)
- **feat**: Workflow delivered via skill (`skills/workflow/SKILL.md`) instead of one-time template copy — always latest version from plugin cache
- **feat**: Lessons management via skill (`skills/lessons/SKILL.md`) — format guidelines always up-to-date
- **feat**: Workflow compressed from 762 to 367 lines — removed RULES-duplicated content, merged 6 agent templates into 1
- **feat**: B9/B10 verification standard added to inject-rules.js RULES — "File contains X" is NEVER valid verification
- **fix**: `templates/` directory removed — `copyTemplateIfMissing` pattern replaced by skill-based delivery
- **fix**: Legacy `workflow.md` auto-renamed to `.bak` on first run after upgrade
- **change**: inject-rules.js RULES: workflow reference changed from file path to skill invocation, lessons reference updated with skill invocation for format guidelines

## v18.5.0 (2026-03-05)
- **feat**: Orchestrator redefined as "Intent Guardian" — primary role is preserving user's original intent, not just verifying reviewer work
- **feat**: workflow.md Phases 4, 7, 10 updated with intent-preservation checks and reviewer feedback filtering logic
- **feat**: New anti-patterns #23 (Reviewer-driven drift) and #24 (Intent erosion through iterations)
- **feat**: Orchestrator role table expanded with intent filtering and override capabilities
- **feat**: Integration Review section rewritten — reviewer opinions are input to judge, not directives to follow
- **feat**: inject-rules.js RULES and CLAUDE.md updated: "Orchestrator final review" → "Orchestrator as Intent Guardian"

## v18.4.0 (2026-03-01)
- **feat**: Agent pairing rule — every Work Agent MUST have a paired Review Agent
- **feat**: Parallel review cross-talk rule — review agents must cross-reference findings for coherence
- **feat**: Orchestrator final review rule — must thoughtfully verify all work against user's original request
- **feat**: Critical stance rule — Review Agents and Orchestrator must maintain skeptical posture by default
- **feat**: workflow.md updated with Parallel Agent Execution, Context Budget, Review Mindset, Cross-talk Protocol, and 4 new anti-patterns

## v18.3.0 (2026-03-01)
- **feat**: Emergency stop keywords (`아시발멈춰` / `BRAINMELT`) — when detected in user input, inject-rules.js replaces entire additionalContext with EMERGENCY_STOP_CONTEXT that halts work, forces Read of CLAUDE.md, and requires line-by-line rule explanation
- **feat**: stdin reading added to inject-rules.js (async readStdin with HOOK_DATA env fallback)
- **feat**: Agent utilization rule added to RULES — use Task tool with agents for many/large files

## v18.2.0 (2026-03-01)
- **feat**: Added workflow agent enforcement rule to injected rules — "When the workflow specifies Work Agent or Review Agent, you MUST use the Task tool to launch a separate agent"

## v18.1.0 (2026-03-01)
- **fix**: `CLAUDE_PROJECT_DIR` not available in Bash tool environment — skills invoking scripts via Bash used `process.cwd()` fallback which breaks when Claude cd's into subdirectories (recurring bug since v16.0.0, never fixed for Bash path)
- **feat**: `--project-dir=PATH` CLI argument added to `extract-delta.js`, `counter.js`, `load-memory.js` — sets `CLAUDE_PROJECT_DIR` env var before any `getProjectDir()` call, works in any shell
- **fix**: All 6 skill files updated with "Project Root Resolution" section and `--project-dir="{PROJECT_DIR}"` in every Bash script invocation
- **fix**: All skill templates changed from relative paths (`.claude/memory/...`) to absolute paths (`{PROJECT_DIR}/.claude/memory/...`)

## v18.0.0 (2026-02-28)
- **fix**: All hook commands used bare `node` which fails on Windows Git Bash when Node.js is not in PATH — plugin was completely non-functional on affected systems
- **feat**: New `scripts/find-node.sh` — cross-platform Node.js locator with 6-stage fallback (NODE_BIN env, PATH, Windows paths, nvm/volta/fnm, Homebrew, Linux paths), uses `exec` for zero-overhead stdin passthrough
- **fix**: `hooks/hooks.json` — all 4 hooks changed from `node "..."` to `bash "...find-node.sh" "..."`, solving the bootstrap chicken-and-egg problem
- **fix**: `ensureGlobalHooks()` in `load-memory.js` — uses `process.execPath` instead of bare `node`, prevents settings.json hooks from being overwritten back to bare `node` on every SessionStart
- **fix**: `inject-rules.js` — injects absolute Node.js path into `additionalContext` so Claude can use it in Bash commands
- **fix**: `counter.js` instruction template — uses `process.execPath` instead of bare `node`
- **change**: SKILL.md (5 files) and commands/*.md (3 files) — `node` replaced with `{NODE_PATH}` placeholder resolved from context
- **change**: HOOK_RUNNER_CODE updated to v4 — `process.argv[0]` uses `process.execPath`
- **chore**: `docs/internal/` created for feedback/tickets/plans (gitignored), public docs (ARCHITECTURE.md, USER-MANUAL.md) remain in `docs/`

## v17.3.0 (2026-02-23)
- **fix**: Anchor text now explicitly states "OVERRIDES Primary working directory" — Claude was ignoring the anchor because it trusted its system prompt's Primary working directory (which becomes wrong after compaction)
- **fix**: Both POST_COMPACT_WARNING and UserPromptSubmit anchor now reference the known bug (#7442), explain CLAUDE_PROJECT_DIR never changes, and instruct Claude to read CLAUDE.md from the anchor path

## v17.2.0 (2026-02-23)
- **feat**: Project root anchor injection — prevents Claude from losing directory awareness after compaction
- **feat**: `load-memory.js` `getPostCompactWarning()` now includes `PROJECT ROOT ANCHOR` with actual project directory path, warns against subdirectory assumptions
- **feat**: `inject-rules.js` injects `Project Root Anchor` with `projectDir` into every UserPromptSubmit `additionalContext`, continuously reinforcing correct project root
- **test**: Added test suites 8-9 (6 new tests, 27 total) covering project root anchor in both load-memory.js and inject-rules.js

## v17.0.0 (2026-02-22)
- **fix**: Central cwd isolation via hook-runner.js v2 — reads stdin, sets `PROJECT_DIR` from `hookData.cwd` before delegating to child scripts. Eliminates all cross-project counter contamination when Bash tool changes working directory
- **fix**: `counter.js` `check()` and `final()` set `PROJECT_DIR` from `hookData.cwd` (double safety with hook-runner.js)
- **fix**: `counter.js` `final()` now passes `sessionId8` to `extractDelta()` and includes sessionId in L1 filename (was missing in v16.0.0)
- **fix**: `CONFIG_PATH` moved from module-level static constant to dynamic computation in `getConfig()` — prevents stale cwd at module load time
- **fix**: `load-memory.js` `logError()` uses `getProjectDir()` instead of raw `process.cwd()`
- **fix**: `search.js` `parseFilenameTimestamp` regex accepts optional `_sessionId8` suffix in L1 filenames
- **fix**: `migrate-timezone.js` `parseL1Filename` regex accepts optional `_sessionId8` suffix
- **fix**: `readStdin()` / `readStdinAsync()` check `HOOK_DATA` env var first (set by hook-runner.js v2), eliminating redundant stdin reads
- **test**: Added `test-cwd-isolation.js` with 20 mock tests covering PROJECT_DIR priority, HOOK_DATA parsing, regex compatibility, and session isolation

## v16.0.5 (2026-02-22)
- **revert**: MIN_DELTA_SIZE 10KB → 20KB (restore user-requested value)

## v16.0.4 (2026-02-22)
- **revert**: MIN_DELTA_SIZE 20KB → 10KB (20KB blocked legitimate deltas)

## v16.0.3 (2026-02-22)
- **change**: DEFAULT_INTERVAL 30 → 15 (tool use count before L1/delta trigger)

## v16.0.2 (2026-02-22)
- **change**: MIN_DELTA_SIZE 10KB → 20KB (delta processing threshold)

## v16.0.1 (2026-02-22)
- **fix**: `writeJson()` Windows EPERM fallback — atomic rename fails when file locked by antivirus/concurrent hooks, now falls back to direct write
- **fix**: Unified all raw `fs.writeFileSync(indexPath, ...)` calls in inject-rules.js, extract-delta.js, init.js to use safe `writeJson()` from utils

## v16.0.0 (2026-02-22)
- **fix**: Remove `getProjectDir()` walk-up traversal — prevents cross-project counter contamination when subdirectory has `.claude/`
- **fix**: `extractDelta(sessionId)` — session-aware L1 file selection prevents cross-session data contamination
- **fix**: `delta_temp.txt` conditional preservation on SessionStart — only deletes stale files (`deltaReady !== true`), preserves unprocessed deltas
- **change**: `check()` now async with stdin reading — reads `session_id`/`transcript_path` from hook data for session isolation
- **change**: L1 filenames include session_id prefix (`{timestamp}_{sessionId8}.l1.jsonl`) for session isolation
- **change**: `readStdin()` now has 1-second timeout (prevents hangs on broken stdin)
- **refactor**: Remove duplicate `getProjectDir()`/`readIndexSafe()` from inject-rules.js and sync-rules-to-claude.js — import from utils.js

## v15.4.0 (2026-02-22)
- **change**: MIN_DELTA_SIZE 40KB → 10KB (shorter sessions can now trigger delta processing)

## v15.3.0 (2026-02-21)
- **fix**: Stable hook-runner.js at `~/.claude/memory-keeper/` dynamically resolves latest plugin cache version at runtime — eliminates version-specific paths in settings.json that broke on `/plugin update`

## v15.2.0 (2026-02-21)
- **fix**: Atomic writes for memory-index.json via writeJson() temp+rename (prevents race condition corruption)
- **fix**: init.js no longer overwrites with defaults on JSON parse error (preserves existing data during concurrent access)

## v15.1.0 (2026-02-21)
- **workaround**: Auto-register PostToolUse/UserPromptSubmit hooks in `~/.claude/settings.json` via SessionStart hook (Claude Code plugin hook bug #10225, #6305)
- **fix**: Add try/catch to counter.js `check()` to prevent plugin-disabling crashes

## v15.0.0 (2026-02-21)
- **fix**: Move final() hook from Stop (fires every response) to SessionEnd (fires on actual session end) — fixes counter reset, L1 duplication, delta duplication every turn
- **change**: Default tool interval 50 → 30

## v14.9.0 (2026-02-21)
- **feat**: Conditional delta processing — only trigger DELTA_INSTRUCTION when delta_temp.txt >= 40KB, smaller deltas accumulate until threshold

## v14.8.1 (2026-02-20)
- **fix**: Remove presentation-specific Template-Based Work section from workflow template — not general-purpose

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
