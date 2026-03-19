# P002_T004 - inject-rules.js RULES 반영 + 동기화

## Parent
- Plan: P002 - autoresearch/rlm 워크플로우 통합 구현

## Intent (의도)
T001-T003에서 workflow SKILL.md에 추가된 개념들 중 RULES 수준으로 격상이 필요한 항목을 inject-rules.js에 반영하고 CLAUDE.md에 동기화한다.

## Scope (범위)
할 것:
- inject-rules.js RULES에 IA 격리 관련 규칙 추가
- inject-rules.js RULES에 Light/Full agent 분류 참조 추가
- inject-rules.js RULES에 Internal Iteration 경계 규칙 추가
- syncRulesToClaudeMd() 실행하여 CLAUDE.md 동기화
- 플러그인 캐시 inject-rules.js도 동기화

안 할 것:
- workflow SKILL.md 수정 (T001-T003에서 완료)
- 버전 범프 (별도 작업)

## Acceptance Criteria (완료 조건)
- [ ] inject-rules.js RULES에 IA READ-ONLY 규칙 존재
- [ ] inject-rules.js RULES에 Light/Full agent 분류 참조 존재
- [ ] inject-rules.js RULES에 Internal Iteration 경계 규칙 존재
- [ ] CLAUDE.md가 inject-rules.js와 동기화됨
- [ ] 캐시 inject-rules.js와 소스 inject-rules.js가 동일

## Verification (검증)
AC1: inject-rules.js 실행 시 RULES 문자열에 IA READ-ONLY 관련 텍스트가 포함됨 — node -e로 RULES 출력 후 grep
AC2: inject-rules.js 실행 시 RULES에 Light/Full 참조가 포함됨 — 동일 방법
AC3: inject-rules.js 실행 시 RULES에 Internal Iteration 경계 규칙 포함됨 — 동일 방법
AC4: CLAUDE.md의 마커 사이 내용과 inject-rules.js RULES가 일치 — diff 비교
AC5: 캐시 파일과 소스 파일의 md5 해시 일치 — md5sum 비교

## Execution
- 이 티켓은 단독 워크플로우로 실행 (1 Ticket = 1 Workflow)
- 실행: `/workflow` 스킬 호출
- **의존성: T001, T002, T003 완료 후 실행**

## Log

---
### [2026-03-18 12:50] 생성
P002 단계 7에 해당. T001-T003의 SKILL.md 변경 결과를 RULES에 반영.
의존성: T001+T002+T003 → T004 (순차)
