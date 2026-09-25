# Regressing — ticket review and final verification checklist

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

- Optional independent review: use when change risk, shared contracts, security, data loss, or user-visible behavior warrants it. Reviewer count never follows worker count.
  - **Independence Protocol:** A reviewer MUST NOT use worker conclusions as its observation source. Provide the ticket acceptance/verification contract and the P/O/G template; the parent later cross-references findings against implementation evidence.
  - **Reviewer prompt, when review is used, MUST include this verification context and output template:**
    ```
    Verification = closing the gap between belief and reality through observation.
    Fill Prediction BEFORE looking at the code. Fill Observation ONLY from tool output.
    The Gap column is where real findings live — if Gap is always "none", you are confirming, not verifying.

    For each verification item, provide ALL fields:
    | Item | Type | Prediction (before observation) | Observation (tool output required) | Gap |
    |------|------|-------------------------------|-----------------------------------|-----|

    Type: `behavioral` = runtime execution observed (ran command, triggered feature, checked output)
    Type: `structural` = static check (grep, file read, code inspection)

    Rules:
    - Observation MUST include tool output (Bash execution, Read result, diff, etc.)
    - If Prediction and Observation are identical text → INVALID (no actual observation occurred)
    - If direct execution is impossible: state "Indirect: {method}" + why direct is impossible
    - Empty Observation or Gap fields → entire verification is INVALID
    ```
- **Verification Tool Check (BEFORE Orchestrator evaluation):**
  1. Check if `.crabshell/verification/manifest.json` exists
  2. If YES → `/verifying run` and include results in evaluation
  3. If NO → `/verifying` to create manifest, then `/verifying run`
  4. No executable runtime → skip with note
- Parent: final verification → append to T document. MUST critically evaluate implementation evidence and any optional review. Default posture: skepticism — "ALL PASS" requires more justification than "FAIL". A worker/reviewer claim is never the completion condition.
  - Correctness: Was it done correctly? Cite specific evidence (command output, observed behavior).
  - Coherence: Do the changes from this cycle work together as a whole? Individual items may each pass, but combined output may have integration gaps. Verify that parts form a coherent whole, not just that each passes individually.
    **Coherence verification methods (minimum 2 of the following):**
    - **Cross-file sync check:** When the same concept appears in multiple files, grep for the concept in all locations and confirm consistent wording/semantics.
    - **Reference integrity:** When file A references file B's content, verify the reference target actually exists and matches.
    - **Integration test:** Run the changed code/hook and verify that outputs from multiple changed files interact correctly.
    - **Contradiction scan:** Explicitly check whether any two changes give contradictory instructions.
    - **Pipeline contradiction scan:** Check whether this change contradicts logic in related pipelines. Level 1: within the changed files. Level 2: in files that interact with the changed component (imports, callers, shared state). Level 3: against project rules/philosophy (CLAUDE.md, SKILL.md principles). A change that works locally but contradicts a related pipeline is not coherent.
    "Coherent" or "일관됨" as a one-line verdict without executing any of the above methods is INVALID.
  - Improvement Opportunities: What gaps remain? What was attempted but didn't work well? (Orchestrator MUST enumerate what was examined. "No improvements" requires detailed justification of what was checked and why no improvements apply — minimum 3 sentences referencing specific aspects.)
  - **Evidence Gate (BLOCKING — check BEFORE evaluating content):**
    Agents can generate text that looks like verification without actual observation. Apply this gate to parent and delegated evidence alike.
    □ Does each verification item have Prediction, Observation, AND Gap fields?
    □ Does Observation contain tool output evidence? (for directly-executable items)
    □ Is Prediction ≠ Observation? (copy detection)
    □ For indirect verification: is the reason stated?
    □ Does at least 1 verification item have Type = behavioral? (structural-only = insufficient for runtime features)
    → If ANY check fails: reject that evidence and re-run the observation.
  - **Independent Evidence Cross-Reference (when delegation/review was used):**
    Compare independent findings against implementation evidence.
    1. Read the independent P/O/G findings
    2. Read the execution results and direct tool output
    3. Identify discrepancies — items where independent observation found problems implementation evidence did not report, or where implementation claimed success but direct observation found issues
    4. Discrepancies are the highest-priority findings and must be addressed in Correctness evaluation
  - **Intent Fidelity (BLOCKING — the result against D):** Write each ticket's `## Intent Fidelity` table before the verdict: one row per D IA item and per cycle-plan decision the ticket touches — `| Discussion item (IA-n / Plan decision) | Result | Deviation (none/partial/departed) | Evidence | Reason / user approval |`. Compare the actual result (diff, command output, the changed documents) with what D and the cycle plan said, not with the ticket's own ACs alone: a ticket can pass its ACs and still drift from D. A departed row without the user's approval keeps the ticket from `verified` (fix it, or ask the user under Rule 5's notify exception). Every partial or departed row is carried into Next Direction and into the next cycle plan's Context; the Final Report lists the deviations that remain.
  - Next Direction (while verification finds gaps and cycle < cap; final cycle uses Final Report instead):
    - **Problems Found**: Specific problems or shortcomings observed in THIS cycle's output, with evidence.
    - **Root Cause Hypothesis**: Why did these problems occur?
    - **Recommended Focus**: What should the next cycle prioritize and why?
    - (If this section reads like a generic TODO list without referencing specific observations from this cycle, it is INVALID — rewrite with evidence.)
