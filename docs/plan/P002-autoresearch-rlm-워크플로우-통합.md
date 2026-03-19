# P002 - autoresearch/rlm 개념의 워크플로우 통합 구현

## Intent (의도)
D002에서 채택된 6개 통합 제안(P1-P6)을 workflow SKILL.md와 inject-rules.js에 구현하여, autoresearch/rlm의 검증된 개념들로 기존 워크플로우를 강화한다.

## Scope (범위)
포함:
- P1: Intent Anchor 구조적 격리 (Agent Prompt Template 수정)
- P2: Phase 간 Compaction Protocol (Phase 4, 7 수정)
- P3: 경량/중량 Agent 분류 체계 (Context Budget 수정)
- P4: 실패 이력 누적 구조 (Phase 11 수정)
- P5: Work Agent 내부 Iteration Protocol (Phase 8 수정, 조건부)
- P6: Graceful Degradation Protocol (Phase 10 수정, 조건부)
- inject-rules.js RULES 관련 규칙 반영

제외:
- G1 탐색적 작업 경량 프레임워크 (별도 연구)
- MG2 복잡성 비용 평가 기준 (별도 연구)
- 코드 구현 (이것은 문서/규칙 변경만)

## Plan (계획)
- [ ] 단계 1: P1 — Agent Prompt Template에 IA READ-ONLY 격리 구조 추가
- [ ] 단계 2: P2 — Phase 4, 7에 Compaction Protocol 섹션 추가
- [ ] 단계 3: P3 — Context Budget에 Light/Full agent 분류 체계 추가
- [ ] 단계 4: P4 — Phase 11 Report에 Experiment Log 포맷 추가
- [ ] 단계 5: P5 — Phase 8에 Internal Iteration Protocol 추가 (경계 조건 명시)
- [ ] 단계 6: P6 — Phase 10에 Graceful Degradation Protocol 추가
- [ ] 단계 7: inject-rules.js RULES에 신규 규칙 반영 + CLAUDE.md 동기화

## Tickets
- P002_T001: P1+P2: IA 격리 + Compaction Protocol
- P002_T002: P3+P4: Agent 분류 + 실패 이력
- P002_T003: P5+P6: 내부 Iteration + Graceful Degradation
- P002_T004: inject-rules.js RULES 반영 + 동기화

## Verification Criteria (검증 기준)
1. 워크플로우 실행 시 Work Agent가 IA를 READ-ONLY로 취급하고, 충돌 발견 시 보고하는 행동을 보인다
2. Phase 4/7 meta-review 후 다음 phase agent prompt에 compacted summary가 전달된다
3. Orchestrator가 Light/Full 분류 기준에 따라 agent 유형을 결정한다
4. Phase 간 왕복 발생 시 Experiment Log에 실패 시도가 기록된다
5. Phase 8에서 Work Agent가 실행 수준 에러 시 max 3회 내부 재시도 후 보고한다
6. Phase 10에서 부분 실패 시 PASS 기준만 확정, FAIL 기준만 재작업 대상으로 분리된다

## Log

---
### [2026-03-18 12:40] 생성
D002 워크플로우 Phase 2-4 결과에서 도출. 6개 채택 제안(P1-P6)과 3개 기각(RJ1-RJ3)이 확정됨.
출처: D002, R001, R002.
