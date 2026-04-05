# Analysis Phases (Phases 1-7)

> Detailed phase definitions for the analysis and planning stages of the Agent Orchestration Workflow.
> For the main workflow overview, see [SKILL.md](SKILL.md).

---

### Phase 0.7: Parameter Recommendation (Orchestrator)

Before starting Phase 1, recommend session parameters:

```
Parameter Recommendation
- Agents: {count} — {Role1}, {Role2}, ...
- Models: Opus (Analysis) → Sonnet (Implementation/Verification)
Silence = proceed. Adjust any parameter by responding.
```

| Parameter | How to determine | Default |
|-----------|-----------------|---------|
| Agent count | 1-2 for focused tasks, 2-3 for broader scope | 2 |
| Specialist roles | Non-overlapping perspectives relevant to the task | — |
| Model tier | Opus for analysis/planning, Sonnet for implementation | Opus/Sonnet |

---

### Phase 1: Understand (Orchestrator + User)

**YOUR job — never delegate.**

1. State understanding explicitly:
   - **Current state:** what exists now
   - **Desired state:** what should exist after
   - **Must preserve:** behaviors/properties that must not change
   - **Constraint Presentation:** enumerate constraints as a numbered list (technical limits, scope limits, external dependencies). Present to user before proceeding. Unacknowledged constraints = hidden assumptions = plan risk.
2. Infer implicit requirements — what would a reasonable person expect even if not mentioned?
3. Produce **Intent Anchor** — numbered list of non-negotiable requirements (3-7 items):
   ```
   IA-1: [requirement]
   IA-2: [requirement]
   ...
   ```
   These are the things that CANNOT be violated. Every meta-review gate re-reads this list.
3a. **Devil's Advocate check** — before presenting IA to user:
   - "Is any IA item actually a preference, not a constraint?"
   - "Could a reasonable implementation satisfy user intent WITHOUT this IA item?"
   - "Does this IA item conflict with another?"
   Remove or qualify items that fail. A flawed IA poisons every downstream gate.
4. Confirm with user: "Is this understanding correct? Are these the right Intent Anchor items?"
5. User corrects → gap found → adjust Intent Anchor → confirm again
6. **RA/WA Cross-Reference anchor:** Before spawning Phase 2 agents, confirm WA and RA will receive identical IA items verbatim. Record in W document: "IA-1..N agreed. WA and RA prompts both include these items."

### Phase 2: Analyze (Work Agent)

Trace call chains, dependencies, state changes, user-visible behavior.

**When NOT to use agents:** simple grep, checking text existence, reading a single short file.

### Phase 3: Review Analysis (Review Agent)

- Check completeness (all files/functions covered?)
- Check accuracy (read code yourself, verify claims)
- Per-item verdict: Claim → Verified YES/NO/PARTIALLY → Issue
- Overall: COMPLETE / INCOMPLETE (with specific gaps)

### Phase 3.5 / 6.5 / 9.5: Cross-Review (BLOCKING Gate)

**Triggers when 2+ Review Agents ran in parallel.** The next Meta-Review phase CANNOT begin without this step. Single reviewer → skip to Meta-Review.

**Procedure:**

1. Orchestrator collects all review results
2. Each reviewer receives the OTHER reviewers' findings with instructions:
   - **Challenge**: conclusions you disagree with — explain why
   - **Contradict**: findings that conflict with yours — cite evidence
   - **Blind spots**: what did they miss that you caught, and vice versa?
3. Each reviewer produces a Cross-Review Response
4. Orchestrator synthesizes into a **Cross-Review Report** (required input for Meta-Review)

**Cross-Review Report format:**

```
## Cross-Review Report
| Finding | R1 | R2 | R3 | Conflict? |
|---------|----|----|-----|-----------|
| [item]  | [position + evidence] | [agrees/disagrees + why] | ... | YES/NO |

## Contested Findings
[Items where reviewers disagree — orchestrator MUST resolve in Meta-Review]

## Blind Spots Identified
[Items one reviewer caught that others missed — require orchestrator judgment]

## Consensus
[Items all reviewers agree on — lower scrutiny needed]
```

"No conflicts found" is a valid but suspicious outcome — orchestrator should verify this isn't lazy cross-review.

### Phase 4: Meta-Review (Orchestrator as Intent Guardian)

**Input:** Review results + Cross-Review Report (if 2+ reviewers)

**Coherence Check (single reviewer — no Cross-Review Report):**
When only 1 reviewer ran, the Orchestrator MUST verify:
1. Does the review cover every Work Agent output item? (completeness)
2. Are verdicts internally consistent? (PASS on A but FAIL on dependent B = inconsistency)
3. Does reviewer's trace match or conflict with Work Agent's trace? (path coherence)
If any check fails → treat as Contested Finding, resolve before proceeding.

1. Did reviewer cite specific evidence (not just "looks correct")?
2. **Spot-check** — read actual code yourself:
   - 1 reviewer → minimum 1 spot-check
   - 2-3 reviewers → minimum 2 (highest-risk + 1 random)
   - 4+ reviewers → minimum 3
3. If Cross-Review Report exists: resolve all Contested Findings with your own judgment
4. **Intent Comparison Protocol** — for each agent recommendation:
   - Re-read Intent Anchor (list IA-1 through IA-N)
   - Write: `Recommendation X → IA-N: ALIGNED/CONFLICTS — [reason]`
   - Any CONFLICTS → reject recommendation or find alternative that preserves intent
   - Record WHY each acceptance/rejection was made
5. Gap check:
   - Thorough + intent-aligned → proceed to Phase 5
   - Vague or missed obvious gaps → re-launch Review Agent
   - Spot-check fails → both analysis and review suspect → return to Phase 2

**Self-enforcement Checklist (MUST complete before proceeding):**
- [ ] Intent Anchor listed? (cite IA-1 through IA-N)
- [ ] Each recommendation compared against Intent Anchor? (show comparison)
- [ ] Accept/reject reasoning documented?
- [ ] Spot-checks completed? (needed: X, done: Y)
- [ ] Cross-review report referenced? (if 2+ reviewers)
- [ ] Runtime verification results reviewed? (reviewer produced traces: YES/NO, spot-checked: X)
- [ ] Overall: intent preserved? (YES with evidence / NO → do not proceed)

> **Compaction:** After completing Phase 4 meta-review, compress previous phases before proceeding. See [COMPACTION.md](COMPACTION.md).

---

### Phase 5: Plan (Work Agent)

For each gap: file, change, why, predicted effect.

**Success criteria rules:**
- MUST describe **observable behavior**, NOT file contents
- BAD: "file.js contains newFunction()"
- GOOD: "When counter reaches 100, delta triggers exactly once"

Include regression checks with verification method.

### Phase 6: Review Plan (Review Agent)

- Coverage: every gap addressed?
- Correctness: will changes close gaps?
- Regression risk per change (NONE / LOW / HIGH)
- Success criteria: observable behavior, testable?
- Per-change verdict + overall APPROVED / NEEDS REVISION

### Phase 6.5: Cross-Review

Same procedure as Phase 3.5. See [Phase 3.5 above](#phase-35--65--95-cross-review-blocking-gate).

### Phase 7: Meta-Review Plan (Orchestrator + User)

**Input:** Plan review results + Cross-Review Report (if 2+ reviewers)

1. Count: N gaps → N addressed in review?
2. **Spot-check** (same scaling as Phase 4): verify highest-risk change(s)
3. If Cross-Review Report exists: resolve all Contested Findings
4. **Intent Comparison Protocol** — for each planned change:
   - Re-read Intent Anchor (list IA-1 through IA-N)
   - Write: `Change X → IA-N: ALIGNED/CONFLICTS — [reason]`
   - Any CONFLICTS → revise plan to preserve intent
5. Scope drift: plan grown beyond or shrunk below original intent?
6. **Self-enforcement Checklist** (same as Phase 4 — MUST complete before presenting to user)
7. Present summary + Intent Anchor comparison → get user approval before implementing

> **Compaction:** After completing Phase 7 meta-review, compress previous phases before proceeding. See [COMPACTION.md](COMPACTION.md).

### Phase 7.5: Alternative Proposal (Optional)

Only when genuinely better approach exists:

| Propose | Do NOT propose |
|---------|----------------|
| Better achieves the intent | Just "simpler" or "faster" |
| Can explain WHY | Gut feeling / pattern matching |
| Verifiable improvement | Skips steps to save time |
| Maintains all constraints | Ignores some requirements |

If accepted → return to Phase 5, full review cycle again.
**"Better" means better achieves intent, not faster to implement.**
