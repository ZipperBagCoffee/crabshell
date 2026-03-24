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
2. **During work** - Auto-save triggers every 15 tool uses (configurable), Claude records decisions/patterns/issues directly
3. **Session end** - Full conversation backup + final save

## What Gets Saved

### Automatic (No action needed)
- `memory.md` - Session summaries accumulate here (auto-rotates at 23,750 tokens)
- `memory_*.md` - Rotated archives (L2)
- `*.summary.json` - L3 summaries (Haiku-generated)
- `sessions/*.l1.jsonl` - Detailed session transcripts (L1)

### Manual Setup (Optional)
If there's information you want Claude to know every session, **directly edit the files**:

```bash
# Create/edit files in your project's .claude/memory/ folder
echo "React + TypeScript web app." > .claude/memory/project.md
echo "src/ - components, hooks, services" > .claude/memory/architecture.md
echo "Functional components only" > .claude/memory/conventions.md
```

Or just ask Claude: "Save the project info to project.md"

With this setup, **Claude starts every new session knowing this information**.

## Slash Commands

**Works in any project where the plugin is installed:**

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Save now (don't wait for auto-save) |
| `/memory-keeper:load-memory` | Reload memory (after manual edits) |
| `/memory-keeper:search-memory query` | Search past sessions |
| `/memory-keeper:clear-memory old` | Clean up files older than 30 days |
| `/memory-keeper:discussing "topic"` | Create/update a discussion document |
| `/memory-keeper:planning "topic"` | Create/update a plan document |
| `/memory-keeper:ticketing P001 "topic"` | Create/update a ticket tied to a plan |
| `/memory-keeper:investigating "topic"` | Multi-source multi-agent investigation |
| `/memory-keeper:regressing "topic" N` | Run N cycles of D→P→T with verification-based optimization |
| `/memory-keeper:light-workflow` | Run the 11-phase agent orchestration workflow (standalone tasks) |
| `/memory-keeper:verifying` | Create/run project-specific verification tools |
| `/memory-keeper:lessons` | Check/create project-specific lessons |

## Document Management (4-Skill System)

Track project work through structured, append-only documents:

| Skill | ID Format | Statuses | Use For |
|-------|-----------|----------|---------|
| `/discussing` | D001 | open, concluded | Decisions, dialogues, conclusions |
| `/planning` | P001 | draft, approved, in-progress, done | Implementation plans with steps |
| `/ticketing` | P001_T001 | todo, in-progress, done, verified | Session-sized work units tied to plans |
| `/investigating` | I001 | open, concluded | Multi-source investigations with cross-review |

Each document type has its own folder under `docs/` with an `INDEX.md` for status tracking. Tickets inherit from plans and require verification-at-creation (TDD principle).

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

- **Above the line**: Auto-managed by the plugin (updated on every session start)
- **Below the line**: Your project-specific content (never modified by the plugin)

> **Note:** The plugin also writes a warning to Claude Code's built-in `MEMORY.md` (at `~/.claude/projects/{project}/memory/MEMORY.md`) to prevent confusion between the two memory systems. This is separate from the plugin's own `memory.md`.

## Storage Location

```
[project]/.claude/memory/
├── memory.md              # Active rolling memory (auto-rotates at 23,750 tokens)
├── memory_*.md            # Rotated archives (L2)
├── *.summary.json         # L3 summaries (Haiku-generated)
├── memory-index.json      # Rotation tracking & counter
├── project.md             # Project overview (optional)
├── architecture.md        # Architecture (optional)
├── conventions.md         # Coding rules (optional)
├── logs/                  # Refine logs
└── sessions/
    └── *.l1.jsonl         # L1 session transcripts (deduplicated)

[project]/docs/
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

`~/.claude/memory-keeper/config.json`:
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
L2 (memory_*.md)          - Rotated archives (auto at 23,750 tokens)
     ↓
L3 (*.summary.json)       - Haiku-generated summaries
     ↓
memory.md                 - Active rolling memory (loaded at startup)
```

- **L1**: Raw transcripts refined to keep only meaningful content
- **L2**: memory.md auto-rotates when too large, archives preserved
- **L3**: AI-generated summaries of archived content
- **Search**: `search-memory` traverses L3 → L2 → memory.md (add `--deep` for L1)

## Documentation

- [User Manual](docs/USER-MANUAL.md) - Detailed usage
- [Architecture](docs/ARCHITECTURE.md) - System design

## Version

| Version | Changes |
|---------|---------|
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
