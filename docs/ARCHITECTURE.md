# Memory Keeper Architecture

## Overview

Memory Keeper is a Claude Code plugin that automatically saves session context using hooks, structured fact extraction, and tiered storage with automatic rotation.

## System Architecture

```
+---------------------------------------------------------------------+
|                        Claude Code CLI                               |
+---------------------------------------------------------------------+
|  Hooks                                                               |
|  +--------------+  +------------------+  +--------------+  +------+ |
|  | SessionStart |  | UserPromptSubmit |  | PostToolUse  |  | Stop | |
|  | load-memory  |  |  inject-rules    |  |   counter    |  |counter|
|  +------+-------+  +--------+---------+  +------+-------+  +--+---+ |
+---------+------------------+-----------------+----------------+-----+
          |                  |                 |                |
          v                  v                 v                v
+---------------------------------------------------------------------+
|  scripts/                                                            |
|  +----------------+  +------------------------------------------+   |
|  | load-memory.js |  | counter.js                               |   |
|  |                |  | - check: increment counter, trigger      |   |
|  | Reads:         |  | - final: save transcript, create L1      |   |
|  | - memory.md    |  | - search-memory: L1/L2/L3 search         |   |
|  | - L3 summaries |  | - generate-l3: create L3 summary         |   |
|  | - project.md   |  +------------------------------------------+   |
|  +----------------+  +------------------------------------------+   |
|                      | inject-rules.js                          |   |
|  +----------------+  | - Inject critical rules (every prompt)   |   |
|  | extract-delta  |  | - Detect pending delta → INSTRUCTION     |   |
|  | - extractDelta |  | - Detect pending rotation → INSTRUCTION  |   |
|  | - cleanup      |  +------------------------------------------+   |
|  +----------------+                                                  |
|                      +----------------+  +----------------------+    |
|  +----------------+  | search.js      |  | memory-rotation.js   |    |
|  | constants.js   |  | - L1/L2/L3     |  | - checkAndRotate     |    |
|  | - thresholds   |  |   search       |  | - token counting     |    |
|  +----------------+  +----------------+  +----------------------+    |
+---------------------------------------------------------------------+
          |                 |                 |
          v                 v                 v
+---------------------------------------------------------------------+
|  .claude/memory/ (Project Storage)                                   |
|  +----------------------------------------+  +----------------+     |
|  | Auto-created:                          |  | sessions/      |     |
|  | - memory.md (rolling, auto-rotates)    |  | - *.l1.jsonl   |     |
|  | - memory_*.md (L2 archives)            |  +----------------+     |
|  | - *.summary.json (L3 summaries)        |  +----------------+     |
|  | - memory-index.json (rotation/counter) |  | logs/          |     |
|  |                                        |  | - refine.log   |     |
|  | Optional (create with memory-set):     |  +----------------+     |
|  | - project.md                           |                         |
|  | - architecture.md                      |                         |
|  | - conventions.md                       |                         |
|  +----------------------------------------+                         |
+---------------------------------------------------------------------+
```

## Memory Hierarchy (v13.0.0+)

```
+---------------------------------------------------------------------+
|  L1: Raw Session Transcripts                                         |
|  - sessions/*.l1.jsonl (refined conversation logs)                   |
+---------------------------------------------------------------------+
|  L2: Rolling Memory (auto-rotates at 23,750 tokens)                  |
|  - memory.md (active, grows with each session)                       |
|  - memory_YYYYMMDD_HHMMSS.md (archived when rotated)                 |
+---------------------------------------------------------------------+
|  L3: Compressed Summaries (Haiku-generated JSON)                     |
|  - memory_YYYYMMDD_HHMMSS.summary.json                               |
|    (themes, keyDecisions, issues, overallSummary)                    |
+---------------------------------------------------------------------+
```

## Memory Rotation Flow

```
memory.md grows with session summaries
        |
        v
checkAndRotate() called on each check
        |
        v
estimateTokens(content) > 23,750?
    +---+---+
    | YES   | NO
    v       v
Rotate    (continue)
    |
    v
1. Archive to memory_YYYYMMDD_HHMMSS.md
2. Keep last 2,375 tokens as carryover
3. Update index.json
4. Output [MEMORY_KEEPER_ROTATE] trigger
    |
    v
Haiku agent generates L3 summary
    |
    v
Save to *.summary.json
```

## counter.js Commands

> ⚠️ **Note:** These commands only work inside the plugin directory.
> For normal usage, use slash commands like `/memory-keeper:search-memory`.

| Command | Description |
|---------|-------------|
| check | Increment counter, trigger auto-save at interval |
| final | Session end: create L1, cleanup duplicates |
| reset | Reset counter to 0 |
| search-memory | Search L1/L2/L3 layers (--deep for L1) |
| generate-l3 | Create L3 summary for archive |
| migrate-legacy | Split oversized memory files |
| compress | Archive 30+ day files |
| refine-all | Process raw.jsonl to L1 |
| dedupe-l1 | Remove duplicate L1 files (keep largest) |
| memory-set | Set hierarchical memory file content |
| memory-get | Get memory file content |
| memory-list | List all memory files |

## Configuration Constants (constants.js)

| Constant | Value | Description |
|----------|-------|-------------|
| ROTATION_THRESHOLD_TOKENS | 25000 | Base rotation threshold |
| ROTATION_SAFETY_MARGIN | 0.05 | 5% safety margin |
| CARRYOVER_TOKENS | 2500 | Base carryover amount |
| MEMORY_DIR | memory | Memory storage directory |
| SESSIONS_DIR | sessions | Session storage directory |
| INDEX_FILE | memory-index.json | Rotation tracking + counter |
| MEMORY_FILE | memory.md | Active memory file |

## memory-index.json Structure

```json
{
  "version": 1,
  "current": "memory.md",
  "rotatedFiles": [
    {
      "file": "memory_20260113_120000.md",
      "rotatedAt": "2026-01-13T12:00:00.000Z",
      "tokenCount": 24500,
      "summary": "memory_20260113_120000.summary.json",
      "summaryGenerated": true
    }
  ],
  "stats": {
    "totalRotations": 0,
    "lastRotation": null
  },
  "counter": 0
}
```

## L3 Summary Structure

```json
{
  "sourceFile": "memory_20260113_120000.md",
  "generatedAt": "2026-01-13T12:05:00.000Z",
  "themes": [
    { "name": "Authentication", "summary": "Implemented JWT-based auth..." }
  ],
  "keyDecisions": [
    { "decision": "Use bcrypt for passwords", "reason": "Industry standard" }
  ],
  "issues": [
    { "issue": "Login timeout bug", "status": "resolved" }
  ],
  "overallSummary": "This period focused on authentication system..."
}
```

## Version History

| Version | Key Changes |
|---------|-------------|
| 13.8.1 | Windows `echo -e` → `printf` fix |
| 13.8.0 | Auto-trigger L3 generation after rotation |
| 13.7.0 | Path detection fix for plugin cache execution |
| 13.6.0 | UserPromptSubmit-based delta/rotation triggers |
| 13.5.0 | Delta-based auto-save, rules injection via UserPromptSubmit |
| 13.0.0 | Token-based memory rotation, L3 Haiku summaries, integrated search |
| 12.x | Stop hook blocking, L2/L3/L4 workflow improvements |
| 8.x | L1-L4 hierarchical memory system |
