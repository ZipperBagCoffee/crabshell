# Memory Keeper Architecture

## Overview

Memory Keeper is a Claude Code plugin that automatically saves session context using hooks, structured fact extraction, and tiered storage with automatic rotation.

## System Architecture

```
+---------------------------------------------------------------------+
|                        Claude Code CLI                               |
+---------------------------------------------------------------------+
|  Hooks                                                               |
|  +--------------+  +--------------+  +--------------+               |
|  | SessionStart |  | PostToolUse  |  |    Stop      |               |
|  | load-memory  |  |   counter    |  |   counter    |               |
|  +------+-------+  +------+-------+  +------+-------+               |
+---------+-----------------+-----------------+-----------------------+
          |                 |                 |
          v                 v                 v
+---------------------------------------------------------------------+
|  scripts/                                                            |
|  +----------------+  +------------------------------------------+   |
|  | load-memory.js |  | counter.js                               |   |
|  |                |  | - check: increment counter, trigger      |   |
|  | Reads:         |  | - final: save transcript, output instr   |   |
|  | - memory.md    |  | - search-memory: L1/L2/L3 search         |   |
|  | - L3 summaries |  | - generate-l3: create L3 summary         |   |
|  | - facts.json   |  | - migrate-legacy: split large files      |   |
|  +----------------+  +------------------------------------------+   |
|                                                                      |
|  +----------------+  +----------------+  +----------------------+    |
|  | constants.js   |  | search.js      |  | memory-rotation.js   |    |
|  | - thresholds   |  | - L1/L2/L3     |  | - checkAndRotate     |    |
|  | - paths        |  |   search       |  | - token counting     |    |
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
|  | - *.summary.json (L3 summaries)        |                         |
|  | - index.json (rotation tracking)       |                         |
|  | - facts.json (structured facts)        |                         |
|  |                                        |                         |
|  | Optional (create with memory-set):     |                         |
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

| Command | Description |
|---------|-------------|
| check | Increment counter, trigger at threshold |
| final | Copy transcript, output final instructions |
| search-memory | Search L1/L2/L3 layers |
| generate-l3 | Create L3 summary for archive |
| migrate-legacy | Split oversized memory files |
| memory-set | Set hierarchical memory file content |
| memory-get | Get memory file content |
| add-decision | Add decision to facts.json |
| add-pattern | Add pattern to facts.json |
| add-issue | Add issue to facts.json |
| search | Search facts.json (legacy) |
| compress | Archive 30+ day files |

## Configuration Constants (constants.js)

| Constant | Value | Description |
|----------|-------|-------------|
| ROTATION_THRESHOLD_TOKENS | 25000 | Base rotation threshold |
| ROTATION_SAFETY_MARGIN | 0.05 | 5% safety margin |
| CARRYOVER_TOKENS | 2500 | Base carryover amount |
| MEMORY_DIR | memory | Memory storage directory |
| SESSIONS_DIR | sessions | Session storage directory |
| INDEX_FILE | index.json | Rotation tracking file |
| MEMORY_FILE | memory.md | Active memory file |

## index.json Structure

```json
{
  "version": "13.0.0",
  "rotatedFiles": [
    {
      "file": "memory_20260113_120000.md",
      "rotatedAt": "2026-01-13T12:00:00.000Z",
      "tokenCount": 24500,
      "summary": "memory_20260113_120000.summary.json",
      "summaryGenerated": true
    }
  ]
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
| 13.0.0 | Token-based memory rotation, L3 Haiku summaries, integrated search |
| 12.3.0 | Clearer hook instructions for L1-L4 workflow |
| 8.2.0 | L4 permanent memory automation |
| 8.0.0 | L1 refined transcripts |
| 7.0.0 | Hierarchical memory structure |
| 6.5.0 | File references + concept tagging |
