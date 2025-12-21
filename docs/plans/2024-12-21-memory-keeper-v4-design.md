# Memory Keeper v4 Design

## Core Requirements (User Specified)

1. **Trigger**: Counter-based (every N tool uses, default: 5)
2. **Save Method**: Background agent generates summary → Main Claude saves
3. **Save Content**:
   - Summary (compressed)
   - Original conversation (raw backup)
4. **Storage Structure**:
   - memory.md (rolling summary - loaded at session start)
   - facts.json (decisions/patterns/issues - searchable)
   - sessions/ (tiered storage)
5. **Tiered Compression**:
   - 0-7 days: Individual session files
   - 7-30 days: Weekly summaries
   - 30+ days: Monthly archives
6. **Load**: Only memory.md at session start
7. **Project Isolation**: Completely separated per project

---

## Architecture

### Storage Structure

```
~/.claude/memory-keeper/
├── config.json                         # Global settings
└── projects/
    └── [project-name]/
        ├── memory.md                   # Rolling summary (loaded at start)
        ├── facts.json                  # Structured knowledge (searchable)
        ├── counter.txt                 # Current counter
        └── sessions/
            ├── YYYY-MM-DD_HHMM.md      # Session summary
            ├── YYYY-MM-DD_HHMM.raw.md  # Raw conversation backup
            ├── week-NN.md              # Weekly summaries (7-30 days)
            └── archive/
                └── YYYY-MM.md          # Monthly archives (30+ days)
```

### Data Formats

**memory.md** (Rolling Summary):
```markdown
# Project Memory: [project-name]

## Core Decisions
- [permanent decisions with rationale]

## Current State
- Version: X.X.X
- Status: [current status]
- Last updated: [timestamp]

## Recent Context
- [YYYY-MM-DD]: [session summary]
- [YYYY-MM-DD]: [session summary]
- [YYYY-MM-DD]: [session summary]

## Known Issues
- [active issues]
```

**facts.json** (Searchable Knowledge):
```json
{
  "decisions": [
    {
      "id": "d001",
      "date": "YYYY-MM-DD",
      "content": "decision made",
      "reason": "why this decision",
      "session": "YYYY-MM-DD_HHMM"
    }
  ],
  "patterns": [
    {
      "id": "p001",
      "date": "YYYY-MM-DD",
      "content": "pattern discovered"
    }
  ],
  "issues": [
    {
      "id": "i001",
      "date": "YYYY-MM-DD",
      "content": "issue description",
      "status": "open|resolved",
      "resolution": "how resolved"
    }
  ]
}
```

**Session Files**:
- `YYYY-MM-DD_HHMM.md`: Compressed summary (~500 tokens)
- `YYYY-MM-DD_HHMM.raw.md`: Full conversation backup

---

## Flow

### PostToolUse Hook Flow

```
[Tool Used]
    │
    ▼
[counter.js check]
    │
    ├─ Counter < N → No output
    │
    └─ Counter >= N → Output JSON with additionalContext
                          │
                          ▼
                 [Main Claude receives message]
                          │
                          ▼
                 [Spawn background agent with Task tool]
                 [Agent prompt: "Summarize this session..."]
                          │
                          ▼
                 [Agent returns summary + extracted facts]
                          │
                          ▼
                 [Main Claude saves]:
                   1. Update memory.md
                   2. Append to facts.json
                   3. Save session summary to sessions/
                   4. Save raw backup to sessions/
                   5. Reset counter
```

### Stop Hook Flow

```
[Session Ending]
    │
    ▼
[counter.js final]
    │
    ▼
[Output JSON with additionalContext]
    │
    ▼
[Main Claude]:
  1. Spawn background agent for final summary
  2. Save all files
  3. Run tier compression
```

### SessionStart Hook Flow

```
[Session Starting]
    │
    ▼
[load-memory.js]
    │
    ▼
[Read memory.md and output to context]
```

---

## Hook Output Format

**PostToolUse (counter >= threshold)**:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "[MEMORY_KEEPER_SAVE] N tool uses reached.\n\n1. Spawn background agent (Task tool, subagent_type: general-purpose)\n   Prompt: 'Summarize this session. Return JSON: {summary: string, decisions: [], patterns: [], issues: []}'\n2. Wait for agent result\n3. Save to:\n   - memory.md: Update with summary\n   - facts.json: Append decisions/patterns/issues\n   - sessions/[timestamp].md: Session summary\n   - sessions/[timestamp].raw.md: Raw conversation\n4. Reset counter: node [script] reset"
  }
}
```

---

## Tier Compression

**Weekly (7+ days old)**:
- Combine 7 daily summaries into one weekly summary
- Delete individual files, keep week-NN.md

**Monthly (30+ days old)**:
- Combine 4 weekly summaries into one monthly archive
- Move to archive/YYYY-MM.md

---

## Implementation Checklist

1. [ ] Update counter.js check() - proper JSON output with background agent instructions
2. [ ] Update counter.js final() - final save with tier compression
3. [ ] Create save-session.js - helper for saving session files
4. [ ] Create compress-tiers.js - tier compression logic
5. [ ] Update agents/memory-keeper.md - background agent definition
6. [ ] Update load-memory.js if needed
7. [ ] Test full flow
8. [ ] Update documentation
