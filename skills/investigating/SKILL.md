---
name: investigating
description: "Conducts multi-agent investigations using internet, local, and user-specified sources with cross-review and structured I-document output. Use when thorough investigation of a topic is needed with evidence from multiple sources. Invoke with /investigating \"topic\" to create, or /investigating I001 to update. Not for quick questions — use normal conversation instead."
---

# Investigation Document Skill

## Modes

- **Create mode:** `/investigating "title"` — creates a new investigation document
- **Update mode:** `/investigating I001` — appends findings to an existing investigation

---

## Create Mode

When argument is a title string (not an I-prefixed ID):

### Step 1: Ensure folder exists

Check if `.crabshell/investigation/` exists.

- **Folder does not exist:** Create it and create `.crabshell/investigation/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `.crabshell/investigation/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to .crabshell/investigation/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Investigation Index

| ID | Title | Status | Created | Related |
|----|-------|--------|---------|---------|
```

### Step 2: Determine next ID

Glob `.crabshell/investigation/I*.md`.
Extract numeric part. Next ID = max + 1, zero-padded to 3 digits.
If no files exist, start at 001.

### Step 3: Gather investigation parameters

Ask the user:
1. **Topic:** What is being investigated? Why?
2. **Questions:** What specific questions need answers?
3. **Sources:** Any specific sources to include? (URLs, files, codebases)

### Step 3.0: Constraint presentation

Before gathering parameters, **proactively present** constraints to the user:

1. **Read** `.crabshell/project.md` — extract the `## Constraints` section
2. **Infer** task-specific constraints from context (topic, related D/P/I documents, user's request)
3. **Present** both to the user:

```
Constraint Check:
- [Project] {each constraint from project.md}
- [Inferred] {constraints derived from task context}
Additional constraints? Silence = proceed.
```

4. Confirmed constraints are written to the `## Constraints` section of the I document
5. All confirmed constraints are binding for every agent in this investigation

### Step 3.5: Parameter Recommendation

Before creating the investigation document and launching agents, recommend execution parameters to the user. Present as a compact table:

| Parameter | Recommendation | Rationale |
|-----------|---------------|-----------|
| Agent count | 3–5 | Based on topic scope; more perspectives = better coverage |
| Specialist roles | _{distinct roles relevant to topic}_ | e.g., "Forensic Auditor", "Cognitive Scientist", "Systems Engineer" — each agent must have a unique expert perspective |
| Model tier | See project.md `## Model Routing` | T1 for analysis/judgment, T2 for mechanical searches. Project-level routing applies. |

After presenting the table, state: **"Silence = proceed with these parameters. Adjust any parameter before I continue."**

This recommendation happens once per investigation creation. If the user does not respond, proceed with the recommended parameters.

### Step 4: Create investigation document

Create `.crabshell/investigation/I{NNN}-{slug}.md`:

```
# I{NNN} - {title}

## Topic
{what is being investigated and why}

## Constraints
- [Project] {constraints from project.md}
- [Inferred] {constraints from task context}
- [User] {additional constraints from user, if any}

## Questions
1. {question 1}
2. {question 2}
...

## Sources
- Internet: {URLs searched/found}
- Local: {files/code examined}
- User-specified: {if any}

## Investigation Log

### Agent 1: {focus area}
{findings}

### Agent 2: {focus area}
{findings}

## Cross-Review
{Review Agents challenge each other's findings}

## Synthesis (Orchestrator)
{integrated conclusions from all agents}

## Conclusions
- Key findings: ...
- Confidence level: ...
- Gaps/unknowns: ...

## Log

---
### [{YYYY-MM-DD HH:MM}] Investigation started
{methodology, initial sources, approach}
```

### Step 5: Execute multi-agent investigation

Launch parallel Work Agents, each assigned a different focus area or source type:

- **Work Agent 1:** Internet research (WebSearch/WebFetch) — search for relevant information online
- **Work Agent 2:** Local investigation — examine local files, code, configurations
- **Work Agent N:** Additional agents as needed for user-specified sources or distinct angles

**After each Agent returns findings, the Orchestrator MUST use the Edit tool to replace the placeholder text in that agent's section with the actual findings.** Do NOT leave "(findings appended after execution)" in the document.
- **Document-first rule:** Write agent findings to the corresponding `### Agent N` section in the I document FIRST using the Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.

### Step 6: Cross-review

Launch Review Agents (paired with Work Agents per CLAUDE.md rules):

- **Independence Protocol (MANDATORY):** Each Review Agent prompt MUST NOT include the Work Agent's findings it is reviewing. Provide only: (1) the investigation's Topic and Questions sections, (2) the source type/focus area assigned to the Work Agent. The Review Agent independently investigates the same focus area first. After Review Agent completes, the Orchestrator cross-references RA findings against WA findings — discrepancies are findings.
- Each Review Agent reviews findings from a different Work Agent
- Review Agents challenge each other's conclusions, identify contradictions and blind spots

**After cross-review completes, the Orchestrator MUST use the Edit tool to replace the Cross-Review section placeholder with the actual cross-review results.**
- **Document-first rule:** Write cross-review results to the `## Cross-Review` section in the I document FIRST using the Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.

### Step 7: Orchestrator synthesis

The Orchestrator:
1. Reads all agent findings and the cross-review
2. Synthesizes integrated conclusions
3. **Uses the Edit tool to replace the Synthesis section placeholder with integrated conclusions**
4. **Uses the Edit tool to replace the Conclusions section placeholder with: each Question answered individually, confidence level, and gaps/unknowns**
5. Assesses confidence level and identifies gaps

**DOCUMENT UPDATE RULE:** By the end of Step 7, every placeholder in the I document ("findings appended after execution", "appended after agent execution", "appended after synthesis") MUST be replaced with actual content. The Log section records timeline events; the structured sections above it contain the full findings. Both must be populated.
- **Document-first rule:** Write synthesis and conclusions to the `## Synthesis` and `## Conclusions` sections in the I document FIRST using the Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.

### Step 8: Update INDEX.md

Append row to `.crabshell/investigation/INDEX.md`:

```
| I{NNN} | {title} | open | {YYYY-MM-DD} | |
```

### Step 9: Confirm

Tell user: "Created I{NNN}. Investigation complete. See Conclusions for findings summary."

---

## Update Mode

When argument matches `I\d{3}` pattern:

### Step 1: Read existing document

Glob `.crabshell/investigation/I{NNN}-*.md`. If not found, stop.

### Step 2: Append log entry

Append to end of document:

```

---
### [{YYYY-MM-DD HH:MM}] {entry_type}
{content}
```

Entry types:
- `New findings` — additional findings, data, analysis results
- `Conclusion update` — revised conclusions with new evidence
- `Status change: {old} → {new}`

### Step 3: Re-run investigation if needed

If new findings warrant it, re-run the multi-agent investigation (Steps 5-7 from Create Mode) with updated focus areas. Append new agent findings, cross-review, and synthesis to the document.

### Step 4: Update INDEX.md if status changed

Update status column in `.crabshell/investigation/INDEX.md`.

### Status Transitions

- `open` → `concluded` (all questions answered)
- `open` → `abandoned` (no longer relevant)

---

## Rules

1. **NEVER modify existing content.** Only append to Log section and update Conclusions/Synthesis during investigation.
2. **Conclusion section** must answer each Question from the Questions section individually, with evidence and confidence assessment.
3. **INDEX.md** is the only file where existing content may be modified (status updates).
4. When investigation leads to a discussion or plan, note in log: "→ See D{NNN}" or "→ See P{NNN}" and update INDEX.md Related column.
5. **Multi-agent is mandatory for Create mode.** At minimum 2 Work Agents with different focus areas. Single-agent investigation defeats the purpose.
6. **Cross-review is mandatory.** Review Agents must challenge findings before Orchestrator synthesis. No synthesis without cross-review.
7. **Source diversity.** Investigation must use at least 2 different source types (internet + local, internet + user-specified, etc.) unless the topic explicitly restricts sources.
8. **Mandatory work log:** After performing any work related to this document, append a log entry to the Log section using the existing format (`### [{YYYY-MM-DD HH:MM}] {entry_type}`). This applies regardless of whether this skill was explicitly invoked — if the work touched or advanced this investigation's purpose, log it.
9. **I documents are independent.** They do not participate in D → P → T hierarchy or status cascades. They may be referenced by other documents but have no parent/child relationships.
10. **Scope Note (from project RULES):** Conciseness applies to communication style, not to verification steps. Evidence citations are required work product, not verbose output. In this project, verification means closing the gap between belief and reality through observation (Predict → Execute → Compare).
