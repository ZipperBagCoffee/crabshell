# Delta Trigger Mechanism Mismatch Analysis

**분석일**: 2026-02-02
**상태**: 분석 완료, 수정 계획 필요

---

## 1. 문제 요약

`lastMemoryUpdateTs`가 항상 null인 이유: memory-delta 스킬이 세션 중간에 실행되지 않음.

---

## 2. 조사 결과

### 2.1 문서화된 트리거 vs 실제 구현

| 항목 | SKILL.md 문서 | 실제 구현 |
|------|--------------|----------|
| 트리거 패턴 | `[MEMORY_KEEPER_DELTA] file=delta_temp.txt` | DELTA_INSTRUCTION in additionalContext |
| 트리거 출처 | "hook outputs" | inject-rules.js additionalContext |
| 가시성 | 명시적 패턴 | 숨겨진 지시문 |

### 2.2 `[MEMORY_KEEPER_DELTA]` 실제 출력 위치

| 파일 | 함수 | 시점 |
|------|------|------|
| counter.js:251 | final() | **세션 종료 시** |
| counter.js:111 | check() | 주석 처리됨 (구버전) |

### 2.3 현재 Delta 처리 흐름

```
PostToolUse hook
  └─ counter.js check()
      └─ 25회 도달 시 extractDelta() → delta_temp.txt 생성

다음 사용자 프롬프트 (UserPromptSubmit hook)
  └─ inject-rules.js
      ├─ delta_temp.txt 존재 확인
      ├─ DELTA_INSTRUCTION을 additionalContext에 추가
      └─ stderr: [rules + delta pending] (상태 표시)

Claude가 DELTA_INSTRUCTION 읽고 스킬 실행해야 함
  └─ 실패: Claude가 지시문 무시 또는 패턴 찾기

세션 종료 (Stop hook)
  └─ counter.js final()
      └─ [MEMORY_KEEPER_DELTA] 출력 (이때만 패턴 나옴)
```

---

## 3. 근본 원인

1. **문서 불일치**: SKILL.md의 트리거 패턴이 실제 구현과 다름
2. **트리거 가시성 부족**: DELTA_INSTRUCTION은 additionalContext에 숨어있음
3. **패턴 기반 탐색**: Claude가 명시적 패턴 `[MEMORY_KEEPER_DELTA]`를 찾지만, 세션 중에는 출력 안 됨

---

## 4. 영향

- `lastMemoryUpdateTs` 항상 null
- delta_temp.txt 누적 (cleanup 안 됨)
- 세션 중 메모리 업데이트 실패
- 다음 세션에서 중복 delta 처리

---

## 5. 관련 파일

| 파일 | 라인 | 역할 |
|------|------|------|
| scripts/inject-rules.js | 18-30 | DELTA_INSTRUCTION 정의 |
| scripts/inject-rules.js | 92-102 | checkDeltaPending() |
| scripts/inject-rules.js | 202-204 | additionalContext에 주입 |
| scripts/inject-rules.js | 220-228 | stderr 상태 출력 |
| scripts/counter.js | 100-124 | check() - delta 추출 |
| scripts/counter.js | 247-252 | final() - 세션 종료 시 출력 |
| skills/memory-delta/SKILL.md | 22 | 잘못된 트리거 문서 |

---

## 6. 수정 방향 (상세 계획은 별도 문서)

- inject-rules.js에서 `[MEMORY_KEEPER_DELTA]` 명시적 출력 추가
- SKILL.md 트리거 조건 업데이트
- stderr와 additionalContext 모두에서 트리거 명확화
