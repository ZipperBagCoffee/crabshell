# Regressing — ticket review and final verification checklist

- Optional independent review: use it when change risk, shared contracts, security, data loss or user-visible behavior call for it. Reviewer count never follows worker count.
  - **Independence Protocol:** A reviewer MUST NOT use worker conclusions as its observations. Give it the ticket's Acceptance Criteria and Verification sections, and ask for the same record the parent keeps: command or file read, output line, pass/fail per criterion. The parent records each finding and what it did about it.
  - **Reviewer prompt, when review is used, MUST include this record instruction:**
    ```
    For each acceptance criterion, record: the command you ran (or the file you read), its output line, and pass/fail.
    A behavior claim is backed by an execution result; a structure claim by what was read — say the check was static.
    Take observations only from your own tool output, never from the implementer's conclusions.
    If direct execution is impossible: state "Indirect: {method}" and why; a criterion you could not observe is "unverified".
    ```
- **Check run — once per cycle, after the cycle's last edit (BEFORE the parent's evaluation):** with several tickets in the cycle, the last one runs it. While editing, run only the test being written, by name through the runner (`node .crabshell/verification/run-verify.js <id>`), so its pass is kept. If `.crabshell/verification/manifest.json` exists, run `node .crabshell/verification/run-verify.js --changed` (or the project's equivalent) and include its result. With no manifest, `/verifying` creates one first. With no executable runtime, note that. Passes on unchanged inputs are reused, not rerun.
- Parent: final verification → append to the T document. MUST critically evaluate the implementation evidence and any optional review. Default posture: skepticism; "ALL PASS" needs more justification than "FAIL". A worker's or reviewer's claim is never the completion condition.
  - Correctness: Was it done correctly? Cite specific evidence: command output, observed behavior.
  - Coherence: Do this cycle's changes work together as a whole? Parts can each pass and still leave integration gaps. Verify that the parts form a coherent whole, not only that each passes.
    **Ways to check coherence (use the ones the change calls for):**
    - **Cross-file sync check:** When one concept appears in several files, grep all of them and confirm the wording and meaning agree.
    - **Reference integrity:** When file A refers to file B's content, confirm the target actually exists and matches.
    - **Integration test:** Run the changed code or hook and confirm that outputs from several changed files work together.
    - **Contradiction scan:** Explicitly check whether any two changes give contradictory instructions.
    - **Pipeline contradiction scan:** Check whether the change contradicts logic in related pipelines. Level 1: within the changed files. Level 2: in files that interact with the changed component (imports, callers, shared state). Level 3: against project rules and principles (CLAUDE.md, SKILL.md). A change that works locally but contradicts a related pipeline is not coherent.
    Name the method used. A one-line "Coherent" or "일관됨" with no method is not a check.
  - Improvement Opportunities: What gaps remain? What was tried and did not work well? The parent MUST list what was examined; "No improvements" names what was checked and why nothing applies.
  - **Evidence (BLOCKING — check BEFORE evaluating content):** every criterion has its record, the parent's and a worker's alike: the command run or file read, its output line, pass/fail. A behavior claim needs an execution result; a structure claim needs what was read. A runtime feature checked only by reading has no record yet. Observe a criterion without a record once (run it, or read its saved result) before it counts.
  - **Intent Fidelity (BLOCKING — the result against D):** Write each ticket's `## Intent Fidelity` table before the verdict. Add one row per D IA item and per cycle-plan decision the ticket touches: `| Discussion item (IA-n / Plan decision) | Result | Deviation (none/partial/departed) | Evidence | Reason / user approval |`. Compare the actual result (diff, command output, the changed documents) with what D and the cycle plan said, not only with the ticket's own ACs; a ticket can pass its ACs and still drift from D. A departed row without the user's approval keeps the ticket from `verified`: fix it, or ask the user under Rule 5's notify exception. Carry every partial or departed row into Next Direction and into the next cycle plan's Context. The Final Report lists the deviations that remain.
  - Next Direction (while verification finds gaps and cycle < cap; the final cycle uses the Final Report instead):
    - **Problems Found**: Specific problems or shortcomings in THIS cycle's output, with evidence.
    - **Root Cause Hypothesis**: Why did these problems occur?
    - **Recommended Focus**: What should the next cycle prioritize, and why?
    - A section that reads like a generic TODO list without this cycle's observations is INVALID; rewrite it with evidence.
