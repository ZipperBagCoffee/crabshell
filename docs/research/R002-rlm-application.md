# R002 - alexzhang13's rlm - memory-keeper 적용 가능성

## Intent (의도)
rlm의 아키텍처/접근법을 분석하고, memory-keeper 워크플로우의 에이전트 오케스트레이션에 적용 가능한 요소를 식별한다.

## Questions (질문)
1. rlm의 핵심 아키텍처와 작동 원리는?
2. rlm의 어떤 요소가 memory-keeper의 에이전트 오케스트레이션에 매핑될 수 있는가?
3. 구체적으로 어떤 기능/패턴을 memory-keeper에 통합할 수 있는가?

## Log

---
### [2026-03-18 14:30] 조사 시작
- 대상: https://github.com/alexzhang13/rlm
- 방법: GitHub repo 구조, README, 핵심 소스코드 분석
- 병렬 에이전트를 통한 조사 실행

---
### [2026-03-18 15:00] 발견사항

#### Q1. rlm의 핵심 아키텍처와 작동 원리

**프로젝트 개요**: MIT OASYS 연구실의 **task-agnostic inference paradigm**. LLM이 자체 컨텍스트 윈도우를 2자릿수 이상 초과하는 입력을 처리할 수 있게 하는 프레임워크. `llm.completion()` → `rlm.completion()`으로 대체하는 것이 핵심. RLM-Qwen3-8B는 기본 대비 **28.3% 평균 성능 향상**, vanilla GPT-5에 근접.

**3-Component Architecture**:
1. **RLM** (`rlm/core/rlm.py`) — 메인 반복 루프. LLM 응답 → 코드 블록 추출 → REPL 실행 → 결과를 history에 추가 → FINAL_VAR/FINAL까지 반복.
2. **LMHandler** (`rlm/core/lm_handler.py`) — TCP 소켓 서버. 각 completion() 호출마다 별도 multi-threaded 서버 생성. REPL→LLM API 호출 중계.
3. **LocalREPL** (`rlm/environments/local_repl.py`) — Python 실행 환경. 동일 프로세스 내 `exec()`. Persistent namespace (변수가 iteration 간 유지). Sandbox: 위험 builtin 제거.

**REPL 함수들**:
- `llm_query(prompt)` — 1-shot LLM 호출 (재귀 없음)
- `rlm_query(prompt)` — 재귀적 sub-call (자체 REPL + iteration 보유)
- `*_batched()` — 동시 실행 버전
- `FINAL_VAR(name)` — 최종 답변 반환

**재귀 구조** (`max_depth`로 제어):
```
RLM (depth=0) → rlm_query() → Child RLM (depth=1) → ... → depth=max_depth → Plain LM call
```
각 자식 RLM은 독립된 LMHandler(별도 TCP 포트) + LocalREPL(별도 namespace). 완전 격리.

**지원**: OpenAI, Anthropic, Gemini, Azure, vLLM 등. 환경: local, docker, modal, e2b 등.

**핵심 설계 패턴**:
1. **재귀적 자기 호출** — 복잡한 작업을 코드로 분해하여 하위 LLM에 위임, 결과를 코드로 합성.
2. **Iterative Reasoning Loop** — max_iterations(기본 30)까지 반복. 매 iteration의 stdout/stderr가 다음 프롬프트에 피드백.
3. **Persistent Namespace** — REPL 변수가 iteration 간 유지. `_restore_scaffold()`로 핵심 함수 복원.
4. **Compaction** — 컨텍스트 85% 도달 시 trajectory를 요약·압축. 전체 이력은 REPL 변수에 보존.
5. **Graceful Degradation** — timeout/budget/token/error 한계 초과 시 `_best_partial_answer` 반환.
6. **자원 한계 전파** — 자식 RLM은 부모의 남은 budget/timeout을 받음.

#### Q2. memory-keeper 에이전트 오케스트레이션에 매핑 가능한 요소

| rlm 개념 | 매핑 대상 Phase | 적용 방안 |
|---|---|---|
| 재귀적 분해 (rlm_query) | Phase 2, 5, 8 Work Agent | 큰 작업을 자동 하위 작업으로 분해, 병렬 처리 후 합성 |
| REPL 기반 코드 실행 | Phase 8-9 Runtime verification | 검증 코드를 생성·실행하여 실행 결과 기반 판단 |
| Compaction | Phase 4, 7 Meta-review | 이전 phase 결과를 구조화된 요약으로 압축, 컨텍스트 관리 |
| llm_query vs rlm_query | 전체 agent spawning | 경량 agent (단순 확인) vs 중량 agent (iterative 추론) 이중 구조 |
| Scaffold Restoration | Phase 간 전환 | 매 phase 전환 시 Intent Anchor 재검증 (namespace 보호) |
| Batched Execution | Phase 2-3, Cross-review | 더 세밀한 수준의 병렬화 (파일별, 관점별) |
| Graceful Degradation | Agent 실패 시 | 부분 결과 보존 후 다음 phase에 전달, meta-review에서 처리 |

#### Q3. 구체적 통합 가능 패턴

**(A) Work Agent를 RLM으로 구동**: Work Agent가 내부적으로 RLM 스타일 iteration loop 실행. 작업을 하위 작업으로 자동 분해→합성. 현재의 "한 번에 모든 작업 수행"보다 견고.

**(B) REPL 기반 Runtime Verification**: Review Agent가 검증 코드를 생성·실행. "파일에 X가 있다"가 아닌 "이 코드를 실행하면 이 결과가 나온다" 기준. memory-keeper의 `verification standard` 규칙과 완벽 일치.

**(C) Phase 간 Compaction**: Meta-review 시점(Phase 4, 7)에서 이전 phase 결과를 구조화된 요약으로 압축. 상세 내용은 별도 파일 보존. 11-phase의 긴 대화에서 컨텍스트 윈도우 압박 해결.

**(D) 경량/중량 Agent 이중 구조**: 단순 작업(파일 확인, 형식 검증)은 llm_query 스타일 경량 호출. 복잡한 작업(아키텍처 리뷰, 코드 변경)은 rlm_query 스타일의 완전한 iterative agent. 비용 효율성·속도 개선.

**(E) Scaffold Restoration → Intent Anchor 보호**: 매 phase 전환 시 Phase 1의 Intent Anchor를 재검증. 워크플로우 진행 중 의도 훼손 방지를 프로그래밍적으로 구현.

**(F) Graceful Degradation**: Agent 실패 시 전체 phase 실패 대신 부분 결과(`_best_partial_answer`)를 보존하여 다음 phase로 전달. Meta-review에서 불완전한 결과를 인지하고 처리.

**(G) 하이브리드 아키텍처 제안**: RLM의 재귀적 분해 + 코드 기반 검증을 memory-keeper의 다중 에이전트 리뷰 프레임워크 안에 내장. Work Agent 내부에 iteration loop, Review Agent에 REPL 검증, Phase 간 compaction 도입.

---
### [2026-03-18 12:30] 발견사항 - D002 철학적 정합성 분석 반영
D002 워크플로우(Phase 2-4)에서 rlm 개념들의 철학적 정합성을 분석 완료.
- 채택: Phase 간 Compaction(P2), 경량/중량 Agent 분류(P3), Graceful Degradation(P6 조건부)
- 조건부: Work Agent 내부 Iteration(P5) — 실행 수준 교정에만 한정, 계획 변경은 STOP
- 기각: Review 없는 재귀(RJ3)
- 핵심 긴장: REPL 코드 실행 vs trace 기반 검증 — 향후 해결 필요
→ See D002
