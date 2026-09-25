# Regressing — document structure

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

## Document Structure

One D wraps the entire session and carries each cycle's plan as a log entry. Each cycle adds one plan entry and one or more tickets under the D:

```
D (open)
  → Cycle 1 plan (D log) → D_T001, D_T002, ...    [cycle 1]
  → Cycle 2 plan (D log) → D_T003                  [cycle 2]
  → ...
D (closed with final report)
```

| Document | Count | Role |
|----------|-------|------|
| D | 1 | Top-level container: intent, IA, one plan entry per cycle, feedback transfers, final report |
| T | >= N | One or more per cycle, parent = the D: execution + verification |

Sessions started before this layout keep their P documents (`P{NNN}` plans with `P{NNN}_T{NNN}` tickets); guards and tools accept both parents.
