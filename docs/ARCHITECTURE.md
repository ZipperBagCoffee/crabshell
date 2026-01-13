# Memory Keeper Architecture (v12)

## Overview

Memory Keeper uses a 4-layer hierarchical memory system with research-based algorithms for fact extraction, concept grouping, and pattern detection.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code CLI                          │
├─────────────────────────────────────────────────────────────────┤
│  Hooks                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ SessionStart │  │ PostToolUse  │  │    Stop      │          │
│  │ load-memory  │  │   counter    │  │   counter    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Core Scripts                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │ load-memory.js │  │ counter.js     │  │ Haiku Subagent   │  │
│  │ - memory.md    │  │ - check()      │  │ (proactive:true) │  │
│  │ - facts.json   │  │ - final()      │  │ - L2 extraction  │  │
│  │ - L4 rules     │  │ - compress()   │  │ - ProMem 3-step  │  │
│  └────────────────┘  └────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
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
Based on arxiv:2601.04463 (73%+ memory integrity vs 42% rule-based)

```
Step 1: Extract    → Identify facts from session
Step 2: Verify     → Cross-check with context
Step 3: Save       → Max 10 facts per session
```

Output: `*.l2.json`
```json
{
  "exchanges": [
    {
      "factId": "f001",
      "fact": "Verified statement",
      "conceptName": "category-name",
      "files": ["file.ts"],
      "keywords": ["keyword1", "keyword2"]
    }
  ]
}
```

### L3: Concept Groups (LiSA)
Based on ACL 2025 LiSA semantic assignment

- Claude assigns `conceptId` (existing) or `conceptName` (new)
- 70% similarity threshold for assignment
- No keyword overlap calculation (replaced by semantic understanding)

Output: `concepts.json`

### L4: Permanent Memory (Reflection)

```
Step 1: Detect patterns    → 3+ occurrences across L2 files
Step 2: Verify relevance   → Is this generalizable?
Step 3: Promote to L4      → Add to facts.json.permanent
Step 4: Utility cleanup    → Remove old/contradicted rules
```

Types:
- `rules`: Repeated principles
- `solutions`: Problem → fix patterns
- `core_logic`: Key implementation patterns

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
    ├── cleanupTmpFiles()      ← tmpclaude bug workaround
    ├── counter++
    └── if counter >= 5:
        ├── Output haiku spawn instructions
        └── Reset counter
```

### Stop (session end)
```
counter.js final()
    │
    ├── Copy transcript → sessions/*.raw.jsonl
    ├── refineRaw() → sessions/*.l1.jsonl
    ├── Delete raw (unless keepRaw=true)
    └── Output L2/L3/L4 instructions
```

## Haiku Proactive Subagent

Configured in `.claude-plugin/plugin.json`:
```json
{
  "customAgents": [{
    "name": "l2-summarizer",
    "model": "haiku",
    "proactive": true,
    "agentFile": "agents/l2-summarizer.md"
  }]
}
```

The subagent:
1. Spawns automatically on auto-save trigger
2. Reads L1 file
3. Extracts ProMem-style facts
4. Saves L2 JSON
5. Updates concepts (L3)
6. Updates keyword index

## Data Structures

### facts.json
```json
{
  "_meta": { "counter": 0, "version": 3 },
  "decisions": [],
  "patterns": [],
  "issues": [],
  "concepts": {},
  "keywords": {},
  "permanent": {
    "rules": [],
    "solutions": [],
    "core_logic": []
  }
}
```

### config.json
```json
{
  "saveInterval": 5,
  "keepRaw": false,
  "quietStop": true
}
```

## Key Scripts

| Script | Purpose |
|--------|---------|
| `counter.js` | Hook handler, CLI commands |
| `load-memory.js` | SessionStart hook |
| `refine-raw.js` | L1 refinement |
| `save-l2.js` | L2 fact storage |
| `update-concepts.js` | L3 concept grouping |
| `permanent-memory.js` | L4 operations |
| `auto-compress.js` | Archive + L4 Reflection |

## Research References

- **ProMem**: arxiv:2601.04463 - Memory integrity in LLM agents
- **LiSA**: ACL 2025 - Semantic assignment for memory clustering
- **Reflection**: Agent Memory Survey - Pattern detection and utility-based pruning
