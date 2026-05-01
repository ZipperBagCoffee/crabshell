---
name: light-workflow
description: Create and maintain a lightweight Crabshell W worklog for a standalone Codex task. Use when the user asks for light workflow or wants traceable one-shot work.
---

# Light Workflow

Create a W document before implementation:

```bash
node scripts/codex-docs.js worklog "task title" --scope="Files: ~N. Components: X. Cross-cutting: no."
```

Then implement the task. Before final response, update the W document so these sections are concrete:

- Problem
- Approach
- Files Changed
- Verification
- Experiment Log
- User Testing Needed
- Result

Update `.crabshell/worklog/INDEX.md` from `in-progress` to `done` when complete.
