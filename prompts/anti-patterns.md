---
type: anti-patterns
id: anti-patterns
title: "Externalization Trap Catalog + Avoidance Pattern History"
created: 2026-04-27
tags: [anti-patterns, externalization, simple-communication]
---

# Externalization Trap Catalog + Avoidance Pattern History

Anchor: `scripts/inject-rules.js` `RULES` PROHIBITED PATTERNS #9 (Default-First / Externalization Avoidance).

## Externalization Trap Catalog (rejected patterns)

These 7 patterns were proposed and rejected during D105 / I066. They are documented here so future cycles do not re-propose them in disguised form.

### TRAP-1 — Hardcoded "simple" measurable signals (regex 3종)
Proposal: define §4.simple PASS as regex matches on (concrete-before-abstract / jargon-with-gloss / one-sentence-core).
Rejection: gameable mechanics — assistant satisfies regex while remaining incomprehensible. Source: I066 RA3 + RA5 cross-review.

### TRAP-2 — Cross-criterion gate (next-turn user comprehension signal as 측정 단위)
Proposal: §4.simple FAILs only when verifier subjective FAIL AND next-turn user signals "이해 안돼"/"무슨 말".
Rejection:책임 transfer — "내가 모르니 사용자가 매번 catch해주세요" 함정. Real understanding doesn't need user signal as measurement unit.

### TRAP-3 — workflow.json merge (skill-active + regressing-state + wa-count → 1)
Proposal: consolidate three workflow-state files into one for "cohesion".
Rejection: nonexistent file premise + single-lock blast radius expansion. Each file has different write cadence/lifecycle. RA4.

### TRAP-4 — H + W document-type merger
Proposal: merge Hotfix and Worklog types into single "lightwork" with mode flag.
Rejection: lifecycle distinction is the point — H = post-hoc forensic record (status:done at create, no agents), W = pre-execution scaffold (status:in-progress, full agent flow). Mode-flag merge collapses semantics.

### TRAP-5 — L3 summary lazy-load
Proposal: skip L3 summary at SessionStart, load on demand only.
Rejection: pre-load EV cheaper (1 summary × ~1.6K tok vs ~1.5K+ tok per on-demand search × N searches). Real audit target = logbook tail-50 (8.6× larger payload).

### TRAP-6 — RULES shared module extraction
Proposal: extract RULES constant to separate file imported by inject-rules.js + subagent-context.js.
Rejection: "code is contract" pattern. Storage cost negligible. Hot-path I/O cost real on UserPromptSubmit. Defense-in-depth duplication is FEATURE.

### TRAP-7 — Project Concept per-turn skip
Proposal: skip Project Concept injection when memory-snippet match score is high.
Rejection: drift-prevention feature. Per-turn injection is intentional under attention-decay model.

## Avoidance Pattern History (4 prior catches)

This session caught 4 instances of the same meta-pattern: "본인 default 안 바꾸고 외부화로 우회". Documented for future cycle dis-incentive.

### AVOID-1 — Analogy 회귀 (CLAUDE.md spec 자체)
Symptom: "쉬운 설명 = use an analogy" 표현이 spec 본문에 박혀 있어서 매번 analogy로 회귀.
Catch: 사용자 "아날로지 ≠ 쉬운 설명" 다회 catch.
Meta cause: spec source 미수정 + analogy default 자체.
Fix: D105 cycle 1 / P137 / T001 — spec 정정.

### AVOID-2 — Regex 측정 신호 만들기 (자동화 우회)
Symptom: I066 Q8에서 §4.simple 측정 가능한 3 hardcoded signal 제안.
Catch: 사용자 "사용자 catch가 측정 단위? 너 모름" — 자동화 우회 함정 catch.
Meta cause: 측정 시스템 만들기로 default 행동 변경 회피.
Fix: TRAP-1으로 등재.

### AVOID-3 — User catch 신호 (책임 transfer)
Symptom: cross-criterion gate 제안 — "사용자 comprehension signal 있어야 §4.simple FAIL".
Catch: 사용자 "내가 말 안하면 쉬운 설명이 뭔지 모른다는 뜻이잖아요" — 사용자 책임 transfer catch.
Meta cause: 본인이 default로 측정 못 한다는 인정 회피.
Fix: TRAP-2으로 등재.

### AVOID-4 — Measurement system 전반 (1주일 누적 prerequisite)
Symptom: I066 Phase 2 "1주일 데이터 누적" 제안.
Catch: 사용자 "지금까지 데이터를 쌓았는데 뭘 1주일 동안 데이터를 쌓는다는건가요" — 외부 측정 시스템 만들기 자체가 회피.
Meta cause: default 변경 + 즉시 분석 대신 측정 인프라 구축으로 우회.
Fix: I066 Phase 2 정정 (즉시 분석으로 변경).

## Meta cause (4회 공통)

"본인 default 안 바꾸고 외부 시스템 (감시자/hook/RULES injection/측정/자동화) 으로 떠넘기기".

향후 외부화 제안 시 점검 — RULES PROHIBITED PATTERNS #9 + 본 catalog 대조.
