---
name: ticketing
description: "Create and update ticket documents tied to a plan. Use when breaking a plan into session-sized work units. Invoke with /ticketing P001 \"topic\" to create, or /ticketing P001_T001 to update."
---

# Ticket Document Skill

## Modes

- **Create mode:** `/ticketing P001 "제목"` — creates a new ticket under plan P001
- **Update mode:** `/ticketing P001_T001` — appends a log entry to an existing ticket

---

## Create Mode

When arguments are a Plan ID + title string:

### Step 1: Validate parent plan

Read `docs/plan/INDEX.md`. Find the row for the given Plan ID.
- If plan not found → error: "Plan {ID} does not exist."
- If plan status is `draft` → warn: "Plan {ID} is not yet approved. Create ticket anyway? (not recommended)"
- If plan status is `approved` or `in-progress` → proceed

### Step 2: Ensure ticket folder exists

Check if `docs/ticket/` exists.

- **Folder does not exist:** Create it and create `docs/ticket/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `docs/ticket/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to docs/ticket/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Ticket Index

| ID | Title | Status | Created | Plan |
|----|-------|--------|---------|------|
```

### Step 3: Determine next ticket ID

Glob `docs/ticket/P{NNN}_T*.md` where P{NNN} is the parent plan.
Extract ticket numbers. Next = max + 1, zero-padded to 3 digits.
If no tickets for this plan, start at 001.

### Step 4: Create ticket document

Ask the user:
1. **Intent:** What part of the parent plan does this ticket fulfill? What changes after completion?
2. **Scope:** What to do / not do in this session?
3. **Acceptance Criteria:** Specific conditions for "done"
4. **Verification:** How to verify each acceptance criterion? (Must be executable commands or observable behavior. "File contains X" is NOT acceptable.)

Then create `docs/ticket/P{NNN}_T{NNN}-{slug}.md`:

```
# P{NNN}_T{NNN} - {title}

## Parent
- Plan: P{NNN} - {plan title}

## Intent (의도)
{user's answer}

## Scope (범위)
할 것: {included}
안 할 것: {excluded}

## Acceptance Criteria (완료 조건)
- [ ] {criterion 1}
- [ ] {criterion 2}

## Verification (검증)
{criterion 1}: {how to verify — command to run, behavior to observe}
{criterion 2}: {how to verify}

## Agent Execution (에이전트 실행)

이 티켓은 다음 agent 구조로 실행된다:

### Step A: Work Agent — 실행
- 계획(P)에 따라 작업 실행
- 각 작업 항목별 결과 기록
- 결과를 `## 실행 결과` 섹션에 append

### Step B: Review Agent — 검증
- 각 작업 항목의 실동작 확인 (trigger → path → result)
- 변경이 기존 기능을 깨뜨리지 않는지 확인
- edge case, 예외 상황 처리 확인
- 결과를 `## 검증 결과` 섹션에 append

### Step C: Orchestrator — 최종 검증
- Review Agent의 검증을 재검증 (가능한 전수조사)
- "검증했다고 주장하지만 실제로 안 한 것" 적발
- 3요소 평가:
  1. **정확성**: 제대로 됐는가?
  2. **개선 기회**: 더 나은 방법은 없었는가?
  3. **다음 방향**: 다음에 뭘 해야 하는가?
- 결과를 `## 최종 검증` 섹션에 append

## Execution
- 이 티켓은 단독 워크플로우로 실행 (1 Ticket = 1 Workflow)
- 실행: `/workflow` 스킬 호출

## 실행 결과 (Work Agent)
(에이전트 실행 후 append)

## 검증 결과 (Review Agent)
(에이전트 실행 후 append)

## 최종 검증 (Orchestrator)
(에이전트 실행 후 append)
### 정확성
### 개선 기회
### 다음 방향

## Log

---
### [{YYYY-MM-DD HH:MM}] 생성
{work plan for this ticket}
```

### Step 5: Update ticket INDEX.md

Append row to `docs/ticket/INDEX.md`:

```
| P{NNN}_T{NNN} | {title} | todo | {YYYY-MM-DD} | P{NNN} |
```

### Step 6: Update parent plan

Append to the **Tickets section** of the parent plan document:

```
- P{NNN}_T{NNN}: {title}
```

Also update `docs/plan/INDEX.md` Tickets column to include the new ticket ID.

### Step 7: Confirm

Tell user: "Created P{NNN}_T{NNN}. Status: todo. Invoke workflow skill to begin execution."

---

## Update Mode

When argument matches `P\d{3}_T\d{3}` pattern:

### Step 1: Read existing ticket

Glob `docs/ticket/P{NNN}_T{NNN}-*.md`. If not found, stop.

### Step 2: Append log entry

Append to end of document:

```

---
### [{YYYY-MM-DD HH:MM}] {entry_type}
{content}
```

Entry types:
- `작업 기록` — work notes, files changed, decisions made
- `검증 실행` — verification run with commands and results
- `검증 완료` — verification passed/failed with evidence
- `상태변경: {old} → {new}`

### Step 3: Update INDEX.md if status changed

Update ticket INDEX.md status column.

### Step 4: Status cascade (on verified)

If ticket status → `verified`:

1. **Check parent plan:** Read `docs/ticket/INDEX.md`, find ALL tickets for the same parent plan. Are ALL of them `verified`?
   - If NO → stop here.
   - If YES → continue cascade.
2. **Close parent plan:** Update parent plan's status to `done` in `docs/plan/INDEX.md`. Append log entry to plan document: `상태변경: in-progress → done (모든 티켓 verified)`
3. **Cascade to D/R:** Read parent plan's `Related` column in `docs/plan/INDEX.md`. For each related D/R ID:
   - **Cross-check:** Read that D/R's Related column in its INDEX.md. If it references OTHER plans besides the one just completed, check those plans' statuses too. ALL related plans must be `done` before concluding.
   - If all related plans done → update D/R status to `concluded`, append log entry: `상태변경: open → concluded (관련 플랜 모두 완료)`
   - If other related plans still open → skip, do not conclude. Log: `P{NNN} 완료, 다른 관련 플랜 미완료로 종결 보류`

### Status Transitions

- `todo` → `in-progress` (work begins)
- `in-progress` → `done` (work complete, pending verification)
- `done` → `verified` (verification passed)
- `in-progress` → `blocked` (external dependency)
- `blocked` → `in-progress` (unblocked)

---

## Rules

1. **NEVER modify existing content.** Only append to Log section and agent result sections (실행 결과, 검증 결과, 최종 검증).
2. **Acceptance criteria checkboxes:** Never modify. Completion tracked in Log entries.
3. **`done` ≠ `verified`:** Work completion and verification are separate events with separate log entries.
4. **Verification at creation:** The Verification section MUST be filled at ticket creation time (before work starts). This is the TDD principle — define how you'll check before you build.
5. **"File contains X" is forbidden** in Verification section. Must describe observable behavior or runnable commands.
6. **INDEX.md** is the only file where existing content may be modified.
7. **Plan propagation:** When all tickets verified → auto-update plan status.
8. **1 Ticket = 1 Workflow:** Each ticket is executed as a separate, independent workflow invocation. Never batch multiple tickets into a single workflow run. 3 tickets = 3 separate workflow executions.
9. **Mandatory work log:** After performing any work related to this document, append a log entry to the Log section using the existing format (`### [{YYYY-MM-DD HH:MM}] {entry_type}`). This applies regardless of whether this skill was explicitly invoked — if the work touched or advanced this ticket's purpose, log it.
10. **검증 결과 append 의무:** Work Agent, Review Agent, Orchestrator는 각자의 실행 결과를 T 문서의 해당 섹션(실행 결과, 검증 결과, 최종 검증)에 반드시 append해야 한다. 문서에 기록되지 않은 검증은 수행하지 않은 것과 동일하다.
11. **전수조사 검증 기준:** 검증은 실동작 확인 수준이어야 한다. 직접 검증 가능 → 직접 실행, 간접만 가능 → 모든 간접 수단, 불가 → "미검증" 명시.
12. **Regressing context 전달:** regressing 루프에서 이 T 문서의 `## 최종 검증 > 다음 방향` 내용은 다음 cycle D(n+1) 문서의 `## Context (배경)` 섹션으로 전달된다. Orchestrator는 이 전달을 명시적으로 수행해야 한다.
