# Memory Rotation System 구현 계획

## 용어 정의

| 용어 | 파일 | 설명 |
|------|------|------|
| **L1** | `.l1.jsonl` | 세션 raw transcript (자동 생성) |
| **L2** | `memory.md` | 세션 요약 (5회 tool use마다 append) |
| **L3** | `.summary.json` | L2 archive 요약 (rotation 시 Haiku 생성) |

## 요약
memory.md가 **23,750 토큰**(~95KB, 5% 마진 적용)을 초과하면 자동으로 rotate하고, Haiku 에이전트가 이전 파일을 JSON으로 요약(L3)하는 시스템.

### 전체 흐름

```
┌─────────────────────────────────────────────────────────────┐
│                      SESSION START                          │
│  load-memory.js 실행:                                       │
│  1. memory.md 마지막 50줄 로드                              │
│  2. 이전 L1 tail 확인 → memory.md에 없으면 컨텍스트 추가    │
│  3. L3 요약 있으면 로드                                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SESSION 중                             │
│  tool 5회마다 counter.js check() 호출:                      │
│  1. memory.md > 23,750 토큰? → Rotation 실행                │
│  2. memory.md에 현재 작업 요약 append (Claude가 실행)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      ROTATION (조건부)                       │
│  memory.md > threshold 시:                                  │
│  1. memory.md → memory_YYYYMMDD_HHMMSS.md (archive)         │
│  2. 새 memory.md = carryover (마지막 2,375 토큰)            │
│  3. [MEMORY_KEEPER_ROTATE] 출력 → Skill → Haiku → L3 생성   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SESSION END                            │
│  counter.js final() 호출:                                   │
│  1. L1 생성 (세션 transcript → .l1.jsonl) - 자동            │
│  2. memory.md 추가 - 불가 (Claude 이미 종료됨)              │
│     → 다음 세션 시작 시 L1 tail에서 보완                    │
└─────────────────────────────────────────────────────────────┘
```

### 핵심 수치
| 항목 | 기준값 | 실제 적용 (5% 마진) |
|------|--------|---------------------|
| Threshold | 25,000 토큰 | **23,750 토큰** |
| Carryover | 2,500 토큰 | **2,375 토큰** |
| 토큰 계산 | bytes ÷ 4 | - |

### 파일 명명 규칙 (통일)

```
memory.md                              # 현재 활성 파일
memory_20260113_112700.md              # archive (underscore, 14자리 timestamp)
memory_20260113_112700.summary.json    # L3 요약
memory-index.json                      # 인덱스
```

**중요**: 모든 archive 파일은 `memory_YYYYMMDD_HHMMSS.md` 형식 사용 (점이 아닌 밑줄)

### 구현 우선순위

| 순서 | 파일 | 작업 | 의존성 |
|------|------|------|--------|
| 1 | `scripts/constants.js` | **New** - 모든 상수 정의 | 없음 |
| 2 | `scripts/utils.js` | 토큰 계산, 파일 유틸리티 | constants.js |
| 3 | `scripts/init.js` | **New** - 프로젝트 초기화 | constants.js |
| 4 | `scripts/search.js` | **New** - 통합 검색 (L3 중심) | utils.js, constants.js |
| 5 | `scripts/legacy-migration.js` | **New** - 대용량 레거시 분할 | utils.js |
| 6 | `scripts/memory-rotation.js` | **New** - rotation 핵심 로직 | utils.js, legacy-migration.js |
| 7 | `agents/memory-summarizer.md` | **New** - Haiku 에이전트 정의 | 없음 |
| 8 | `skills/memory-rotate/SKILL.md` | **New** - 자동화 skill | agent 정의 필요 |
| 9 | `scripts/counter.js` | rotation + search 통합 | memory-rotation.js, search.js |
| 10 | `scripts/load-memory.js` | L3 로드 + 레거시 호환 | init.js |

### 코딩 규칙

- **모든 스크립트와 주석은 영어로 작성**
- 변수명, 함수명, 로그 메시지 모두 영어
- **하드코딩 금지** - 모든 설정값은 config 또는 파일 상단 constants로
- Threshold에 **5% 마진** 적용 (안전 버퍼)

### 상수 정의 (`scripts/constants.js`)

```javascript
// All configurable values in one place
module.exports = {
  // Token thresholds (with 5% safety margin)
  ROTATION_THRESHOLD_TOKENS: 23750,  // 25000 * 0.95
  CARRYOVER_TOKENS: 2375,            // 2500 * 0.95

  // Byte fallbacks
  ROTATION_THRESHOLD_BYTES: 95000,   // ~100KB * 0.95
  CARRYOVER_BYTES: 9500,             // ~10KB * 0.95

  // Token calculation
  BYTES_PER_TOKEN: 4,

  // Directory names (relative to .claude/)
  MEMORY_DIR: 'memory',
  SESSIONS_DIR: 'memory/sessions',
  LOGS_DIR: 'memory/logs',

  // File names
  MEMORY_FILE: 'memory.md',
  INDEX_FILE: 'memory-index.json',
  LOCK_FILE: '.rotation.lock',

  // Lock settings
  LOCK_STALE_MS: 60000,  // 60 seconds

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,  // Base delay for exponential backoff

  // Limits for L3 summary
  MAX_THEMES: 10,
  MAX_DECISIONS: 10,
  MAX_ISSUES: 10,
  SUMMARY_SENTENCES: { min: 10, max: 15 },

  // Archive settings
  ARCHIVE_PREFIX: 'memory_',
  SUMMARY_SUFFIX: '.summary.json',

  // Timestamp format function
  getTimestamp: () => {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
};
```

---

## 빠른 시작 (Getting Started)

### 새 프로젝트에서 처음 사용 시

```bash
# 1. 플러그인이 자동으로 디렉토리 구조 생성
#    (load-memory.js 첫 실행 시)
.claude/
  memory/
    memory.md           # 자동 생성 안됨 - 첫 save 시 생성
    memory-index.json   # 자동 생성 (빈 index)
    sessions/           # 자동 생성
    logs/               # 자동 생성
```

### 초기화 흐름

```
첫 세션 시작
    │
    ▼
load-memory.js 실행
    ├─► .claude/memory/ 없음?
    │       └─► init.js: 디렉토리 구조 생성
    │
    ├─► memory-index.json 없음?
    │       └─► init.js: 빈 인덱스 생성
    │
    └─► memory.md 없음?
            └─► 정상 (첫 save에서 생성됨)

첫 save 트리거 (5회 tool use)
    │
    ▼
counter.js check()
    └─► memory.md 생성 + 내용 저장
```

### 필수 파일 vs 선택 파일

| 파일 | 필수 | 자동 생성 시점 | 설명 |
|------|------|---------------|------|
| `.claude/memory/` | Yes | load-memory.js | 메모리 루트 디렉토리 |
| `memory-index.json` | Yes | load-memory.js | rotation 추적 인덱스 |
| `memory.md` | No | 첫 save | 없어도 에러 없음 |
| `config.json` | No | - | 없으면 기본값 사용 |

### 에러 방지를 위한 가드

```javascript
// init.js에서 호출
function ensureMemoryStructure(projectDir) {
  const dirs = [MEMORY_DIR, SESSIONS_DIR, LOGS_DIR];

  for (const dir of dirs) {
    const fullPath = path.join(projectDir, '.claude', dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Index file - create if not exists
  const indexPath = path.join(projectDir, '.claude', MEMORY_DIR, INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, JSON.stringify({
      version: 1,
      current: MEMORY_FILE,
      rotatedFiles: [],
      stats: { totalRotations: 0, lastRotation: null }
    }, null, 2));
  }
}
```

---


## 0. 메모리 검색 전략

### 핵심 원칙

**L3 summary가 검색의 중심**. 모든 과거 정보는 L3 summary에 구조화되어 있음.

### 검색 우선순위 (Search Order)

```
1. memory.md           ← 현재 L2 (세션 컨텍스트)
2. L3 summaries        ← 과거 rotation 요약 (themes, decisions, issues)
3. L2 archives         ← 과거 memory_*.md 파일 (L3에 없는 세부사항)
4. L1 sessions         ← 원본 세션 (deep search, 최후 수단)
```

### 검색 함수 구현 (`scripts/search.js`)

```javascript
const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault } = require('./utils');
const { MEMORY_DIR, INDEX_FILE, MEMORY_FILE } = require('./constants');

/**
 * 통합 메모리 검색
 */
function searchMemory(query, options = {}) {
  const projectDir = getProjectDir();
  const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
  const results = [];
  const queryLower = query.toLowerCase();

  // 1. memory.md - 현재 컨텍스트 검색
  const memoryMatches = searchCurrentMemory(memoryDir, queryLower);
  if (memoryMatches.length > 0) {
    results.push({ source: 'memory.md', matches: memoryMatches });
  }

  // 2. L3 summaries - 과거 요약 검색
  const l3Matches = searchL3Summaries(memoryDir, queryLower);
  if (l3Matches.length > 0) {
    results.push({ source: 'L3 summaries', matches: l3Matches });
  }

  // 3. L2 archives - 과거 memory.md 파일들 검색
  const l2Matches = searchL2Archives(memoryDir, queryLower);
  if (l2Matches.length > 0) {
    results.push({ source: 'L2 archives', matches: l2Matches });
  }

  // 4. L1 sessions - deep search only
  if (options.deep) {
    const l1Matches = searchL1Sessions(memoryDir, queryLower);
    if (l1Matches.length > 0) {
      results.push({ source: 'L1 sessions', matches: l1Matches });
    }
  }

  return results;
}

/**
 * memory.md 검색 - 줄 단위 grep
 */
function searchCurrentMemory(memoryDir, query) {
  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  if (!fs.existsSync(memoryPath)) return [];

  const content = fs.readFileSync(memoryPath, 'utf8');
  const lines = content.split('\n');
  const matches = [];

  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(query)) {
      matches.push({ line: i + 1, text: line.trim() });
    }
  });

  return matches;
}

/**
 * L3 summary 검색 - themes, decisions, issues에서 검색
 */
function searchL3Summaries(memoryDir, query) {
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const index = readJsonOrDefault(indexPath, { rotatedFiles: [] });
  const matches = [];

  for (const entry of index.rotatedFiles) {
    if (!entry.summaryGenerated) continue;

    const summaryPath = path.join(memoryDir, entry.summary);
    if (!fs.existsSync(summaryPath)) continue;

    const summary = readJsonOrDefault(summaryPath, null);
    if (!summary) continue;

    // Search in themes
    if (summary.themes) {
      for (const theme of summary.themes) {
        if (theme.name.toLowerCase().includes(query) ||
            theme.summary.toLowerCase().includes(query)) {
          matches.push({
            file: entry.file,
            type: 'theme',
            content: theme.name,
            detail: theme.summary
          });
        }
      }
    }

    // Search in keyDecisions
    if (summary.keyDecisions) {
      for (const dec of summary.keyDecisions) {
        if (dec.decision.toLowerCase().includes(query)) {
          matches.push({
            file: entry.file,
            type: 'decision',
            content: dec.decision,
            reason: dec.reason
          });
        }
      }
    }

    // Search in issues
    if (summary.issues) {
      for (const issue of summary.issues) {
        if (issue.issue.toLowerCase().includes(query)) {
          matches.push({
            file: entry.file,
            type: 'issue',
            content: issue.issue,
            status: issue.status
          });
        }
      }
    }

    // Search in overallSummary
    if (summary.overallSummary &&
        summary.overallSummary.toLowerCase().includes(query)) {
      matches.push({
        file: entry.file,
        type: 'summary',
        content: summary.overallSummary.substring(0, 200) + '...'
      });
    }
  }

  return matches;
}

/**
 * L1 session 검색 - .l1.jsonl 파일에서 raw 검색
 */
function searchL1Sessions(memoryDir, query) {
  const sessionsDir = path.join(memoryDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];

  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));
  const matches = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(sessionsDir, file), 'utf8');
    if (content.toLowerCase().includes(query)) {
      matches.push({ file, found: true });
    }
  }

  return matches;
}

/**
 * L2 archive 검색 - memory_*.md 파일에서 검색
 */
function searchL2Archives(memoryDir, query) {
  const files = fs.readdirSync(memoryDir)
    .filter(f => f.startsWith('memory_') && f.endsWith('.md'));
  const matches = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(memoryDir, file), 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(query)) {
        matches.push({ file, line: i + 1, text: line.trim() });
      }
    });
  }

  return matches;
}

module.exports = { searchMemory, searchL3Summaries, searchL2Archives };
```

### counter.js 통합

```javascript
// counter.js에 추가
case 'search':
  const { searchMemory } = require('./search');
  const deep = args.includes('--deep');
  const query = args.filter(a => !a.startsWith('--'))[0];

  if (!query) {
    console.log('[MEMORY_KEEPER] Usage: search <query> [--deep]');
    break;
  }

  const results = searchMemory(query, { deep });

  if (results.length === 0) {
    console.log(`[MEMORY_KEEPER] No results for "${query}"`);
  } else {
    for (const r of results) {
      console.log(`\n[${r.source}]`);
      for (const m of r.matches.slice(0, 5)) {
        if (m.line) console.log(`  L${m.line}: ${m.text}`);
        else if (m.type) console.log(`  [${m.type}] ${m.content}`);
        else console.log(`  ${m.file}`);
      }
      if (r.matches.length > 5) {
        console.log(`  ... and ${r.matches.length - 5} more`);
      }
    }
  }
  break;

case 'generate-l3':
  // 수동으로 L3 요약 생성 (미생성된 archive용)
  const archiveFile = args[0];
  if (!archiveFile) {
    console.log('[MEMORY_KEEPER] Usage: generate-l3 <archive-file>');
    break;
  }
  console.log(`[MEMORY_KEEPER_ROTATE] file=${archiveFile}`);
  // Claude가 이 출력을 보고 Skill 호출
  break;

case 'migrate-legacy':
  // 대용량 레거시 memory.md 분할
  const { splitLegacyMemory } = require('./legacy-migration');
  const result = splitLegacyMemory(memoryPath);
  if (result) {
    console.log(`[MEMORY_KEEPER] Legacy split: ${result.archives.length} archives created`);
    result.triggers.forEach(t => console.log(t));
  } else {
    console.log('[MEMORY_KEEPER] No migration needed (under threshold)');
  }
  break;
```

---

## 0.1 레거시 포맷 처리 (Migration)

### 현재 존재하는 파일들

| 파일 | 처리 방식 |
|------|----------|
| `memory.md` | **유지** - 첫 rotation 대상 |
| `sessions/*.l1.jsonl` | **유지** - deep search용 |

### memory-index.json 구조 (단순화)

rotation 추적 전용. keywords/themes는 **L3 summary에 있으므로 중복 저장 안 함**.

```json
{
  "version": 1,
  "current": "memory.md",
  "rotatedFiles": [
    {
      "file": "memory_20260113_235959.md",
      "rotatedAt": "2026-01-13T23:59:59Z",
      "tokens": 23000,
      "summary": "memory_20260113_235959.summary.json",
      "summaryGenerated": true
    }
  ],
  "stats": {
    "totalRotations": 1,
    "lastRotation": "2026-01-13T23:59:59Z"
  }
}
```

### Migration 전략

**1. 즉시 적용 (No Migration)**
- 기존 파일 그대로 유지
- 새 rotation 시스템만 추가
- memory-index.json 신규 생성

**2. 선택적 요약 생성**
- 기존 L1 파일들에 대해 요약 필요 시:
```bash
node scripts/counter.js generate-l3 sessions/2026-01-13_1011.l1.jsonl
```

### 대용량 레거시 memory.md 처리

threshold(23,750 토큰)보다 큰 레거시 memory.md 발견 시:

**처리 방식: 날짜 기반 분할 (Date-based Split)**

```
기존 memory.md (100,000 토큰, 약 4x threshold)
    │
    ├─► 섹션 파싱: ## YYYY-MM-DD 헤더로 분리
    │
    ├─► 청크 그룹화: threshold 이하로 묶기
    │       │
    │       ├─► Chunk 1: 2026-01-01 ~ 2026-01-05 (~22,000 토큰)
    │       ├─► Chunk 2: 2026-01-06 ~ 2026-01-09 (~23,000 토큰)
    │       ├─► Chunk 3: 2026-01-10 ~ 2026-01-12 (~21,000 토큰)
    │       └─► Chunk 4: 2026-01-13 (remainder)
    │
    ├─► 각 청크 → archive 파일 생성 (정상 rotation과 동일 포맷)
    │       ├─► memory_20260105_235959.md
    │       ├─► memory_20260109_235959.md
    │       └─► memory_20260112_235959.md
    │
    ├─► 인덱스 등록 (rotatedFiles 배열에 추가)
    │       └─► summaryGenerated: false
    │
    ├─► L3 요약 트리거 출력
    │       ├─► [MEMORY_KEEPER_ROTATE] file=memory_20260105_235959.md
    │       ├─► [MEMORY_KEEPER_ROTATE] file=memory_20260109_235959.md
    │       └─► [MEMORY_KEEPER_ROTATE] file=memory_20260112_235959.md
    │
    └─► 마지막 청크의 tail → 새 memory.md (carryover)
```

**구현 (`scripts/legacy-migration.js`)**:

```javascript
const fs = require('fs');
const path = require('path');
const { ROTATION_THRESHOLD_TOKENS, CARRYOVER_TOKENS } = require('./constants');
const { estimateTokens, extractTailByTokens, updateIndex, getProjectDir } = require('./utils');

/**
 * 날짜 헤더(## YYYY-MM-DD)로 섹션 파싱
 */
function parseDateSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    const match = line.match(/^## (\d{4}-\d{2}-\d{2})/);
    if (match) {
      if (currentSection) sections.push(currentSection);
      currentSection = { date: match[1], content: line + '\n' };
    } else if (currentSection) {
      currentSection.content += line + '\n';
    }
  }
  if (currentSection) sections.push(currentSection);

  // 헤더 없으면 전체를 하나의 섹션으로
  if (sections.length === 0) {
    sections.push({ date: new Date().toISOString().split('T')[0], content });
  }

  return sections;
}

function splitLegacyMemory(memoryPath) {
  const memoryDir = path.dirname(memoryPath);
  const content = fs.readFileSync(memoryPath, 'utf8');
  const tokens = estimateTokens(content);

  // Under threshold - no split needed
  if (tokens <= ROTATION_THRESHOLD_TOKENS) {
    return null;
  }

  // Parse sections by date headers (## YYYY-MM-DD)
  const sections = parseDateSections(content);

  // Group sections into chunks under threshold
  const chunks = [];
  let currentChunk = { sections: [], tokens: 0 };

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content);

    if (currentChunk.tokens + sectionTokens > ROTATION_THRESHOLD_TOKENS) {
      // Save current chunk, start new one
      if (currentChunk.sections.length > 0) {
        chunks.push(currentChunk);
      }
      currentChunk = { sections: [section], tokens: sectionTokens };
    } else {
      currentChunk.sections.push(section);
      currentChunk.tokens += sectionTokens;
    }
  }

  // Don't forget last chunk
  if (currentChunk.sections.length > 0) {
    chunks.push(currentChunk);
  }

  // Archive all but last chunk + register to index + emit triggers
  const archives = [];
  const triggers = [];
  for (let i = 0; i < chunks.length - 1; i++) {
    const chunk = chunks[i];
    const lastDate = chunk.sections[chunk.sections.length - 1].date;
    // Use rotation-compatible naming: memory_YYYYMMDD_HHMMSS.md
    const archivePath = `memory_${lastDate.replace(/-/g, '')}_235959.md`;
    archives.push({
      path: archivePath,
      content: chunk.sections.map(s => s.content).join('\n'),
      tokens: chunk.tokens,
      dateRange: {
        first: chunk.sections[0].date,
        last: lastDate
      }
    });

    // Register to index (same as normal rotation)
    updateIndex(path.join(memoryDir, archivePath), chunk.tokens, memoryDir);

    // Emit L3 trigger (same as normal rotation)
    triggers.push(`[MEMORY_KEEPER_ROTATE] file=${archivePath}`);
  }

  // Last chunk becomes new memory.md (with carryover from tail)
  const lastChunk = chunks[chunks.length - 1];
  const newMemoryContent = extractTailByTokens(
    lastChunk.sections.map(s => s.content).join('\n'),
    CARRYOVER_TOKENS
  );

  return { archives, newMemoryContent, triggers };
}
```

**실행 시점**:
- 첫 번째 `check()` 호출 시 자동 감지
- 또는 수동: `node scripts/counter.js migrate-legacy`

**Edge Cases**:
| 케이스 | 처리 |
|--------|------|
| 헤더 없는 레거시 | 전체를 하나의 섹션으로 처리 → 단일 archive |
| 단일 섹션이 threshold 초과 | 해당 섹션만 별도 archive (강제 분할) |
| 날짜 포맷 불일치 | `## `로 시작하는 모든 라인을 섹션 구분자로 |

### 대용량 단일 섹션 강제 분할

단일 섹션이 threshold를 초과할 경우 (예: 하루에 매우 많은 작업):

```javascript
/**
 * 단일 섹션이 threshold 초과 시 강제 분할
 * @param {object} section - { date, content }
 * @param {number} threshold - 토큰 threshold
 * @returns {array} 분할된 섹션 배열
 */
function forceSplitSection(section, threshold) {
  const tokens = estimateTokens(section.content);

  if (tokens <= threshold) {
    return [section];  // 분할 불필요
  }

  // 줄 단위로 분할
  const lines = section.content.split('\n');
  const chunks = [];
  let currentChunk = { lines: [], tokens: 0 };
  let partNum = 1;

  for (const line of lines) {
    const lineTokens = estimateTokens(line + '\n');

    if (currentChunk.tokens + lineTokens > threshold && currentChunk.lines.length > 0) {
      // Save current chunk
      chunks.push({
        date: `${section.date}_part${partNum}`,
        content: currentChunk.lines.join('\n')
      });
      partNum++;
      currentChunk = { lines: [line], tokens: lineTokens };
    } else {
      currentChunk.lines.push(line);
      currentChunk.tokens += lineTokens;
    }
  }

  // Last chunk
  if (currentChunk.lines.length > 0) {
    chunks.push({
      date: `${section.date}_part${partNum}`,
      content: currentChunk.lines.join('\n')
    });
  }

  return chunks;
}
```

**사용 예시**:
```javascript
// splitLegacyMemory 내부에서 호출
for (const section of sections) {
  const splitSections = forceSplitSection(section, ROTATION_THRESHOLD_TOKENS);
  for (const split of splitSections) {
    // 기존 로직과 동일하게 처리
  }
}
```

### 호환성 보장

```javascript
// load-memory.js - backward compatible
function loadMemory() {
  // Try new format first
  const index = readJsonOrDefault(indexPath, null);

  if (index) {
    // New format: load from index
    loadFromIndex(index);
  } else {
    // Legacy format: direct file load
    loadLegacyMemory();
  }
}
```

### 마이그레이션 체크리스트

- [ ] memory-index.json 없으면 자동 생성
- [ ] 기존 memory.md 토큰 체크 → 필요 시 즉시 rotation
- [ ] L1 파일들 보관 (삭제 안함)

---

## 1. 크기 제한 기준

| 기준 | 값 | 근거 |
|------|-----|------|
| **threshold** | 25,000 토큰 | 사용자 지정 기본값. 컨텍스트 효율성 기준 |
| **측정 방식** | 토큰 수 | 문자 수 ÷ 4 (근사치) 또는 tiktoken |
| **fallback** | ~100KB | 토큰 계산 실패 시 바이트 기준 |

**참고**:
- Haiku 4.5 입력: 200K 토큰 context window → 25K 토큰 파일 처리 여유
- Subagent 출력: 32K 토큰 하드 제한 (요약 JSON은 이보다 훨씬 작음)
- 25,000 토큰 ≈ 약 100KB 텍스트 ≈ 약 800-1500줄

### 토큰 계산 유틸리티 (`utils.js`에 추가)

```javascript
const fs = require('fs');
const path = require('path');
const { INDEX_FILE, MEMORY_FILE, LOCK_FILE, LOCK_STALE_MS } = require('./constants');

/**
 * 텍스트의 토큰 수 추정 (Claude 토크나이저 근사치)
 * - 영어: ~4 문자/토큰
 * - 한국어: ~2-3 문자/토큰 (UTF-8에서 더 많은 바이트 사용)
 * - 혼합 콘텐츠: 바이트 수 ÷ 4 사용
 */
function estimateTokens(text) {
  const bytes = Buffer.byteLength(text, 'utf8');
  return Math.ceil(bytes / 4);
}

function estimateTokensFromFile(filePath) {
  const stats = fs.statSync(filePath);
  return Math.ceil(stats.size / 4);
}

/**
 * 텍스트 끝에서 지정된 토큰 수만큼 추출
 * @param {string} content - 텍스트 내용
 * @param {number} targetTokens - 목표 토큰 수
 * @returns {string} 추출된 텍스트
 */
function extractTailByTokens(content, targetTokens) {
  const lines = content.split('\n');

  let tokens = 0;
  let startIndex = lines.length;

  // 역순으로 토큰 누적
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineTokens = estimateTokens(lines[i] + '\n');
    if (tokens + lineTokens > targetTokens) break;
    tokens += lineTokens;
    startIndex = i;
  }

  return lines.slice(startIndex).join('\n');
}

/**
 * JSON 파일 읽기 (없거나 파싱 실패 시 기본값 반환)
 */
function readJsonOrDefault(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return defaultValue;
  }
}

/**
 * 프로젝트 디렉토리 감지 (현재 작업 디렉토리 기준)
 */
function getProjectDir() {
  // Hook에서 PROJECT_DIR 환경변수로 전달받거나
  // 현재 디렉토리에서 .claude 폴더를 찾아 올라감
  if (process.env.PROJECT_DIR) {
    return process.env.PROJECT_DIR;
  }

  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.claude'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();  // fallback
}

/**
 * memory-index.json 업데이트
 */
function updateIndex(archivePath, tokens, memoryDir) {
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const index = readJsonOrDefault(indexPath, {
    version: 1,
    current: MEMORY_FILE,
    rotatedFiles: [],
    stats: { totalRotations: 0, lastRotation: null }
  });

  // Add new rotation entry
  index.rotatedFiles.push({
    file: path.basename(archivePath),
    rotatedAt: new Date().toISOString(),
    tokens: tokens,
    bytes: fs.statSync(archivePath).size,
    summary: path.basename(archivePath).replace('.md', '.summary.json'),
    summaryGenerated: false
  });

  index.stats.totalRotations++;
  index.stats.lastRotation = new Date().toISOString();

  // Atomic write
  const tempPath = indexPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(index, null, 2));
  fs.renameSync(tempPath, indexPath);
}

/**
 * Lock 획득/해제 (동시성 제어)
 */
function acquireLock(memoryDir) {
  const lockPath = path.join(memoryDir, LOCK_FILE);
  try {
    fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
    return true;
  } catch (e) {
    // Check if stale (> 60 seconds)
    try {
      const stats = fs.statSync(lockPath);
      if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(lockPath);
        return acquireLock(memoryDir);
      }
    } catch (e2) { /* ignore */ }
    return false;
  }
}

function releaseLock(memoryDir) {
  const lockPath = path.join(memoryDir, LOCK_FILE);
  try {
    fs.unlinkSync(lockPath);
  } catch (e) { /* ignore */ }
}

module.exports = {
  estimateTokens,
  estimateTokensFromFile,
  extractTailByTokens,
  readJsonOrDefault,
  getProjectDir,
  updateIndex,
  acquireLock,
  releaseLock
};
```

---

## 2. 파일 명명 규칙

### 현재 메모리 (L2)
```
memory.md                           # 현재 활성 파일
```

### Rotate된 파일 (L2 Archive)
```
memory_20260113_112700.md           # timestamp로 구분
```

### 요약 파일 (L3)
```
memory_20260113_112700.summary.json # JSON 포맷
```

### 인덱스
```
memory-index.json                   # 모든 파일 메타데이터
```

---

## 3. 인덱스 구조

```json
{
  "version": 1,
  "current": "memory.md",
  "rotatedFiles": [
    {
      "file": "memory_20260113_112700.md",
      "rotatedAt": "2026-01-13T11:27:00Z",
      "tokens": 24500,
      "bytes": 98000,
      "lines": 1200,
      "dateRange": { "first": "2026-01-01", "last": "2026-01-13" },
      "summary": "memory_20260113_112700.summary.json",
      "summaryGenerated": true
    }
  ],
  "stats": {
    "totalRotations": 5,
    "lastRotation": "2026-01-13T11:27:00Z"
  }
}
```

---

## 4. Rotation 로직

### 타이밍
`counter.js check()` 에서 크기 체크 후 threshold 초과 시

### Carryover (컨텍스트 유지)
rotation 시 **마지막 2,500 토큰** (~10%, 약 100줄)을 새 memory.md에 복사하여 연속성 유지

```
기존 memory.md (~25,000 토큰)
    │
    ├─► 전체 → memory_20260113_235959.md (archive)
    │
    └─► 마지막 2,500 토큰 → 새 memory.md (carryover)
```

**Carryover 계산**:
1. 파일 끝에서 역순으로 줄 읽기
2. 토큰 수 누적 (문자수 ÷ 4)
3. 2,500 토큰 도달 시 해당 줄까지 포함

---

## 5. L3 요약 생성 - 자동화 메커니즘

### 핵심: Skill + Hook 연동

```
Hook 출력: "[MEMORY_KEEPER_ROTATE] file=memory_20260113_235959.md"
    ↓
Claude가 패턴 인식 → Skill 자동 호출
    ↓
Skill이 Task tool로 Haiku 에이전트 호출
    ↓
Haiku가 파일 읽고 JSON 요약 반환
    ↓
Claude가 .summary.json 저장 + index 업데이트
```

### Skill 자동 호출 메커니즘

**Q: Claude는 어떻게 `[MEMORY_KEEPER_ROTATE]` 패턴을 인식하는가?**

Claude Code는 Hook 출력에서 특정 패턴을 인식하면 자동으로 관련 Skill을 호출함:

1. **플러그인 등록**: `settings.json`에 플러그인 등록 시 skills 디렉토리 경로 지정
2. **Skill description 매칭**: Skill의 `description` 필드에 트리거 패턴 포함
3. **Claude 시스템 프롬프트**: Claude는 Hook 출력을 시스템 메시지로 받아서 Skill 호출 결정

**Skill 등록 위치**:
```
plugin/
  skills/
    memory-rotate/
      SKILL.md          # description에 "[MEMORY_KEEPER_ROTATE]" 포함
```

**Claude Code 동작**:
```
1. Hook 실행 → stdout에 "[MEMORY_KEEPER_ROTATE] file=..." 출력
2. Claude가 이 출력을 <system-reminder> 태그로 받음
3. Claude는 등록된 Skill 중 description 매칭하는 것을 Skill tool로 호출
4. Skill 내용이 로드되어 Claude가 지시사항 따름
```

### 새 에이전트: `agents/memory-summarizer.md`

```markdown
---
name: memory-summarizer
description: Rotate된 memory 파일을 JSON으로 요약
tools: Read
model: haiku
---

## Task
주어진 memory 파일을 읽고 JSON 요약을 출력하라.

## Input
첫 번째 메시지로 파일 경로가 제공됨

## Output Format (MUST follow exactly)
{
  "dateRange": { "first": "YYYY-MM-DD", "last": "YYYY-MM-DD" },
  "sectionCount": 45,
  "themes": [
    {
      "name": "주제명",
      "summary": "이 주제에 대한 상세 요약 (3-5문장)",
      "sessions": ["2026-01-10", "2026-01-12"]
    }
  ],
  "keyDecisions": [
    {
      "decision": "결정 내용",
      "reason": "이유",
      "date": "2026-01-11"
    }
  ],
  "issues": [
    {
      "issue": "이슈 내용",
      "status": "resolved|open",
      "date": "2026-01-12"
    }
  ],
  "overallSummary": "전체 기간에 대한 종합 요약 (10-15문장)"
}

## Rules
- 반드시 위 JSON 포맷으로만 출력
- 추가 설명이나 마크다운 금지
- themes, keyDecisions, issues 각각 최대 10개
```

### 새 스킬: `skills/memory-rotate/SKILL.md`

```markdown
---
name: memory-rotate
description: "[MEMORY_KEEPER_ROTATE]" 트리거 시 자동 실행
---

## 트리거 조건

Hook이 `[MEMORY_KEEPER_ROTATE] file=memory_XXXXXXXX_XXXXXX.md` 출력 시 자동 호출됨.

## 실행 단계

**→ Use Skill tool:** 이 스킬이 호출되면 아래 단계를 순차 실행:

1. **파일 경로 추출**: 트리거 메시지에서 `file=` 뒤의 파일명 파싱
2. **Haiku 에이전트 호출**:
   ```
   Task tool 사용:
   - subagent_type: "memory-keeper:memory-summarizer"
   - model: "haiku"
   - prompt: "Read and summarize: .claude/memory/{파일명}"
   ```
3. **결과 저장**:
   - 반환된 JSON → `.claude/memory/{파일명에서 .md를 .summary.json으로 교체}`
   - 예: `memory_20260113_112700.md` → `memory_20260113_112700.summary.json`
   - Write tool 사용
4. **인덱스 업데이트**:
   - `memory-index.json`의 해당 항목 `summaryGenerated: true`
   - Edit tool 사용

## 실패 처리

- Task 실패 시: 에러 로그 출력, `summaryGenerated: false` 유지
- 다음 세션 시작 시 재시도 트리거 자동 발생
```

### Hook과 Auto-save 우선순위

```
counter.js check() 호출 시:
    │
    ├─► 1. Rotation 체크 (threshold 초과?)
    │       │
    │       YES → Rotation 실행
    │              └─► Hook 출력: [MEMORY_KEEPER_ROTATE]
    │
    └─► 2. Auto-save 체크 (5회 도달?)
            │
            └─► memory.md에 append
                (rotation 발생한 경우 새 파일에 append)
```

**중요**: Rotation이 auto-save보다 먼저 실행됨. 이렇게 해야 carryover 이후의 새 memory.md에 save됨.

---

## 6. Session Start 로드 로직

### load-memory.js 수정사항

0. **초기화 체크** (신규):
   ```javascript
   const { ensureMemoryStructure } = require('./init');
   ensureMemoryStructure(projectDir);  // 디렉토리/인덱스 없으면 생성
   ```
1. **memory.md 로드**: 현재 방식 유지 (마지막 50줄)
2. **이전 L1 tail 로드** (신규):
   - 가장 최근 L1 파일에서 마지막 부분 확인
   - memory.md에 없는 내용이면 컨텍스트에 추가
   - 세션 끝에 memory.md에 저장 못한 내용 보완
3. **최근 L3 요약 로드**:
   - `memory-index.json`에서 가장 최근 rotation 1개의 summary 로드
   - `summaryGenerated: true`인 것만
   - overallSummary 필드를 컨텍스트에 추가

### L1 tail 로드 로직

```javascript
/**
 * 이전 세션 L1에서 memory.md에 없는 내용 추출
 */
function getUnreflectedL1Content(sessionsDir, memoryContent) {
  // 가장 최근 L1 파일 찾기
  const l1Files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l1.jsonl'))
    .sort()
    .reverse();

  if (l1Files.length === 0) return null;

  const latestL1 = path.join(sessionsDir, l1Files[0]);
  const l1Content = fs.readFileSync(latestL1, 'utf8');
  const lines = l1Content.split('\n').filter(l => l.trim());

  // L1 마지막 몇 줄의 핵심 내용 추출
  const tailLines = lines.slice(-20);
  const summary = [];

  for (const line of tailLines) {
    try {
      const entry = JSON.parse(line);
      // assistant 응답 중 요약 가능한 내용만
      if (entry.role === 'assistant' && entry.content) {
        const text = typeof entry.content === 'string'
          ? entry.content
          : entry.content.map(c => c.text || '').join('');
        if (text.length > 50 && !memoryContent.includes(text.substring(0, 50))) {
          summary.push(text.substring(0, 200));
        }
      }
    } catch (e) {}
  }

  return summary.length > 0 ? summary : null;
}
```

### 출력 예시

```
---
## 이전 세션 마무리 (memory.md 미반영분)
[L1 tail에서 추출한 내용]
---
## 이전 메모리 요약 (2026-01-01 ~ 2026-01-13)
[L3 overallSummary 내용]
---
## 최근 세션
[memory.md 마지막 50줄]
```

---

## 7. 에러 핸들링

### 7.1 Rotation 실패 시 (파일 작업)

| 단계 | 실패 시나리오 | 복구 전략 |
|------|--------------|----------|
| archive 복사 | 디스크 공간 부족, 권한 오류 | rotation 중단, 원본 유지, 에러 로그 |
| memory.md 덮어쓰기 | 쓰기 실패 | archive에서 복원, 에러 로그 |
| index 업데이트 | JSON 파싱/쓰기 실패 | archive 파일은 유지, 다음 check()에서 index 재생성 |

**Atomic 보장을 위한 순서**:
```javascript
try {
  // 1. archive 먼저 생성 (원본 보존)
  fs.copyFileSync(memoryPath, archivePath);

  // 2. 새 memory.md를 임시 파일로 생성
  const tempPath = memoryPath + '.tmp';
  fs.writeFileSync(tempPath, carryoverContent);

  // 3. 임시 → 실제 (atomic rename)
  fs.renameSync(tempPath, memoryPath);

  // 4. index 업데이트 (실패해도 파일은 안전)
  updateIndex(archivePath, tokens, memoryDir);
} catch (e) {
  // cleanup: 임시 파일 삭제
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  throw e;
}
```

### 7.2 Skill/Haiku 호출 실패 시

| 실패 유형 | 감지 방법 | 복구 |
|----------|---------|------|
| Task tool 호출 실패 | Skill 내 에러 캐치 | `summaryGenerated: false` 유지 |
| Haiku 타임아웃 | Task timeout | 위와 동일 |
| JSON 파싱 실패 | `JSON.parse()` 예외 | raw 응답 `.summary.raw.txt` 저장 |
| 불완전한 JSON | 필수 필드 누락 | 위와 동일 |

### 7.3 Session Start 복구

`load-memory.js`에서 미생성 요약 감지 시:
```javascript
const pendingSummaries = index.rotatedFiles.filter(f => !f.summaryGenerated);
if (pendingSummaries.length > 0) {
  console.log(`[MEMORY_KEEPER] ${pendingSummaries.length}개 요약 미생성:`);
  pendingSummaries.forEach(f => {
    console.log(`  - ${f.file} (수동 생성 필요)`);
  });
}
```

### 7.4 로그 파일

| 파일 | 내용 |
|------|------|
| `rotation-error.log` | rotation 실패 기록 |
| `summary-error.log` | Haiku 요약 실패 기록 |

---

## 8. 구현할 파일

### 새 파일
| 파일 | 역할 |
|------|------|
| `scripts/constants.js` | 모든 상수 정의 |
| `scripts/utils.js` | 토큰 계산, 파일 유틸리티, lock 함수 |
| `scripts/init.js` | 프로젝트 초기화 (디렉토리 구조 생성) |
| `scripts/search.js` | 통합 검색 (L3 중심) |
| `scripts/legacy-migration.js` | 대용량 레거시 분할 |
| `scripts/memory-rotation.js` | Rotation 로직 (파일 이동, carryover, Hook 출력) |
| `agents/memory-summarizer.md` | Haiku 에이전트 정의 |
| `skills/memory-rotate/SKILL.md` | 자동화 트리거 스킬 |

### `memory-rotation.js` 핵심 구조

```javascript
const {
  estimateTokensFromFile, extractTailByTokens,
  updateIndex, acquireLock, releaseLock, getProjectDir
} = require('./utils');
const {
  ROTATION_THRESHOLD_TOKENS, CARRYOVER_TOKENS,
  getTimestamp, MEMORY_DIR
} = require('./constants');

function checkAndRotate(memoryPath, config) {
  const tokens = estimateTokensFromFile(memoryPath);
  const threshold = config.memoryRotation?.thresholdTokens || ROTATION_THRESHOLD_TOKENS;

  if (tokens < threshold) {
    return null; // rotation 불필요
  }

  const projectDir = getProjectDir();
  const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);

  // Lock 획득 (동시성 제어)
  if (!acquireLock(memoryDir)) {
    console.log('[MEMORY_KEEPER] Another rotation in progress, skipping');
    return null;
  }

  try {
    const timestamp = getTimestamp();
    const archivePath = memoryPath.replace('.md', `_${timestamp}.md`);

    // 1. 전체 파일을 archive로 복사
    fs.copyFileSync(memoryPath, archivePath);

    // 2. carryover 추출 (파일 읽어서 content 전달)
    const carryoverTokens = config.memoryRotation?.carryoverTokens || CARRYOVER_TOKENS;
    const memoryContent = fs.readFileSync(memoryPath, 'utf8');
    const carryoverContent = extractTailByTokens(memoryContent, carryoverTokens);

    // 3. 새 memory.md 생성 (atomic: temp → rename)
    const tempPath = memoryPath + '.tmp';
    fs.writeFileSync(tempPath, carryoverContent);
    fs.renameSync(tempPath, memoryPath);

    // 4. index 업데이트
    updateIndex(archivePath, tokens, memoryDir);

    // 5. Hook 출력 반환
    return {
      rotated: true,
      archiveFile: path.basename(archivePath),
      tokens: tokens,
      hookOutput: `[MEMORY_KEEPER_ROTATE] file=${path.basename(archivePath)}`
    };
  } finally {
    releaseLock(memoryDir);
  }
}
```

### 수정할 파일
| 파일 | 변경 내용 |
|------|-----------|
| `scripts/counter.js` | check()에 rotation 체크 추가 |
| `scripts/load-memory.js` | L3 요약 로드 로직 추가 |

---

## 9. 흐름도

```
Session Start
    │
    ▼
load-memory.js
    ├─► memory.md 마지막 50줄 로드
    ├─► 이전 L1 tail 확인
    │       └─► memory.md에 없는 내용 있으면 컨텍스트에 추가
    │           (이전 세션 끝에 저장 못한 내용 보완)
    └─► memory-index.json 확인
            └─► 최근 L3 요약 있으면 overallSummary 출력

Tool Use (매 5회)
    │
    ▼
counter.js check()
    ├─► memory.md 토큰 수 체크 (bytes ÷ 4)
    │       │
    │       └─► > 23,750 토큰? (5% 마진 적용)
    │               │
    │               YES → memory-rotation.js
    │                       │
    │                       ├─► 전체 → memory_{ts}.md 복사
    │                       ├─► 마지막 2,500 토큰 → 새 memory.md
    │                       ├─► memory-index.json 업데이트 (summaryGenerated: false)
    │                       └─► Hook 출력: "[MEMORY_KEEPER_ROTATE] file=..."
    │                               │
    │                               ▼
    │                       Claude가 Skill 자동 호출
    │                               │
    │                               ▼
    │                       Task(subagent_type="memory-keeper:memory-summarizer")
    │                               │
    │                               ▼
    │                       Haiku가 JSON 요약 반환
    │                               │
    │                               ▼
    │                       .summary.json 저장
    │                       summaryGenerated: true로 업데이트
    │
    └─► save instruction 출력 (새 memory.md에)

Session End
    │
    ▼
counter.js final()
    ├─► L1 생성 (세션 transcript → .l1.jsonl) - 자동
    └─► memory.md 추가 불가 (Claude 이미 종료됨)
            └─► 다음 Session Start에서 L1 tail로 보완
```

---

## 10. 설정 옵션

`config.json`:
```json
{
  "saveInterval": 5,
  "memoryRotation": {
    "enabled": true,
    "thresholdTokens": 25000,
    "carryoverTokens": 2500
  }
}
```

**토큰 계산**: `Math.ceil(fileBytes / 4)` (평균 4바이트/토큰)

**참고**: Rotate된 파일은 무제한 보관

---

## 11. 검증 방법

### 11.1 단위 테스트

| 테스트 | 입력 | 기대 결과 |
|--------|------|----------|
| `estimateTokens()` | "Hello World" (11 bytes) | 3 토큰 |
| `estimateTokens()` | 한글 10자 (30 bytes UTF-8) | 8 토큰 |
| `estimateTokensFromFile()` | 100KB 파일 | ~25,000 토큰 |
| `extractTailByTokens()` | 1000줄, 2500 토큰 요청 | ~100줄 반환 |

### 11.2 통합 테스트 시나리오

**시나리오 A: 정상 Rotation**
```bash
# 1. 테스트 데이터 생성 (100KB+)
node -e "console.log('## Test\\n'.repeat(3000))" > .claude/memory/memory.md

# 2. check() 트리거
node scripts/counter.js check

# 3. 검증
ls .claude/memory/memory_*.md          # archive 존재 (underscore)
wc -c .claude/memory/memory.md          # ~10KB (carryover)
cat .claude/memory/memory-index.json    # summaryGenerated: false
```

**시나리오 B: Threshold 미달**
```bash
# 50KB 파일 (threshold 미달)
node -e "console.log('## Test\\n'.repeat(1500))" > .claude/memory/memory.md
node scripts/counter.js check
# 결과: rotation 없음
```

**시나리오 C: Haiku 요약 실패 복구**
```bash
# 1. summaryGenerated: false인 파일 있는 상태에서
# 2. 세션 시작
node scripts/load-memory.js
# 결과: "1개 요약 미생성" 메시지 출력
```

### 11.3 Edge Cases

| 케이스 | 테스트 방법 | 기대 동작 |
|--------|------------|----------|
| 빈 memory.md | 0 byte 파일 | rotation 안함 |
| threshold 미만 (23,749 토큰) | ~95KB 파일 | rotation 안함 |
| threshold 이상 (23,750+ 토큰) | ~95KB+ 파일 | rotation 발생 |
| 한글만 있는 파일 | UTF-8 한글 | 토큰 계산 정확 |
| 동시 rotation | 2개 세션 동시 | 파일 잠금 또는 순차 처리 |
| index 손상 | 잘못된 JSON | 새 index 생성 |

### 11.4 E2E 테스트 체크리스트

- [ ] memory.md 100KB+ 생성
- [ ] tool 사용 5회 → check() 트리거
- [ ] archive 파일 생성됨
- [ ] 새 memory.md는 ~10KB
- [ ] memory-index.json 업데이트됨
- [ ] Hook 출력: `[MEMORY_KEEPER_ROTATE]`
- [ ] Skill 자동 호출됨
- [ ] Haiku 에이전트 실행됨
- [ ] .summary.json 생성됨
- [ ] summaryGenerated: true로 업데이트
- [ ] 다음 세션 시작 시 L3 요약 로드됨

### 11.5 테스트 파일 구조

```
tests/
├── unit/
│   ├── constants.test.js      # 상수 값 검증
│   ├── utils.test.js          # estimateTokens, extractTailByTokens
│   ├── init.test.js           # ensureMemoryStructure
│   └── legacy-migration.test.js  # parseDateSections, forceSplitSection
│
├── integration/
│   ├── rotation.test.js       # 전체 rotation 흐름
│   ├── load-memory.test.js    # L3 로드 + 레거시 호환
│   └── search.test.js         # 검색 우선순위 검증
│
├── fixtures/
│   ├── large-memory.md        # 100KB+ 테스트 데이터
│   ├── legacy-memory.md       # 레거시 포맷 테스트
│   ├── sample-index.json      # 인덱스 테스트
│   └── sample-summary.json    # L3 요약 테스트
│
└── e2e/
    └── full-cycle.test.js     # 전체 세션 사이클 테스트
```

**테스트 실행**:
```bash
# 단위 테스트
npm test -- --grep "unit"

# 통합 테스트
npm test -- --grep "integration"

# 전체
npm test
```

---


## 12. 검토 결과 - 해결된 문제

> 아래 문제들은 검토 과정에서 발견되어 **본문에 통합 완료**됨

| # | 문제 | 해결 위치 |
|---|------|----------|
| 12.1 | 신규 프로젝트 초기화 | Section 7: `init.js` - `ensureMemoryStructure()` |
| 12.2 | 동시 접근 (Concurrency) | Section 7: `utils.js` - `acquireLock()`, `releaseLock()` |
| 12.3 | Threshold 값 불일치 | 전체 문서에서 23,750 토큰으로 통일 |
| 12.4 | Agent/Skill 경로 | Section 7.1 참조 |
| 12.5 | Haiku 실패 시 재시도 | Section 8: `skills/memory-rotate/SKILL.md` |
| 12.6 | 디스크 공간 관리 | Section 7: `config.json` 옵션 |
| 12.7 | Cross-Platform 경로 | Section 7: 모든 코드에서 `path.join()` 사용 |
| 12.8 | 날짜 파싱 정규식 | Section 7: `legacy-migration.js` - `parseDateSections()` |
| 12.9 | 사용자 검색 인터페이스 | Section 0: `search.js` - `searchMemory()`, `searchL3Summaries()` |
| 12.10 | Skill 트리거 신뢰성 | Section 7: `load-memory.js` 미생성 요약 감지 |
| 12.11 | memory-index keywords/themes 중복 | Section 0: L3에 있으므로 index에서 제거 |
| 12.12 | Session end 시 memory.md 누락 | Section 6: `load-memory.js`에서 L1 tail 로드 |
| 12.13 | facts.json 불필요 | 제거됨 - L3 keyDecisions와 중복 |
| 12.14 | L2 archive 검색 누락 | Section 0: `searchL2Archives()` 추가, 검색 순서 4단계로 확장 |

### 미래 고려사항 (V2)

- **Archive 보관 정책**: 무제한 기본, `maxArchives`/`archiveRetentionDays` config로 제한 가능
- **재시도 전략**: exponential backoff (1s, 2s, 4s) 3회 재시도
- **Override 구조**: 플러그인 기본값, 프로젝트 `.claude/`에서 override 가능

---
## 13. 구현 전 필수 결정 사항

| # | 질문 | 선택지 | 권장 |
|---|------|--------|------|
| 1 | config.json 위치 | 프로젝트 / 글로벌 / 둘다 | 프로젝트 우선, 글로벌 fallback |
| 2 | Agent/Skill 위치 | 플러그인 내 / 프로젝트 내 | 플러그인 기본, 프로젝트 override |
| 3 | Archive 보관 정책 | 무제한 / 개수 제한 / 기간 제한 | 무제한 (config로 변경 가능) |
| 4 | 동시성 처리 | Lock file / 무시 | Lock file |
| 5 | 실패 재시도 | 즉시 / 다음 세션 / 둘다 | 즉시 3회 + 다음 세션 |
