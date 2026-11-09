---
name: investigating
description: "Conducts multi-agent investigations using internet, local, and user-specified sources with cross-review and structured I-document output. Use when thorough investigation of a topic is needed with evidence from multiple sources. Invoke with /investigating \"topic\" to create, or /investigating I001 to update. Not for quick questions — use normal conversation instead."
---

# Investigation Document Skill

- **Create mode:** `/investigating "title"` creates a new investigation document.
- **Update mode:** `/investigating I001` appends findings to an existing one.

---

## Create Mode

Use this when the argument is a title, not an I-prefixed ID.

### Step 1: Ensure folder exists

Check `.crabshell/investigation/`.
- No folder: create it, and create `.crabshell/investigation/INDEX.md` with the content below.
- Folder without INDEX.md: create `.crabshell/investigation/backup/`, move all existing files into it, then create INDEX.md. Tell the user: "Moved N existing files to .crabshell/investigation/backup/"
- Folder with INDEX.md: go on.

INDEX.md content:
```
# Investigation Index

| ID | Title | Status | Created | Related |
|----|-------|--------|---------|---------|
```

### Step 2: Determine next ID

Glob `.crabshell/investigation/I*.md`. Next ID = highest number + 1, zero-padded to 3 digits. With no files, start at 001.

### Step 3: Constraints and parameters

1. Before asking for parameters, proactively present the constraints to the user. Read the `## Constraints` section of `.crabshell/project.md`. Infer task constraints from the topic, related D/P/I documents and the user's request. Show both:

```
Constraint Check:
- [Project] {each constraint from project.md}
- [Inferred] {constraints derived from task context}
Additional constraints? Silence = proceed.
```

   Write the confirmed constraints to the I document's `## Constraints` section. They bind every worker in this investigation.
2. Ask the user:
   - **Topic:** what is investigated, and why?
   - **Questions:** which specific questions need answers?
   - **Sources:** any specific URLs, files or codebases to include?
3. Before creating the document and launching workers, recommend execution parameters to the user once, as a compact table:

| Parameter | Recommendation | Rationale |
|-----------|---------------|-----------|
| Worker count | 0 (parent-led) for narrow topics; 2–5 for broad or contested topics | Delegate by risk (rule 5) |
| Specialist roles | _{distinct roles relevant to topic}_ | Each worker must have a unique expert view, e.g. "Forensic Auditor", "Systems Engineer" |
| Model tier | See project.md `## Model Routing` | T1 for analysis and judgment, T2 for mechanical searches |

   Then state: **"Silence = proceed with these parameters. Adjust any parameter before I continue."** If the user does not answer, proceed with them.

### Step 4: Create investigation document

Create `.crabshell/investigation/I{NNN}-{slug}.md`:

```
---
type: investigation
id: I{NNN}
title: "{title}"
status: open
created: {YYYY-MM-DD}
tags: []
---

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

### Step 5: Investigate

When rule 5 calls for workers, launch them in parallel, each on a different focus area or source type:
- **Worker 1, internet:** find URLs with the search tools the project configured, in the order the user or the project ranks them. Without any, use the host's built-in search. Search snippets are pointers only. Read every cited source's own text in full, with a text extractor or from the raw page. Never let a worker cite a search snippet or a tool's summary of a page as evidence.
- **Worker 2, local:** examine local files, code and configurations.
- **Worker N:** user-specified sources or other distinct angles, as needed.

When a worker returns, replace its `### Agent N` placeholder with its findings.

### Step 6: Cross-review

Cross-review by risk (rule 6). When you use reviewers:
- Give each reviewer only the Topic and Questions sections and the source type or focus area of the worker it checks. Never include that worker's findings.
- The reviewer investigates that focus area on its own first. Then the parent compares its findings with the worker's; each discrepancy is a finding.
- Assign each reviewer a different worker. Reviewers challenge each other's conclusions and name contradictions and blind spots.

Replace the `## Cross-Review` placeholder with the results.

### Step 7: Synthesis

The parent reads all findings and the cross-review, then fills:
- `## Synthesis`: the integrated conclusions.
- `## Conclusions`: each question answered on its own, with evidence and a confidence level, plus gaps and unknowns.

By the end of this step, replace every placeholder in the document with real content. The structured sections hold the full findings; the Log records the timeline. Fill both.

### Step 8: Update INDEX.md

Append a row to `.crabshell/investigation/INDEX.md`:

```
| [[I{NNN}-{slug}|I{NNN}]] | {title} | open | {YYYY-MM-DD} | |
```
`{slug}` is the kebab-case part of the document's file name. Glob `.crabshell/investigation/I{NNN}-*.md` and take the basename without `.md`.

### Step 9: Confirm

Tell the user: "Created I{NNN}. Investigation complete. See Conclusions for findings summary."

---

## Update Mode

Use this when the argument matches `I\d{3}`.

### Step 1: Read existing document

Glob `.crabshell/investigation/I{NNN}-*.md`. If none matches, stop.

### Step 2: Append log entry

Append to the end of the document:

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

If new findings warrant it, rerun Create Mode Steps 5-7 with updated focus areas. Append the new findings, cross-review and synthesis to the document.

### Step 4: Update INDEX.md if status changed

Update the status column in `.crabshell/investigation/INDEX.md`.

### Status Transitions

- `open` → `concluded` (all questions answered)
- `open` → `abandoned` (no longer relevant)

---

## Rules

1. Never modify existing content. During the investigation, you may replace template placeholders and update Synthesis and Conclusions; otherwise only append to the Log.
2. INDEX.md is the only file whose existing content may change (status updates).
3. When an investigation leads to a discussion or plan, log "→ See [[D{NNN}-{slug}|D{NNN}]]" or "→ See [[P{NNN}-{slug}|P{NNN}]]". Put the same wikilink in the INDEX.md Related column. Get `{slug}` by globbing `.crabshell/{discussion|plan}/{ID}-*.md` and taking the basename without `.md`. If the target document does not exist yet, use the bare ID for now: "→ See D{NNN}" or "→ See P{NNN}".
4. Write each result into its I-document section with the Edit tool before summarizing in chat. After each phase's document update, give the user a brief summary. The document is the primary output.
5. Delegation is risk-based, not mandatory. Use independent workers when source breadth, contested claims or context volume call for them. A parent-led investigation is valid for narrow topics. Worker count is never completion evidence.
6. Cross-review by risk. Use independent reviewers, without showing them the workers' findings, when conclusions are contested or high-impact. Otherwise the parent's own source check is enough. Record in the document which level you used and why.
7. Use at least 2 different source types, such as internet + local or internet + user-specified, unless the topic explicitly restricts sources.
8. After any work that touches or advances this investigation, append a Log entry in the existing format (`### [{YYYY-MM-DD HH:MM}] {entry_type}`). This applies even when this skill was not invoked.
9. I documents are independent. They take no part in the D → P → T hierarchy or status cascades and have no parent or child. Other documents may reference them.
10. Conciseness applies to chat style, not to verification. Evidence citations are required work product. Verify by observation: predict, execute, compare.
11. Whenever Conclusions change, they answer each Question individually, with evidence and a confidence level.
