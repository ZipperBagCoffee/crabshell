# P002_T002 - P3+P4: Agent 분류 + 실패 이력

## Parent
- Plan: P002 - autoresearch/rlm 워크플로우 통합 구현

## Intent (의도)
Context Budget 섹션에 Light/Full agent 분류 체계를 추가하고, Phase 11 Report에 Experiment Log 포맷을 추가하여 작업 효율성과 학습 메커니즘을 강화한다.

## Scope (범위)
할 것:
- Context Budget 섹션에 Light call / Full agent 분류 기준 표 추가
- Light call의 리뷰 규칙 명시 (Orchestrator spot-check)
- Phase 11 Report 포맷에 Experiment Log 섹션 추가
- Quick Reference에 관련 요약 추가

안 할 것:
- inject-rules.js 수정 (T004에서 처리)
- 다른 Phase 수정

## Acceptance Criteria (완료 조건)
- [ ] Context Budget에 Light/Full 분류 기준 표 존재
- [ ] Light call의 리뷰 규칙이 명시됨 (Orchestrator spot-check, Review Agent 불필요)
- [ ] 분류 의심 시 Full 격상이 기본값으로 명시
- [ ] Phase 11 Report에 Experiment Log 포맷 존재
- [ ] Experiment Log가 Phase 간 왕복 시에만 기록됨을 명시

## Verification (검증)
AC1: Context Budget 섹션에서 agent spawning 시 Light/Full 판단 경로 추적 — 단일 파일+판단 불필요 → Light, 그 외 → Full
AC2: Light call 실행 시 Review Agent 없이 Orchestrator spot-check만으로 완료되는 절차 명시 확인
AC3: 분류 기준에 "의심 시 Full" 기본값 규칙 존재 확인
AC4: Phase 11 Report 포맷에 Experiment Log 테이블 구조(Attempt/Phase/What/Result/Why) 존재 확인
AC5: Experiment Log 기록 조건이 "Phase 간 왕복 발생 시"로 한정됨 확인

## Execution
- 이 티켓은 단독 워크플로우로 실행 (1 Ticket = 1 Workflow)
- 실행: `/workflow` 스킬 호출

## Log

---
### [2026-03-18 12:50] 생성
P002 단계 3-4에 해당. rlm의 이중 호출 패턴(R5) + autoresearch의 results.tsv 이력 축적(R6)을 workflow SKILL.md에 반영.
