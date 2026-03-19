# P002_T001 - P1+P2: IA 격리 + Compaction Protocol

## Parent
- Plan: P002 - autoresearch/rlm 워크플로우 통합 구현

## Intent (의도)
Agent Prompt Template에 Intent Anchor를 READ-ONLY 격리 구조로 강화하고, Phase 4/7 meta-review 후 Compaction Protocol을 추가하여 장기 워크플로우의 컨텍스트 관리를 개선한다.

## Scope (범위)
할 것:
- Agent Prompt Template의 IA 섹션을 READ-ONLY로 강화 (수정 불가 명시, 충돌 시 보고 의무)
- Phase 4, 7에 Compaction Protocol 섹션 추가 (요약 형식, IA 원문 보존 규칙)
- Quick Reference에 compaction 관련 요약 추가

안 할 것:
- inject-rules.js 수정 (T004에서 처리)
- 다른 Phase 수정

## Acceptance Criteria (완료 조건)
- [ ] Agent Prompt Template의 IA 섹션에 READ-ONLY 격리 지시 포함
- [ ] Phase 4에 Compaction Protocol 섹션 존재
- [ ] Phase 7에 동일 Compaction Protocol 참조 존재
- [ ] IA가 compaction 대상에서 명시적으로 제외됨

## Verification (검증)
AC1: 워크플로우 실행 시 Work Agent가 IA를 재해석하지 않고 충돌 발견 시 STOP하여 보고하는 행동 지시가 존재 — Agent Prompt Template에서 trigger→path→result 추적
AC2: Phase 4 meta-review 완료 후 Orchestrator가 compacted summary를 생성하는 절차가 명시됨 — Phase 4 섹션에서 절차 단계 추적
AC3: Phase 7이 Phase 4와 동일한 compaction 절차를 참조 — Phase 7 섹션에서 참조 확인
AC4: Compaction Protocol에 "Intent Anchor는 절대 압축하지 않는다" 규칙이 명시됨 — Protocol 내 규칙 추적

## Execution
- 이 티켓은 단독 워크플로우로 실행 (1 Ticket = 1 Workflow)
- 실행: `/workflow` 스킬 호출

## Log

---
### [2026-03-18 12:50] 생성
P002 단계 1-2에 해당. autoresearch의 불변 평가 개념(R1) + rlm의 compaction 개념(R2)을 workflow SKILL.md에 반영.
