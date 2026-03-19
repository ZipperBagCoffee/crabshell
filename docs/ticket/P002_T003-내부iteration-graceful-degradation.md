# P002_T003 - P5+P6: 내부 Iteration + Graceful Degradation

## Parent
- Plan: P002 - autoresearch/rlm 워크플로우 통합 구현

## Intent (의도)
Phase 8에 Work Agent Internal Iteration Protocol을 추가하고, Phase 10에 Graceful Degradation Protocol을 추가하여 실행 효율성과 실패 복구 메커니즘을 강화한다. 두 제안 모두 조건부 채택이므로 경계 조건을 명확히 한다.

## Scope (범위)
할 것:
- Phase 8에 Internal Iteration Protocol 추가 (실행 수준 교정만, max 3회, 로그 필수)
- P5와 RJ2의 경계 명시 (실행 수준 vs 계획 수준 구분 기준)
- Phase 10에 Graceful Degradation Protocol 추가 (부분 결과 보존, PASS 기준 확정)
- P6와 Anti-Pattern #9의 해소 명시 (작업 보존 vs 판정의 레이어 구분)
- Anti-Pattern 표에 관련 항목 추가/수정

안 할 것:
- inject-rules.js 수정 (T004에서 처리)
- Phase 9 수정 (Review Agent 절차는 기존 유지)

## Acceptance Criteria (완료 조건)
- [ ] Phase 8에 Internal Iteration Protocol 섹션 존재
- [ ] 실행 수준 교정 vs 계획 수준 변경의 구분 기준이 명시됨
- [ ] max 3회 hard limit과 초과 시 STOP 의무가 명시됨
- [ ] Phase 10에 Graceful Degradation Protocol 섹션 존재
- [ ] "검증 판정은 PASS/FAIL 유지, partial은 작업 산출물 보존에만 적용"이 명시됨
- [ ] Anti-Pattern 표에 관련 항목 반영

## Verification (검증)
AC1: Phase 8에서 Work Agent가 구문 에러 발생 시 Internal Iteration을 시도하는 절차 추적 — trigger(실행 에러) → 로그 기록 → 재시도 → max 3 체크
AC2: "다른 접근법 시도"가 Internal Iteration이 아닌 STOP+보고로 분류되는 기준 명시 확인
AC3: 3회 초과 시 Orchestrator 보고 의무 + 모든 iteration 로그 포함 확인
AC4: Phase 10에서 5개 기준 중 2개 FAIL 시 → 3개 PASS 확정 + 2개만 재작업 대상으로 분리하는 절차 추적
AC5: Anti-Pattern 표에서 "internal iteration으로 계획 변경 시도"가 금지됨 확인
AC6: Graceful degradation이 검증 판정(PASS/FAIL)과 명확히 분리됨 확인

## Execution
- 이 티켓은 단독 워크플로우로 실행 (1 Ticket = 1 Workflow)
- 실행: `/workflow` 스킬 호출

## Log

---
### [2026-03-18 12:50] 생성
P002 단계 5-6에 해당. rlm의 iteration loop(P5) + graceful degradation(P6)을 workflow SKILL.md에 반영.
두 제안 모두 조건부 채택 — D002에서 P5↔RJ2 경계, P6↔Anti-Pattern#9 해소가 핵심 조건.
