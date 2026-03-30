# Crabshell

**Claude Code plugin that makes Claude remember, verify, and self-correct.**

Three pillars:
1. **Session memory** — Auto-saves context across sessions. Delta extraction, Haiku summarization, token-based rotation. No manual setup.
2. **Behavioral correction** — Injects verification-first rules and interference pattern detection every prompt. Eight guard hooks block sycophancy, overcorrection, and shortcuts at runtime.
3. **Structured workflows** — D/P/T/I document system with 16 skills for planning, investigating, and iterative improvement (regressing).

All plugin output lives under `.crabshell/` — gitignored, clean project root.

## Installation

```bash
/plugin marketplace add ZipperBagCoffee/crabshell
/plugin install crabshell
```

After installation, **you don't need to do anything**. It works automatically.

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
| `/crabshell:lessons` | Check/create project-specific lessons |

## Document Management (4-Skill System)

Track project work through structured, append-only documents:

| Skill | ID Format | Statuses | Use For |
|-------|-----------|----------|---------|
| `/discussing` | D001 | open, concluded | Decisions, dialogues, conclusions |
| `/planning` | P001 | draft, approved, in-progress, done | Implementation plans with steps |
| `/ticketing` | P001_T001 | todo, in-progress, done, verified | Session-sized work units tied to plans |
| `/investigating` | I001 | open, concluded | Multi-source investigations with cross-review |

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
└── investigation/         # Investigation documents (I001, I002...)
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
