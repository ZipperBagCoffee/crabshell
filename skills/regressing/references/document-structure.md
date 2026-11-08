# Regressing — document structure

## Document Structure

One D wraps the session and carries each cycle's plan as a log entry. Each cycle adds one plan entry and one or more tickets under the D:

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
