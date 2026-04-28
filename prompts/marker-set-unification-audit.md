# §1 + §0.5 Marker Set Unification Audit (D107 cycle 4 cycle 3 P-3)

**Status**: AUDIT ONLY — enumeration + risk analysis. Implementation deferred to cycle 5+ explicit decision.

**Source of truth**: `prompts/behavior-verifier-prompt.md` (cycle 4 baseline, ~36707-36825 B post-Step 3+4).

## §1 Marker Set Enumerate

Source: `prompts/behavior-verifier-prompt.md` §1 understanding "format-markers" sub-clause (L234 area).

Markers (3):
- `[의도]` — intent restatement
- `[답]` — response/answer body
- `[자기 평가]` — self-assessment (optional `[정정]` follow-up)

Trigger condition: response length > 200 chars (non-trivial turn). Sample 3 (L509-518) confirms: `understanding.pass=false` with reason `"format-markers absent: response > 200 chars without [의도]/[답]/[자기 평가]"`.

Routing: missing marker → `understanding.pass=false` via §1 format-markers sub-clause (NOT a §0.5 form-game signal — see §0.5 L126).

## §0.5 Marker Set Enumerate

Source: `prompts/behavior-verifier-prompt.md` §0.5 Orchestrator Behavior Audit (L108-138).

Markers (5):
- `[의도]` — intent (L120, L134: must quote ≥1 noun phrase from user prompt)
- `[이해]` — understanding (L121, L135: must include uncertainty list OR `"없음"` disclaimer)
- `[검증]` — verification (L122, L136: must cite tool output OR `"미검증"` disclaimer)
- `[논리]` — logic (L123, L137: must include reasoning chain OR `"추론 불필요"` disclaimer)
- `[쉬운 설명]` — simple (L124, L138: ≤200자 plain prose, no analogy markers)

Trigger condition: every assistant turn (skeleton presence audit, no length gate per L126). Form-game detection (L134-138) assumes all 5 markers present.

Routing: missing marker → structural FAIL signal but NOT a form-game signal alone — routes to `understanding.pass=false` via §1 format-markers sub-clause (L126 explicit).

## Overlap Analysis

| Marker | §1 (3) | §0.5 (5) |
|--------|--------|----------|
| `[의도]` | ✓ | ✓ |
| `[답]` | ✓ | ✗ |
| `[자기 평가]` | ✓ | ✗ |
| `[이해]` | ✗ | ✓ |
| `[검증]` | ✗ | ✓ |
| `[논리]` | ✗ | ✓ |
| `[쉬운 설명]` | ✗ | ✓ |

**Overlap = 1 marker (`[의도]` only)**. Combined audit on a long workflow-internal turn requires 3 + 5 - 1 = **7 distinct markers**.

**Trigger asymmetry**: §1 fires only on length-gated turns (>200 chars). §0.5 fires every turn. On long turns, both audits run; the assistant must satisfy 7-marker union without conflict.

**Routing convergence (L126 evidence)**: §0.5 already delegates marker-presence FAIL back to §1's format-markers sub-clause. The two audits share a routing path but enumerate disjoint marker semantics — coupling without unification.

**Operational observation (cycle 3 Orchestrator self-observation, plan L17)**: assistant turns frequently FAIL §1 audit (`[답]` or `[자기 평가]` missing) while §0.5 audit PASSes (5 skeleton fields all present). Marker set divergence creates extra cognitive load without proportional audit value.

## Unification Options

### Option (i) — Absorb §1 into §0.5

§0.5 5-field skeleton becomes the only marker set; §1 format-markers sub-clause removed; `[답]` content folded into `[쉬운 설명]` body, `[자기 평가]` folded into `[검증]` (tool-output citation already covers self-assessment via P/O/G).

**Pros**:
- Single marker set, simpler cognitive model.
- Eliminates routing ambiguity (no two sub-clauses pointing at same FAIL).
- Prompt size reduction (~50-200 B from §1 format-markers sub-clause + Sample 3 collapse).

**Cons**:
- Backward compat break: cycle 1+2+3 turns used 3-marker §1 set; historical turn replay would FAIL retroactively.
- Semantic loss: `[답]` (response body marker) has no §0.5 equivalent — `[쉬운 설명]` is ≤200자 plain-prose constraint, not a body container. Content-rule redesign needed.
- `[자기 평가]` semantic ≠ `[검증]` semantic: self-assessment is meta-reflection on the turn; verification is tool-output citation. Conflation loses distinct audit dimension.

### Option (ii) — Separate but Cross-reference (RECOMMENDED for cycle 5+)

Keep both §1 and §0.5; add explicit cross-reference note in §0.5 stating "`[의도]` audit shared with §1 format-markers — same marker, same regex, distinct audit semantics"; document distinct trigger conditions (length-gated vs every-turn) inline.

**Pros**:
- Backward compat preserved (all post-cycle-1+2+3 turns valid).
- Additive change (low migration risk, no semantic loss).
- Distinct audit dimensions retained (§1 ergonomic short-form, §0.5 5-field skeleton).
- Explicit routing convergence (L126) gets explicit reader-facing documentation.

**Cons**:
- 2 audit checks per long turn = duplicate cognitive load (unchanged from baseline).
- Marker overlap (`[의도]`) reader confusion remains, though cross-ref note mitigates.
- Prompt size cost: ~30-150 B for cross-ref table or inline note.

### Option (iii) — Deprecate §1, §0.5 only

§1 format-markers sub-clause deprecated with explicit timeline (cycle N → cycle N+M deprecation window); only §0.5 5-field skeleton remains as audit target. Sample 3 rewritten to use §0.5 markers.

**Pros**:
- Simpler than (i) — explicit deprecation timeline allows graceful migration.
- Single marker set post-deprecation.
- Prompt size reduction (~250 B from §1 sub-clause + Sample 3 + length-gate logic).

**Cons**:
- Backward compat break (same as Option i).
- Loses length-gate semantics: §0.5 every-turn audit is heavier on short turns where §1 currently skips.
- Semantic loss of `[자기 평가]` (same as Option i).
- Deprecation window adds prompt complexity during transition (temporary +bytes before -bytes).

## Risk per Option

| Option | Backward compat | Prompt size delta | Semantic preservation | Migration cost |
|--------|----------------|-------------------|----------------------|----------------|
| (i) absorb | break (§1 markers obsolete) | -50 to -200 B | partial loss (`[답]` body container, `[자기 평가]` meta-reflection) | high (prompt rewrite + sample regeneration) |
| (ii) cross-ref | preserved | +30 to +150 B (cross-ref note/table) | full | low (additive only) |
| (iii) deprecate | break (with window) | -250 B post-window, +50 B during window | loss (`[자기 평가]`, length-gate) | high (rewrite + deprecation note + window mgmt) |

## Recommendation

**Option (ii) — Separate but Cross-reference** for cycle 5+ implementation.

**Rationale**:
- Preserves backward compat (all post-cycle-1+2+3 turns remain valid).
- Additive change (low migration risk).
- Distinct semantic preservation (§1 self-assessment ≠ §0.5 skeleton fields).
- Routing convergence (L126) gets explicit reader-facing documentation, reducing reader confusion without semantic merge.
- Prompt size cost (+30 to +150 B) acceptable when paired with cycle 5+ byte-budget renegotiation.

**Cycle 5+ implementation prerequisite**:
- Byte budget headroom recheck — cycle 4 ships ~39 B headroom (target 36825 / cap 36864). Option (ii) cross-ref +30 to +150 B forces compression elsewhere or cap relaxation. Cycle 5 byte-budget renegotiation MUST precede implementation.
- Cross-ref format design: column-table at top of §0.5 vs inline per-marker note vs separate "Marker Map" section. Compare reader-load and byte-cost before commit.
- Operational test: dispatch verifier on 10 turns with both marker sets present → confirm both audits PASS without conflict (cycle 5 prerequisite, NOT this audit).
- F-3 lifecycle FSM evaluation outcome (`prompts/f3-fsm-reconciliation-evaluation.md`) — if path (b) hand-off protocol shipped, two-lock acquisition pattern interacts with marker-set audit dispatch frequency. Resolve F-3 first.

## Open Questions for Cycle 5+

1. **Cross-ref format** — Should Option (ii) cross-ref be inline (per marker) or separate table (top of §0.5) or both? Inline is denser (~30 B); separate table is more reader-friendly (~150 B). Cycle 5 byte budget determines feasible form.

2. **`[의도]` overlap semantic** — Is `[의도]` meaning identical between §1 and §0.5? §1 calls it "intent restatement"; §0.5 L134 requires "≥1 noun phrase from user prompt OR explicit acknowledgment". Cross-ref note must clarify whether §1 `[의도]` ergonomic short-form satisfies §0.5 stricter quote-rigor — or if they are distinct regexes despite identical marker text.

3. **Cycle 5+ byte budget renegotiation** — Cycle 4 hard cap is 36864 B with 39 B headroom. Option (ii) +30 to +150 B forces (a) compression elsewhere (Sample 1+4 already compressed in cycle 4 — diminishing returns), (b) cap relaxation to 37000 B or higher, or (c) Option (i)/(iii) reconsidered for net-negative byte delta. Decision tree needed before cycle 5 implementation.

4. **Sample 3 fate under Option (ii)** — Sample 3 (L509-518) currently demonstrates §1 format-markers FAIL with 3-marker reason string. Under Option (ii), Sample 3 stays valid but cross-ref note may require Sample 3 reason text update to clarify §1-only failure (not §0.5 5-field). Audit-only document — implementation defers this decision to cycle 5+.

5. **Audit consolidation feasibility** — Could a single audit emit both §1 and §0.5 verdicts (one regex pass, two reason strings)? Would reduce duplicate cognitive load (Option ii main con) without breaking backward compat. Cycle 5+ implementation design question.
