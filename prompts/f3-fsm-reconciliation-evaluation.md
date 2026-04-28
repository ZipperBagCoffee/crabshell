# F-3 Lifecycle FSM Reconciliation Evaluation (D107 cycle 4 IA-5 frontier F-3)

> **Status**: PROPOSAL ONLY — preliminary recommendation pending cycle 5 F-4 measurement. NOT pre-ratified for implementation. Cycle 5+ defer for actual lock surface change (architecture-critical, explicit user confirm prerequisite per P146 cycle 4 scope).
> **Ratification gate**: cycle 5 F-4 standalone audit (lock contention measurement) MUST run before any path (a/b) ratification. Bundling F-4 measurement with a path-b minimal contract would corrupt measurement validity (decision-without-evidence). This document is preliminary; cycle 5 measurement may surprise (e.g., measured contention < threshold could enable path (a) lock-merge after all).
> **Authority**: P146 Plan Step 1 (cycle 3 P-4 follow-up). cycle 2 RA2 frontier F-3 source (`P144` `## Analysis Results > WA2 §D`).
> **Cross-references**: cycle 3 F-2 `prompts/output-schema-2tier-proposal.md` § F-3 Prerequisite (Tier 2 ship hard-gated on F-3 settle). cycle 2 P144 RA2 (`§ F-3 Lifecycle FSM reconciliation`).

---

## Background

cycle 2 (P144) RA2 evaluation produced a 4-axis frontier (F-1 trigger / F-2 schema / F-3 lifecycle / F-4 lock) for cycle 3+. cycle 3 (P145) shipped F-2 (output schema 2-tier proposal-only). F-3 was deliberately deferred because:

- F-2 settled the **output asymmetry** (Tier 1 JSON / Tier 2 markdown) without touching the lock surface.
- F-3 settles the **state-machine asymmetry** between two sub-systems that already coexist:
  1. **verifier** (`scripts/inject-rules.js` L956-988 RMW): explicit FSM `pending → completed → consumed`, lock = `verifier.lock` (`scripts/constants.js:38` — `BEHAVIOR_VERIFIER_LOCK_FILE = 'verifier.lock'`), TTL=10min stale (`inject-rules.js` L879 `TTL_MS = 10 * 60 * 1000`), 60s lock stale cleanup (`inject-rules.js` L983 `Date.now() - fs.statSync(lockPath).mtimeMs > 60000`).
  2. **memory-keeper** (`scripts/extract-delta.js` + `scripts/append-memory.js` + `scripts/counter.js`): implicit lifecycle via 3 booleans + 1 mtime gate in `memory-index.json`:
     - `deltaReady` (`extract-delta.js:194`, `counter.js:229` — set after `extractDelta()` succeeds)
     - `deltaProcessing` (`extract-delta.js:215` — `markDeltaProcessing()` flips while Haiku runs)
     - `memoryAppendedInThisRun` (cleared at `extract-delta.js:196` `delete index.memoryAppendedInThisRun`)
     - `deltaCreatedAtMemoryMtime` (`extract-delta.js:118` — captured at extraction time)
     - mtime gate: `extract-delta.js:186-189` blocks cleanup if `currentMemoryMtime <= deltaCreatedMtime` (fail-CLOSED — only fail-closed gate in the whole memory-keeper pipeline).
  3. Lock surfaces today are **distinct**: `verifier.lock` (verifier-only) vs `.memory-index.lock` (`scripts/constants.js:48` — `INDEX_LOCK_FILE = '.memory-index.lock'`). The `.memory-index.lock` is acquired by `counter.js:91`, `counter.js:353`, `inject-rules.js:731`, `load-memory.js:139`, `post-compact.js:59`, `wa-count-pretool.js:61`, `sycophancy-guard.js:287/317/356`. The `verifier.lock` is acquired only at `inject-rules.js:973`. **No code path acquires both today** — cross-lock contention surface = 0.

Cycle 3 F-2 § F-3 Prerequisite (`prompts/output-schema-2tier-proposal.md` L216-258) defined this frontier as a **hard ordering constraint** for Tier 2 ship: Tier 2 narrative must be appended via the same logbook sink (`append-memory.js:46-47`) as memory-keeper, so a Tier 2 producer that runs alongside verifier consumption introduces cross-lock acquisition that does not exist today. F-3 must settle BEFORE Tier 2 producer code (cycle 6+ per F-2 roadmap).

This document evaluates the two paths cycle 3 F-2 named (path a = lock-merge, path b = hand-off protocol), enumerates per-path race risk, and recommends a path + ship cycle + risk acceptance gate.

---

## Path (a) — Lock-Merge

### Design

Replace `verifier.lock` and `.memory-index.lock` with a single `.memory-state.lock` (or rename `.memory-index.lock` to absorb verifier transitions). All three sub-systems acquire the unified lock:

1. **verifier consumer** (`inject-rules.js:973-1006`): replace `BEHAVIOR_VERIFIER_LOCK_FILE` write with `acquireIndexLock(memoryDir)` (already imported at `inject-rules.js:9`). Move `pending → completed → consumed` transition inside the existing `inject-rules.js:731-787` RMW block — verifier transition becomes another field-update inside the index lock.
2. **memory-keeper** (`counter.js:91`, `counter.js:353`): no change — already on `.memory-index.lock`.
3. **future Tier 2 producer** (cycle 6+ narrative-extractor sub-agent) acquires same lock for `append-memory.js`-style appends.

State machine becomes single-file (`memory-index.json`): verifier FSM fields (`status`, `taskId`, `verdicts`, `ringBuffer`, etc. — currently 14 fields in `behavior-verifier-state.json`) absorb into `memory-index.json` as a `behaviorVerifier:{...}` sub-object.

### Acquisition Order

Single lock = single acquisition order. No deadlock possible (cannot have lock cycle of size 1).

### Pros

- **Cross-lock contention surface = 0 by construction.** A unified mutex auto-serializes all state transitions. F-4 lock unification audit becomes trivial (one lock, no cross-lock cases to audit).
- **State machine consolidation enables F-2 Tier 2 ship.** Tier 2 producer acquiring the same lock as memory-keeper rotation is automatic — no new lock primitive.
- **At-most-once consumption invariant preserved.** verifier RMW (`inject-rules.js:990-1009`) re-reads inside the lock; `acquireIndexLock` provides identical re-read semantics (`utils.js:134-138`).
- **Eliminates schema asymmetry.** `behavior-verifier-state.json` collapses into `memory-index.json` — fewer files, single source of truth.

### Cons

- **Contention surface expansion.** Today `.memory-index.lock` is held during:
  - PostToolUse (`counter.js:91-238`): every tool call, holds for the duration of `extractDelta()` + L1 read + delta_temp write (sync, ~10-50ms typical).
  - UserPromptSubmit (`inject-rules.js:731-787`): every user prompt, holds for pressure RMW (~5ms).
  - Final Stop (`counter.js:353-364`): once per session.
  - SessionStart (`load-memory.js:139`).
  - PreToolUse (`wa-count-pretool.js:61`): every tool call.
  - Sycophancy-guard (`sycophancy-guard.js:287/317/356`): every UserPromptSubmit pre-check.

  Adding verifier transitions on top means `verifier.lock`'s currently-uncontended RMW (`inject-rules.js:990-1009`, ~5ms) now waits behind every PostToolUse extractDelta. Worst case: PostToolUse holds lock for 50ms while extractDelta writes delta_temp; UserPromptSubmit verifier transition queues behind it. **User-visible latency** (UserPromptSubmit blocks the next user prompt's context injection).

- **Regression risk against P130 3-counter pressure model.** `inject-rules.js:744-754` performs pressure RMW under `.memory-index.lock` already; merging verifier transitions doubles the critical-section work. P130 cycle counts (`feedbackPressure.consecutiveCount` / `decayCounter` / `oscillationCount`) were derived assuming current lock duration. Cycle counts may need re-derivation (e.g., decay timing assumed 1-prompt granularity; if a verifier-transition contention extends a turn, decay phase can desync).

- **Fail-closed gate inheritance.** memory-keeper has one fail-closed gate (`extract-delta.js:186-189` BLOCKED if logbook.md not updated since delta creation). Verifier is fail-open at every step (`inject-rules.js:1009` `} catch (e) { /* fail-open */ }`). Merging into one lock surface forces verifier transitions to coexist with the fail-closed mtime gate — if extractDelta fails its mtime check, the lock-acquired verifier consumer sees the same `memory-index.json` state but cannot meaningfully proceed without addressing the BLOCKED logbook condition. **Fail-open invariant for verifier is at risk** if the consumer block is naively co-located.

- **Migration cost.** All callers of `readBehaviorVerifierState()` (`inject-rules.js:812`, `:816`, ringBuffer renderer at L885-927, dispatch emit at L941-965, RMW at L967-1009) must switch to reading the `behaviorVerifier:{...}` sub-object of `memory-index.json`. `behavior-verifier.js` (Stop hook) state writer also migrates. State file migration script needed (legacy `behavior-verifier-state.json` → `memory-index.json.behaviorVerifier`).

- **Critical risk — writer asymmetry (hidden migration cost).** The verifier `status='pending'` writer at `behavior-verifier.js:243` (`status: 'pending'` field-set) followed by `writeJson(stateFilePath, state)` at `behavior-verifier.js:259` runs in the Stop hook **WITHOUT acquiring `verifier.lock`**. Today this is safe because the writer side is single-process (Stop hook fires once per turn) and the consumer side (`inject-rules.js:973-1006` RMW) re-reads inside the lock — the writer races against itself only on simultaneous Stop hooks (rare; sub-second turn boundary). Path (a) lock-merge would force a NEW lock acquisition on the unlocked writer side: `behavior-verifier.js` Stop hook would have to call `acquireIndexLock(memoryDir)` before the `writeJson` at L259. This is a **hidden migration cost not visible from inject-rules.js review alone** — the writer-side rewrite adds lock acquisition, lock release, fail-open fallback path, and stale-cleanup interaction that today does not exist for the writer. Path (a) acceptance must explicitly budget this writer rewrite + a `_test-behavior-verifier-lock.js` covering writer-side fail-open. Cycle 6 implementation budget: +1 test fixture, +~30 LOC in `behavior-verifier.js`, +1 stale-cleanup contention case (writer waits behind PostToolUse extractDelta).

- **Contention surface expansion (9-callsite absorption).** Currently `verifier.lock` has **1 acquisition site** (`inject-rules.js:973` consumer RMW) and `.memory-index.lock` has **9 acquisition sites** (counter.js:91, counter.js:353, inject-rules.js:731, load-memory.js:139, post-compact.js:59, wa-count-pretool.js:61, sycophancy-guard.js:287/317/356). Path (a) merge absorbs the verifier into the 9-callsite regime. Cross-process contention (Stop hook writer + UserPromptSubmit consumer + PostToolUse counter + SessionStart load + Sycophancy-guard) where currently zero cross-process contention exists for verifier.lock. The 9:1 callsite asymmetry favors decoupling unless cycle 5 F-4 measurement shows the 9 callsites are individually fast and rarely overlap.

### Concrete acquisition order proposal

Single lock — acquisition order is trivially `acquireIndexLock(memoryDir)` everywhere. No deadlock possible (lock cycle requires ≥2 distinct locks).

### Deadlock analysis

- N=1 lock → no cycle possible.
- Stale-lock cleanup (`utils.js:137`) handles process-crash holders identically to today.

---

## Path (b) — Hand-off Protocol

### Design

Keep `verifier.lock` and `.memory-index.lock` separate. Define a hand-off ordering invariant:

1. **verifier completes** transition `pending → completed → consumed` under `verifier.lock` (current code, unchanged).
2. **narrative-extractor** (cycle 6+ Tier 2 producer) reads `behavior-verifier-state.json` AFTER `verifier.lock` is released. Reads `status === 'consumed'` as the trigger condition.
3. **narrative-extractor** acquires `.memory-index.lock` separately, appends Tier 2 narrative via `append-memory.js`-style logic, releases.
4. Lock acquisition order is **strictly sequential** — never both held at once.

State machines remain separate. Verifier owns `behavior-verifier-state.json` 14 fields. memory-keeper owns `memory-index.json` 3-flag + mtime-gate lifecycle. Tier 2 narrative is the bridge — narrative-extractor reads verifier state + writes memory-keeper sink.

### State-machine transitions

```
verifier:                                memory-keeper (Tier 2 producer):
[idle]                                    [idle]
  │ Stop hook                              │
  ▼                                        │
[pending] ──launchedAt set────►            │
  │ verifier sub-agent                     │
  ▼                                        │
[completed] ──verdicts written────►        │
  │ next UserPromptSubmit                  │
  │ acquires verifier.lock (RMW)           │
  ▼                                        │
[consumed] ──verifier.lock released───►    │
                                           │ (next event after consumed)
                                           │ narrative-extractor dispatched
                                           ▼
                                          [reading-state] (no lock)
                                           │ reads behavior-verifier-state.json
                                           │ confirms status===consumed
                                           ▼
                                          [appending] (acquires .memory-index.lock)
                                           │ appendFileSync(logbook.md)
                                           │ writes lastMemoryUpdateTs
                                           ▼
                                          [idle] (releases .memory-index.lock)
```

### Pros

- **Lock decoupling preserved.** Cross-lock contention = 0 by ordering invariant. `.memory-index.lock` PostToolUse contention does not bleed into verifier consumer path.
- **No P130 pressure model regression.** `.memory-index.lock` critical section unchanged (no verifier transition added). Decay/oscillation counters keep cycle 3 baseline.
- **Fail-open invariant unchanged per sub-system.** Verifier remains fail-open everywhere; memory-keeper retains its fail-CLOSED mtime gate. Each lock's failure semantics stay isolated.
- **No state file migration.** `behavior-verifier-state.json` and `memory-index.json` remain distinct files. Cycle 6+ Tier 2 producer is purely additive.
- **Smaller cycle 5 ship surface.** path (b) requires only the read-after-consumed contract to be specified; no lock primitive change. Cycle 5+ implementation is documentation + a thin trigger ordering check, not lock surface refactor.

### Cons

- **Ordering invariant dependency.** narrative-extractor's read-after-consumed contract is enforced only by trigger sequencing — there is no compiler/runtime guard. If a future change moves narrative-extractor to fire on a different hook (e.g., parallel with verifier consumer), the invariant silently breaks. **Documentation-only invariant** — fragile.

- **Edge case 1: verifier stuck pending.** If verifier sub-agent crashes or user kills the session before `completed` transition, narrative-extractor sees `status === 'pending'` indefinitely. Two responses:
  - (i) **Block narrative-extractor** until status=consumed → narrative loss for that turn (acceptable per fail-open).
  - (ii) **Skip narrative-extractor** if status≠consumed for >TTL_MS (10min, mirror verifier stale gate at `inject-rules.js:879`) → narrative skipped permanently for stuck turns.

  Recommendation: **(ii) skip** — matches existing verifier stale-skip semantics (`inject-rules.js:1039+`). Fail-open invariant preserved. But this is a NEW timing dependency — narrative-extractor must implement its own stale check.

- **Edge case 2: narrative-extractor crash mid-append.** If narrative-extractor crashes between `acquireIndexLock` and `appendFileSync(memoryPath, ...)`, the `.memory-index.lock` stale-cleanup (`utils.js:137`, 60s) handles holder release. But the verifier state remains `consumed` — narrative is lost for that turn with no retry. Fail-open per design; acceptable.

- **Edge case 3: rotation-during-read.** If `memory-keeper` rotates `logbook.md` (token threshold 23750 per `constants.js:5`) WHILE narrative-extractor is in `[reading-state]`, the logbook file path is intact (rotation moves old content to archive, creates new logbook.md), so the subsequent `appendFileSync` writes to the new logbook. **Race-safe** because rotation is atomic at the file-handle level (rotation acquires `.memory-index.lock`, narrative-extractor's read-state phase holds no lock). But narrative_extractor's append to the new logbook means the rotation summary won't include this turn's narrative — narrative gets bucketed into the post-rotation logbook. Acceptable (narrative is associated with verifier state's timestamp, not with rotation epoch).

- **Edge case 4: two-lock acquisition novel pattern (cycle 6+ flag).** The at-most-once narrative invariant (see Race scenarios > "Two narrative-extractor invocations" below) requires narrative-extractor to acquire **both** `verifier.lock` (to write `narrativeAppendedAt` on verifier state file) **and** `.memory-index.lock` (to append to logbook.md) within one logical operation. Today no codebase path acquires both locks — this is a NEW pattern with no precedent. Cycle 5 must explicitly evaluate three sub-concerns:
  - **Windows EPERM behavior on two-lock acquisition**: `writeFileSync(lockPath, ..., { flag: 'wx' })` failures on Windows can manifest as EPERM (not EEXIST) when antivirus or file-system filters intercept. `utils.js:79-84` writeJson has Windows EPERM fallback, but the lock-acquire pattern (`utils.js:134-138`) catches errors generically and falls through to stale check. The two-lock case adds compound failure modes — e.g., `verifier.lock` acquired, then `.memory-index.lock` write hits Windows EPERM → narrative-extractor must release `verifier.lock` (set `narrativeAppendedAt` was already written? roll back?). Atomicity across two locks is NOT guaranteed by current primitives. Cycle 5 audit must measure Windows EPERM frequency on two-lock attempts.
  - **Recursive stale cleanup interaction**: `acquireIndexLock` (`utils.js:134-138`) recurses on stale-lock cleanup (`return acquireIndexLock(memoryDir)`). The verifier.lock RMW at `inject-rules.js:981-988` mirrors this pattern manually. If narrative-extractor holds `verifier.lock` and the `.memory-index.lock` is stale (60s+ holder crash), recursive stale cleanup fires while `verifier.lock` is held. If the stale lock cleanup itself fails (e.g., another process re-acquired between unlinkSync and recursive call), narrative-extractor is stuck holding `verifier.lock` → verifier consumer at `inject-rules.js:973` blocks for up to 60s on next UserPromptSubmit. Cycle 5 must enumerate the recursive-stale × two-lock interaction matrix.
  - **Acquisition order standardization to prevent deadlock**: Today no deadlock possible (single-lock-per-codepath). Path (b) two-lock pattern requires a documented acquisition order (e.g., always `verifier.lock` first, then `.memory-index.lock`). If a future code path acquires reverse order (`.memory-index.lock` first, then `verifier.lock`), classical deadlock risk emerges. Cycle 6 implementation contract must include a static-grep enforcement: no callsite may acquire `.memory-index.lock` while `verifier.lock` is held in the reverse direction.

  This two-lock pattern is **the strongest argument that path (b) is not strictly "decoupled"** — narrative-extractor as a producer-of-record crosses both lock surfaces. Cycle 5 F-4 audit must explicitly score this novel pattern against path (a)'s single-lock simplicity.

### Race scenarios

- **Verifier RMW + narrative read overlap**: Verifier holds `verifier.lock` (~5ms). narrative-extractor reads `behavior-verifier-state.json` without lock. If reader sees `status='completed'` at the moment RMW transitions to `consumed`, reader's "trigger" check fires on `consumed` — correct. If reader sees `status='completed'` BEFORE RMW transitions, reader proceeds to acquire `.memory-index.lock`; verifier RMW completes independently. Both paths converge to identical final state. **Race-safe.**
- **Two narrative-extractor invocations**: Reader A and reader B both observe `status='consumed'`. Both acquire `.memory-index.lock` sequentially. Both `appendFileSync` to logbook → **duplicate narrative** for the same turn. **Mitigation needed**: narrative-extractor must implement its own at-most-once gate (e.g., `behaviorVerifier.narrativeAppendedAt` flag in state file under verifier.lock). This is a NEW invariant not covered by F-2 schema proposal.

---

## Race Risk Comparison

| Scenario | Path (a) lock-merge | Path (b) hand-off |
|---|---|---|
| Verifier dispatch + memory rotation overlap | Single lock — serial. No race. | `verifier.lock` + `.memory-index.lock` distinct. Rotation holds `.memory-index.lock` ~50ms; verifier RMW holds `verifier.lock` ~5ms. No cross-lock acquisition → race-safe by construction. |
| inject-rules consumer reads while memory-keeper rotation in progress | Single lock — consumer waits for rotation. **User-visible latency on UserPromptSubmit** if rotation in progress. | Independent — consumer reads `verifier.lock`-protected state; rotation reads `.memory-index.lock`-protected state. No wait. |
| State file read during write | Atomic via lock (single critical section). | Atomic per state file (each state file has its own lock or its writer holds a lock during the write — `behavior-verifier-state.json` writes are inside `verifier.lock` RMW; `memory-index.json` writes are inside `.memory-index.lock`). Cross-file consistency NOT guaranteed (narrative-extractor read of verifier state + memory-index can see inconsistent snapshots if both update between reads). **Mitigation**: narrative-extractor reads state file once, derives all needed fields, then transitions. |
| Lock acquisition order inversions | N/A (1 lock). | Verifier never acquires `.memory-index.lock` (today verifier consumer at `inject-rules.js:973` only takes `verifier.lock`). memory-keeper never acquires `verifier.lock`. narrative-extractor acquires both **sequentially** (reads verifier state lock-free, then acquires `.memory-index.lock`). **No cycle possible** because narrative-extractor never holds both at once. |
| Atomic write of state file | `writeJson` (`utils.js`) used for all writes — Windows EPERM fallback already present. Atomic per write. Path (a) merge does not change atomicity. | Same — `writeJson` semantics unchanged. |
| At-most-once narrative emit | Trivial: same lock that gates verifier transition gates narrative append. Add `narrativeAppendedAt` field in unified state. | **Requires NEW invariant** — narrative-extractor must check + set a flag (e.g., on verifier state file under `verifier.lock`) to prevent duplicate appends from concurrent narrative-extractor invocations. New cross-lock RMW: narrative-extractor acquires `verifier.lock` to set flag, releases, then acquires `.memory-index.lock` to append. **Cross-lock acquisition reintroduced** — partially defeats path (b)'s decoupling. |

**Critical finding**: at-most-once narrative emit (path b cons edge case 3) requires narrative-extractor to acquire `verifier.lock` for the flag write. This **reintroduces cross-lock acquisition** in path (b), because narrative-extractor would hold `verifier.lock` then later acquire `.memory-index.lock`. While the locks are not held simultaneously (sequential acquire-release-acquire), the invariant "verifier never touches `.memory-index.lock`, memory-keeper never touches `verifier.lock`" is broken — narrative-extractor crosses the boundary. Path (b)'s "lock decoupling" claim weakens to "no simultaneous holding" rather than "no cross-touch."

---

## Cycle 5+ Implementation Prerequisite

### F-4 dependency

cycle 2 RA2 named F-4 (lock unification audit) as a separate frontier. Currently no contention reported (`hooks.json` Stop + UserPromptSubmit + PostToolUse hold distinct locks per sub-system, observed via grep above — no code path acquires both `verifier.lock` and `.memory-index.lock` in one call).

If path (a) ships before F-4 audit:
- F-4 becomes trivially satisfied (one lock, no audit needed). Path (a) **subsumes** F-4.
- Risk: path (a)'s contention expansion may surface latency issues that F-4 audit would have caught proactively (e.g., measuring `.memory-index.lock` hold duration distribution before merging).

If path (b) ships before F-4 audit:
- F-4 audit must explicitly cover narrative-extractor's cross-lock acquire-release-acquire pattern (per the critical finding above).
- Risk: F-4 audit at cycle 6+ may discover that the at-most-once invariant (cross-lock flag write) needs a different design — narrative-extractor implementation may need rework.

**Recommendation**: F-4 audit BEFORE F-3 ship. Concretely, cycle 5 = F-4 audit (measure lock hold durations + contention frequency under realistic load); cycle 6+ = F-3 ship per audit findings. Path choice (a vs b) **driven by F-4 contention measurements**, not by this proposal alone.

### F-4 audit MUST be standalone (RA1 strong recommendation)

F-4 lock contention measurement audit MUST run **standalone** in cycle 5 — bundling F-4 audit with a path-b minimal contract or with F-3 implementation in the same cycle would corrupt **measurement validity** (instrumentation interleaved with functional change makes regression attribution impossible). Concretely:

- **Standalone F-4 cycle 5 scope**: instrument `acquireIndexLock` (`utils.js:134`) with hold-duration logging, run a representative session (≥100 turns covering counter.js dispatch + inject-rules.js consumer + sycophancy-guard.js Stop checks + load-memory.js SessionStart), measure `.memory-index.lock` p50/p95/p99 hold duration and contention frequency. Establish baseline contention rate. Path (a) ratification requires baseline + projected merger overhead < acceptable threshold (e.g., p95 hold < 50ms, contention frequency < 1/100 turns).
- **DO NOT bundle**: cycle 5 must NOT also ship path-b read-after-consumed contract code — even a "minimal contract" change adds dispatcher reordering that interferes with measurement (the measurement window must observe production behavior, not modified behavior). Bundling = decision-without-evidence.
- **Cycle 6+ separation**: F-3 implementation lands in cycle 6 (or later) as a separate cycle, with cycle 5 measurement archived as the ratification evidence. This preserves measurement validity (cycle 5 baseline) and isolates implementation regression (cycle 6 changes only).

### Cycle 6 measurement window opening

D107 cycle 6 (P148_T001) opens the F-4 measurement window **passively** — the lock-contention instrumentation deployed cycle 5 (`scripts/utils.js` `_recordContention` + `acquireIndexLock` / `releaseIndexLock` wrappers) accumulates samples during the operator's normal use of the plugin. The window opening is marked by a top-level `measurementWindowStart` ISO 8601 timestamp field in `.crabshell/memory/lock-contention.json` (additive, sibling to per-lock metric sub-objects; written atomically while holding `.memory-index.lock` to serialize against concurrent `_recordContention` writers). Cycle 7+ F-3 ratification depends on this window's accumulated samples (per-lock `acquireCount`, `contendedCount`, `totalWaitMs`, `totalHeldMs`, `maxWaitMs`, `maxHeldMs`) being assessed at cycle entry.

- **Measurement-close criterion deferred to cycle 7+ entry assessment.** Cycle 6 deliberately does NOT define a sample-count / turn-count / elapsed-time threshold for closing the window. Defining a premature close criterion would bias the F-3 path-choice decision against load characterization that has not yet been observed. Cycle 7+ entry assessment must establish the close criterion using accumulated data (e.g., "window closes when contention frequency stabilizes within ±X% over N consecutive turns") before ratifying any F-3 path.
- **Cycle 5 instrumentation note (RA1 race undercount caveat).** `_recordContention` uses unprotected `writeJson` (deadlock prevention — see `scripts/utils.js` L139-141 comment: `_recordContention` is invoked from inside the lock primitive, so recursive lock acquisition would infinite-loop). Race-condition increment loss is therefore possible under high concurrent writes — the resulting bias is a **conservative undercount** (real contention ≥ measured). Cycle 7+ F-3 ratification must factor this undercount when comparing measured contention vs any acceptance threshold: a measured contention frequency at or below threshold does NOT prove real contention is at or below threshold; only a measured contention frequency comfortably below threshold (with margin sized to plausible race loss) supports ratification.
- **Cycle 7 F-5 self-instrumentation note (P149_T001 RA cycle 6 finding).** Marker-write event itself produces ~3 `acquireCount` increments (helper's own `acquireIndexLock` / `releaseIndexLock` from `_p148-t001-marker-write.js` plus its inner `_recordContention` call). Cycle 7+ ratification analysis MAY subtract this floor sample (~3 acquires + corresponding contention/release pairs) from the first post-`measurementWindowStart` window if pure-organic baseline is required. The undercount caveat above and the self-instrumentation floor compound — both error directions favor a more-conservative ratification gate (margin must absorb both).
- **Cycle 7+ measurement window close-criterion candidates (D2 enrichment, values TBD).** The deferred close-criterion above must eventually pick concrete values. Three candidate thresholds for cycle 8+ to populate when F-4 baseline data accumulates:
  - (a) **Sample threshold**: `acquireCount ≥ N` for the lock under measurement (N TBD; floor ~100 turns × ~5 acquires per turn ≈ 500, but should be calibrated to observed contention sparseness — fewer samples needed if `contendedCount/acquireCount` is stable, more if it oscillates).
  - (b) **Elapsed-time threshold**: `now − measurementWindowStart ≥ T` (T TBD; floor ~24h to capture diurnal load variation, ceiling bounded by F-3 implementation urgency).
  - (c) **Contention-rate threshold**: `contendedCount / acquireCount ≥ R` for ratification trigger (R TBD; if observed rate is below `R_low`, F-3 path (a) lock-merge is overkill; if above `R_high`, path (b) hand-off becomes mandatory). Cycle 8+ to populate `R_low` / `R_high` from baseline data.

### F-3 ship before F-4 audit = risk?

Yes. F-3 ship of either path without F-4 measurement is **decision-without-evidence**. Path (a) acceptance gate ("contention expansion is tolerable") cannot be verified without measuring `.memory-index.lock` hold duration distribution today. Path (b) acceptance gate ("cross-lock acquire-release-acquire pattern is acceptable") cannot be verified without measuring narrative-extractor's lock hold pattern under load.

**Cycle 4 (this cycle, evaluation-only) cannot ship F-3 implementation** by P146 scope. Cycle 5 should be **F-4 audit + measurement**, cycle 6+ F-3 implementation per measured data.

---

## Recommendation

### Preliminary recommendation pending cycle 5 F-4 measurement

This recommendation is **preliminary** — NOT pre-ratified. Cycle 4 evaluation produces this proposal; cycle 5 F-4 standalone audit measures lock contention; cycle 6+ ratifies path choice with measurement evidence. The cycle 4 output is a structured analysis, not a decision.

### Path choice

**Preliminary recommendation: Path (b) hand-off protocol** — **conditional on F-4 audit confirming `.memory-index.lock` contention frequency is acceptable for narrative-extractor's added load** (narrative-extractor adds `verifier.lock` flag write + `.memory-index.lock` append per non-clarification turn ≥50 chars). Based on:
- 9:1 callsite asymmetry (`.memory-index.lock` 9 sites vs `verifier.lock` 1 site) favors decoupling
- P130 pressure model preservation (path (a) forces re-derivation of decay/oscillation cycle counts)
- Writer asymmetry discovery (path (a) requires migration of currently-unlocked `behavior-verifier.js:243-259` writer side — hidden cost)
- At-most-once narrative requirement is solvable with explicit ordering invariant under path (b)

**This is NOT a ratified decision.** Cycle 5 measurement may surprise — e.g., if `.memory-index.lock` p95 hold duration measures < 5ms with contention < 1/1000 turns, path (a) lock-merge becomes acceptable and the writer-side migration cost is the only remaining blocker. Conversely, if cycle 5 measures p95 > 50ms or contention > 1/100 turns, path (b)'s two-lock pattern compounds the wait → path (a) becomes the safer choice despite migration cost.

**Justification**:
1. **Smaller ship surface in cycle 5+.** Path (b) requires no lock primitive change, no state file migration, no schema unification. Path (a) requires `behavior-verifier-state.json` → `memory-index.json` migration + `behavior-verifier.js` writer rewrite + `inject-rules.js:973-1009` lock-call replacement + ringBuffer renderer update.
2. **P130 pressure model preserved.** Path (a)'s addition of verifier transitions to `.memory-index.lock` critical section forces re-derivation of pressure cycle counts. Path (b) keeps `.memory-index.lock` semantics identical to cycle 3 baseline.
3. **Fail-open invariant per sub-system isolated.** Path (a) co-locates fail-CLOSED mtime gate (memory-keeper) with fail-open verifier transitions in one lock — risk of accidental coupling. Path (b) keeps each sub-system's failure mode local.
4. **Cycle 6+ Tier 2 ship feasibility unchanged.** Both paths enable Tier 2 narrative producer; path (b) requires only documenting the read-after-consumed contract.

**Conditional**: if F-4 audit (cycle 5) measures `.memory-index.lock` hold duration as already saturated (e.g., p95 > 100ms), the cross-lock acquire-release-acquire pattern in path (b) becomes problematic (narrative-extractor's cumulative lock wait grows). In that case, switch to path (a) and accept the migration cost — F-4 measurement provides the evidence.

### Timing

- **Cycle 4 (this cycle)**: F-3 evaluation document (this proposal). NO implementation.
- **Cycle 5**: F-4 audit + lock contention measurement. Add lock-hold-duration logging to `acquireIndexLock` (`utils.js:134`) — measure p50/p95 distribution over a representative session. Document findings.
- **Cycle 6**: F-3 implementation per cycle 5 measurement. Path (b) by default; path (a) only if cycle 5 measurement contraindicates path (b).
- **Cycle 7+**: Tier 2 narrative-extractor (per F-2 cycle 4+ roadmap) — gated by F-3 ship.

### Risk acceptance gate

Before cycle 6 F-3 implementation, the following measurements MUST be archived (cycle 5 deliverables):

1. `.memory-index.lock` hold duration p50/p95/p99 over ≥1 representative session (≥100 turns).
2. `verifier.lock` hold duration p50/p95/p99 over the same session.
3. Cross-lock contention frequency: count of cases where one process waits on a lock held by another. Today this is expected ≈ 0 — measurement confirms baseline.
4. PostToolUse `extractDelta()` execution time distribution (latency that path (a) exposes to UserPromptSubmit).
5. P130 pressure-model cycle counts under measured lock contention. If decay/oscillation timing observed to drift under realistic contention, path (a) is contraindicated.

If any measurement violates an acceptance threshold (TBD by cycle 5 — proposal recommends thresholds: lock p95 < 50ms, contention frequency < 1/100 turns), F-3 must NOT ship in cycle 6 — extend to cycle 7+ with mitigation (e.g., reduce lock critical section by hoisting non-state work outside the lock).

---

## Open Questions for Cycle 5+

1. **F-4 standalone vs bundled with path-b minimal contract** → **standalone** (RA1 strong recommendation, enforced in this document). Cycle 5 ships measurement only; cycle 6 ships implementation. Bundling corrupts measurement validity.
2. **Path (a) acceptable contention threshold** → measurement + user gate. Proposal: p95 lock hold < 50ms AND contention frequency < 1/100 turns (TBD by cycle 5 measurement; user explicitly accepts thresholds before cycle 6 implementation).
3. **Cycle 6 Tier 2 narrative-extractor producer agent design**: separate skill (e.g., `crabshell:narrative-extractor`) vs delta-summarizer reuse (extend `crabshell:memory-delta` skill to also emit verifier-grounded narrative). Trade-off: separate skill = clean lifecycle / extra prompt overhead; reuse = code reuse / shared lifecycle complications. Cycle 5 / cycle 6 design discussion.
4. **Two-lock acquisition Windows EPERM + recursive stale cleanup edge case handling**: per Edge case 4 above, cycle 5 must enumerate the recursive-stale × two-lock interaction matrix and propose either (i) atomic two-lock primitive (new utility), (ii) acquisition order discipline + static-grep enforcement, or (iii) single-lock fallback (path (a) regression).
5. **F-1 trigger axis coordination with path (b) ordering invariant**: F-2 (cycle 3) deferred trigger location to F-1 result. Path (b) hand-off protocol assumes narrative-extractor fires on a hook AFTER UserPromptSubmit verifier consumer. If F-1 centralizes all dispatchers into one Stop hook chain, path (b) ordering invariant is auto-enforced. If F-1 keeps dispatchers separate, path (b) needs explicit ordering documentation. Coordinate F-1 + F-3 cycle ordering.
6. **Path (a) regression-test budget**: if cycle 5 measurement contraindicates path (b), path (a) implementation requires `_test-fail-open-edge-cases.js` extension (verifier transitions inside merged lock must remain fail-open). Should cycle 6 budget include a new `_test-d107-cycle6-lock-merge.js` covering merged-lock fail-open paths, or is /verifying suite extension sufficient?

---

> **Document end** — sections per P146 Verification Criteria #1 (Background + Path (a) + Path (b) + Race Risk + Cycle 5+ Prerequisite + Recommendation + Open Questions). Implementation deferred to cycle 6+ with F-4 standalone audit (cycle 5) as hard prerequisite. **Preliminary recommendation only — NOT pre-ratified for implementation.** Cycle 5 measurement evidence governs final path choice; this proposal is the structured input to that decision, not the decision itself.
