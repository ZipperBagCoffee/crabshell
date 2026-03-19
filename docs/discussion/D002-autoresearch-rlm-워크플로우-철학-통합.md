# D002 - autoresearch와 rlm의 memory-keeper 워크플로우 철학 통합

## Intent (의도)
R001(autoresearch)과 R002(rlm) 연구에서 발견한 패턴들을 memory-keeper의 기존 워크플로우, 스킬 체계, 핵심 철학(RULES)과 어떻게 조화롭게 통합할 것인가를 논의한다. 단순 기능 이식이 아니라, 철학적 일관성을 유지하면서 실질적 개선을 도출하는 것이 목표.

## Context (배경)
- R001: Karpathy's autoresearch — 자율 실험 반복, 불변 평가 기준, keep/discard 롤백, 극도의 단순성
- R002: alexzhang13's rlm — 재귀적 분해, REPL 기반 검증, compaction, 경량/중량 이중 호출
- 기존 체계: 11-phase workflow, 5개 skill (discussing/planning/ticketing/researching/workflow), RULES (inject-rules.js), Intent Anchor, Intent Guardian, runtime verification standard
- 핵심 질문: 외부 프레임워크의 개념을 도입할 때 memory-keeper의 "이해 우선", "검증 기반", "의도 보존" 철학이 희석되지 않는가?

## Discussion Log

---
### [2026-03-18 11:58] 시작
R001/R002 연구 완료 후, 발견사항을 단순 나열하는 것을 넘어 memory-keeper 철학과의 정합성을 깊이 검토하는 논의를 시작한다. 워크플로우 스킬을 통한 에이전트 오케스트레이션으로 진행 예정.

핵심 논의 축:
1. autoresearch의 "자율성 + 단순성" vs memory-keeper의 "감독 + 구조"
2. rlm의 "재귀적 분해 + 코드 기반 검증" vs memory-keeper의 "다중 에이전트 리뷰"
3. 두 프레임워크의 장점을 취하면서 기존 철학(이해 우선, 검증 기반, 의도 보존)을 강화하는 방향
4. 구체적으로 어떤 phase/skill/rule을 어떻게 수정할 것인가

---
### [2026-03-18 12:30] 워크플로우 Phase 2-4 결과 (분석 + 리뷰 + 메타리뷰)

**Intent Anchor**:
- IA-1: 핵심 철학(이해 우선, 검증 기반, 의도 보존) 약화 불가
- IA-2: 외부 개념은 강화 방향으로만 통합
- IA-3: autoresearch/rlm 공정 검토
- IA-4: actionable 결론 (어떤 phase/skill/rule을 어떻게)
- IA-5: 11-phase 근간 유지

#### 1. 철학적 긴장점 (Tensions)

| ID | 긴장 | 심각도 | 리뷰 판정 |
|----|-------|--------|-----------|
| T1 | autoresearch "NEVER STOP" vs Human Oversight | HIGH | PASS |
| T2 | 단일 메트릭 검증 vs 다차원 검증 | MEDIUM | PASS |
| T3 | 오케스트레이터 없음 vs Intent Guardian | HIGH | PASS |
| T4 | rlm 단일 에이전트 재귀 vs Work/Review 분리 | MEDIUM | PASS |
| T5 | rlm compaction vs "기록 수정 불가" | NEAR-ZERO | 레이어가 다름 (ephemeral context vs persistent doc) |
| T6 | program.md 진화 vs RULES 불변성 | LOW-MEDIUM | RULES도 버전 진화함 (agent가 못 바꿀 뿐) |
| MT1 | greedy hill climbing vs plan-then-execute | MEDIUM | **리뷰에서 추가 식별** |

핵심 통찰: autoresearch는 "실험적 행동 자체가 이해를 만든다"는 철학. memory-keeper는 "이해 없는 행동은 위험"이라는 철학. 이 둘은 **적용 도메인이 다르기 때문**에 발생하는 긴장이며, 하나가 틀린 것이 아니다.

#### 2. 철학적 강화점 (Reinforcements)

| ID | 출처 | 강화 대상 | 효과 |
|----|------|-----------|------|
| R1 | autoresearch 불변 평가 | Verification Standard | IA를 구조적으로 수정 불가능하게 격상 |
| R2 | rlm scaffold restoration | Intent Anchor 재검증 | Anti-Pattern #24 방지를 자동화 |
| R3 | autoresearch git 상태 | Plan-Reality Gap | 에이전트 자기보고 → git 객관적 증거로 격상 |
| R4 | rlm graceful degradation | 실패 처리 | 부분 결과 보존 (판정은 여전히 PASS/FAIL) |
| R5 | rlm 이중 호출 | Context Budget | "느려야 할 때/빨라도 될 때" 구조화 |
| R6 | autoresearch 결과 이력 | Cross-review | 실증적 근거 기반 리뷰 |

#### 3. 기존 체계의 Gap

| ID | Gap | 드러낸 출처 |
|----|-----|-------------|
| G1 | 탐색적 작업의 경량 경로 부재 | autoresearch |
| G2 | 실패 이력의 구조적 축적 부재 | autoresearch results.tsv |
| G3 | 워크플로우 내 컨텍스트 압축 전략 부재 | rlm compaction |
| G4 | 에이전트 내부 iteration 메커니즘 부재 | rlm iteration loop |
| G5 | 자원 한계의 하위 전파 부재 | rlm budget propagation |
| MG1 | 자동 롤백 메커니즘 부재 | autoresearch git reset |
| MG2 | 복잡성 비용 평가 프레임워크 부재 | autoresearch simplicity criterion |

#### 4. 통합 제안 (검증 완료)

**ACCEPT (6건)**:

**P1. Intent Anchor 구조적 격리** (autoresearch → Phase 1)
- Agent prompt에 IA를 별도 시스템 메시지로 주입, 수정 경로 자체를 차단
- Enforcement: rule + prompt 구조 이중 보호. "IA가 현실과 충돌 시 보고하라" 명시
- IA-1 직접 실현

**P2. Phase 간 Compaction Protocol** (rlm → Phase 4, 7)
- Meta-review 후 이전 phase를 구조화 요약으로 압축. IA는 절대 압축 안 함
- 원본은 파일로 보존. Trigger: 매 meta-review 시점 (자동)
- G3 해결

**P3. 경량/중량 Agent 분류** (rlm → Context Budget)
- Light call: 단일 파일, 판단 불필요 → Orchestrator spot-check만
- Full agent: 다파일, 판단 필요 → 1:1 Review Agent 필수
- 의심 시 Full로 격상이 기본. Orchestrator가 분류 결정

**P4. 실패 이력 누적** (autoresearch → Phase 11)
- Experiment Log를 Phase 11 Report에 추가 (Phase 간 왕복 시에만 기록)
- Staleness decay: 6개월 이상 미참조 시 archive로 이동
- G2 해결

**P5. Work Agent 내부 Iteration** (rlm → Phase 8) — **CONDITIONAL**
- **RJ2와의 구분**: 내부 iteration은 "실행 수준 교정"(구문 에러, 런타임 에러)에 한정
- "계획 수준 변경"(다른 접근법, 구조 변경)은 여전히 STOP → Orchestrator
- max 3회. 모든 iteration 로그 기록. 최종 결과는 Review Agent가 검증
- 이 경계가 명확하지 않으면 P5는 기각

**P6. Graceful Degradation** (rlm → Phase 10) — **CONDITIONAL**
- **Anti-Pattern #9와의 해소**: 검증 판정은 PASS/FAIL 절대 유지
- Degradation은 "작업 산출물 보존" 레이어에만 적용
- 5개 기준 중 3개 PASS, 2개 FAIL → 3개는 확정, 2개만 재작업 대상

**REJECT (3건)**:
- RJ1: NEVER STOP 자율 모드 — IA-1 위반 (Human Oversight 원칙)
- RJ2: 단일 에이전트 모델 — IA-5 위반 (3-layer 구조 해체)
- RJ3: Review 없는 재귀 — IA-1 위반 (Agent pairing 필수)

#### 5. 향후 과제 (별도 연구/논의 필요)

- 탐색적 작업 경량 프레임워크 설계 (G1 — 11-phase가 아닌 별도 프레임워크)
- 복잡성 비용 평가 기준 (MG2 — Phase 7 meta-review 확장)
- 워크플로우 메타-학습: 실행 결과에 기반한 workflow 정의 개선 사이클
