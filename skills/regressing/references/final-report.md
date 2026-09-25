# Regressing — Final Report format

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

Final Report format:

```
### [{timestamp}] Regressing Final Report
Converged after {actual} cycles (cap: {N})
Termination reason: {convergence | cap reached | user stop}

**Gap Reduction:**
| Cycle | Gaps Identified | Gaps Resolved | Key Improvement |
|-------|----------------|---------------|-----------------|
| 1     | ...            | ...           | ...             |
| ...   | ...            | ...           | ...             |

**Improvement Trajectory:**
- Cycle 1→2: {key changes}
- Cycle 2→3: {key changes}

**Final State:**
- Achieved: ...
- Remaining gaps: ...
- Future recommendations: ...
```
