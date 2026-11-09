# Regressing — session start: Step 2 state file, Step 2.5 parameters, Step 2.6 goal-mode handoff

### Step 2: the regressing state file

After creating the Discussion document, write the regressing state file:
- Path: `.crabshell/memory/regressing-state.json`
- Content: `{ "active": true, "discussion": "{D-ID}", "cycle": 1, "totalCycles": {N}, "userSpecifiedN": {true|false}, "phase": "planning", "planId": null, "ticketIds": [], "sessionId": "{session id or null}", "startedAt": "{ISO}", "lastUpdatedAt": "{ISO}" }`. `sessionId` records the owning host session, so only that session is asked to continue the workflow.
- Use the Bash tool: `"{NODE_PATH}" -e "require('fs').writeFileSync('{PROJECT_DIR}/.crabshell/memory/regressing-state.json', JSON.stringify({active:true, discussion:'{D-ID}', cycle:1, totalCycles:{N}, userSpecifiedN:{true|false}, phase:'planning', planId:null, ticketIds:[], sessionId:process.env.CLAUDE_CODE_SESSION_ID||null, startedAt:new Date().toISOString(), lastUpdatedAt:new Date().toISOString()}, null, 2))"`

### Step 2.5: Parameter Recommendation

Recommend session parameters once, at session start, before execution. They apply to ALL cycles.

| Parameter | How to determine | Default |
|-----------|-----------------|---------|
| **Cycle cap** | From the invocation: a bare number after the topic is the cap. | 10 |
| **Agent count** | From topic complexity: 2–3 for focused tasks, 3–5 for broad or complex tasks. | 3 |
| **Specialist roles** | Give each worker a distinct expert perspective relevant to the topic (e.g., "Security Auditor", "Performance Engineer", "API Design Specialist"). Roles must not overlap. | — |
| **Model tier** | See project.md `## Model Routing` | T1 for planning, T2 for execution/verification. Project-level routing applies. |

Present it as a compact recommendation block:

```
📋 Parameter Recommendation
- Cycle cap: {N}
- Agents: {count} — {Role1}, {Role2}, ...
- Models: See project.md Model Routing (T1 → T2 per task type)
Silence = proceed. Adjust any parameter by responding.
```

**Inline parameter detection:** A bare number after the topic is the cycle cap, not the agent count. A number given as a count of agents, in any language, is the agent count. Example: `/regressing "topic" 5` → cap=5. `/regressing "topic" 3명` → agents=3, cap=10.

Silence means proceed with the recommended parameters. The user may change any parameter before execution begins.

### Step 2.6: Goal-Mode Handoff (host continuation)

On a host with a `/goal` command, goal mode keeps the session working until its evaluator confirms the Discussion is concluded. No hook forces continuation; `completion-controller.js` still enforces bounded continuation on execution-authorized turns.

Right after Step 2.5, print this ready-to-paste line for the user. Fill in the real D-ID, file name and cap:

```
/goal Crabshell regressing {D-ID}: every item under "## Convergence Criteria" in .crabshell/discussion/{D-file}.md is met and its frontmatter status is "concluded", or the D Final Report records the cycle cap {N} as reached. Judge only by reading that document.
```

- Starting goal mode is the user's choice; the skill cannot start it. Without it, cycles still continue autonomously per Rule 5.
- The goal condition MUST point at the D document only. The evaluator judges by reading it, so cycle results must land in the D and T documents (document-first) for the evaluator to see progress.
