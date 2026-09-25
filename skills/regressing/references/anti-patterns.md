# Regressing — anti-patterns

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

## Anti-Patterns (PROHIBITED)

The following patterns indicate regressing has degenerated into sequential batch execution:

| Anti-Pattern | What it looks like | Correct alternative |
|---|---|---|
| **Pre-partitioning** | Cycle 1's plan divides total work into N equal parts, assigning each to a cycle | Cycle 1's plan addresses the highest-impact improvements; later cycle plans respond to verification gaps. Cycle count is emergent, not planned |
| **Sequential pipeline** | Cycle 1 = modify, Cycle 2 = sync, Cycle 3 = version bump | Sequential tasks (version bump, cache sync, deploy) belong in the SAME cycle as separate tickets — NOT as separate cycles. Each cycle is a complete implement-verify-improve loop |
| **Copy-paste feedback** | Next Direction says "continue with remaining items" | Next Direction diagnoses specific problems with evidence |
| **Parent abdication** | Parent accepts a worker/reviewer claim as the final decision | Parent reopens decisive references, diffs, execution results, and side effects before completion |
| **Rubber-stamp verification** | "ALL PASS — no improvement opportunities" | Orchestrator enumerates what was examined and why no improvements apply |
| **Delegation ritual** | Agent count or role pairing is treated as progress or completion evidence | Delegate only bounded independent work when risk or latency justifies it; counts are never completion conditions |
| **Operational steps as separate cycles** | Cycle 1 = code change, Cycle 2 = version bump + cache sync + commit | Version bump, cache sync, and commit are operational steps within a cycle's ticket(s), not independent cycles |
| **Autonomous Write outside scope** | Agent writes/edits code files not covered by current ticket AC | Every code file write must trace to a ticket AC. If not covered → STOP and raise Open Question |

If any of these patterns are detected during execution, the Orchestrator MUST halt and restructure before proceeding.
