---
name: regressing
description: "Autonomous D→P→T loop with verification-based optimization. Use when iterative improvement is needed. Invoke with /regressing \"topic\" N to run N cycles of discuss→plan→ticket→workflow→feedback."
---

# Regressing Skill

## Core Philosophy: Verification-based Optimization

> 검증을 기반으로 한 최적화 — 매 사이클의 검증 결과가 다음 사이클의 최적화 방향을 결정한다.

### 3가지 철학 기반

| 철학 | 출처 | regressing에서의 역할 |
|------|------|----------------------|
| **반복 최적화** | autoresearch | 매 사이클 피드백 → 개선. 결과가 입력이 됨 |
| **Agent 구조 + 검증** | workflow | Work/Review/Orchestrator 패턴, 런타임 검증 |
| **문서 추적** | D/P/T | 모든 과정이 문서로 남아 tracing 가능 |

## Execution Procedure

### Step 1: Initialize

사용자가 `/regressing "주제"` 또는 `/regressing "주제" N`으로 호출.

- N이 지정되지 않은 경우: "몇 회 반복할까요?" 질문
- N이 지정된 경우: 바로 진행

### Step 2: Pre-check (선택적)

- 관련 Research(R) 문서가 있는지 확인
- 없으면 사전 조사가 필요한지 사용자에게 질문
- R은 루프 밖의 독립 사전 작업

### Step 3: Cycle Loop

```
for cycle in 1..N:
  Step 3a: Discussion (D)
  Step 3b: Planning (P)
  Step 3c: Ticketing (T)
  Step 3d: Workflow Execution
  Step 3e: Feedback Transfer
```

#### Step 3a: Discussion — D(n) 생성
- Cycle 1: `/discussing "주제 [cycle 1/N]"` 호출, 사용자 의도 기반
- Cycle 2+: `/discussing "주제 [cycle n/N]"` 호출
  - Context에 이전 T(n-1)의 `## 최종 검증 > 다음 방향` 내용 포함
- D 문서에 Intent Anchor(IA) 정의
- 메타데이터: `[regressing cycle: {n}/{N}]`

#### Step 3b: Planning — P(n) 생성
- `/planning` 호출, D(n)을 기반으로 계획 수립
- Work Agent: 분석 + 계획 → P 문서에 append
- Review Agent: 계획 검증 → P 문서에 append
- Orchestrator: D(n)의 IA 대비 의도 점검 → P 문서에 append
- 승인 후 티켓 생성으로 진행

#### Step 3c: Ticketing — T(n) 생성
- `/ticketing` 호출, P(n)에서 티켓 생성

#### Step 3d: Workflow Execution
- `/workflow` 호출, T(n) 실행
- Work Agent: 작업 실행 → T 문서에 append
- Review Agent: 실동작 검증 (전수조사 수준) → T 문서에 append
- Orchestrator: 최종 검증 → T 문서에 append
  - 정확성: 제대로 됐는가?
  - 개선 기회: 더 나은 방법은 없었는가?
  - 다음 방향: 다음에 뭘 해야 하는가?

#### Step 3e: Feedback Transfer
- T(n)의 `## 최종 검증 > 다음 방향`을 추출
- 다음 cycle D(n+1)의 `## Context (배경)` 섹션으로 전달
- 이 전달은 Orchestrator가 명시적으로 수행

### Step 4: Final Report

N회 완료 후 최종 보고서를 사용자에게 제시:

```
## Regressing 최종 보고서: {주제}
총 {N} cycles 완료

### IA 달성도
| Cycle | IA-1 | IA-2 | ... | 종합 |
|-------|------|------|-----|------|
| 1     | ...  | ...  |     | ...  |
| N     | ...  | ...  |     | ...  |

### 개선 궤적
- Cycle 1→2: {주요 변화}
- Cycle 2→3: {주요 변화}

### 최종 상태
- 달성된 것: ...
- 미달성: ...
- 향후 권장 사항: ...
```

## Document Naming Convention

매 사이클마다 새 문서 세트 생성:

| Cycle | Discussion | Plan | Ticket |
|-------|-----------|------|--------|
| 1 | D{next} | P{next} | P{n}_T001 |
| 2 | D{next+1} | P{next+1} | P{n}_T001 |
| N | D{next+N-1} | P{next+N-1} | P{n}_T001 |

모든 문서에 메타데이터 포함: `[regressing session: {timestamp}, cycle: {n}/{N}]`

## User Interaction

- **시작 시**: 주제 + 회차 확인
- **중간**: 사용자 개입 없음 (완전 자율)
- **종료 시**: 최종 보고서 제시 → 사용자가 추가 사이클 요청 또는 종료

## Rules

1. **1 cycle = 1 D + 1 P + 1 T + 1 Workflow 실행.** 생략 불가.
2. **매 사이클 새 문서 세트.** 기존 문서에 append 하지 않고 새 D/P/T 생성.
3. **Verification-based Optimization.** 검증 없는 반복 금지. 매 사이클 끝에서 반드시 검증하고, 검증 결과가 다음 사이클을 결정.
4. **T→D context 전달 필수.** Orchestrator는 T(n)의 최종 검증 결과를 D(n+1)의 Context로 명시적으로 전달해야 한다.
5. **사용자 개입은 마지막에만.** 중간 사이클에서 사용자 확인을 구하지 않는다.
6. **기존 스킬 호출 방식.** discussing, planning, ticketing, workflow 스킬을 내부적으로 호출한다.
7. **조기 중단은 사용자 요청 시에만.** 자동 수렴 판단 없음 (v1).
8. **Workflow는 경량 레퍼런스.** regressing이 정식 모드이며, workflow는 단독 1회성 작업용.
