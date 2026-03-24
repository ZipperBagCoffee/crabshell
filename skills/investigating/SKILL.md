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

Check if `docs/investigation/` exists.

- **Folder does not exist:** Create it and create `docs/investigation/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `docs/investigation/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to docs/investigation/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Investigation Index

| ID | Title | Status | Created | Related |
|----|-------|--------|---------|---------|
```

### Step 2: Determine next ID

Glob `docs/investigation/I*.md`.
Extract numeric part. Next ID = max + 1, zero-padded to 3 digits.
If no files exist, start at 001.

### Step 3: Gather investigation parameters

Ask the user:
1. **Topic:** What is being investigated? Why?
2. **Questions:** What specific questions need answers?
3. **Sources:** Any specific sources to include? (URLs, files, codebases)

### Step 4: Create investigation document

Create `docs/investigation/I{NNN}-{slug}.md`:

```
# I{NNN} - {title}

## Topic
{what is being investigated and why}

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

Each Work Agent appends findings to their designated section in the I document.

### Step 6: Cross-review

Launch Review Agents (paired with Work Agents per CLAUDE.md rules):

- Each Review Agent reviews findings from a different Work Agent
- Review Agents challenge each other's conclusions, identify contradictions and blind spots
- Cross-Review section is populated with contested findings, consensus, and blind spots

### Step 7: Orchestrator synthesis

The Orchestrator:
1. Reads all agent findings and the cross-review
2. Synthesizes integrated conclusions
3. Populates the Synthesis and Conclusions sections
4. Assesses confidence level and identifies gaps

### Step 8: Update INDEX.md

Append row to `docs/investigation/INDEX.md`:

```
| I{NNN} | {title} | open | {YYYY-MM-DD} | |
```

### Step 9: Confirm

Tell user: "Created I{NNN}. Investigation complete. See Conclusions for findings summary."

---

## Update Mode

When argument matches `I\d{3}` pattern:

### Step 1: Read existing document

Glob `docs/investigation/I{NNN}-*.md`. If not found, stop.

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

Update status column in `docs/investigation/INDEX.md`.

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
