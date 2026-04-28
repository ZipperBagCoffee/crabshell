# Output Schema 2-Tier Proposal (D107 cycle 3 IA-5 frontier F-2)

> **Status**: Proposal-only. NOT implementation. Tier 2 ship deferred to cycle 4+ with F-3 (lifecycle FSM reconciliation) as a HARD prerequisite.
> **Authority**: P145 cycle 3 ticket P145_T001 AC-9 (RA2 condition C2 enforcement). 7 sections required.
> **Cross-references**: cycle 2 plan P144 RA2 frontier evaluation; cycle 3 plan P145 Intent Check L650-727.

---

## Background

cycle 2 (P144) RA2 evaluation produced a 4-axis frontier for cycle 3:

- **F-1** trigger axis unification (Stop hook + PostToolUse hook 단일 dispatcher 설계).
- **F-2** output schema 2-tier separation (this proposal의 대상).
- **F-3** lifecycle FSM reconciliation (verifier `pending → completed → consumed` × memory-keeper rotation의 상호작용).
- **F-4** lock unification audit (verifier.lock × .memory-index.lock 경계 정합성).

cycle 2 Step C 평가에 따르면 **F-2 가 가장 cross-cutting leverage 가 높음**:

1. **cycle 2 P-1 (Sample 1-4 inconsistency) 의 구조적 해소** — Tier 1 schema 가 freeze 되면 Sample examples 의 sync 가 mechanical 한 byte-gate 작업으로 환원된다.
2. **cycle 2 P-2 (LLM-compliance harness 부재) 의 부분 응답** — Tier 1 의 machine-consumed 경계가 명확해지면 V023 같은 deterministic harness 가 정의 가능해진다.
3. **memory-keeper merge 의 eventual feasibility precursor** — Tier 2 (logbook narrative-history) 가 memory-keeper 의 logbook rotation pipeline 과 동일한 sink 를 사용하므로, 향후 verifier 와 memory-keeper 의 통합 경로를 미리 정렬한다.

**증거 (cycle 2 RA2 비교 매트릭스)**:

| 축 | 현재 상태 (cycle 2 ship 기준) | F-2 적용 후 (proposal) |
|---|---|---|
| Trigger | Stop hook + PostToolUse 이중 entry (F-1 미해결) | F-2 와 직교, 변화 없음 |
| State | `pending → completed → consumed` (verifier.lock) | F-3 와 cross-cut, Tier 2 가 trigger 하는 lock 경합 risk → F-3 prerequisite |
| Output | 5-key JSON 단일 출력 (UVLS 4 + auditVerdict 1) | **Tier 1 = 구조화 JSON (machine-consumed) / Tier 2 = markdown narrative (logbook-only)** |
| Inject pressure | ≤1500 char (`inject-rules.js` L1018 `TOTAL_CAP`) | Tier 1 unchanged ≤1500 char / Tier 2 = 0 (never injected) |

cycle 2 의 RA2 frontier evaluation 은 F-2 의 cross-cutting leverage 를 근거로 cycle 3 우선순위 #1 로 결정했다. 본 문서는 F-2 의 architectural design 만 기록하며, **실제 producer/sink 코드 구현은 cycle 4+ ticket 으로 분리**한다 (anti-partitioning 보존).

---

## Tier 1 (Structured-Correction Layer)

**현재 상태 (cycle 2 ship 기준, cycle 3 에서 변경 없음)**:

- **Schema**: verifier sub-agent 는 5-key JSON 을 emit 한다.
  ```
  {
    "understanding": { "pass": bool, "reason": str },
    "verification":  { "pass": bool, "reason": str },
    "logic":         { "pass": bool, "reason": str },
    "simple":        { "pass": bool, "reason": str },
    "auditVerdict":  { "semanticAlignment": bool,
                       "formGameDetected":  bool,
                       "evidence":          str (≤80 chars) }
  }
  ```
- **Schema authority**: `prompts/behavior-verifier-prompt.md` §Schema Stability (L27 — single source of truth) + Sample 1-4 byte-identical examples (cycle 3 WA1 의 sync 대상).
- **Producer**: `behavior-verifier.js` sub-agent dispatch (sentinel `[CRABSHELL_BEHAVIOR_VERIFY]` at `behavior-verifier.js` L270, dispatch instruction shape 는 `inject-rules.js` L958-965).
- **Consumer**: `inject-rules.js` L1011-1037.
  ```js
  // inject-rules.js L1013-1015
  const failed = Object.entries(stateForEmit.verdicts).filter(function(entry) {
    return entry && entry[1] && entry[1].pass === false;
  });
  ```
  4 UVLS 축은 `.pass === false` 일 때 correction 으로 emit 된다. **`auditVerdict` 는 `.pass` property 가 없으므로 자동으로 skip** — 의도된 schema 비대칭이다 (sibling key 지만 inject path 와 분리).
- **Per-turn injection pressure cap**:
  - `PER_ITEM_CAP = 600` (각 verdict reason)
  - `TOTAL_CAP = 1500` (전체 correction block) — `inject-rules.js` L1017-1018.
  - 초과 시 `...(truncated)` 로 끊는다 (L1029-1031).
- **Lifecycle FSM**: `pending → completed → consumed`. lock = `verifier.lock` (RMW transition-then-emit, `inject-rules.js` L973-1009).

**cycle 3 변경 사항: 없음.** Tier 1 schema 는 cycle 2 P144 ship 으로 frozen. cycle 3 의 WA1 작업은 Sample examples 의 byte-identical sync 만 수행한다 (schema 자체는 불변).

---

## Tier 2 (Narrative-History Layer)

**Proposal — NOT implemented in cycle 3**:

- verifier sub-agent (또는 별도 narrative-extractor — § Producer Architecture Trade-off 참조) 가 **OPTIONALLY** markdown narrative 를 emit 한다. Tier 1 JSON 은 변함없이 emit; Tier 2 narrative 는 추가 채널.
- **Sink path**: `append-memory.js` L46-47 의 logbook append 메커니즘 재사용.
  ```js
  // append-memory.js L46-47
  const entry = `\n## ${ts.utc} (local ${ts.local})\n${summary}\n`;
  fs.appendFileSync(memoryPath, entry, 'utf8');
  ```
  Tier 2 narrative 는 동일한 markdown block 형태로 logbook.md 에 append.
- **Per-turn prompt injection pressure: 0**. Tier 2 는 logbook-only — `inject-rules.js` 의 correction emit path (L1011-1037) 를 거치지 않는다. 즉 다음 턴 user prompt 에 절대 주입되지 않으며, Tier 1 의 1500-char cap 에 영향을 주지 않는다.
- **Sentinel**: TBD (§ Sentinel Naming Convention 참조).
- **Producer**: TBD (§ Producer Architecture Trade-off 참조).
- **Lifecycle**: TBD (§ F-3 Prerequisite 참조 — `pending → completed → consumed` 와 logbook rotation 의 race 해소 후 결정).
- **Consumption target**:
  - 1차: human 의 `cat .crabshell/memory/logbook.md` / Obsidian 렌더링.
  - 2차: memory-keeper 의 Haiku rotation pipeline (L3 archive 입력으로 자연 흡수).
  - 3차 (optional, cycle 5+ feasibility): 향후 search-memory skill 의 BM25 index 입력.

**핵심 비대칭**: Tier 1 = machine-consumed (구조화 JSON, inject pressure 발생) / Tier 2 = human + Haiku-consumed (markdown, inject pressure 0). 이 비대칭이 F-2 의 architectural value 의 핵심.

---

## Producer Architecture Trade-off

Tier 2 narrative producer 의 두 가지 후보:

### Option A — Same-agent dual-emit

기존 verifier sub-agent 가 단일 dispatch 안에서 **둘 다** emit:
- Tier 1: 5-key JSON (state file 에 write).
- Tier 2: markdown narrative (별도 sentinel + stderr 또는 별도 파일 sink).

**Pros**:
- Single dispatch cost — 2nd sub-agent spawn 비용 없음 (구독 사용량 절감 + latency 절감).
- Shared input transcript context — Tier 1 과 Tier 2 가 동일 transcript 를 본다 (관점 불일치 risk 0).
- 구현 단순성 — 기존 `behavior-verifier.js` 의 state-file write 경로 옆에 logbook append 만 추가.

**Cons**:
- **Prompt size pressure** — Tier 2 narrative 생성 instruction 이 verifier prompt 에 추가되면 현재 ~36210 byte body 가 36864 cap 을 초과할 risk 가 cycle 3 R-2 (P145 Intent Check) 시점에서도 75-byte headroom 으로 brittle.
- **Single point of failure** — LLM dispatch 가 실패하면 Tier 1 + Tier 2 모두 손실 (현재는 fail-open 으로 Tier 1 만 손실).
- **Schema coupling** — Tier 2 schema 변경이 verifier prompt 변경을 강제 → Tier 1 schema 의 freeze 약속 (cycle 2 ship) 위반 risk.
- **Lifecycle entanglement** — Tier 2 narrative 는 `consumed` 전환 시점에 logbook 에 sink 되어야 하는데, verifier sub-agent 자체는 RMW critical section 외부에 있음 → cross-lock 경합 (§ F-3 Prerequisite 참조).

### Option B — Separate narrative-agent

새로운 sub-agent (예: `narrative-extractor` skill, 또는 기존 `delta-summarizer` agent 재사용) 가:
- Tier 1 의 `behavior-verifier-state.json` (status=`completed`) 를 read.
- 동일 transcript 를 read.
- Tier 2 markdown narrative 를 emit.

**Pros**:
- **Schema decoupling** — Tier 1 과 Tier 2 는 독립적으로 진화 가능. Tier 1 freeze 약속 보존.
- **Failure isolation** — Tier 2 dispatch 실패 시 Tier 1 correction emit 은 영향 없음. 프로젝트 fail-open invariant 와 정합.
- **Prompt size 분리** — verifier prompt 는 36864 cap 안에서 자유, narrative-extractor 는 별도 prompt (자체 cap).
- **Agent skill clarity** — verifier 는 "behavior judgment", narrative-extractor 는 "history capture" — 단일 책임 원칙.
- **Lock 책임 분리** — Tier 2 producer 가 `.memory-index.lock` 을 직접 관리. verifier 는 `verifier.lock` 만 다룸.

**Cons**:
- **2nd dispatch cost** — sub-agent spawn 1회 추가 (구독 사용량 + latency).
- **Coordination overhead** — Tier 2 는 Tier 1 의 `completed` 상태에 의존 → trigger ordering 필요 (Stop hook 또는 PostToolUse hook 에서 sequential dispatch).
- **Transcript re-read** — Tier 2 producer 가 transcript 를 다시 읽어야 함 (캐시 가능하나 구현 복잡도 증가).

### Recommendation: Option B (separate narrative-agent)

**근거**:
1. **Schema decoupling 이 cycle 2 freeze 약속과 정합** — Tier 1 schema 변경을 cycle 4+ 에서 강제하지 않는다.
2. **Failure isolation 이 프로젝트 fail-open invariant 와 정합** — `CLAUDE.md` "All hook scripts must fail-open" 원칙.
3. **Cost 비대칭 수용 가능** — Tier 2 는 logbook-only consumption 이므로 latency-tolerant. 2nd dispatch 의 latency penalty 가 user-blocking path 가 아님.
4. **Prompt size pressure 회피** — R-2 (75-byte headroom) 가 Tier 2 instruction 추가로 즉시 깨질 risk 제거.

**Cycle 4+ 결정 사항** (이 proposal 에서는 미결정):
- 새 skill (`narrative-extractor`) vs 기존 `delta-summarizer` 재사용 — cycle 4 implementation 단계에서 결정.
- Trigger 위치 (Stop hook chain 의 어느 지점 / 별도 PostToolUse) — F-1 (trigger axis unification) 결과에 따라 결정.

---

## Sentinel Naming Convention

기존 pipeline sentinel 2종:

| Sentinel | Producer | Consumer | 위치 |
|---|---|---|---|
| `[CRABSHELL_DELTA]` | `counter.js` (L368: `\n[CRABSHELL_DELTA] file=...`) | `memory-delta` skill | session 종료 시 stderr |
| `[CRABSHELL_BEHAVIOR_VERIFY]` | `behavior-verifier.js` L270 | `inject-rules.js` UserPromptSubmit hook | post-response stderr |

추가로 (`memory-autosave`, `memory-rotate` 등) 도 `[CRABSHELL_SAVE]` / `[CRABSHELL_ROTATE]` 형태로 동일 namespace.

**Tier 2 sentinel 후보**:

- **후보 1**: `[CRABSHELL_VERIFIER_NARRATIVE]` (line-prefix 형식, 기존 sentinel 과 동일 형태).
- **후보 2**: `<VERIFIER_NARRATIVE>...</VERIFIER_NARRATIVE>` (XML-tag 감싸기, multi-line content 안전).

**Constraints (cycle 4+ 구현 시 충족 필수)**:
- 기존 2 sentinel 의 parser regex 와 충돌 금지 — `delta-summarizer` 의 `[CRABSHELL_DELTA] file=...` regex, `inject-rules.js` 의 `[CRABSHELL_BEHAVIOR_VERIFY]` consumption regex 와 distinct prefix.
- prefix `[CRABSHELL_*]` 또는 `[CRABSHELL_VERIFIER_*]` 로 namespace 일관성.
- multi-line markdown narrative 가 들어갈 가능성 → **후보 2 (XML-tag)** 가 line-prefix 보다 안전 (markdown 안의 `\n` 이 sentinel parser 를 깨뜨리지 않음).

**Tentative recommendation**: `<VERIFIER_NARRATIVE>...</VERIFIER_NARRATIVE>` (XML-tag) — multi-line markdown safety + 기존 line-prefix sentinel namespace 와 형태적으로 distinct (parser collision risk 0).

**최종 결정 cycle 4+ 구현 시점에 collision audit + naming poll**.

**Convention summary**:
- **Prefix** = pipeline stage (`CRABSHELL_VERIFIER_*` = verifier 후속 단계).
- **Suffix** = content type (`_NARRATIVE` = markdown narrative, `_DELTA` = delta entries).
- **Form**: line-prefix `[...]` for short single-line / XML-tag `<...>` for multi-line markdown.

---

## Markdown vs JSON Rationale (Tier 2)

Tier 2 narrative format = **markdown** (NOT JSON). 근거 4가지:

### 1. Logbook rotation pipeline 호환성

`logbook.md` 는 markdown 파일이며, `append-memory.js` L46-47 은 markdown block 을 append 한다:
```js
const entry = `\n## ${ts.utc} (local ${ts.local})\n${summary}\n`;
```
JSON 을 sink 로 보내려면 rotation pipeline 의 parser 변경이 필요 — cycle 3 scope 외 변화. markdown 유지 시 **0-line parser 변경**.

### 2. Haiku summarization 가정

memory-keeper 의 Haiku sub-agent (T3 model — `project.md` Model Routing) 는 markdown narrative 를 input 으로 가정한다 (rotation 시 markdown body 를 받아 요약). JSON input 으로 바뀌면:
- summarization 품질 저하 (Haiku 가 JSON structural cue 를 놓침).
- Haiku prompt schema 변경 필요 — cycle 4+ 에서 추가 비용.

markdown 유지 시 **Haiku prompt 변경 0**.

### 3. Human-readable

Tier 2 narrative 의 1차 consumption target 은 human (`cat logbook.md`, Obsidian 렌더링). markdown 은 plain-text 로 자연스럽게 읽히고, Obsidian wiki link 를 자연 지원. JSON 은 raw 로 읽기 어렵고 wiki 렌더링이 깨진다.

### 4. Tier 1 vs Tier 2 format asymmetry 강화

Tier 1 = 구조화 (JSON, machine-consumed) / Tier 2 = 비구조화 (markdown, human + Haiku-consumed). **format asymmetry 가 consumption-model asymmetry 를 reinforce** — 향후 reviewer 가 두 Tier 의 역할을 혼동할 risk 감소. 동일 format (둘 다 JSON 또는 둘 다 markdown) 으로 가면 경계 모호.

**결론**: Tier 2 = markdown. 4 axes 모두 markdown 채택을 지지하며 JSON 채택의 affirmative 근거 없음.

---

## F-3 Prerequisite (Lifecycle FSM Reconciliation)

**Tier 2 implementation 은 F-3 settle 후에만 ship 가능. 이는 권고가 아니라 hard ordering constraint.**

### F-3 가 settle 되어야 하는 이유

**(a) State race**:
- verifier 의 lifecycle: `pending → completed → consumed` (`inject-rules.js` L996 의 `fresh.status = 'consumed'` 전환).
- memory-keeper 의 logbook rotation: token 임계 도달 시 logbook.md 의 일부를 archive 로 이동 + 새 logbook 생성.
- Tier 2 narrative emit 이 verifier 의 `consumed` 전환과 logbook rotation 사이에 끼면, append-then-rotate race 발생 — narrative 가 archive 와 신 logbook 사이에 split 되거나 lost.

**(b) Lock contention**:
- verifier 는 `verifier.lock` (`inject-rules.js` L973: `lockPath = path.join(memoryDir, BEHAVIOR_VERIFIER_LOCK_FILE)`) 을 RMW critical section 에서 hold.
- memory-keeper 는 `.memory-index.lock` 을 logbook write/rotate 시 hold.
- **Option A (same-agent dual-emit)** 채택 시: verifier sub-agent 가 logbook 에 직접 append → `.memory-index.lock` 획득 필요 → cross-lock 획득 순서 risk (deadlock 또는 stale-lock cleanup race).
- **Option B (separate narrative-agent)** 채택 시: narrative-agent 가 verifier `consumed` 상태를 read-only 로 보고 자체 lock 만 hold → cross-lock 회피 가능, 하지만 read-after-consumed 시점이 logbook rotation 과 정렬되지 않으면 (a) 의 race 에 노출.

### F-3 가 선택할 두 경로

**경로 (a) — Two locks 통합**:
- `verifier.lock` 와 `.memory-index.lock` 을 단일 lock 으로 머지 (예: `.memory-state.lock`).
- 모든 verifier-state + logbook write 가 동일 lock 으로 직렬화.
- **장점**: cross-lock 문제 0.
- **단점**: contention 증가 (verifier 자주 hold, memory-keeper 도 자주 hold) → user prompt latency 증가 가능.

**경로 (b) — Hand-off protocol**:
- verifier 가 `consumed` 전환을 완료하고 `verifier.lock` 을 release.
- narrative-extractor 가 `verifier.lock` 풀린 후에 `consumed` state 를 read.
- narrative-extractor 가 `.memory-index.lock` 을 획득하고 logbook 에 append.
- rotation 은 별도 trigger — narrative append 와 sequential 이 아니라 token 임계 기반.
- **장점**: contention 최소화, 단일 책임 원칙 보존.
- **단점**: 구현 복잡도 (state read 시점 정의, rotation 진행 중 append-trigger 의 fallback 정의).

### Cycle 4+ 진행 조건

**cycle 4+ implementation roadmap MUST NOT proceed Tier 2 until F-3 reconciliation ships.**

이는 hard ordering constraint:
- F-3 의 (a)/(b) 경로 중 하나가 ship 되기 전에 Tier 2 producer 코드를 작성하면, lock 경합 / state race 의 정의되지 않은 경계 위에서 구현하게 된다.
- 결과적으로 cycle 4+ 의 Tier 2 ship 이 race regression 을 동반할 risk → ship 후 fail-open 발동 빈도 증가 → memory loss → user-visible breakage.

따라서 **cycle 4 에서 F-3 우선 settle, cycle 5+ 에서 F-4 audit + Tier 2 producer skill 구현, cycle 6+ 통합 테스트** — 다음 § 참조.

---

## Cycle 4+ Implementation Roadmap

Tier 2 ship 까지의 estimated 4-cycle path:

### Cycle 4 — F-3 lifecycle FSM reconciliation

- 두 lock (`verifier.lock`, `.memory-index.lock`) 의 경로 결정: (a) 머지 vs (b) hand-off.
- 결정 근거: contention 측정 (verifier dispatch 빈도 × logbook write 빈도) + race window 측정.
- ship: lock surface 변경 (코드 + verifier-state schema 의 lock-name field 가 있다면 migration).
- AC: `_test-fail-open-edge-cases.js` regression 0건 + 새 `_test-d107-cycle4-lock-reconcile.js` (race scenario) PASS.

### Cycle 5 — F-4 lock unification audit (또는 F-3 hand-off 구현 마감)

- (a) 머지 경로 채택 시: 다른 lock 들 (memory rotation lock, sessions lock 등) 과의 통합 audit.
- (b) hand-off 경로 채택 시: hand-off protocol 의 edge case (verifier crash 시 narrative-extractor 진행 여부, narrative-extractor crash 시 verifier `consumed` 상태 보존 여부) 마감.
- AC: full /verifying suite (28+ entries) regression 0건 + lock contention metric 측정 결과 archive.

### Cycle 6 — Tier 2 producer skill 구현

- producer 결정: `narrative-extractor` 신규 skill vs `delta-summarizer` agent 재사용.
- sentinel naming 최종 결정 (`<VERIFIER_NARRATIVE>` 권고안 또는 collision audit 후 대안).
- sink path: `append-memory.js` L46-47 메커니즘 재사용 또는 신규 `append-narrative.js` (Tier 2 전용).
- Tier 2 schema 의 lightweight freeze: cycle 6 ship 시점부터 schema 변경은 cycle 7+ ticket 으로 분리.
- AC: `prompts/output-schema-2tier-proposal.md` 의 본 § 와 ship 결과 deviation 0 (또는 deviation explicit 문서화).

### Cycle 7 — End-to-end integration tests

- verifier dispatch → Tier 1 state file write → Tier 2 narrative emit → logbook append → rotation pipeline 의 full-flow regression test.
- LLM-compliance manual capture archive (V023 manual capture pattern 의 Tier 2 확장).
- 측정: per-turn latency, logbook growth rate, rotation 빈도.
- AC: full-flow test PASS + cycle 3 baseline (V001-V023) regression 0건.

### Realistic ship target

**Tier 2 = cycle 7+ (cycle 3 기준 +4 cycle)**. F-3 dependency 가 cycle 4 에서 settle 되어야 하므로 earlier ship 은 race risk 동반 → infeasible.

cycle 별 risk 조합 (implementation 시 reference 용):
- cycle 4 risk: lock 변경의 fail-open regression. mitigation: `_test-fail-open-edge-cases.js` AC 강제.
- cycle 5 risk: lock contention 증가로 user-visible latency. mitigation: contention metric 측정 후 ship/abort 결정.
- cycle 6 risk: Tier 2 schema 가 cycle 6 시점에 over-design. mitigation: minimal schema (timestamp + verdict ref + narrative body 3-field) 로 시작, cycle 7+ 에서 evidence-driven 확장.
- cycle 7 risk: end-to-end test 불안정. mitigation: cycle 6 시점에 unit test 부터 스택 빌드 (skill-level → integration-level → end-to-end).

---

> **Document end** — 7 sections per RA2 condition C2 enforcement. Implementation deferred to cycle 4+ with F-3 prerequisite hard-gated.
