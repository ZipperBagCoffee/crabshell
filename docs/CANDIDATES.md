# Feature Candidates from Other Memory Systems

Analysis of memory management features from other projects that could enhance memory-keeper.

## Sources Analyzed

- [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) - Comprehensive memory with SQLite + Chroma
- [hudrazine/claude-code-memory-bank](https://github.com/hudrazine/claude-code-memory-bank) - Hierarchical markdown files
- [ebailey78/mcp-memory](https://github.com/ebailey78/mcp-memory) - Entity/concept/session structure
- [WhenMoon-afk/claude-memory-system](https://github.com/WhenMoon-afk/claude-memory-system) - Knowledge graph + compression

---

## Recommended Candidates (No Server Required)

### 1. Observation Type Tags
**Source**: claude-mem

Current memory-keeper only distinguishes decisions/patterns/issues. Add more granular types:

| Type | Icon | Description |
|------|------|-------------|
| decision | 🟤 | Architectural/approach choices |
| bugfix | 🔴 | Bug fixes with root cause |
| feature | 🟢 | New feature implementation |
| refactor | 🔵 | Code restructuring |
| discovery | 🟡 | New insight/pattern found |
| change | ⚪ | General modification |

**Implementation Difficulty**: Low
**How to Apply**: Extend facts.json structure, update extract-facts parser

```json
{
  "observations": [
    {
      "id": "o001",
      "type": "bugfix",
      "date": "2025-12-21",
      "content": "Fixed memory leak in dashboard",
      "files": ["src/dashboard.ts"],
      "concepts": ["memory-management", "react-hooks"]
    }
  ]
}
```

---

### 2. Hierarchical Memory Structure
**Source**: claude-code-memory-bank

Current: Everything stored in single memory.md
Proposed: Hierarchical file structure

```
.claude/memory/
├── memory.md              # Rolling summary (current)
├── project.md             # Project overview (new)
├── architecture.md        # Architecture decisions (new)
├── conventions.md         # Code conventions (new)
├── current.md             # Work in progress (new)
├── facts.json
└── sessions/
```

**Implementation Difficulty**: Medium
**How to Apply**:
- Load multiple files in load-memory.js
- Classify into appropriate files in save instructions

---

### 3. Concept/Tag System
**Source**: claude-mem, mcp-memory

Group related items by concept:

```json
{
  "concepts": {
    "authentication": ["d001", "p003", "i002"],
    "performance": ["d005", "p001"],
    "testing": ["p002", "d003"]
  }
}
```

**Implementation Difficulty**: Medium
**How to Apply**:
- Add concepts section to facts.json
- Auto-tagging in extract-facts
- Search by concept in search command

---

### 4. File Reference Tracking
**Source**: claude-mem

Track which files are related to which decisions/patterns:

```json
{
  "decisions": [
    {
      "id": "d001",
      "content": "Use React hooks",
      "files": ["src/components/Dashboard.tsx", "src/hooks/useAuth.ts"]
    }
  ]
}
```

**Implementation Difficulty**: Medium
**How to Apply**:
- Add files section to session.md format
- Parse file references in extract-facts

---

### 5. Progressive Disclosure (Token-Aware)
**Source**: claude-mem

Load large memory progressively:

| Layer | Content | Token Cost |
|-------|---------|------------|
| 1 | Index only (what exists) | ~100 tokens |
| 2 | Summaries | ~500 tokens |
| 3 | Full details | 2000+ tokens |

**Implementation Difficulty**: High
**How to Apply**:
- Layer selection option in load-memory.js
- Load additional details on demand

---

### 6. Memory Compression/Archiving
**Source**: claude-mem (Endless Mode), claude-memory-system

Current: Move to archive after 30 days
Proposed: AI-based compression summary

```
Recent Sessions (7 days): Full detail
Mid-term (30 days): Compressed summary
Archive (30+ days): Key facts only
```

**Implementation Difficulty**: High
**How to Apply**:
- Extend compress command
- Generate summary via agent (optional)

---

### 7. Privacy Tags
**Source**: claude-mem

Exclude sensitive content:

```markdown
## Decisions
- Use API key from <private>env.SECRET_KEY</private>: Security
```

Content within `<private>` tags is not saved to facts.json.

**Implementation Difficulty**: Low
**How to Apply**:
- Filter `<private>` tags in extract-facts

---

## Not Recommended (Server Required)

| Feature | Reason for Skip |
|---------|-----------------|
| Web Viewer UI | Requires background server (port 37777) |
| Real-time memory stream | Requires WebSocket server |
| Chroma vector DB | Requires separate service |
| SQLite FTS5 | Increased complexity, current JSON is sufficient |

---

## Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Observation Type Tags | Low | High |
| 2 | File Reference Tracking | Medium | High |
| 3 | Privacy Tags | Low | Medium |
| 4 | Concept/Tag System | Medium | High |
| 5 | Hierarchical Memory | Medium | Medium |
| 6 | Progressive Disclosure | High | Medium |
| 7 | Memory Compression | High | Low |

---

## Next Steps

1. **v6.4.0**: Observation Types + Privacy Tags (low effort, high value)
2. **v6.5.0**: File References + Concept Tags
3. **v7.0.0**: Hierarchical Memory Structure
