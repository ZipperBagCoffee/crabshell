# Memory Keeper Architecture (v12.3)

## Overview

Memory Keeper uses a 4-layer hierarchical memory system with **blocking enforcement** to ensure L2/L3/L4 are completed before session end.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code CLI                          │
├─────────────────────────────────────────────────────────────────┤
│  Hooks                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ SessionStart │  │ PostToolUse  │  │    Stop      │          │
│  │ load-memory  │  │   counter    │  │  BLOCKING    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Blocking Logic (v12.2)                                        │
│                                                                │
│  Stop hook checks:                                             │
│  ✓/✗ L2 - .l2.json exists for today?                          │
│  ✓/✗ L3 - concepts.json modified today?                       │
│  ✓/✗ L4 - .l4-done marker exists?                             │
│  ✓/✗ mem - memory.md updated today?                           │
│                                                                │
│  ALL ✓ → decision:approve (stop allowed)                      │
│  ANY ✗ → decision:block (must complete first)                 │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  4-Layer Hierarchical Memory                                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │   L1    │  │   L2    │  │   L3    │  │   L4    │           │
│  │ Refined │→ │ Facts   │→ │Concepts │→ │Permanent│           │
│  │*.l1.jsonl│  │*.l2.json│  │concepts │  │facts.json│          │
│  │         │  │ ProMem  │  │  LiSA   │  │Reflection│          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Memory Layers

### L1: Refined Transcripts
- **Input**: Raw JSONL from Claude Code
- **Output**: `*.l1.jsonl` (95% size reduction)
- **Algorithm**: Removes metadata, keeps user/assistant text + tool summaries

### L2: Verified Facts (ProMem)
Based on arxiv:2601.04463 (73%+ memory integrity)

```
Step 1: Extract    → Identify facts from session (via haiku)
Step 2: Verify     → Cross-check with context
Step 3: Save       → Max 10 facts per session
```

**Triggered by**: Task tool with `model: "haiku"`, `subagent_type: "memory-keeper:l2-summarizer"`

### L3: Concept Groups (LiSA)
Based on ACL 2025 LiSA semantic assignment

- Claude assigns `conceptId` (existing) or `conceptName` (new)
- 70% similarity threshold
- No keyword overlap calculation

**Triggered by**: `node scripts/counter.js update-concepts <l2-file>`

### L4: Permanent Memory (Reflection)

```
Step 1: Detect patterns    → 3+ occurrences across L2 files
Step 2: Verify relevance   → Is this generalizable?
Step 3: Promote to L4      → Add to facts.json.permanent
Step 4: Cleanup            → Remove old/contradicted rules
```

**Triggered by**: `node scripts/counter.js compress`

## Hook Flow

### SessionStart
```
load-memory.js
    │
    ├── Read memory.md
    ├── Read facts.json (L4 permanent)
    └── Output to Claude context
```

### PostToolUse (every tool use)
```
counter.js check()
    │
    ├── cleanupTmpFiles()
    ├── counter++
    └── if counter >= 5:
        └── Output L2 spawn instructions
```

### Stop (session end) - BLOCKING
```
counter.js final()
    │
    ├── Create L1 from transcript
    │
    ├── Check completion status:
    │   ├── L2: .l2.json exists today?
    │   ├── L3: concepts.json modified today?
    │   ├── L4: .l4-done marker exists?
    │   └── mem: memory.md has today's date?
    │
    ├── ALL complete → decision:approve
    └── ANY missing  → decision:block + STEP instructions
```

## Agents

Located in `agents/` folder:

| Agent | Purpose |
|-------|---------|
| `l2-summarizer.md` | ProMem fact extraction (haiku) |
| `memory-keeper.md` | Background session analysis |
| `context-loader.md` | Load relevant context |

**Note**: Agents are spawned via Task tool, not automatically. Blocking enforcement ensures they get called.

## Data Structures

### facts.json
```json
{
  "_meta": { "counter": 0, "version": 3 },
  "decisions": [],
  "patterns": [],
  "issues": [],
  "permanent": {
    "rules": [],
    "solutions": [],
    "core_logic": []
  }
}
```

### concepts.json
```json
{
  "concepts": [
    {
      "id": "c001",
      "name": "concept-name",
      "summary": "description",
      "files": [],
      "keywords": [],
      "exchanges": []
    }
  ],
  "nextId": 2
}
```

## Key Scripts

| Script | Purpose |
|--------|---------|
| `counter.js` | Hook handler, CLI commands, blocking logic |
| `load-memory.js` | SessionStart hook |
| `refine-raw.js` | L1 refinement |
| `save-l2.js` | L2 fact storage |
| `update-concepts.js` | L3 concept grouping |
| `auto-compress.js` | L4 Reflection + cleanup |

## Research References

- **ProMem**: arxiv:2601.04463 - Memory integrity in LLM agents
- **LiSA**: ACL 2025 - Semantic assignment for memory clustering
- **Reflection**: Agent Memory Survey - Pattern detection and pruning
