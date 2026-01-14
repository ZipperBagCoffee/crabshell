# Facts.json 제거 및 Memory.md 단일화 계획

## 배경
- facts.json과 memory.md 내용 중복
- facts.json은 L1 추적 불가 (날짜만 있음)
- 두 시스템 병행 유지는 비효율
- L1 파일 중복 저장 (같은 세션에서 여러 스냅샷 → 83% 공간 낭비)
- lastlog.json: 이전 세션에서 시도했으나 Edit 실패로 미완료

## 목표
1. facts.json 시스템 완전 제거
2. 카운터를 memory-index.json으로 이전
3. memory.md를 유일한 롤링 메모리로 단일화
4. L1 중복 제거 (세션당 하나만 유지)
5. memory.md → L1 추적 개선

---

## Phase 0: 카운터 이전 (선행 작업)

### 현재 상태
```javascript
// counter.js line 119-128
// Counter stored in facts.json._meta.counter
function getCounter() {
  const facts = loadFacts();
  return facts._meta.counter || 0;
}

function setCounter(value) {
  const facts = loadFacts();
  facts._meta.counter = value;
  saveFacts(facts);
}
```

### 변경 후
```javascript
// memory-index.json 사용
function getCounter() {
  const indexPath = path.join(getProjectDir(), '.claude', MEMORY_DIR, 'memory-index.json');
  const index = readJsonOrDefault(indexPath, { counter: 0 });
  return index.counter || 0;
}

function setCounter(value) {
  const indexPath = path.join(getProjectDir(), '.claude', MEMORY_DIR, 'memory-index.json');
  const index = readJsonOrDefault(indexPath, {});
  index.counter = value;
  writeJson(indexPath, index);
}
```

### memory-index.json 구조 변경
```json
{
  "version": 1,
  "current": "memory.md",
  "counter": 0,          // ← 추가
  "rotatedFiles": [],
  "stats": {
    "totalRotations": 0,
    "lastRotation": null
  }
}
```

---

## Phase 1: counter.js 정리

### 제거할 함수
| 함수 | 라인 | 용도 |
|------|------|------|
| `getFactsPath()` | 62-65 | facts.json 경로 |
| `loadFacts()` | 67-97 | facts.json 로드 |
| `updateConceptsIndex()` | 100+ | concepts 인덱스 |
| `saveFacts()` | 115+ | facts.json 저장 |
| `stripPrivate()` | 406-408 | private 태그 제거 |
| `VALID_TYPES` | 411-415 | 타입 상수 |
| `parseList()` | 418-421 | 파싱 유틸 |
| `addDecision()` | 424+ | decision 추가 |
| `addPattern()` | 450+ | pattern 추가 |
| `addIssue()` | 474+ | issue 추가 |
| `search()` 내 facts 검색 | 499+ | facts 검색 |
| `clearFacts()` | 628+ | facts 초기화 |
| `extractFacts()` | (해당 라인) | facts 추출 |

### 제거할 case문
- `add-decision` (line 1001)
- `add-pattern` (line 1005)
- `add-issue` (line 1009)
- `search` (line 1013) - facts.json 검색용
- `clear-facts` (line 1023)
- `extract-facts` (line 1026)

### check() 출력 수정 (line 151-185)
**제거:**
- Steps 2-4: add-decision, add-pattern, add-issue 지침

**유지:**
- Step 1: memory.md append

### final() 출력 수정 (line 326-390)
**제거:**
- Steps 2-4: add-decision, add-pattern, add-issue 지침
- Step 6 전체: add-rule, add-solution, add-core-logic (이미 삭제된 permanent-memory.js 참조)

**유지:**
- Step 1: memory.md append
- Step 5: compress

---

## Phase 2: Skills 수정

### save-memory/SKILL.md
**제거:** `extract-facts` 호출 (line 47-49)

**유지:** memory.md append + 세션 파일 생성

### search-memory/SKILL.md
**제거:** Legacy facts search 섹션 전체 (line 32-53)
- `search --type=X`
- `search --concept=X`
- `search --file=X`

**유지:** `search-memory` 명령어만 (L1/L2/L3 검색)

### clear-memory/SKILL.md
**제거:** `clear-facts` 호출 (line 29-31, 45)

**유지:** `compress` 명령어만

---

## Phase 3: L1 중복 제거

### 현재 문제
```
같은 세션에서 compact 될 때마다 L1 생성:
0032.l1.jsonl (94 lines)   ← 세션 시작~08:32
0034.l1.jsonl (117 lines)  ← 세션 시작~08:34 (0032 내용 포함)
0039.l1.jsonl (147 lines)  ← 세션 시작~08:39 (모든 내용 포함)

총 7개 파일 = 197KB, 실제 필요한 건 마지막 1개 = 33KB
→ 83% 공간 낭비
```

### 해결 방안
final()에서 L1 생성 후, 같은 세션의 이전 L1 삭제

### 같은 세션 판별 기준
L1 파일의 **첫 번째 타임스탬프**가 동일 = 같은 세션

### 구현
```javascript
// counter.js final() 끝에 추가
function cleanupDuplicateL1(newL1Path) {
  const sessionsDir = path.dirname(newL1Path);
  const newL1Content = fs.readFileSync(newL1Path, 'utf8');
  const newL1FirstLine = newL1Content.split('\n')[0];

  let sessionStartTs;
  try {
    sessionStartTs = JSON.parse(newL1FirstLine).ts;
  } catch (e) {
    return; // 파싱 실패시 스킵
  }

  const newL1Size = fs.statSync(newL1Path).size;
  const newL1Name = path.basename(newL1Path);

  // 같은 세션의 L1 파일들 찾아서 삭제
  const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));

  for (const fileName of l1Files) {
    if (fileName === newL1Name) continue;

    const filePath = path.join(sessionsDir, fileName);
    const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];

    try {
      const fileStartTs = JSON.parse(firstLine).ts;
      const fileSize = fs.statSync(filePath).size;

      // 같은 세션이고 새 파일보다 작으면 삭제
      if (fileStartTs === sessionStartTs && fileSize < newL1Size) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      continue;
    }
  }
}
```

### 효과
| 항목 | Before | After |
|------|--------|-------|
| 파일 수 | 7개 | 1개 |
| 저장 공간 | 197KB | 33KB |
| 검색 대상 | 여러 파일 | 1개 파일 |

---

## Phase 4: Memory.md → L1 추적 개선

### Phase 3 적용 후 상황
```
memory.md: ## 2026-01-13_0830
L1 파일:   2026-01-13_0839.l1.jsonl (세션 유일한 L1)
           ↳ 내용 시간 범위: 08:27 ~ 08:39
```

### 검색 로직 (Phase 3 적용 후)
세션당 L1이 하나이므로 **시간 범위** 기반 매칭:

1. L1 파일의 시간 범위 파악
   - 시작: 첫 줄 타임스탬프 (08:27)
   - 끝: 파일명 타임스탬프 (0839)

2. memory.md 타임스탬프가 이 범위에 포함되면 매칭
   - 0830은 08:27~08:39 범위 안 → 0839.l1.jsonl에서 검색

### 구현 위치
`scripts/search.js`의 `searchL1Sessions()` 함수 수정:

```javascript
function findL1ForTimestamp(timestamp, sessionsDir) {
  // timestamp: "2026-01-13_0830" 형식
  const targetTime = parseTimestamp(timestamp); // Date 객체로 변환

  const l1Files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l1.jsonl'))
    .map(f => {
      const filePath = path.join(sessionsDir, f);
      const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
      const startTs = JSON.parse(firstLine).ts;
      const endTs = parseFilenameTimestamp(f); // 파일명에서 추출
      return { file: f, start: new Date(startTs), end: endTs };
    });

  // 타임스탬프가 범위 안에 있는 L1 찾기
  return l1Files.find(l1 => targetTime >= l1.start && targetTime <= l1.end);
}
```

---

## Phase 5: 파일/문서 정리

### 삭제
- `.claude/memory/facts.json`

### 문서 업데이트
- README.md - facts 명령어 제거
- STRUCTURE.md - facts.json 참조 제거
- docs/USER-MANUAL.md - facts 관련 내용 제거
- docs/ARCHITECTURE.md - facts 시스템 설명 제거, L1 중복 제거 설명 추가

---

## 작업 순서

1. **Phase 0**: getCounter/setCounter → memory-index.json 사용하도록 수정
2. **Phase 1**: counter.js에서 facts 관련 함수/case문 제거
3. **Phase 1**: check/final 출력 수정
4. **Phase 2**: skills 3개 수정
5. **Phase 3**: final()에 cleanupDuplicateL1() 추가
6. **Phase 4**: search.js L1 추적 로직 개선 (시간 범위 기반)
7. **Phase 5**: facts.json 삭제 + 문서 업데이트
8. **검증**: `node --check scripts/counter.js`
9. **테스트**: check, search-memory, compress, L1 중복 제거 확인
10. **커밋 & 푸시**

---

## 검증 명령어

```bash
# 문법 확인
node --check scripts/counter.js

# 카운터 동작 (memory-index.json 사용 확인)
node scripts/counter.js check
cat .claude/memory/memory-index.json | grep counter

# search-memory 동작
node scripts/counter.js search-memory "test"

# L1 중복 제거 확인 (같은 세션 시작 타임스탬프 가진 파일이 하나만 있어야 함)
ls -la .claude/memory/sessions/*.l1.jsonl

# compress 동작
node scripts/counter.js compress
```
