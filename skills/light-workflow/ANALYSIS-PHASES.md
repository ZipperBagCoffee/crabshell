# Understand and Inspect

This reference expands stages 1-2 of [SKILL.md](SKILL.md). It does not define extra gates or mandatory agents.

## Understand internally

Create the eight-field task contract in the W document. Keep it internal unless the user must resolve a blocking unknown. Treat the latest user correction as authoritative and preserve unaffected earlier constraints.

A blocking unknown exists only when repository inspection cannot settle the choice and a wrong assumption would cause one of these outcomes:

- destructive or irreversible change;
- write outside the authorized workspace;
- external installation or external state mutation;
- materially different product behavior.

Ordinary library choice, file placement, naming, test method, and reversible implementation detail are inspection problems, not permission questions.

## Inspect

Read named references first and record which source input controls which observable behavior. Then inspect connected callers, tests, configuration, and repository conventions. Do not turn one example value into a permanent rule.

Use direct local tools for simple search and reading. Use a read-only worker only when the exploration is independently bounded or benefits from a distinct specialist view.

## Delegation handoff

The parent retains the full task contract. A worker receives only the relevant slice, but its prompt must still contain the original sentence, exact task/non-goal, authoritative references, read/write scope, expected observation, verification command, and claim/evidence/gap return.

The parent rejects a worker response that omits decisive evidence, exceeds scope, reinterprets the request, or reports completion without executing the named verification.
