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

현재 memory-keeper는 decisions/patterns/issues만 구분. 더 세분화된 타입 추가:

| Type | Icon | Description |
|------|------|-------------|
| decision | 🟤 | Architectural/approach choices |
| bugfix | 🔴 | Bug fixes with root cause |
| feature | 🟢 | New feature implementation |
| refactor | 🔵 | Code restructuring |
| discovery | 🟡 | New insight/pattern found |
| change | ⚪ | General modification |

**구현 난이도**: 낮음
**적용 방법**: facts.json 구조 확장, extract-facts 파서 업데이트

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

현재: 단일 memory.md에 모든 것 저장
제안: 계층적 파일 구조

```
.claude/memory/
├── memory.md              # Rolling summary (현재)
├── project.md             # 프로젝트 개요 (새로)
├── architecture.md        # 아키텍처 결정 (새로)
├── conventions.md         # 코드 컨벤션 (새로)
├── current.md             # 현재 작업 중 (새로)
├── facts.json
└── sessions/
```

**구현 난이도**: 중간
**적용 방법**:
- load-memory.js에서 여러 파일 로드
- save 지시문에서 적절한 파일에 분류

---

### 3. Concept/Tag System
**Source**: claude-mem, mcp-memory

관련 항목을 개념으로 그룹화:

```json
{
  "concepts": {
    "authentication": ["d001", "p003", "i002"],
    "performance": ["d005", "p001"],
    "testing": ["p002", "d003"]
  }
}
```

**구현 난이도**: 중간
**적용 방법**:
- facts.json에 concepts 섹션 추가
- extract-facts에서 자동 태깅
- search 명령에서 개념별 검색

---

### 4. File Reference Tracking
**Source**: claude-mem

어떤 파일이 어떤 결정/패턴과 관련됐는지 추적:

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

**구현 난이도**: 중간
**적용 방법**:
- session.md 포맷에 파일 섹션 추가
- extract-facts에서 파일 참조 파싱

---

### 5. Progressive Disclosure (Token-Aware)
**Source**: claude-mem

대용량 메모리를 단계적으로 로드:

| Layer | Content | Token Cost |
|-------|---------|------------|
| 1 | Index only (what exists) | ~100 tokens |
| 2 | Summaries | ~500 tokens |
| 3 | Full details | 2000+ tokens |

**구현 난이도**: 높음
**적용 방법**:
- load-memory.js에서 레이어 선택 옵션
- 필요시 상세 정보 추가 로드

---

### 6. Memory Compression/Archiving
**Source**: claude-mem (Endless Mode), claude-memory-system

현재: 30일 후 archive로 이동
제안: AI 기반 압축 요약

```
Recent Sessions (7일): Full detail
Mid-term (30일): Compressed summary
Archive (30일+): Key facts only
```

**구현 난이도**: 높음
**적용 방법**:
- compress 명령 확장
- 에이전트로 요약 생성 (선택적)

---

### 7. Privacy Tags
**Source**: claude-mem

민감한 내용 제외:

```markdown
## Decisions
- Use API key from <private>env.SECRET_KEY</private>: Security
```

`<private>` 태그 내용은 facts.json에 저장 안 됨.

**구현 난이도**: 낮음
**적용 방법**:
- extract-facts에서 `<private>` 태그 필터링

---

## Not Recommended (Server Required)

| Feature | Reason for Skip |
|---------|-----------------|
| Web Viewer UI | 백그라운드 서버 필요 (포트 37777) |
| Real-time memory stream | WebSocket 서버 필요 |
| Chroma vector DB | 별도 서비스 필요 |
| SQLite FTS5 | 복잡도 증가, 현재 JSON으로 충분 |

---

## Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Observation Type Tags | 낮음 | 높음 |
| 2 | File Reference Tracking | 중간 | 높음 |
| 3 | Privacy Tags | 낮음 | 중간 |
| 4 | Concept/Tag System | 중간 | 높음 |
| 5 | Hierarchical Memory | 중간 | 중간 |
| 6 | Progressive Disclosure | 높음 | 중간 |
| 7 | Memory Compression | 높음 | 낮음 |

---

## Next Steps

1. **v6.4.0**: Observation Types + Privacy Tags (낮은 노력, 높은 가치)
2. **v6.5.0**: File References + Concept Tags
3. **v7.0.0**: Hierarchical Memory Structure
