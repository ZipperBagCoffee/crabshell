# Trigger Mechanism Analysis

Date: 2026-01-14

## 1. L1 생성 시점

### Claude Code Hook 실행 시점

[공식 문서](https://code.claude.com/docs/en/hooks)에 따르면:

| Hook | 실행 시점 |
|------|-----------|
| **Stop** | AI 응답이 끝날 때마다 (매 turn) |
| **SessionEnd** | 세션이 완전히 종료될 때 |

**핵심**: Stop hook은 "세션 종료" 시가 아니라 **매 응답 종료 시** 실행됨.

### 타임라인 흐름

```
Turn 1:
  User prompt
    │
    ├─► UserPromptSubmit hook → inject-rules.js
    │       └─► RULES 주입, delta/rotation pending 감지
    │
    ├─► Claude responds (tools)
    │       │
    │       └─► [매 Tool 사용] PostToolUse hook → counter.js check()
    │               │
    │               ├─► counter++
    │               ├─► checkAndRotate() - rotation 체크
    │               │
    │               └─► counter >= 5?
    │                       │
    │                       YES → extractDelta() 호출
    │                               │
    │                               ├─► L1에서 lastMemoryUpdateTs 이후 엔트리 추출
    │                               ├─► delta_temp.txt 생성
    │                               └─► counter = 0
    │
    └─► Stop hook → counter.js final() → L1 생성/업데이트

Turn 2:
  User prompt
    │
    ├─► UserPromptSubmit hook → inject-rules.js
    │       │
    │       └─► delta_temp.txt 존재?
    │               │
    │               YES → additionalContext에 INSTRUCTION 주입
    │                       │
    │                       ▼
    │               Claude가 memory-delta skill 실행
    │                       │
    │                       ├─► Haiku가 delta_temp.txt 요약
    │                       ├─► memory.md에 추가
    │                       ├─► lastMemoryUpdateTs 업데이트
    │                       └─► delta_temp.txt 삭제
    │
    ├─► Claude uses tools
    │       │
    │       └─► PostToolUse → check() → extractDelta() → 현재 세션 L1 읽음
    │
    └─► Stop hook → L1 업데이트
```

### 요약

| 파일 | 생성 시점 | 트리거 | 소스 |
|------|-----------|--------|------|
| **L1.jsonl** | 매 turn 종료 | Stop hook → final() | raw.jsonl 변환 |
| **delta_temp.txt** | Tool 5회 사용 후 | PostToolUse → check() | 현재 세션 L1 (이전 turn) |
| **memory.md 요약** | 다음 프롬프트 | UserPromptSubmit → inject-rules.js | Haiku가 delta_temp.txt 요약 |

---

## 2. Hook 출력 형식

### Claude Code Hook 출력 방식 (공식)

| Hook | 출력 형식 | Claude 전달 여부 |
|------|-----------|------------------|
| **SessionStart** | Plain text stdout | ✅ context로 추가 |
| **SessionStart** | JSON additionalContext | ✅ 더 깔끔하게 추가 |
| **UserPromptSubmit** | JSON additionalContext | ✅ 확실히 전달 |
| **PostToolUse** | Plain text stdout | ⚠️ 불안정 ([버그 보고](https://github.com/anthropics/claude-code/issues/3983)) |
| **PostToolUse** | JSON output | ❌ 버그: 처리 안 됨 |
| **Stop** | systemMessage | ⚠️ 사용자에게만, Claude 불확실 |

### Exit Code 동작

| Exit Code | 동작 |
|-----------|------|
| 0 | stdout을 JSON으로 파싱 시도. additionalContext 추출 |
| 2 | Blocking error. stderr가 Claude에게 전달됨 |
| 기타 | Non-blocking. verbose mode에서만 stderr 표시 |

**결론: UserPromptSubmit + JSON additionalContext가 가장 신뢰성 있는 전달 방식**

---

## 3. 현재 코드 문제점

### 3.1 counter.js:97 (PostToolUse) - Rotation 트리거

```javascript
if (rotationResult) {
  console.log(rotationResult.hookOutput);  // "[MEMORY_KEEPER_ROTATE] file=xxx"
}
```

**문제**: PostToolUse plain text stdout → Claude에게 불안정하게 전달

**영향**: Rotation은 발생하지만 Claude가 `memory-rotate` skill을 실행하지 않음

### 3.2 load-memory.js:53-54 (SessionStart) - Pending Summaries

```javascript
const pending = rotatedFiles.filter(f => !f.summaryGenerated);
if (pending.length > 0) {
  console.log('[MEMORY_KEEPER] ' + pending.length + ' summaries pending:');
  pending.forEach(f => console.log('  - ' + f.file));
}
```

**문제**: Plain text stdout은 Claude에게 전달되지만, **INSTRUCTION이 아닌 정보성 텍스트**

**영향**: Claude가 pending summary를 보지만 행동을 취하지 않음 (명시적 지시 없음)

### 3.3 counter.js:263 (Stop) - Session Save / Delta

```javascript
const output = {
  systemMessage: systemMsg  // "[MEMORY_KEEPER] Session saved..." + delta info
};
console.log(JSON.stringify(output));
```

**문제**: `systemMessage`는 사용자에게만 표시될 수 있음

**영향 없음**: 다음 세션의 inject-rules.js가 delta_temp.txt를 감지하므로 실제로는 괜찮음

---

## 4. 해결 방안

### 핵심 원칙

모든 중요한 트리거를 **inject-rules.js (UserPromptSubmit)**에서 감지하고 INSTRUCTION으로 주입

### 구현할 기능

| 감지 대상 | 현재 상태 | 필요한 조치 |
|-----------|-----------|-------------|
| delta_temp.txt 존재 | ✅ 구현됨 | - |
| summaryGenerated: false | ❌ 없음 | inject-rules.js에 추가 |

### inject-rules.js 수정안

```javascript
// === 추가할 상수 ===
const ROTATION_INSTRUCTION = `
## MEMORY KEEPER ROTATION INSTRUCTION
INSTRUCTION: Rotation summaries pending. Execute memory-rotate skill NOW.

Steps:
1. Use the Skill tool: skill="memory-rotate"
2. The skill will trigger Haiku to generate L3 summary

Execute after delta processing (if any). DO NOT skip.
`;

// === 추가할 함수 ===
function checkRotationPending(projectDir) {
  const indexPath = path.join(projectDir, '.claude', 'memory', 'memory-index.json');
  const index = readJsonSafe(indexPath, {});
  const rotatedFiles = index.rotatedFiles || [];
  return rotatedFiles.filter(f => !f.summaryGenerated);
}

// === main() 수정 ===
function main() {
  try {
    const projectDir = getProjectDir();
    // ... 기존 frequency 로직 ...

    // Check for pending delta
    const hasPendingDelta = checkDeltaPending(projectDir);

    // Check for pending rotation summaries
    const pendingRotations = checkRotationPending(projectDir);

    // Build context
    let context = RULES;

    if (hasPendingDelta) {
      context += DELTA_INSTRUCTION;
    }

    if (pendingRotations.length > 0) {
      context += `\n${ROTATION_INSTRUCTION}\nFiles: ${pendingRotations.map(f => f.file).join(', ')}`;
    }

    // ... 나머지 출력 로직 ...
  } catch (e) {
    // ... 에러 처리 ...
  }
}
```

### 처리 우선순위

동일 프롬프트에서 delta와 rotation이 모두 pending인 경우:

1. **Delta 먼저** - 현재 세션 내용 반영 (빠름)
2. **Rotation 후** - L3 요약 생성 (Haiku 호출 필요)

---

## 5. 예상 플로우

### Rotation 발생 시

```
Tool 사용 (PostToolUse)
    ↓
counter.js check() → checkAndRotate() 실행
    ↓
memory.md 아카이브, memory-index.json에 { file: "xxx", summaryGenerated: false } 추가
    ↓
console.log("[MEMORY_KEEPER_ROTATE]...") → Claude 못 봄 (PostToolUse 한계)
    ↓
다음 User Prompt
    ↓
inject-rules.js (UserPromptSubmit) 실행
    ↓
checkRotationPending() → summaryGenerated: false 발견
    ↓
ROTATION_INSTRUCTION을 additionalContext에 추가
    ↓
Claude가 memory-rotate skill 실행
    ↓
Haiku가 L3 요약 생성, summaryGenerated: true 업데이트
```

---

## 6. 타임스탬프

파일명은 로컬 시간, 내부 ts 필드는 UTC 사용. 로직에 문제 없음 (둘 다 UTC로 비교).
가독성 개선이 필요하면 추후 통일 고려 (낮은 우선순위).

---

## 7. 권장 사항

### 즉시 필요

| 문제 | 해결책 | 우선순위 |
|------|--------|----------|
| Rotation 트리거 미전달 | inject-rules.js에 pending summary 감지 추가 | **높음** |

### 개선 권장

| 문제 | 해결책 | 우선순위 |
|------|--------|----------|
| 타임스탬프 불일치 | 전부 UTC 또는 전부 로컬로 통일 | 낮음 |
| Exit code 2 주석 코드 | counter.js에서 완전 제거 | 낮음 |

### 수정 필요 파일

| 파일 | 수정 내용 |
|------|-----------|
| scripts/inject-rules.js | checkRotationPending() 함수, ROTATION_INSTRUCTION 추가 |

### 수정 불필요 파일

| 파일 | 이유 |
|------|------|
| counter.js | rotation 자체는 정상 작동 |
| load-memory.js | 정보 로그로 유지 |
| memory-rotation.js | 변경 불필요 |

---

## Sources

- [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [PostToolUse hook JSON output bug #3983](https://github.com/anthropics/claude-code/issues/3983)
