# Regressing — session start: Step 2 state file, Step 2.5 parameters, Step 2.6 goal-mode handoff

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

### Step 2: the regressing state file

After creating the Discussion document, write the regressing state file:
- Path: `.crabshell/memory/regressing-state.json`
- Content: `{ "active": true, "discussion": "{D-ID}", "cycle": 1, "totalCycles": {N}, "userSpecifiedN": {true|false}, "phase": "planning", "planId": null, "ticketIds": [], "sessionId": "{session id or null}", "startedAt": "{ISO}", "lastUpdatedAt": "{ISO}" }` — `sessionId` records the owning host session, so only that session is asked to continue the workflow (other sessions in the same project are not).
- Use Bash tool: `"{NODE_PATH}" -e "require('fs').writeFileSync('{PROJECT_DIR}/.crabshell/memory/regressing-state.json', JSON.stringify({active:true, discussion:'{D-ID}', cycle:1, totalCycles:{N}, userSpecifiedN:{true|false}, phase:'planning', planId:null, ticketIds:[], sessionId:process.env.CLAUDE_CODE_SESSION_ID||null, startedAt:new Date().toISOString(), lastUpdatedAt:new Date().toISOString()}, null, 2))"`

### Step 2.5: Parameter Recommendation

Before starting execution, recommend session parameters to the user. This happens ONCE at session start — recommended parameters apply to ALL cycles.

**Recommend the following:**

| Parameter | How to determine | Default |
|-----------|-----------------|---------|
| **Cycle cap** | From user invocation. Bare number after topic = cap. | 10 |
| **Agent count** | Based on topic complexity. 2–3 for focused tasks, 3–5 for broad/complex tasks. | 3 |
| **Specialist roles** | Each agent gets a distinct expert perspective relevant to the topic (e.g., "Security Auditor", "Performance Engineer", "API Design Specialist"). Roles must be non-overlapping and topic-relevant. | — |
| **Model tier** | See project.md `## Model Routing` | T1 for planning, T2 for execution/verification. Project-level routing applies. |

**Present to user as a compact recommendation block:**

```
📋 Parameter Recommendation
- Cycle cap: {N}
- Agents: {count} — {Role1}, {Role2}, ...
- Models: See project.md Model Routing (T1 → T2 per task type)
Silence = proceed. Adjust any parameter by responding.
```

**Inline parameter detection:** If the user's invocation includes a bare number after the topic, it is the cycle cap (not agent count). Numbers with "명" or "agents" suffix indicate agent count. Example: `/regressing "topic" 5` → cap=5. `/regressing "topic" 3명` → agents=3, cap=10.

**User interaction:** Silence = proceed with recommended parameters. User may adjust any parameter before execution begins.

### Step 2.6: Goal-Mode Handoff (host continuation)

Session continuation is goal-driven, not hook-forced. The host's goal mode (Claude Code 2.1.139+ `/goal`, Codex CLI 0.128.0+ `/goal`) keeps the session working until the host's evaluator confirms the Discussion is concluded. The old unconditional Stop-hook block (`regressing-loop-guard.js`) was removed; `completion-controller.js` still enforces bounded continuation on execution-authorized turns.

Immediately after Step 2.5, print this ready-to-paste line for the user (fill in the real D-ID, file name, and cap):

```
/goal Crabshell regressing {D-ID}: every item under "## Convergence Criteria" in .crabshell/discussion/{D-file}.md is met and its frontmatter status is "concluded", or the D Final Report records the cycle cap {N} as reached. Judge only by reading that document.
```

- Starting goal mode is the user's choice; the skill cannot start it. If the user does not start it, cycles still continue autonomously per Rule 5.
- The goal condition MUST point at the D document only — the evaluator judges by reading it, so cycle results must land in the D/T documents (document-first) for the evaluator to see progress.
