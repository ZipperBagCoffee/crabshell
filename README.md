# Crabshell

**Claude Code plugin that makes Claude remember, verify, and self-correct.**

Three pillars:
1. **Session memory** — Auto-saves context across sessions. Delta extraction, Haiku summarization, token-based rotation. No manual setup.
2. **Behavioral correction** — Injects verification-first rules and interference pattern detection every prompt. Twelve guard hooks block sycophancy, scope reduction, overcorrection, and shortcuts at runtime. **Pressure System:** three pressure counters (feedbackPressure.level, feedbackPressure.oscillationCount, tooGoodSkepticism.retryCount) with user-prompt-driven level (W021: profanity-only NEG patterns) plus assistant-side oscillation and too-good skepticism counters. UNLEASH keyword (renamed from BAILOUT in v21.79.0 / W021) resets all three.
3. **Structured workflows** — D/P/T/I/H/W document system with 21 skills for planning, investigating, iterative improvement (regressing), hotfix recording, and light-workflow tracing.

All plugin output lives under `.crabshell/` — gitignored, clean project root.

## Installation

```bash
/plugin marketplace add ZipperBagCoffee/crabshell
/plugin install crabshell
```

After installation, **you don't need to do anything**. It works automatically.

## Codex Compatibility

This repository is a dual-runtime plugin repo:

- **Claude Code** uses `.claude-plugin/plugin.json`, `hooks/hooks.json`, `commands/`, and `skills/`.
- **Codex** uses `.codex-plugin/plugin.json`, `codex-skills/`, and the `scripts/codex-*.js` wrappers.

Installing the plugin in one runtime does not automatically activate the other runtime. The files can ship in the same GitHub repository, but each product only reads its own manifest and entrypoints.

After installing through Claude, run the manual bridge command when you want the same checkout available in Codex:

```text
/crabshell:install-codex
```

The shared state is `.crabshell/`. Claude and Codex can both read and write the same memory/document store when they are used in the same project:

```bash
node scripts/codex-memory.js load
node scripts/codex-memory.js save --title="Codex session note" --message="..."
node scripts/codex-memory.js search "query"
node scripts/claude-to-agents.js
node scripts/codex-docs.js investigation "research topic"
node scripts/codex-docs.js worklog "task title"
```

Codex compatibility is explicit skill/script based. Claude-style automatic hooks such as `SessionStart`, `PostToolUse`, `PreToolUse`, and `Stop` are not activated by Codex.

## How It Works

1. **Session start** - Loads saved content from previous sessions into Claude's context
2. **During work** - Auto-save triggers every 15 tool uses (configurable), Claude records decisions/patterns/issues directly
3. **Session end** - Full conversation backup + final save

## What Gets Saved

### Automatic (No action needed)
- `logbook.md` - Session summaries accumulate here (auto-rotates at 23,750 tokens)
- `logbook_*.md` - Rotated archives (L2)
- `*.summary.json` - L3 summaries (Haiku-generated)
- `sessions/*.l1.jsonl` - Detailed session transcripts (L1)

### Manual Setup (Optional)
If there's information you want Claude to know every session, **directly edit the files**:

```bash
# Create/edit files in your project's .crabshell/memory/ folder
echo "React + TypeScript web app." > .crabshell/project.md
```

Or just ask Claude: "Save the project info to project.md"

With this setup, **Claude starts every new session knowing this information**.

## Slash Commands

**Works in any project where the plugin is installed:**

| Command | Description |
|---------|-------------|
| `/crabshell:save-memory` | Save now (don't wait for auto-save) |
| `/crabshell:load-memory` | Reload memory (after manual edits) |
| `/crabshell:search-memory query` | Search past sessions |
| `/crabshell:clear-memory old` | Clean up files older than 30 days |
| `/crabshell:discussing "topic"` | Create/update a discussion document |
| `/crabshell:planning "topic"` | Create/update a plan document |
| `/crabshell:ticketing P001 "topic"` | Create/update a ticket tied to a plan |
| `/crabshell:investigating "topic"` | Multi-source multi-agent investigation |
| `/crabshell:regressing "topic" N` | Run N cycles of P→T wrapped by a single Discussion, with verification-based optimization |
| `/crabshell:light-workflow` | Run the 11-phase agent orchestration workflow (standalone tasks) |
| `/crabshell:verifying` | Create/run project-specific verification tools |
| `/crabshell:status` | Healthcheck of plugin state (memory, regressing, verification, version) |
| `/crabshell:install-codex` | Link the Claude-installed Crabshell checkout into Codex plugin and skill locations |
| `/crabshell:lint` | Run Obsidian document lint checks (orphans, broken wikilinks, stale, missing frontmatter, INDEX inconsistencies) |
| `/crabshell:search-docs query` | BM25 full-text search across all D/P/T/I/W documents |
| `/crabshell:knowledge "title"` | Create a K-page (verified fact or operational tip) in .crabshell/knowledge/ |

## Document Management (5-Document System: D/P/T/I/W)

Track project work through structured, append-only documents:

| Skill | ID Format | Statuses | Use For |
|-------|-----------|----------|---------|
| `/discussing` | D001 | open, concluded | Decisions, dialogues, conclusions |
| `/planning` | P001 | draft, approved, in-progress, done | Implementation plans with steps |
| `/ticketing` | P001_T001 | todo, in-progress, done, verified | Session-sized work units tied to plans |
| `/investigating` | I001 | open, concluded | Multi-source investigations with cross-review |
| `/light-workflow` | W001 | open, concluded | Light-workflow tracing (standalone tasks) |

Each document type has its own folder under `.crabshell/` with an `INDEX.md` for status tracking. Tickets inherit from plans and require verification-at-creation (TDD principle).

## Agent Orchestration Workflow

For complex tasks, the light-workflow skill runs an 11-phase process with 3-layer architecture:

```
Work Agent     →  Analysis, planning, implementation
Review Agent   →  Verify, cite evidence, PASS/FAIL
Orchestrator   →  Intent guardian, meta-review, final authority
```

Key features:
- **Intent Anchor** - Non-negotiable requirements defined in Phase 1, enforced at every gate
- **Cross-Review** - When 2+ reviewers run in parallel, adversarial cross-examination is mandatory
- **Runtime Verification** - Mandatory runtime verification in Phase 8/9/10 (not just static checks)
- **1 Ticket = 1 Workflow** - Each ticket gets its own independent workflow execution

## Regressing (Iterative Optimization)

For tasks requiring multiple improvement cycles, `/regressing "topic" N` runs N cycles of Plan→Ticket→Verify:

- Each cycle's verification results determine the next cycle's direction
- **Phase Tracker** (v19.23.0): Hook-based auto-enforcement of Skill tool usage — UserPromptSubmit injects phase-specific reminders, PostToolUse auto-advances phase on Skill tool detection
- Anti-partitioning: each cycle plans current work only (no pre-dividing across cycles)
- Single Discussion wraps all cycles, auto-concludes when all plans complete

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

- **Above the line**: Auto-managed by the plugin (updated on every prompt)
- **Below the line**: Your project-specific content (never modified by the plugin)

> **Note:** The plugin also writes a warning to Claude Code's built-in `MEMORY.md` (at `~/.claude/projects/{project}/memory/MEMORY.md`) to prevent confusion between the two memory systems. This is separate from the plugin's own `logbook.md`.

## Storage Location

```
[project]/.crabshell/memory/
├── logbook.md             # Active rolling memory (auto-rotates at 23,750 tokens)
├── logbook_*.md            # Rotated archives (L2)
├── *.summary.json         # L3 summaries (Haiku-generated)
├── memory-index.json      # Rotation tracking & delta state
├── counter.json           # PostToolUse counter
├── project.md             # Project overview (optional)
├── logs/                  # Refine logs
└── sessions/
    └── *.l1.jsonl         # L1 session transcripts (deduplicated)

[project]/.crabshell/
├── discussion/            # Discussion documents (D001, D002...)
│   └── INDEX.md
├── plan/                  # Plan documents (P001, P002...)
│   └── INDEX.md
├── ticket/                # Ticket documents (P001_T001...)
│   └── INDEX.md
├── investigation/         # Investigation documents (I001, I002...)
│   └── INDEX.md
└── worklog/               # Worklog documents (W001, W002...) — light-workflow tracing
    └── INDEX.md
```

## Configuration

Global: `~/.crabshell/config.json`
Project: `.crabshell/memory/config.json` (takes precedence over global)

```json
{
  "saveInterval": 15,
  "keepRaw": false,
  "rulesInjectionFrequency": 1
}
```
- `saveInterval`: How many tool uses before auto-save (default: 15)
- `keepRaw`: Keep raw.jsonl files after L1 conversion (default: false)
- `rulesInjectionFrequency`: Inject rules every N prompts (default: 1 = every prompt)

## Hierarchical Memory Architecture

```
L1 (sessions/*.l1.jsonl)  - Refined session transcripts (~95% size reduction)
     ↓
L2 (logbook_*.md)          - Rotated archives (auto at 23,750 tokens)
     ↓
L3 (*.summary.json)       - Haiku-generated summaries
     ↓
logbook.md                - Active rolling memory (loaded at startup)
```

- **L1**: Raw transcripts refined to keep only meaningful content
- **L2**: logbook.md auto-rotates when too large, archives preserved
- **L3**: AI-generated summaries of archived content
- **Search**: `search-memory` traverses logbook.md → L3 → L2 (add `--deep` for L1)

## Documentation

- [User Manual](USER-MANUAL.md) - Detailed usage guide
- [Architecture](ARCHITECTURE.md) - System design
- [Structure](STRUCTURE.md) - Directory layout & version history

## Version

| Version | Changes |
|---------|---------|
| 21.99.3 | fix: I076/W026 latest release risk cleanup — `hooks/hooks.json` now runs 26 hooks through direct `node` commands instead of Git Bash `find-node.sh`; `find-node.sh` remains as a hardened fallback utility for WSL/Windows path cases; marketplace plugin version drift fixed; manifest V010/V012/V019/V020/V022 candidates repaired; stale `_test-*.js` expectations updated for the current 7-field verifier and D108 cleanup. |
| 21.99.2 | fix: 7-field skeleton 가독성 — `inject-rules.js` `SKELETON_7FIELD` 필드 사이 빈 줄 + 압축 지시 (H016) + [의도]/[이해]/[쉬운 설명] 하단 재배치 (H017). 사용자 transparency 회복. cycle1 inject test 6/6 PASS. |
| 21.99.1 | fix: D109 cycle 2 — `run-verify.js` `parseArgs()` `startsWith('-')` guard fixes argv[2] flag-capture bug; `verify-classify.js` assertion-fail regex extended with `^FAIL:\|\nFAIL:` (V012) + `Command failed:.*\.exe.*_test-[\w.-]+\.js` (V022); `unknown` ratio 40%→0%, `[VERIFY] WARN` eliminated; 31-assertion unit test all PASS. |
| 21.99.0 | feat: D109 cycle 1 — failure classification renderer (`verify-classify.js`, grouped summary in `run-verify.js`, `[<failureClass>]` prefix in `verify-guard.js`, 15-case / 31-assertion unit test); fix: runner `parseArgs()` + `RUNNER_RECURSION` guard prevents nested full-manifest self-recursion; fix: AC-6 manifest sync (`v==='21.96.2'` → `v==='21.99.0'` — stale since v21.97.0, two missed checklist step 5c). |
| 21.98.1 | fix: H015 — `behavior-verifier.js:77` `hasVerifierEcho` regex extended with Korean tokens (`검증자 디스패치|감시자 디스패치|디스패치 완료`) so `isOperationalIdleTurn()` correctly skips Korean idle stubs and breaks the infinite verifier-dispatch loop seen in `docs/feedback_050426.md`. `inject-rules.js:311` `SKELETON_7FIELD` prepended with placement instruction so the 7-field self-check renders at the bottom of the response, after the main answer body. `_test-trigger-model.js` Case 7 added; 7/7 PASS. |
| 21.98.0 | feat: W024 — `[완결 충동]` (completion-drive) 7th skeleton field. `SKELETON_6FIELD` → `SKELETON_7FIELD` in `scripts/inject-rules.js`. `shared-context.js COMPRESSED_CHECKLIST` item 11 appended. `behavior-verifier-prompt.md` §0.5 marker table + content-rule table + pseudocode 6→7 fields; §1 format-markers list updated; Sample 3 reason updated. Forces every response to either declare "완결 충동 없음" or name a specific flagged unknown / deferred verification — closes the gap where completion-drive failures leaked silently into other UVLS axes. `_test-inject-rules.js` 114/114 PASS. |
| 21.97.0 | feat: Codex `knowledge` skill + `scripts/codex-docs.js knowledge` command; creates K-pages with `category` (fact/tip), `source`, `tags` frontmatter, `## What` / `## When` sections, and INDEX wikilink row matching Claude-side `/knowledge`. Closes `/install-codex` gap where `codex-skills/knowledge/` was missing. |
| 21.96.2 | fix: H014 — `EMERGENCY_STOP_CONTEXT` Step 4 changed from interrogative ("What did I get wrong? What should I do differently?") to declarative gap statement after `BRAINMELT`/`아시발멈춰` reset. User already signalled the gap by triggering the reset; asking back was deflection. Diagnostic re-read of CLAUDE.md preserved; Claude now commits to naming the violated rule + offending turn from evidence. `_test-inject-rules.js` 114/114 PASS. |
| 21.96.1 | fix: H013 — behavior-verifier rubric path resolution. `scripts/inject-rules.js:911` dispatch instruction now emits `__dirname`-derived absolute plugin install path for `prompts/behavior-verifier-prompt.md` instead of a relative literal that the consuming agent resolved against `CLAUDE_PROJECT_DIR`, leaving any project without a sibling `prompts/` folder permanently `status=pending` with escalating `[DISPATCH OVERDUE]` reminders. Aligns with `memoryFeedbackPath` (already absolute). Tests: `_test-d107-cycle3-llm-compliance.js` 5/5 PASS. |
| 21.96.0 | fix: behavior-verifier workflow-active idle echo loop; `scripts/behavior-verifier.js` now skips verifier/monitor wait echoes before writing pending state, with `_test-trigger-model.js` coverage preserving real workflow-active force-fire. |
| 21.95.0 | feat: Codex `investigating` skill + `scripts/codex-docs.js investigation`/`investigating` commands; creates I documents with Topic, Constraints, Questions, Sources, Investigation Log, Cross-Review, Synthesis, Conclusions, and INDEX row. |
| 21.94.0 | feat: `/crabshell:install-codex` manual bridge command + `scripts/install-codex.js`; links Claude-installed Crabshell checkout into Codex marketplace and `~/.codex/skills`, with dry-run, temp-home testability, idempotent rerun, marketplace backup, and non-link replacement guard. |
| 21.93.0 | feat: Codex 호환층 추가 — `.codex-plugin/plugin.json` + `codex-skills/` 10 skills + `scripts/codex-memory.js` + `scripts/codex-docs.js` + `scripts/claude-to-agents.js` + `AGENTS.md`. README/STRUCTURE dual-runtime 문서. H009 hotfix: codex-docs `wikiTarget()` regex fix + ticket `--plan` fail-fast + claude-to-agents `--force` overwrite protection. |
| 21.92.0 | feat: I070 결함 수정 — SKELETON_5FIELD→SKELETON_6FIELD (6번째 필드 `[동조화 및 일관성]` 추가). Behavior-verifier dispatch 위치 position 9→5 상향 (positional attention skip 해결). §1 format markers OLD→NEW 6-field 통일 (§0.5 marker mismatch 해소). §0.5 stale ANTI_PATTERNS_INLINE 참조 제거. sycophancy-guard dead code 제거. Test stale assertions 수정. inject-rules 114/114 + sycophancy-guard 23/23 PASS. |
| 21.91.0 | feat: D108 cycle 1 — I069 토큰 절약 즉시 실행. inject-rules.js: ANTI_PATTERNS_INLINE 제거 (~1,701 B), Root Anchor 5→1줄 압축 (~504 B), Verification Reminder 삭제 (~184 B). deferral-guard.js 폐지 (77 LOC, behavior-verifier §3.logic에서 흡수). sycophancy-guard.js Stop handler 3 branch 제거 (context-length, verification-claims, reversal/oscillation). Per-turn static savings ~2,389 B (~43%). Guard hooks 12→11. Test updates: V021 6 cases, V008 24 cases, fail-open 7/7. /verifying 29/29 PASS. |
| 21.90.0 | feat: H008 hotfix — `scripts/inject-rules.js:961` behavior-verifier dispatch instruction에 `model: opus` 명시 추가. 이전 dispatch = `subagent_type: general-purpose` 만 → harness default model. `.crabshell/project.md` Model Routing rule (T1=Opus = "verification requiring interpretation") enforcement. Behavior-verifier = UVLS 4축 + §0.5 auditVerdict (form-game detection, frame-fidelity) → Type B interpretation-heavy → Opus 적합. /verifying 29/29 + fail-open 7/7 preserved. |
| 21.89.0 | feat: D107 cycle 8+9 — USER-MANUAL.md doc cycle (Doc Debt resolution: 4 cycle 5 features sections — SKELETON_5FIELD / ANTI_PATTERNS_INLINE / lock-contention.json / _recordContention) + cycle 9 lightweight bundle (WA1 cross-ref anchor fix + acquireCount baseline status note in f3 evaluation doc). **Cycle 8 (P150_T001)**: 4 dedicated USER-MANUAL.md subsections at L229/L247/L387/L391 covering 5-field skeleton injection, anti-patterns hardcode, F-4 instrumentation state file, lock contention measurement helper. Doc Debt 4/4 rows Done. AC-7 +110 B / 1.79% overrun ratified. **Cycle 9 (P151_T001)**: cross-ref `#critical-rules-core-principles-alignment` invalid same-page anchor → project-wide CLAUDE.md reference; baseline status note acquireCount=71 / 14.2% of floor 500 / observed rate ~44.56/h / projected days-to-floor ≈ 0.4d (heavy session use). **F-3 path implementation D108+ defer** — Orchestrator C recommendation per user "뭘 추천하는데" + "일단 커밋 푸시" authorization. Evidence-based per cycle 4 RA1 ratification rule (decision-without-evidence rejected at 14.2% baseline). /verifying 29/29 + fail-open 7/7 + behavior-verifier-prompt.md 36835 B preserved. |
| 21.88.0 | feat: D107 cycle 5+6 — F-4 lock contention instrumentation + measurement window opening + race undercount doc (P143 + P148 + P149 cycle 7 operator gate resolution). **Cycle 5 (P143_T001)**: `scripts/utils.js` `_recordContention` (deadlock-prevention, unprotected `writeJson` — race undercount caveat); `acquireIndexLock` / `releaseIndexLock` per-lock metrics wiring (`acquireCount` / `contendedCount` / `totalWaitMs` / `totalHeldMs` / `maxWaitMs` / `maxHeldMs`). `.crabshell/memory/lock-contention.json` NEW state file. `scripts/inject-rules.js` D107 IA-1 (`SKELETON_5FIELD` ~458B 5-field response skeleton inject) + IA-2 (`ANTI_PATTERNS_INLINE` ~1701B anti-patterns inline inject) — every-prompt default behavior. **Cycle 6 (P148_T001)**: `lock-contention.json` top-level `measurementWindowStart` ISO 8601 marker (atomic write under `.memory-index.lock`). `prompts/f3-fsm-reconciliation-evaluation.md` `### Cycle 6 measurement window opening` subsection (close-criterion deferred + RA1 race undercount caveat). **Cycle 7 (P149_T001) operator gate**: helper `scripts/_p148-t001-marker-write.js` cleanup, vbump v21.87.0 → v21.88.0, F-5 self-instrumentation tautology disclosure (~3 acquireCount floor sample from helper itself), F-4 close-criterion threshold candidates enrichment (a) sample (`acquireCount ≥ N`, N TBD) / (b) elapsed-time (`now − measurementWindowStart ≥ T`, T TBD) / (c) contention-rate (`contendedCount / acquireCount ≥ R`, R TBD), CHANGELOG/README/STRUCTURE/ARCHITECTURE/USER-MANUAL/manifest version-string sweep. 신규 test files (`_test-d107-cycle1-inject-enhancement.js` / `_test-d107-cycle2-verifier-audit.js` / `_test-d107-cycle3-llm-compliance.js`), `_test-fail-open-edge-cases.js` Case 7 (F-4 instrumentation fail-open). `prompts/marker-set-unification-audit.md` + `prompts/output-schema-2tier-proposal.md` audit docs. /verifying 29/29 PASS post-vbump. fail-open 7/7 PASS. **Known doc gap (path b explicit deferral)**: USER-MANUAL.md cycle 5 features (`SKELETON_5FIELD` / `ANTI_PATTERNS_INLINE` / `lock-contention.json` / `_recordContention`) 본문 sections 미작성, `## Doc Debt` section에 4 items TODO 등록, cycle 8+ doc cycle 처리. **Excluded (cycle 8+)**: F-3 path implementation (path a/b explicit user selection prerequisite), close-criterion N/T/R 구체화, §1+§0.5 marker set unification Option ii. |
| 21.87.0 | feat: D106 cycle 5 — code/doc IA bulk processing (P142 T001+T002+T003). **T001 (IA-9)**: dead code 4 file 삭제 (`scripts/test-cwd-isolation.js` 274 + `scripts/delta-background.js` 200 + `scripts/_test-delta-background.js` ~565 + `scripts/_prototype-measure.js` 130 = 약 1,169 LOC). STRUCTURE.md "retained for reference" 정책 reversal + I063 future-work 정책 reversal. **T002 (IA-10 utils 통합 + F1 mitigation)**: `scripts/utils.js` `isBackground()` + `parseProjectDirArg()` 추가, 22 hook file inline `process.env.CRABSHELL_BACKGROUND === '1'` early-exit 보존 + utils require + F1 mitigation 주석, 12 inline `getProjectDir` 제거, 3 readStdin wrapper 제거 (counter/inject-rules/load-memory), `append-memory.js` Variant B → `parseProjectDirArg(process.argv.slice(2))`. WA-fix critical: 11 hook + 6 transitive consumer 의 require 가 inline env check 앞에 실행되던 invariant 위반 — 순서 reorder 로 fail-open invariant 보존. **T003 (IA-13/15/16)**: `scripts/find-node.sh` CRLF → LF, 49+3=52 split sites → split(/\r?\n/), `.gitignore` `*.stackdump`. 회귀: `_test-fail-open-edge-cases.js` Case 6 추가. /verifying 26/26 PASS. fail-open edge cases 6/6 PASS. (v21.86.0 hotfix은 `scripts/regressing-guard.js` regex bug fix 단독). |
| 21.85.0 | feat: D106 cycle 3+4 — verifier FALLBACK 강화 (P140 + P141). **Cycle 3 (P140)**: §0 Memory Feedback Cross-Check (6 regex: no_permission_asking / no_record_asking / no_option_dump / no_api_billing / philosophy_framing / agent_count) + §Edge Cases AND-narrowed trivial bypass (length<50 AND no deferral verb AND no §0 match AND no scope-expansion); `scripts/inject-rules.js` MEMORY.md absolute path injection (`memoryFeedbackPath` variable, fail-open); `scripts/transcript-utils.js:189` hardened patch (`name === 'Agent' && subagent_type === 'general-purpose'` — production transcript serialization fix, prior `name === 'Task'` 100% miss); `_test-dispatch-overdue-detection.js` production-shape fixture + 9/9 PASS; H006 hotfix carry (load-memory.js feedbackPressure carry-over). **Cycle 4 (P141)**: §1.understanding Scope-expansion signals (4 regex: autonomous-closure / reasonable-assumption / cascade auto-decision / assumption-disclaimer override) + Authorization Tokens Allowlist (literal user prompt match — verifier inference PROHIBITED) + §Hook-vs-Human Heuristic (`Stop hook feedback:` / `Document update pending:` / `## REGRESSING ACTIVE` patterns NOT user authorization) + §1 Rigor enforcement (PASS reason MUST quote literal user prompt + response action) + §Turn-Type Conditional Gating workflow-internal row fix (frame-fidelity + scope-expansion always, ticket-id silent skip 차단) + Sample 4 (autonomous closure FAIL example sub-200 chars). Manifest V017-V020 4 entries. Production behavioral evidence: post-T002 state file `dispatchOverdue: true→false`/`missedCount: 1→0`/`escalationLevel: 1→0` reset; cycle 4 verifier가 자기 작성 over-reach (이번 세션 line 104 "Autonomous 진행. Reasonable assumption: Option C") 3-axis catch (understanding + verification + logic FAIL). **/verifying 26/26 PASS**. IA-26 FALLBACK 3-layer 완성 (known feedback + dispatch tracking + novel over-reach + 자기-catch). |
| 21.84.0 | feat: D105 cycle 1 — 외부화 함정 source 제거 (spec 정정 + 회피 원칙 + 거절 catalog + 회피 4회 기록). `scripts/inject-rules.js` RULES Simple Communication 4 항목 replace "use an analogy"; PROHIBITED #9 Default-First. `prompts/anti-patterns.md` 신규 7 TRAPs + 4 AVOIDs. Test cascade 145 신규 assertions. /verifying 19/19 PASS. |
| 21.83.0 | feat: D104 cycle 1 — 감시자 (Behavior Verifier) Phase 1 (P136 T001+T002+T003). **T001 architecture core**: trigger 3-layer (periodic N=8 + workflow-active force + escalation L0/L1) + verdict ring buffer (FIFO N=8) + 5-class turn classification (`user-facing`/`workflow-internal`/`notification`/`clarification`/`trivial`) + verifierCounter PostToolUse 누적 + state schema 7→14 fields + hooks.json Stop section 순서 swap (behavior-verifier above regressing-loop-guard, RA8 MISS-1 mitigation). `## 감시자 (Behavior Verifier) Dispatch Required` 한글 bilingual dispatch header in inject-rules consumer. **T002 prompt + hook polish**: `prompts/behavior-verifier-prompt.md` Schema Stability single-source (G3) + Steps 2 JSON template "preserve" directive (G1) + Sample 3 format-markers 위반 (G2) + per-criterion turnType conditional gating directive. `scripts/deferral-guard.js` stderr `[BEHAVIOR-WARN] Trailing deferral question detected (PROHIBITED #7). (warn-only — sub-agent verifier §3.logic Trailing-deferral sub-clause will retroactively correct in next turn)` (sycophancy 4 Stop branches와 prefix/후행구 일치, pLevel 부재 절충). V011 regex tightened to bold-header form (avoids §Schema Stability cross-reference false-fire after schema hoist). **T003 한글 facing rename docs/manual layer**: USER-MANUAL.md / README.md / STRUCTURE.md / `prompts/behavior-verifier-prompt.md` L1 header에 "감시자 (Behavior Verifier)" 한글 alias 추가. 코드 식별자 (filename / `BEHAVIOR_VERIFIER_*` / `<VERIFIER_JSON>` / `[CRABSHELL_BEHAVIOR_VERIFY]` / `CRABSHELL_AGENT='behavior-verifier'`) byte-identical 보존 (Phase 3 v22 carry-over). 7 new `_test-*.js` files; 48/48 regression PASS; 18/18 /verifying PASS; AC-6 manifest 21.82.0→21.83.0. **Behavioral effect**: 감시자가 매 응답에서 발동하지 않고 (periodic N=8) workflow 진행 중(regressing/light-workflow)에는 강제 발동, turn classification에 따라 criteria gating 적용, ring buffer로 cross-turn 맥락 ~50-100 tokens/turn 노출. deferral-guard 메시지 sycophancy 패턴과 일치 (sub-agent retroactive correction graceful degradation). |
| 21.82.0 | feat: D103 cycle 2 — dispatch overdue detection + verifier prompt §1.understanding format-marker sub-clause (P135_T001). `scripts/transcript-utils.js` adds `getRecentTaskCalls(transcriptPath, sinceTimestamp)` (mirrors `getRecentBashCommands`, matches `block.name === 'Task'`). `scripts/behavior-verifier.js` Stop hook reads prior state, scans transcript since prior `launchedAt`, sets `dispatchOverdue=true` when prior status was `pending` + zero Task tool_use found (clarification-only and length<50 bypasses preserved upstream — RA amendment 1). `scripts/inject-rules.js` UserPromptSubmit consumer pending branch prepends `**[DISPATCH OVERDUE]** Previous turn did not invoke Task. Invoke NOW.` before the dispatch instruction when `bvState.dispatchOverdue === true`. `prompts/behavior-verifier-prompt.md` §1.understanding extended with **Format markers** sub-clause: response > 200 chars without ANY-ONE-set of `[의도]/[답]/[자기 평가]` (Korean) OR `[Intent]/[Answer]/[Self-Assessment]` (English) → FAIL; trivial responses (<200 chars) delegate to §Edge Cases (RA amendment 2). 4-key JSON schema preserved. Two new test files (8+5 cases). V012 manifest entry; AC-6 21.81.0→21.82.0; total entries 17→18. 42/42 `_test-*.js` PASS. **Behavioral effect**: missed Task dispatches now flagged with markdown-emphasized marker on the next turn (D103 IA-1 closure); response format violations (missing intent/answer/self-assessment markers) surface as `## Behavior Correction` (D103 IA-3 closure). |
| 21.81.0 | feat: D103 cycle 1 — sycophancy 4 Stop branches → warn-only + verifier prompt §3.logic 3 sub-clause (P134_T001). `scripts/sycophancy-guard.js` `handleStop` branches (context-length / too-good P/O/G / oscillation / bare agreement) flipped from `decision:'block' + exit(2)` to `[BEHAVIOR-WARN]` stderr + `exit(0)`; PreToolUse mid-tool block (Write/Edit) preserved; `incrementTooGoodRetryCount` + `incrementOscillationCount` RMW preserved before warn-only emit (hybrid counter). `prompts/behavior-verifier-prompt.md` §3.logic body extended with 3 sub-clauses (Direction change / Session-length deferral / Trailing deferral) + key composition directive ("AND across sub-clauses → single `logic.pass`/`logic.reason`"). JSON output schema unchanged (4 keys). Test cascade: case 15 + 3 new testWarn cases (15a/15b/15c). V008 expectation 32→35; new V011 manifest entry (cycle 1 absorption probe). 40/40 `_test-*.js` PASS. **Behavioral effect**: 4 absorbed Stop branches no longer hard-block; the behavior-verifier sub-agent dispatched on the next turn evaluates them semantically and emits `## Behavior Correction` via UserPromptSubmit. Graceful degradation aligned with I064 Output 4 §"Phase 2" boundary. |
| 21.80.0 | feat: 감시자 (behavior-verifier) sub-agent dispatch architecture (D102 P132 cycle 1) — new Stop hook + UserPromptSubmit consumer + sycophancy-guard verification-claim warn-only + RMW transition-then-emit race fix + 4-criterion sub-agent prompt with self-write + prototype measurement scaffolding + 18 new behavioral test assertions + 4 new manifest entries (V006-V009). **Behavioral effect**: verification-claim no longer hard-blocks at Stop; the sub-agent verdict retroactively corrects on the next turn via `## Behavior Correction` injection (600B/item, 1500B total). |
| 21.79.0 | feat: NEGATIVE_PATTERNS profanity-only reduction + BAILOUT keyword renamed to UNLEASH (W021) — `scripts/inject-rules.js` `NEGATIVE_PATTERNS` removes all command-mode/assessment-mode/logical-disagreement patterns, keeps only Korean (시발/병신/좆/지랄/새끼/뒤질) and English (wtf/shit/fuck/dumbass/piece of shit/this sucks/so frustrating) profanity. `NEGATIVE_EXCLUSIONS` reduced to 2 profanity-FP-prevention items (시발점/병신경). `BAILOUT_KEYWORDS = ['봉인해제', 'BAILOUT']` → `['봉인해제', 'UNLEASH']`. `pressure-guard.js` L2/L3 messages updated. Internal var `BAILOUT_KEYWORDS`, function `detectBailout`, stderr label `[PRESSURE BAILOUT: ...]` preserved. **Behavioral effect**: normal user clarification ("아닌데", "이해 안", "wrong") no longer triggers pressure escalation; only actual profanity. W021 WA1+RA1 verification: 100% convergence + 229/229 regression test pass. |
| 21.78.4 | fix: NEG detection false-positive elimination (W020) — `scripts/inject-rules.js` gains `stripSystemReminders(text)` helper that strips Claude Code auto-injected `<system-reminder>...</system-reminder>` blocks before NEGATIVE_PATTERNS matching in `detectNegativeFeedback`. Prevents reminder words (`error`, `wrong`, `break`, `incorrect`) from triggering user-independent feedbackPressure increments. Helper exported for testability; preserves NEGATIVE_PATTERNS array, signature, and all other prompt consumers (extractKeywords) untouched. WA1+RA1 verification: 8/8 IA + 5/5 behavior cases + 107/107 regression PASS |
| 21.78.3 | hotfix: load-memory.js L1 tail line count 20 → 50 (H005) — `getUnreflectedL1Content` in `scripts/load-memory.js` widens `slice(-20)` to `slice(-50)`, expanding the candidate range for unreflected L1 content auto-loaded on session start; existing filters (assistant-only + length>50 + not yet in logbook.md) are preserved, only the inspected line count is increased to reduce truncation of recent context |
| 21.78.2 | feat: `COMPRESSED_CHECKLIST` — new items 9 (Be Logical) and 10 (Simple Communication) added to `scripts/shared-context.js` checklist, surfacing two PRINCIPLES at per-prompt Quick-Check; Output scan line annotated to distinguish PROHIBITED PATTERNS 1-8 from PRINCIPLES 9-10; 190/190 tests PASS (shared-context 10 + inject-rules 107 + subagent-context 12 + classification 29 + race 4 + parallel-reminder 10 + wa-count 18); live hook simulation confirms items 9-10 reach Claude via `additionalContext` |
| 21.78.1 | hotfix: RULES PRINCIPLES — `Deep Thinking` → `Be Logical` rename + reframe (H004); goal is a logically-sound conclusion, depth is the means; new bullet text: "Every conclusion must follow logically from evidence — not from plausibility, pattern-match, or gut. Trace cause, check contradictions, derive step by step. Going deep is the means; landing on a logically sound conclusion is the goal. Lucky-correct reasoning is still a violation." |
| 21.78.0 | feat: RULES PRINCIPLES — new **Deep Thinking** bullet (trace actual cause + second-order effects, reject shallow reasoning) and **Simple Communication** bullet (one-sentence core + analogy, reject verbose hedging) inserted above HHH in `scripts/inject-rules.js` RULES constant; auto-synced to CLAUDE.md via `syncRulesToClaudeMd()`; 168/168 tests PASS (W019) |
| 21.77.2 | fix: RA agent rate-limit fallback (H003) — `skills/ticketing/SKILL.md` Step B and `skills/regressing/SKILL.md` Step 4c gain explicit fallback paragraph allowing Orchestrator self-verification when Task-tool RA dispatch fails with API rate-limit; auditable label `**Note: RA agent rate-limited, Orchestrator self-verification fallback applied.**` mandatory; standard mode remains RA dispatch retry |
| 21.77.1 | fix: waCount hook-event ordering (D101 T001) — new PreToolUse hook `wa-count-pretool.js` increments at dispatch (Pre = sole mutator), resolves subagent first-Write role-collapse false positive; test drift cleanup (D101 T002) — `_test-pressure-guard.js` PG-6/PG-11 + `_test-wa-count-enforcement.js` AC6 fixture updates; docs & process (D101 T003) — CLAUDE.md Version bump checklist step (5c), USER-MANUAL.md canonical phrase, /status SKILL counter bullet unified, ticketing SKILL Step 4a line-number pre-flight |
| 21.77.0 | feat: pressure 3-counter model alignment (D100/I058) — three pressure counters (feedbackPressure.level, feedbackPressure.oscillationCount, tooGoodSkepticism.retryCount); BAILOUT resets all three; inject-rules.js race fix (RMW fully inside index lock); sycophancy-guard/post-compact counter writes acquire lock; /status reports all 3; new tests `_test-inject-rules-race.js` + `_test-bailout-tooGoodSkepticism.js` |
| 21.76.0 | feat: retire lessons system — /knowledge replaces /lessons for project-specific facts; CLAUDE.md for behavioral rules; 21 skills |
| 21.75.1 | fix: skill-tracker.js DOCS_SKILLS missing 'hotfix' — /hotfix now activates skill-active flag, unblocks docs-guard on H*.md writes |
| 21.73.0 | feat: background agent stop exemption — counter.js detects run_in_background Agent launches, regressing-loop-guard.js allows stop during 10min TTL window |
| 21.72.0 | feat: --generate-digest (moc-digest.md), search-docs.js BM25, /search-docs skill, load-memory moc-digest injection; 20 skills |
| 21.71.0 | feat: pressure message once-only (lastShownLevel tracking); PRESSURE_L2/L3 content rewritten to require problem analysis + corrective plan; pressure-guard short block messages |
| 21.70.0 | feat: Obsidian L3 — MOC pages (--generate-moc), /lint skill (5-check linter), convergence criteria auto-apply; 19 skills |
| 21.69.0 | feat: Obsidian L2 integration — YAML frontmatter + wikilinks in D/P/T/I/W templates; migrate-obsidian.js; fix: light-workflow INDEX.md init logic |
| 21.68.0 | fix: bailout guidance once-only, L3 structured self-diagnosis |
| 21.67.0 | feat: USER-MANUAL.md full update, bailout keyword disclosure, version bump checklist step 5b |
| 21.66.0 | fix: discussing SKILL.md convergence criteria default for regressing |
| 21.65.0 | feat: D/I document templates add `## Constraints` section for persistent constraint reference |
| 21.64.0 | fix: skill-active.json TTL expiry check — prevents Stop hook false-blocking after workflow completes |
| 21.63.0 | fix: BAILOUT now resets oscillationCount to 0 (complete pressure reset) |
| 21.62.0 | feat: Model Routing splits verification into mechanical (Sonnet) vs judgment (Opus); workflow selection blocks light-workflow when open D exists; light-workflow SKILL.md pre-check + Rule 7; L2/L3 pressure messages include bailout user-authority note |
| 21.61.0 | feat: Discussion Convergence Criteria section (discussing SKILL.md 4th question + template), regressing Rule 7 Convergence Criteria reference, pressure bailout keywords "봉인해제"/"BAILOUT" — instant L0 reset |
| 21.60.0 | feat: role-collapse-guard.js (Orchestrator source-write block), deferral-guard.js (warn-only trailing question detection); fix: context-length "세션" + stoppage patterns, narrowed English session patterns; fix: memory-delta SKILL.md "foreground" → "wait for completion" |
| 21.59.0 | feat: Discussion Edit guard during regressing (docs-guard.js), context-length deferral detection (sycophancy-guard.js Step 0), discussing SKILL.md Rule 1 conditional, regressing SKILL.md pre-partitioning warning in Step 2.5 |
| 21.58.0 | feat: Pressure system redesign — L2 blocks 6 tools, L3 full lockdown (all tools including TaskCreate); block messages with user feedback solicitation; fix: counter.js TaskCreate reset gated, hooks.json matcher `.*`, verify-guard timeout 30s→60s |
| 21.57.0 | feat: anti-retreat pressure rules — PRESSURE_L1 blocks "I don't know" without tool use; PRESSURE_L2 blocks "검증 불가능" without searching, mandates sub-agent spot-checking |
| 21.56.0 | feat: oscillation enforcement — block on first direction change (pressure-independent), precision REVERSAL_PATTERNS, PRESSURE_L1 prior-response review mandate |
| 21.55.0 | feat: Stop hook phase-specific context + fix: WA count tracking 'TaskCreate'→'Agent' tool name |
| 21.54.0 | fix: I051 audit doc consistency fixes — regressing-loop-guard.js in Hook Flow 3.5 and Scripts Reference, scope-guard.js Scripts Reference, ASCII diagram Stop box expanded, STRUCTURE.md 6 new files + setup-rtk skill, CLAUDE.md 2 guard baseline entries, PROHIBITED PATTERNS 1-7→1-8, skills count 17→18 |
| 21.53.0 | fix: hooks.json trailing comma fix — version bump for cache refresh |
| 21.52.0 | feat: WA count enforcement — classifyAgent, wa-count.json tracking, ticketing reset, Stop hook single-WA block, PARALLEL_REMINDER "parallel and multiple" |
| 21.51.0 | fix: PARALLEL_REMINDER — WA parallel vs WA→RA sequential distinction, Single-WA tightened to single-file mechanical only |
| 21.50.0 | feat: input classification + guard cleanup — DEFAULT_NO_EXECUTION, EXECUTION_JUDGMENT, regressing-loop-guard rename, completion-drive-write-guard removal |
| 21.49.0 | fix: regressing Stop hook blocks instead of skips — forces autonomous execution continuation |
| 21.48.0 | feat: completion drive Write/Edit guard, positive path tests, PARALLEL_REMINDER rewrite, 3 SKILL.md completion drive warnings |
| 21.47.0 | feat: completion-drive-guard, too-good P/O/G skepticism, parallel processing reminder, regressing Rule 14, 39 new unit tests |
| 21.46.0 | feat: 3-tier model routing — centralized project.md table, SubagentStart injection, SKILL.md deduplication |
| 21.45.0 | feat: setup-rtk opt-in skill; fix: investigating default model Sonnet→Opus |
| 21.44.0 | feat: document-first rule for all skills; refactor: CLAUDE_RULES trim; fix: TTL 5→15min; chore: MEMORY.md/CLAUDE.md compression, I047 concluded |
| 21.43.0 | feat: orchestrator document-update fallback — investigating/planning/ticketing/light-workflow skills now require orchestrator to verify and write section content after each agent step; eliminates placeholder-only documents |
| 21.42.0 | feat: oscillation mitigation — PRESSURE_L1/L2 direction-change awareness text; PROHIBITED PATTERNS #8; checkReversalPhrases (14 patterns, protected-zone stripping); oscillationCount tracking in memory-index.json; Stop hook blocks on count≥3 + pressure≥1 |
| 21.41.0 | feat: planning/ticketing SKILL.md document-first rule (Steps A/B/C); feat: regressing-guard IA-2 agent section validation; fix: verify-guard V002 bare node→process.execPath; test: 21 regressing-guard tests |
| 21.40.0 | fix: docs-guard.js dead code removal (INDEX.md check in checkInvestigationConstraints); feat: CLAUDE.md checklist step 7 (source repo plugin.json); feat: ticketing SKILL.md — Skeptical calibration + Edge-case AC guidance |
| 21.39.0 | test: 32 new tests — _test-extract-delta (15), _test-append-memory (7), _test-memory-rotation (10) |
| 21.38.0 | feat: path-guard skill-active.json block; ticketing Step C document-first rule; calm-framing in inject-rules + sycophancy-guard (PRESSURE labels, DIAGNOSTIC RESET); counter.js lock early return + ensureDir |
| 21.37.0 | fix: docs-guard.js INDEX.md early return (bypasses skill-active TTL check); 3 new tests (TC5c/d/e), 18 total |
| 21.36.0 | feat: RA Deletion Check — mandatory `git diff` scan before verification in ticketing/light-workflow; Evidence Gate 5→6 checkbox (unintended deletion check); fallback paths for empty diff |
| 21.35.0 | fix: docs-guard.js INDEX.md exclusion from investigation Constraints check; 2 new tests (15 total) |
| 21.34.0 | feat: delta-summarizer background non-blocking via Agent `run_in_background: true`; SKILL.md Phase A/B split; DELTA_INSTRUCTION NON-BLOCKING; extract-delta.js markDeltaProcessing() + mark-processing CLI; memory-index.json deltaProcessing flag (double-trigger prevention) |
| 21.33.0 | fix: verification-sequence.js + sycophancy-guard.js node.exe pattern (`\bnode\s+` → `\bnode(?:\.exe)?["']?\s+`) for Windows full path with quotes; 5 new tests (34 total) |
| 21.32.0 | feat: pressure-sycophancy integration — graduated strictness L0-L3 in sycophancy-guard (feedbackPressure.level), pressureHint(), PRESSURE_L1/L2/L3 behavioral rules, profanity patterns in NEGATIVE_PATTERNS, quote stripping, 20-test suite |
| 21.31.0 | feat: docs-guard Constraints enforcement for I documents, 13 tests, `claude -p --system-prompt` L1 test |
| 21.30.0 | feat: Phase 9 Evidence Gate harmonized (5-checkbox BLOCKING), Parameter Recommendation (Phase 0.7), 11→12-Phase workflow |
| 21.29.0 | feat: light-workflow philosophy port — PROHIBITED PATTERNS scan, L1-L4 levels, Evidence Gate 5-checkbox, Constraint Presentation, Devil's Advocate, Coherence Check, Escalation cross-ref, W template alignment |
| 21.28.0 | feat: light-workflow SKILL.md modernization — Workflow Selection matrix, 9-section W template + 6 rejection criteria, Mid-Execution Escalation Protocol, CLAUDE.md workflow selection + urgency signal rules |
| 21.27.0 | fix: ARCHITECTURE.md stale DELTA comment; D065 concluded, P093 done |
| 21.26.0 | revert: restore foreground DELTA detection in inject-rules.js (DELTA_INSTRUCTION, checkDeltaPending, hasPendingDelta); remove delta-background.js PostToolUse hook (claude -p loads 34K+ token context, causing Haiku to follow skills instead of summarizing; --bare breaks OAuth) |
| 21.25.0 | fix: delta-background.js direct API → `claude -p` subprocess (fixes broken Haiku summarization); hooks.json async→asyncRewake (ghost response prevention); 17 hooks CRABSHELL_BACKGROUND guard (plugin pollution prevention); 4 new delta-background tests (14 total) |
| 21.24.0 | feat: proactive constraint presentation in investigating/discussing skills (project + inferred); feat: worklog (W) document system for light-workflow tracing; docs: D/P/T/I/W 5-document system |
| 21.23.0 | feat: async background delta processing via delta-background.js (Haiku API + raw fallback); task constraint confirmation in investigating/discussing skills; remove CRABSHELL_DELTA foreground trigger from inject-rules.js; delta no longer consumes model turns |
| 21.22.0 | refactor: inject-rules.js readProjectConcept() from shared-context.js; RULES Korean descriptive text translated to English |
| 21.21.0 | feat: PreCompact/PostCompact/SubagentStart hooks; shared-context.js for cross-hook reuse; project.md constraints injection; async:true on skill-tracker + doc-watchdog record (12 guard hooks total) |
| 21.20.0 | feat: Type B/C metacognitive→behavioral rule rewrites (HHH, Anti-Deception, Understanding-First, Contradiction Detection, Problem-Solving); VIOLATIONS section removed; SCOPE DEFINITIONS consolidated; COMPRESSED_CHECKLIST synchronized |
| 21.19.0 | feat: CLAUDE.md R4 Completion Drive → Scope Preservation behavioral rule; R26 INTERFERENCE PATTERNS → PROHIBITED PATTERNS (7 output-scannable); scope-guard.js Stop hook (user quantity vs response count); transcript-utils.js getLastUserMessage(); 20-test suite; I040 metacognition research (6 Opus agents) |
| 21.18.0 | feat: doc-watchdog.js FSM — record (PostToolUse code edit tracking), gate (PreToolUse soft warning at threshold during regressing), stop (Stop hook blocks session end without ticket work log); 12-test suite; DOC_WATCHDOG_FILE/THRESHOLD constants |
| 21.17.0 | feat: /status healthcheck skill — reports plugin state with ✓/!/✗ indicators; fix: marketplace.json version drift corrected (was 21.15.0) |
| 21.16.0 | fix: verify-guard hybrid approach — Write to new file skips verification, Write to existing file + Edit enforce 3-stage check (fs.existsSync-based); feat: _test-verify-guard.js 7-test integration suite |
| 21.15.0 | fix: regressing/investigating SKILL.md — actually include Step 2.5/3.5 Parameter Recommendation content (missing from v21.14.0 commit) |
| 21.14.0 | feat: Parameter Recommendation step added to regressing + investigating skills — users specify optimization target / confirm scope before agent work begins |
| 21.13.0 | feat: regressing/planning/ticketing SKILL.md Phase-based multi-agent rewrite — Loop structure, Machine Verification priority, iteration cap + stall detection, Verify Agent Independence Protocol, 11 anti-patterns, cycle→iteration terminology |
| 21.12.0 | feat: checkTicketStatuses() — ticket status reminder for active regressing sessions, injects warning for todo/in-progress tickets into additionalContext, 114-test suite (was 110) |
| 21.11.0 | feat: log-guard.js validatePendingSections() — blocks ticket terminal transitions when result sections contain "(pending)", 77-test suite (was 67) |
| 21.10.0 | feat: L1 session file pruning (>30 days), refineRawSync offset mode (O(n^2)→O(n)), session-aware L1 reuse, final() offset clearing, prune→delta ordering, 102-test suite (10 integration) |
| 21.9.0 | feat: RULES constant compressed 14,153→5,392 chars (62%), COMPRESSED_CHECKLIST 1,375→703 chars (49%), information architecture restructured for density |
| 21.8.0 | feat: path-guard.js shell variable resolution (fail-closed for unknown vars targeting .crabshell/), _test-path-guard.js 111-test suite (subprocess+unit), marketplace.json+plugin.json description sync, run-hook.cmd cleanup |
| 21.7.0 | feat: counter.js conditional exports (require.main guard), _test-counter.js 67-test suite (unit+subprocess+edge), acquireIndexLock for memory-index.json writes, INDEX_LOCK_FILE constant, pressure reset fix |
| 21.6.0 | feat: .gitattributes LF enforcement, inject-rules.js expanded exports (12 new), _test-inject-rules.js 110-test integration suite (subprocess, Korean+English, regressing phases, delta+rotation) |
| 21.5.0 | feat: pressure detection fixes — exclusion strip architecture, narrowed `왜 이렇게`, 8 diagnostic exclusions, widened `break(ing|s)`, SessionStart decay to L1, self-directed pressure text, 66-test suite |
| 21.4.0 | feat: log-guard.js dual-trigger D/P/T log enforcement, guard count 7→8 |
| 21.3.0 | feat: /verifying manifest v21 entries, guard consolidation analysis (keep 4, safety > count), Stop hook text block gap documented |
| 21.2.0 | feat: L1-L4 observation resolution hierarchy (VERIFICATION-FIRST) + verifying SKILL.md manifest schema expansion |
| 21.1.0 | feat: verification claim detection (sycophancy-guard 4-tier classification) + pressure L3 expansion (all 6 tools blocked, expertise framing) |
| 21.0.0 | feat: verification-sequence guard — source edit→test→commit enforcement, edit-grep cycle detection, transcript-utils.js shared utilities, hooks.json order optimization |
| 20.7.0 | feat: sycophancy-guard dual-layer — removed 100-char exemption, added PreToolUse mid-turn transcript parsing |
| 20.6.0 | feat: memory.md → logbook.md rename (docs, skills, commands), memory-delta SKILL.md Step 4 append-memory.js CLI |
| 20.5.0 | feat: counter file separation (counter.json), extract-delta.js mark-appended CLI, memory-delta SKILL.md Bash CLI steps |
| 20.4.0 | feat: sycophancy-guard evidence type split (behavioral vs structural), inject-rules.js positional optimization (COMPRESSED_CHECKLIST first, verify items #1/#2, verification reminder) |
| 20.3.0 | feat: enforcement guards — path-guard Edit block on logbook.md, verify-guard behavioral AC requirement, sycophancy-guard "맞다." + English "Correct."/"Right." patterns |
| 20.2.0 | feat: delta foreground conversion — remove background delta-processor, TZ_OFFSET auto-injection, foreground-only SKILL.md |
| 20.1.0 | feat: D/P/T/I documents consolidated under .crabshell/ — all document paths, guards, and skills updated |
| 20.0.0 | **BREAKING**: memory-keeper → crabshell rename, .claude/memory/ → .crabshell/ path migration, auto-migration on SessionStart, STORAGE_ROOT centralization |
| 19.56.0 | feat: project.md injection expanded to 10 lines/500 chars, CLAUDE_RULES practical guidelines (AI slop avoidance, config externalization) |
| 19.55.0 | feat: delta-processor Bash removal — Read+Write only, JSON lock protocol, inline timestamps, SKILL.md fallback Bash-free |
| 19.54.0 | feat: contradiction detection — 3-level verification framework (Local/Related pipeline/System-wide), pipeline contradiction scan in coherence methods |
| 19.53.0 | fix: Bash escaping/permission — 9 files fixed; feat: regressing convergence loop; feat: feedback assessment-mode detection |
| 19.52.0 | feat: setup-project skill, fix counter.js path bug, remove architecture.md/conventions.md |
| 19.51.0 | feat: regressing skill — default 10 cycles, early convergence termination, 10-cycle checkpoint, sequential tasks in same cycle |
| 19.50.0 | feat: feedback pressure detection — L0-L3 escalating intervention, pressure-guard.js Write/Edit blocking at L3, TaskCreate auto-reset |
| 19.49.0 | feat: per-prompt project concept anchor + refactor: extract agent orchestration rules to .claude/rules/, reduce emphasis markers, remove redundant negation clauses |
| 19.48.0 | refactor: lossless compression of RULES + COMPRESSED_CHECKLIST — 8 edits preserving all rule semantics |
| 19.47.0 | feat: PROBLEM-SOLVING PRINCIPLES — Constraint Reporter + Cross-Domain Translation; SCOPE DEFINITIONS failure-context reframes |
| 19.46.0 | fix: replace Bash write/delete with Node.js fs in all SKILL.md files |
| 19.45.0 | feat: sycophancy-guard context-aware detection with position-based evidence |
| 19.44.0 | fix: path-guard regex handles spaces in quoted paths |
| 19.43.0 | fix: remove ensureGlobalHooks() — duplicate hook registration in global settings.json on every SessionStart |
| 19.42.0 | feat: lessons skill enforces actionable rule format — Problem/Rule/Example template, prohibits reflective narratives |
| 19.41.0 | fix: replace Bash rm with Node fs.unlinkSync in clear-memory skill and delta-processor agent to avoid sensitive file permission prompts |
| 19.40.0 | chore: remove orphaned verifying-called.json flag code (skill-tracker, load-memory, constants) |
| 19.39.0 | verify-guard deterministic execution (execSync run-verify.js, blocks on FAIL) + P/O/G Type column (behavioral/structural) + IA Source Mapping Table |
| 19.38.0 | Fix: HOOK_DATA fallback for path-guard.js and regressing-guard.js; sync-rules-to-claude.js duplicate MARKER_START header |
| 19.37.0 | search-memory CLI enhancements — `--regex`, `--context=N`, `--limit=N` flags; L1 structured entry/context display |
| 19.36.0 | Fix: sycophancy-guard HOOK_DATA fallback — guard failed silently via hook-runner.js; added env var check matching other guard scripts |
| 19.35.0 | delta-processor background agent — non-blocking delta processing + lock file race condition prevention + foreground fallback |
| 19.34.0 | verify-guard PreToolUse hook (block Final Verification without /verifying run) + skill-tracker verifying-called flag + N/A exception |
| 19.33.0 | docs-guard PreToolUse hook (block docs/ Write/Edit without skill flag) + skill-tracker PostToolUse hook + TTL cleanup |
| 19.32.0 | RA pairing enforcement (WA N = RA N), concrete coherence verification methods, overcorrection SCOPE DEFINITIONS framing |
| 19.31.0 | PreToolUse path-guard hook — block Read/Grep/Glob/Bash targeting wrong .claude/memory/ path, Bash command string inspection |
| 19.30.0 | Best practices fixes — P/O/G unification, R→I stale refs, stop_hook_active guard, regressing-guard JSON block, RA Independence Protocol |
| 19.29.0 | Stop hook sycophancy guard — detect agreement-without-verification in Stop responses, block with re-examination |
| 19.28.0 | Ticket execution ordering guide + final coherence verification (D025) |
| 19.27.0 | COMPRESSED_CHECKLIST coherence/multi-WA dedup + regressing 4-factor evaluation (correctness, completeness, coherence, improvement) |
| 19.26.0 | Regressing execution quality — result improvement cycles, multi-WA perspective diversity, 4-factor coherence evaluation, /verifying IA anchor, anti-sycophancy framing |
| 19.25.0 | Regressing 1:N Plan:Ticket — ticketIds array, multi-ticket execution/feedback phases, P→T(1..M) rule notation |
| 19.24.0 | SCOPE DEFINITIONS framing + COMPRESSED_CHECKLIST (77% token reduction) + regressing-guard PreToolUse hook + skill Scope Notes |
| 19.23.0 | Feat: Regressing phase tracker — hook-based auto-enforcement of Skill tool usage via UserPromptSubmit reminders + PostToolUse auto-phase-advance |
| 19.22.0 | Feat: Verification tool check procedure in regressing/ticketing/light-workflow — /verifying invoked as procedural step, not rule |
| 19.21.0 | Feat: Verifying skill — create/run project-specific verification tools; inline verification definitions replaced with VERIFICATION-FIRST reference |
| 19.20.0 | Feat: RA Independence Protocol + Planning E/A/G verification + Orchestrator cross-reference step |
| 19.19.0 | Feat: Verification philosophy operationalization — P/O/G template + Evidence Gate for Review Agent/Orchestrator in regressing/ticketing, inject-rules.js observation evidence mandate |
| 19.18.0 | Feat: Regressing quality enforcement — anti-pattern rules, agent independence via Task tool, enriched feedback structure, anti-partitioning, cross-review integration, Devil's Advocate for single reviewers |
| 19.17.0 | Feat: Anthropic best practices skill optimization — 14 skill descriptions rewritten to 3rd person with trigger phrases, fabricated params removed |
| 19.16.0 | Feat: Rename researching → investigating, new I(Investigation) document type with multi-agent multi-source design |
| 19.15.0 | Feat: Restructure regressing to D-PT loop — single Discussion wraps all cycles, P-T pairs repeat per cycle |
| 19.14.0 | Feat: Rename workflow → light-workflow, remove stale workflow references across project |
| 19.13.0 | Changed: i18n — translated all Korean text in 6 skill documents to English (no meaning changes) |
| 19.12.0 | Changed: Verification philosophy — redefined verification standard, added observation evidence gates to workflow phases |
| 19.11.0 | Feat: Regressing skill — autonomous D→P→T loop with verification-based optimization |
| 19.10.0 | Feat: Skill precision optimization — descriptions, trigger patterns, workflow split, terminology fixes |
| 19.9.0 | Feat: Mandatory work log — all D/P/T/R documents require log append after any related work |
| 19.7.0 | Feat: Status cascade — ticket verified auto-closes parent plan and related D/R; reverse propagation constraints prevent premature closure |
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
| 18.3.0 | Feat: emergency stop keywords — context replacement + agent utilization rule |
| 18.2.0 | Feat: workflow agent enforcement rule — must use Task tool for Work/Review Agent phases |
| 18.1.0 | Fix: `CLAUDE_PROJECT_DIR` not propagated to Bash tool — `--project-dir` CLI arg for scripts, absolute paths in all skills |
| 18.0.0 | Fix: bare `node` PATH failure on Windows Git Bash — find-node.sh cross-platform locator, process.execPath in ensureGlobalHooks |
| 17.3.0 | Fix: anchor explicitly overrides Primary working directory |
| 17.2.0 | Feat: project root anchor injection — prevent directory loss after compaction |
| 17.1.0 | Fix: use CLAUDE_PROJECT_DIR instead of hookData.cwd for project root |
| 17.0.0 | Fix: Central cwd isolation via hook-runner.js v2 — prevents cross-project counter contamination |

<details>
<summary>Older versions</summary>

| Version | Changes |
|---------|---------|
| 16.0.x | Fix: Session isolation, writeJson EPERM fallback, walk-up removal, async check() |
| 15.4.0 | Change: MIN_DELTA_SIZE 40KB → 10KB |
| 15.3.0 | Fix: stable hook-runner.js eliminates version-specific paths in settings.json |
| 15.2.0 | Fix: atomic writeJson, init.js preserves index on parse error |
| 15.1.0 | Workaround: auto-register hooks in settings.json via SessionStart |
| 15.0.0 | Fix: Stop→SessionEnd hook, counter interval 50→30 |
| 14.9.0 | Delta: conditional processing, only trigger at >= 40KB |
| 14.8.1 | Workflow: remove presentation-specific section from template |
| 14.8.0 | Workflow: 3-layer architecture (Work Agent + Review Agent + Orchestrator), 11 phases |
| 14.7.1 | Fix: async stdin for Windows pipe compatibility |
| 14.7.0 | Post-compaction detection: inject recovery warning via SessionStart |
| 14.6.0 | PRINCIPLES: imperative commands instead of definitions |
| 14.5.0 | Rename Action Bias → Completion Drive |
| 14.4.0 | Fix: UNDERSTANDING-FIRST requires external user confirmation |
| 14.3.0 | Fix: L1 captures user-typed messages |
| 14.2.0 | PRINCIPLES: understanding-driven rewrite with verification tests |
| 14.1.0 | Action Bias principle added to injected RULES |
| 14.0.0 | L1 on PostToolUse, L1-based timestamps, spread readIndexSafe |
| 13.9.26 | DEFAULT_INTERVAL 100→50 |
| 13.9.25 | Workflow: Orchestrator vs Agent role division |
| 13.9.24 | Counter-based delta gating, interval 25→100 |
| 13.9.23 | UNDERSTANDING-FIRST rule: gap-based verification |
| 13.9.22 | Timestamp double-escaping fix, MEMORY.md auto-warning |
| 13.9.21 | Session restart context recovery rule |
| 13.9.20 | Workflow & lessons system with auto-init templates |
| 13.9.19 | CLAUDE.md marker-based sync |
| 13.9.16 | Restore CLAUDE.md auto-sync |
| 13.9.9 | 30-second thinking rule with date command verification |
| 13.9.7 | lastMemoryUpdateTs preservation fix |
| 13.9.5 | Dual timestamp headers |
| 13.9.4 | Delta extraction append mode |
| 13.9.2 | UTC timestamps, saveInterval 5→25 |
| 13.8.7 | Removed experimental context warning feature |
| 13.8.6 | Proportional delta summarization |
| 13.8.5 | Stronger delta instruction blocking language |
| 13.8.4 | Script path resolution for all skills |
| 13.8.3 | Added 'don't cut corners' rule |
| 13.8.2 | Fixed memory-index.json field preservation on parse errors |
| 13.8.1 | Windows `echo -e` bug fix |
| 13.8.0 | Auto-trigger L3 generation after rotation |
| 13.7.0 | Path detection fix for plugin cache execution |
| 13.6.0 | UserPromptSubmit-based delta triggers |
| 13.5.0 | Delta-based auto-save (Haiku summarization), rules injection every prompt |
| 13.0.0 | Token-based memory rotation (L2 archives, L3 summaries) |
| 12.x | Stop hook blocking, L2/L3/L4 workflow improvements |
| 8.x | L1-L4 hierarchical memory system |

</details>

## License

MIT
