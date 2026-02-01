# Delta 추출 시간 기록 문제 분석

## 현재 상태

- `lastMemoryUpdateTs`: **null** (한 번도 설정된 적 없음)
- 결과: 매번 "첫 실행 모드"로 동작하여 최신 50개 엔트리만 추출

---

## 문제 분석

### 1. 데이터 흐름

```
L1 파일 생성 (refine-raw.js)
    ↓
entry.ts = "2026-02-01T16:39:24.052Z" (ISO 8601 UTC)
    ↓
counter.js 25턴 → extractDelta() 호출
    ↓
delta_temp.txt 생성 (lastMemoryUpdateTs 이후 엔트리만)
    ↓
inject-rules.js가 delta 감지 → DELTA_INSTRUCTION 주입
    ↓
Claude가 memory-delta 스킬 실행 (Haiku 요약 → memory.md 추가)
    ↓
mark-updated 명령 → lastMemoryUpdateTs = new Date().toISOString()
    ↓
cleanup 명령 → delta_temp.txt 삭제
```

### 2. 핵심 문제: mark-updated가 실행되지 않음

**원인 체인:**
1. `counter.js`가 25턴마다 `extractDelta()` 호출
2. `delta_temp.txt` 생성됨
3. `inject-rules.js`가 UserPromptSubmit 훅에서 delta 감지
4. `DELTA_INSTRUCTION`을 additionalContext로 주입
5. **Claude가 DELTA_INSTRUCTION을 무시하거나 스킬 실행 실패**
6. `mark-updated` 명령이 호출되지 않음
7. `lastMemoryUpdateTs`가 계속 null

**증거:**
- memory-index.json의 `lastMemoryUpdateTs: null`
- delta_temp.txt가 오랜 시간 존재 (inject-debug.log에서 delta=true 반복)

### 3. 타임스탬프 비교 로직

```javascript
// extract-delta.js:45
if (lastUpdateTs && entry.ts && entry.ts <= lastUpdateTs) {
  skippedCount++;
  continue;
}
```

- `lastUpdateTs`가 null이면 조건이 항상 false
- 모든 L1 엔트리가 delta에 포함됨
- `FIRST_RUN_MAX_ENTRIES`(50개)로 제한

### 4. 시간 형식 일치 여부 (문제 아님)

| 소스 | 형식 | 예시 |
|------|------|------|
| L1 entry.ts | ISO 8601 UTC | `2026-02-01T16:39:24.052Z` |
| lastMemoryUpdateTs | ISO 8601 UTC | `2026-02-01T11:48:00.000Z` |

형식은 일치함. 문자열 비교로 시간 순서 비교 가능.

---

## 근본 원인

### additionalContext의 한계

```javascript
// inject-rules.js:210-216
const output = {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: context  // DELTA_INSTRUCTION 포함
  }
};
```

**additionalContext는 Claude에게 "힌트"일 뿐, 강제 실행 메커니즘이 아님:**
- Claude가 사용자 질문에 먼저 응답할 수 있음
- 스킬 실행을 잊거나 우선순위를 낮게 판단할 수 있음
- 컨텍스트가 길면 DELTA_INSTRUCTION이 묻힐 수 있음

---

## 해결 방안

### 방안 A: Claude 의존성 제거 - 직접 Haiku API 호출

**개념:** 훅 스크립트에서 직접 Anthropic API를 호출하여 delta 요약

```javascript
// 훅에서 직접 처리
async function processDelta() {
  const deltaContent = fs.readFileSync(deltaPath, 'utf8');
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    messages: [{ role: 'user', content: `Summarize:\n${deltaContent}` }]
  });
  fs.appendFileSync(memoryPath, `\n## ${timestamp}\n${response.content[0].text}\n`);
  markMemoryUpdated();
  cleanupDeltaTemp();
}
```

**장점:**
- Claude 응답 여부와 무관하게 확실히 실행
- 훅 내에서 완결되는 원자적 처리

**단점:**
- API 키 관리 필요 (환경변수 또는 설정파일)
- 훅 실행 시간 증가 (API 호출 대기)
- 비용 발생 (사용자 API 키 사용)

### 방안 B: 요약 없이 raw delta 저장

**개념:** Haiku 요약을 건너뛰고 delta 내용을 직접 memory.md에 추가

```javascript
// counter.js에서 직접 처리
function processDeltaDirectly() {
  const deltaContent = fs.readFileSync(deltaPath, 'utf8');
  const summary = extractKeyPoints(deltaContent);  // 로컬 추출
  fs.appendFileSync(memoryPath, `\n## ${timestamp}\n${summary}\n`);
  markMemoryUpdated();
  fs.unlinkSync(deltaPath);
}
```

**장점:**
- API 호출 불필요
- 즉시 처리 가능

**단점:**
- 요약 품질 저하 (단순 추출 vs LLM 요약)
- memory.md 크기 급증 가능

### 방안 C: 세션 종료 시점에만 처리

**개념:** 실시간 delta 처리를 포기하고 세션 종료 시 일괄 처리

```javascript
// counter.js final()에서만 처리
async function final() {
  // ... L1 생성 후
  const deltaResult = extractDelta();
  if (deltaResult.success) {
    // exit(2)로 Claude에게 강제 스킬 호출 유도
    // 또는 systemMessage로 명령
  }
}
```

**장점:**
- 기존 메커니즘 활용
- 세션 종료 시점은 Claude 응답이 필수가 아님

**단점:**
- 실시간 메모리 업데이트 불가
- 긴 세션에서 컨텍스트 누적 문제

### 방안 D: exit(2) 복원 + 스킬 자동 호출 강화

**개념:** 현재 주석 처리된 exit(2) 방식을 복원하고 스킬 호출 신뢰성 개선

```javascript
// counter.js:108-117 (현재 주석 처리됨)
console.error(instructions);
process.exit(2);
```

**장점:**
- 기존 설계 의도 복원
- PostToolUse 훅이 Claude에게 직접 전달됨

**단점:**
- 주석 처리된 이유가 있음 ("skill auto-invoke unreliable")
- 근본적인 스킬 호출 신뢰성 문제 미해결

---

## 권장 해결책

### 단기: 방안 B (로컬 요약 + 직접 처리)

1. `extractDelta()`에서 delta 생성 후 바로 처리
2. 로컬 함수로 핵심 포인트 추출 (완전한 요약 대신)
3. memory.md에 즉시 추가
4. `markMemoryUpdated()` 호출
5. delta_temp.txt 삭제

```javascript
// extract-delta.js에 추가
function processAndAppendDelta() {
  const result = extractDelta();
  if (!result.success) return result;

  const deltaContent = fs.readFileSync(deltaPath, 'utf8');
  const keyPoints = extractKeyPoints(deltaContent);  // 간단한 로컬 추출

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_');
  fs.appendFileSync(memoryPath, `\n## ${timestamp}\n${keyPoints}\n`);

  markMemoryUpdated();
  fs.unlinkSync(deltaPath);

  return { ...result, processed: true };
}

function extractKeyPoints(content) {
  const lines = content.split('\n\n');
  // User/Assistant 메시지 중 핵심만 추출
  const userMsgs = lines.filter(l => l.startsWith('[User]:'));
  const assistMsgs = lines.filter(l => l.startsWith('[Assistant]:'));
  // 최근 5개씩만
  return [...userMsgs.slice(-3), ...assistMsgs.slice(-3)].join('\n');
}
```

### 중기: 방안 A (Haiku API 직접 호출)

사용자가 API 키를 설정한 경우에만 활성화:
1. 설정 파일에 `apiKey` 또는 `ANTHROPIC_API_KEY` 환경변수 확인
2. 있으면 Haiku API 호출
3. 없으면 방안 B로 폴백

---

## 즉시 수정 가능한 버그

### lastMemoryUpdateTs 초기화 누락

현재 memory-index.json에 `lastMemoryUpdateTs: null`이 있으므로, 수동으로 현재 시간으로 설정하면 다음 delta부터 정상 필터링됨:

```bash
node -e "
const fs = require('fs');
const p = '.claude/memory/memory-index.json';
const idx = JSON.parse(fs.readFileSync(p));
idx.lastMemoryUpdateTs = new Date().toISOString();
fs.writeFileSync(p, JSON.stringify(idx, null, 2));
console.log('Updated:', idx.lastMemoryUpdateTs);
"
```

단, 이는 임시 방편이며 근본 원인(mark-updated 미실행)은 해결되지 않음.

---

## 결론

**근본 원인:** Claude가 additionalContext의 DELTA_INSTRUCTION을 무시하여 mark-updated가 실행되지 않음

**권장 해결:**
1. 단기: 로컬 요약 + counter.js에서 직접 처리
2. 중기: Haiku API 직접 호출 (선택적)
3. Claude 의존성 최소화가 핵심
