# R001 - Karpathy's autoresearch - memory-keeper 적용 가능성

## Intent (의도)
autoresearch의 아키텍처/접근법을 분석하고, memory-keeper 워크플로우에 적용 가능한 요소를 식별한다.

## Questions (질문)
1. autoresearch의 핵심 아키텍처와 작동 원리는?
2. 자동 연구 파이프라인의 어떤 요소가 memory-keeper의 워크플로우(11-phase)에 매핑될 수 있는가?
3. 구체적으로 어떤 기능/패턴을 memory-keeper에 통합할 수 있는가?

## Log

---
### [2026-03-18 14:30] 조사 시작
- 대상: https://github.com/karpathy/autoresearch
- 방법: GitHub repo 구조, README, 핵심 소스코드 분석
- 병렬 에이전트를 통한 조사 실행

---
### [2026-03-18 15:00] 발견사항

#### Q1. autoresearch의 핵심 아키텍처와 작동 원리

**프로젝트 개요**: Karpathy가 만든 자율 AI 연구 프레임워크 (42K+ stars). AI 에이전트에게 실제 LLM 학습 환경을 주고, 자율적으로 실험을 반복하게 하는 것.

**핵심 구조 (극도로 단순함)**:
| 파일 | 역할 | 수정 권한 |
|------|------|-----------|
| `prepare.py` | 데이터, 토크나이저, 평가 함수 | 읽기 전용 (에이전트 수정 불가) |
| `train.py` | 모델, 옵티마이저, 학습 루프 | **에이전트가 수정하는 유일한 파일** |
| `program.md` | 에이전트 지시 사항 | **사람이 수정하는 유일한 파일** |
| `results.tsv` | 실험 결과 로그 | 에이전트가 기록 |

**실험 루프** (`program.md`에 정의):
```
LOOP FOREVER:
  1. git 상태 확인
  2. train.py에 아이디어 적용 (코드 수정)
  3. git commit
  4. 실험 실행 (5분 wall clock 제한)
  5. 결과 읽기: val_bpb (validation bits per byte)
  6. 개선 → branch 유지 (keep) / 동일·악화 → git reset 롤백 (discard)
```

**핵심 제약**: 고정 시간(5분), 단일 메트릭(val_bpb), 단일 파일 수정(train.py), 평가 함수 변경 불가.

**사용 도구**: autoresearch 자체는 LLM API를 호출하지 않음. LLM 에이전트(Claude Code, Codex 등)가 이 위에서 동작하는 구조. `program.md`가 에이전트의 "skill".

**핵심 설계 패턴**:
1. **Git을 상태 머신으로 사용** — 성공한 실험은 commit 유지, 실패는 reset으로 롤백. Branch history = 성공 실험의 진화 기록.
2. **오케스트레이터 없음** — 단일 에이전트가 아이디어 생성~판단까지 모든 것 수행.
3. **Greedy hill climbing** — 125회 실험 중 keep ~20%, discard ~78%, crash ~1%. baseline 0.9979 → 최종 0.9697 (2.83% 개선).
4. **변조 불가능한 검증** — `prepare.py`의 evaluate_bpb()는 에이전트가 수정 불가.
5. **AgentHub** (실험적) — 다중 에이전트 branch에서 git repo를 공유 상태로 사용, 결과 공유 게시판, 부정 결과 공유.

#### Q2. 11-phase 워크플로우에 매핑 가능한 요소

| autoresearch 개념 | 매핑 대상 Phase | 적용 방안 |
|---|---|---|
| 불변 평가 기준 (prepare.py) | Phase 1 Intent Anchor | IA를 수정 불가능한 별도 파일로 분리, 에이전트 수정 권한 제외 |
| keep/discard 자동 롤백 | Phase 5-6, 8-9 | 이전 iteration 대비 자동 회귀 검증, 개선 없으면 롤백 |
| results.tsv 이력 축적 | Phase 3.5, 6.5, 9.5 Cross-review | 이전 워크플로우의 실패 패턴을 cross-review에서 참조 |
| "NEVER STOP" 자율성 | 워크플로우 전체 | 탐색적 작업에 "자율 모드" 도입 (모든 작업에 11단계 불필요) |
| simplicity criterion | Phase 4, 7, 10 Meta-review | "복잡성 비용 vs 개선 가치" 트레이드오프 기준 명시 |
| program.md as evolving skill | 워크플로우 자체 | 실험 결과에 기반한 워크플로우 지시 자체의 반복 개선 |

#### Q3. 구체적 통합 가능 패턴

**(A) Intent Anchor 파일 격리**: 현재 문서 내 텍스트로 존재하는 IA를 별도 읽기 전용 파일로 격상. 에이전트가 구조적으로 수정 불가능하게 만들어 의도 변질 방지.

**(B) 자동 회귀 검증 + 롤백**: 각 iteration의 산출물을 이전 iteration과 수치적/구조적으로 비교. 개선 없으면 자동 롤백. autoresearch의 val_bpb 비교 로직을 일반화.

**(C) 실패 이력의 누적 학습**: Cross-review에서 "이 유형의 변경은 과거 N번 실패" 등 실증적 근거를 참조하는 기억 시스템 도입. Issue #329의 Hebbian memory 제안과 유사.

**(D) 복잡성 비용 평가 기준**: Meta-review에 "0.001 improvement + 20 lines of hacky code = discard" 같은 정량적 판단 프레임워크 추가.

**(E) 탐색적 작업용 경량 자율 모드**: 모든 작업에 11단계를 강제하지 않고, 단일 메트릭으로 판별 가능한 탐색 작업에는 keep/discard 자동 반복 모드 도입.

**(F) 워크플로우 메타-학습**: 워크플로우 실행 결과를 기반으로 워크플로우 정의 자체를 개선하는 피드백 루프 (Issue #318의 "iterative refinement of program.md" 개념).

---
### [2026-03-18 12:30] 발견사항 - D002 철학적 정합성 분석 반영
D002 워크플로우(Phase 2-4)에서 autoresearch 개념들의 철학적 정합성을 분석 완료.
- 채택: IA 구조적 격리(P1), 실패 이력 누적(P4), 복잡성 비용 평가(MG2 향후과제)
- 기각: NEVER STOP 자율 모드(RJ1), 단일 에이전트(RJ2)
- 핵심 긴장: "실험이 이해를 만든다" vs "이해 없이 행동하지 말라" — 도메인 차이에서 비롯
→ See D002
