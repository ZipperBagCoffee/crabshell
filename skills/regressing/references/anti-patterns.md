# Regressing — anti-patterns

## Anti-Patterns (PROHIBITED)

| Anti-Pattern | What it looks like | Correct alternative |
|---|---|---|
| **Pre-partitioning** | Cycle 1's plan divides total work into N equal parts, one per cycle | Cycle 1's plan addresses the highest-impact improvements; later cycle plans respond to verification gaps. Cycle count is emergent, not planned |
| **Sequential pipeline** | Cycle 1 = modify, Cycle 2 = test, Cycle 3 = release | Each cycle is a complete implement-verify-improve loop |
| **Copy-paste feedback** | Next Direction says "continue with remaining items" | Next Direction diagnoses specific problems with evidence |
| **Parent abdication** | The parent accepts a worker's or reviewer's claim as the final decision | The parent reopens decisive references, diffs, execution results and side effects before completion |
| **Rubber-stamp verification** | "ALL PASS — no improvement opportunities" | The parent lists what was examined and why no improvement applies |
| **Delegation ritual** | Worker count or role pairing is treated as progress or completion evidence | Run independent parts as parallel workers; counts are never completion conditions |
| **Operational steps as separate cycles** | Cycle 1 = code change, Cycle 2 = version bump + build + commit | Version bump, build and commit are operational steps within a cycle's ticket(s), not separate cycles |
| **Autonomous Write outside scope** | The parent or a worker writes or edits code files the current ticket's AC does not cover | Every code file write must trace to a ticket AC. If none covers it, STOP and raise an Open Question |
