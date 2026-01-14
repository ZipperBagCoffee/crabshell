# Delta Trigger Investigation Report

## Date: 2026-01-14

## Problem Statement

`delta_temp.txt`가 생성되지만, `lastMemoryUpdateTs`가 `memory-index.json`에 기록되지 않음.
즉, delta 추출은 되지만 후속 처리(Haiku 요약 → memory.md 저장 → mark-updated)가 실행 안 됨.

---

## Investigation Flow

### 1. counter.js check() 분석

```javascript
// Line 105-113
if (deltaResult.success) {
  const instructions = `...
[MEMORY_KEEPER_DELTA] file=${deltaResult.deltaFile}
...`;
  setCounter(0);
  console.error(instructions);  // stderr 출력
  process.exit(2);              // exit code 2
}
```

**발견:** `console.error()` + `process.exit(2)` 사용

### 2. inject-rules.js와 비교

```javascript
// inject-rules.js (정상 동작)
console.log(JSON.stringify(output));  // stdout + JSON
// exit code 0 (default)
```

**차이점:** inject-rules.js는 stdout + exit 0, counter.js는 stderr + exit 2

### 3. 왜 exit code 2를 사용했는가?

Claude Code PostToolUse hook의 출력 가시성 규칙:

| Exit Code | Stream | 사용자 보임 | Claude 보임 |
|-----------|--------|-------------|-------------|
| 0 | stdout | ✅ | ❌ |
| 1, 3+ | any | ✅ (error) | ❌ |
| **2** | **stderr** | ✅ | **✅** |

**결론:** PostToolUse에서 Claude에게 출력을 전달하려면 **exit code 2 + stderr가 유일한 방법**

**참고:**
- [Issue #11224](https://github.com/anthropics/claude-code/issues/11224) - PostToolUse hook output visibility
- [Issue #3983](https://github.com/anthropics/claude-code/issues/3983) - PostToolUse hook JSON output not processed

### 4. UserPromptSubmit vs PostToolUse 차이

| Hook | Exit 0 + stdout | Claude에게 전달 |
|------|-----------------|-----------------|
| **UserPromptSubmit** | JSON → additionalContext | ✅ Yes |
| **PostToolUse** | 사용자만 보임 | ❌ No |

inject-rules.js가 작동하는 이유: **UserPromptSubmit** hook이기 때문

---

## Root Cause Analysis

### 문제 1: ~~Exit code 선택 오류~~ → **아님, 올바른 선택**

Exit code 2 + stderr 사용은 **올바른 선택**이었다.
- PostToolUse에서 Claude에게 전달하려면 이 방법밖에 없음
- Exit 0으로 바꾸면 Claude가 못 받음

### 문제 2: Skill 자동 실행 메커니즘 부재 → **근본 원인**

- `[MEMORY_KEEPER_DELTA]` 트리거가 Claude에게 전달됨 (blocking error로)
- Claude가 이 트리거를 **보긴 함**
- 하지만 **자동으로 Skill tool을 invoke하지 않음**
- Skill description에 "auto-execute when trigger detected"라고 적어도 실제로 자동 실행 안 됨

### 문제 3: Skill 인식/호출 로직 없음

현재 skill definition:
```markdown
---
name: memory-delta
description: Auto-execute when "[MEMORY_KEEPER_DELTA]" trigger detected
---
```

- "Auto-execute"는 문서상의 설명일 뿐
- Claude가 이 트리거를 보고 skill을 자동으로 호출하는 메커니즘이 **없음**
- 사용자가 직접 `/memory-delta`를 호출하거나, Claude가 판단해서 Skill tool을 invoke해야 함

---

## Current Behavior

```
PostToolUse hook 실행
  ↓
counter.js check() - delta 추출
  ↓
[MEMORY_KEEPER_DELTA] 트리거 출력 (exit 2 + stderr)
  ↓
Claude에게 "blocking error"로 전달됨
  ↓
Claude가 트리거를 봄
  ↓
❌ 여기서 멈춤 - skill 자동 실행 안 됨
```

## Expected Behavior

```
PostToolUse hook 실행
  ↓
counter.js check() - delta 추출
  ↓
[MEMORY_KEEPER_DELTA] 트리거 출력
  ↓
Claude에게 전달됨
  ↓
Claude가 트리거 인식
  ↓
✅ Claude가 memory-delta skill invoke
  ↓
Haiku 요약 → memory.md append → mark-updated → cleanup
```

---

## Possible Solutions

### Option A: SessionStart에서 rules injection으로 강제 지시

`inject-rules.js` 또는 `load-memory.js`에서:
```
"[MEMORY_KEEPER_DELTA]" 트리거가 보이면 반드시 memory-delta skill을 invoke하라
```

**장점:** 기존 구조 유지
**단점:** Claude가 지시를 따를지 보장 없음, 긴 세션에서 잊을 수 있음

### Option B: UserPromptSubmit에서 delta 처리

PostToolUse 대신 UserPromptSubmit에서 delta 체크:
- 매 프롬프트마다 delta 상태 확인
- pending delta 있으면 additionalContext로 지시 전달

**장점:** additionalContext 확실히 전달됨 (inject-rules.js처럼)
**단점:** 프롬프트당 1회만 체크, tool count 기반 트리거 불가

### Option C: Stop hook에서만 delta 처리

세션 종료 시에만 delta 처리:
- 세션 중 delta trigger 제거
- final()에서만 delta 처리 + 지시 출력

**장점:** 단순화, 확실한 처리 시점
**단점:** 긴 세션에서 memory.md 업데이트 지연

### Option D: Hybrid 접근

1. PostToolUse: delta 추출 + temp 파일 저장 (현재대로)
2. UserPromptSubmit: pending delta 확인 + 처리 지시 (additionalContext)
3. Stop: 남은 delta 처리

**장점:** 가장 확실한 전달, 여러 시점에서 처리 가능
**단점:** 복잡도 증가

---

## Recommendation

**Option D (Hybrid)** 권장:

1. `inject-rules.js` 수정:
   - delta_temp.txt 존재 여부 확인
   - 있으면 additionalContext에 처리 지시 추가

2. counter.js check():
   - delta 추출 + temp 파일 저장
   - exit code 2 출력은 유지 (백업용)

3. counter.js final():
   - 현재대로 유지

이렇게 하면:
- UserPromptSubmit에서 확실하게 Claude에게 전달
- PostToolUse의 exit code 2도 백업으로 유지
- Stop에서도 처리 가능

---

## Implementation Plan (2026-01-14)

### Phase 1: UserPromptSubmit 방식 구현 (Option C)

1. **inject-rules.js 수정**
   - delta_temp.txt 존재 여부 확인
   - 있으면 additionalContext에 **명시적 명령** 추가
   - `INSTRUCTION: Execute memory-delta skill NOW`

2. **counter.js check() 수정**
   - exit 2 + stderr 코드 **주석 처리** (삭제 X)
   - delta 추출 + temp 파일 저장만 유지

### Phase 2: 테스트

1. Tool 5회 사용 → delta_temp.txt 생성 확인
2. 다음 프롬프트 → inject-rules.js가 delta 감지
3. Claude가 INSTRUCTION 인식 → skill 실행
4. memory.md 업데이트 + lastMemoryUpdateTs 기록 확인

### Phase 3: 정리

1. 테스트 성공 시 counter.js의 주석 코드 완전 제거
2. 문서 업데이트

---

## Action Items

- [x] 조사 완료: exit 2 사용 이유 확인
- [x] 조사 완료: skill 자동 실행 불안정 확인
- [ ] inject-rules.js 수정: delta_temp.txt 확인 + INSTRUCTION 추가
- [ ] counter.js check(): exit 2 코드 주석 처리
- [ ] 테스트: delta trigger → skill 실행 → memory.md 업데이트 확인
- [ ] (테스트 성공 후) counter.js 주석 코드 완전 제거

---

## References

- [Claude Code Hooks Docs](https://docs.claude.com/en/docs/claude-code/hooks)
- [Issue #11224 - PostToolUse hook output visibility](https://github.com/anthropics/claude-code/issues/11224)
- [Issue #3983 - PostToolUse hook JSON output not processed](https://github.com/anthropics/claude-code/issues/3983)
- [memory-update-rules-injection-plan.md](./memory-update-rules-injection-plan.md) - 원래 플랜
