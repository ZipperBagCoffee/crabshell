# Regressing — ticket review and final verification checklist

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

- Optional independent review: use when change risk, shared contracts, security, data loss, or user-visible behavior warrants it. Reviewer count never follows worker count.
  - **Independence Protocol:** A reviewer MUST NOT use worker conclusions as its observation source. Provide the ticket Acceptance Criteria and Verification sections and ask for the same record the parent keeps (command or file read, output line, pass/fail per criterion); the parent records each finding and what it did about it.
  - **Reviewer prompt, when review is used, MUST include this record instruction:**
    ```
    For each acceptance criterion, record: the command you ran (or the file you read), its output line, and pass/fail.
    A behavior claim is backed by an execution result; a structure claim by what was read — say the check was static.
    Take observations only from your own tool output, never from the implementer's conclusions.
    If direct execution is impossible: state "Indirect: {method}" and why; a criterion you could not observe is "unverified".
    ```
- **Check run — once per cycle, after the cycle's last edit (BEFORE Orchestrator evaluation):** with several tickets in the cycle, the last one runs it; while editing, run only the test being written, by name through the runner (`node .crabshell/verification/run-verify.js <id>`), so its pass is kept. If `.crabshell/verification/manifest.json` exists, run `node .crabshell/verification/run-verify.js --changed` (or the project's equivalent) and include its result; with no manifest, `/verifying` creates one first; no executable runtime → note it. Passes on unchanged inputs are reused, not rerun.
- Parent: final verification → append to T document. MUST critically evaluate implementation evidence and any optional review. Default posture: skepticism — "ALL PASS" requires more justification than "FAIL". A worker/reviewer claim is never the completion condition.
  - Correctness: Was it done correctly? Cite specific evidence (command output, observed behavior).
  - Coherence: Do the changes from this cycle work together as a whole? Individual items may each pass, but combined output may have integration gaps. Verify that parts form a coherent whole, not just that each passes individually.
    **Ways to check coherence (use the ones the change calls for):**
    - **Cross-file sync check:** When the same concept appears in multiple files, grep for the concept in all locations and confirm consistent wording/semantics.
    - **Reference integrity:** When file A references file B's content, verify the reference target actually exists and matches.
    - **Integration test:** Run the changed code/hook and verify that outputs from multiple changed files interact correctly.
    - **Contradiction scan:** Explicitly check whether any two changes give contradictory instructions.
    - **Pipeline contradiction scan:** Check whether this change contradicts logic in related pipelines. Level 1: within the changed files. Level 2: in files that interact with the changed component (imports, callers, shared state). Level 3: against project rules/philosophy (CLAUDE.md, SKILL.md principles). A change that works locally but contradicts a related pipeline is not coherent.
    Name the method used; "Coherent" or "일관됨" as a one-line verdict with no method is not a check.
  - Improvement Opportunities: What gaps remain? What was attempted but didn't work well? (Orchestrator MUST enumerate what was examined; "No improvements" names what was checked and why nothing applies.)
  - **Evidence (BLOCKING — check BEFORE evaluating content):** each criterion has its record — the command run or file read, its output line, pass/fail — the parent's and a worker's alike. A behavior claim is backed by an execution result, a structure claim by what was read; a runtime feature checked only by reading has no record yet. A criterion without one (verification claimed but not performed) is observed once — run it, or read its saved result — before it counts.
  - **Intent Fidelity (BLOCKING — the result against D):** Write each ticket's `## Intent Fidelity` table before the verdict: one row per D IA item and per cycle-plan decision the ticket touches — `| Discussion item (IA-n / Plan decision) | Result | Deviation (none/partial/departed) | Evidence | Reason / user approval |`. Compare the actual result (diff, command output, the changed documents) with what D and the cycle plan said, not with the ticket's own ACs alone: a ticket can pass its ACs and still drift from D. A departed row without the user's approval keeps the ticket from `verified` (fix it, or ask the user under Rule 5's notify exception). Every partial or departed row is carried into Next Direction and into the next cycle plan's Context; the Final Report lists the deviations that remain.
  - Next Direction (while verification finds gaps and cycle < cap; final cycle uses Final Report instead):
    - **Problems Found**: Specific problems or shortcomings observed in THIS cycle's output, with evidence.
    - **Root Cause Hypothesis**: Why did these problems occur?
    - **Recommended Focus**: What should the next cycle prioritize and why?
    - (If this section reads like a generic TODO list without referencing specific observations from this cycle, it is INVALID — rewrite with evidence.)
