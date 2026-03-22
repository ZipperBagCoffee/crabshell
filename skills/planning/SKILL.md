---
name: planning
description: "Create and update plan documents. Use when establishing a structured plan for implementation. Invoke with /planning \"topic\" to create, or /planning P001 to update."
---

# Plan Document Skill

## Modes

- **Create mode:** `/planning "제목"` — creates a new plan document
- **Update mode:** `/planning P001` — appends a log entry to an existing plan

---

## Create Mode

When argument is a title string (not a P-prefixed ID):

### Step 1: Ensure folder exists

Check if `docs/plan/` exists.

- **Folder does not exist:** Create it and create `docs/plan/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `docs/plan/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to docs/plan/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Plan Index

| ID | Title | Status | Created | Related | Tickets |
|----|-------|--------|---------|---------|---------|
```

### Step 2: Determine next ID

Glob `docs/plan/P*.md` (exclude files matching `P\d{3}_T` pattern to avoid tickets in wrong folder).
Extract numeric part. Next ID = max + 1, zero-padded to 3 digits.
If no files exist, start at 001.

### Step 3: Create plan document

Ask the user:
1. **Intent:** What is this plan's purpose? What are the success conditions?
2. **Scope:** What's included / excluded?
3. **Plan steps:** What are the high-level steps?
4. **Verification criteria:** How do we know the plan succeeded? (Observable behavior, not "file contains X")

Then create `docs/plan/P{NNN}-{slug}.md`:

```
# P{NNN} - {title}

## Intent (의도)
{user's answer}

## Scope (범위)
포함: {included}
제외: {excluded}

## Plan (계획)
- [ ] 단계 1: {step}
- [ ] 단계 2: {step}
...

## Agent Execution (에이전트 실행)

이 계획은 다음 agent 구조로 실행된다:

### Step A: Work Agent — 분석 + 계획 작성
- 관련 코드/시스템 분석
- 의존성, 영향 범위 파악
- 구체적 실행 계획 작성
- 결과를 `## 분석 결과` 섹션에 append

### Step B: Review Agent — 계획 품질 검증
- 분석의 완전성과 정확성 검증
- 계획의 실행 가능성 검토
- 리스크 및 누락 사항 식별
- 결과를 `## 리뷰 결과` 섹션에 append

### Step C: Orchestrator — 의도 점검
- D 문서의 Intent Anchor(IA)와 대조
- 계획이 원래 의도에서 이탈하지 않았는지 확인
- 승인 또는 반려 결정
- 결과를 `## 의도 점검` 섹션에 append

## Tickets
(티켓 생성 시 자동 기록)

## 분석 결과 (Work Agent)
(에이전트 실행 후 append)

## 리뷰 결과 (Review Agent)
(에이전트 실행 후 append)

## 의도 점검 (Orchestrator)
(에이전트 실행 후 append)

## Verification Criteria (검증 기준)
{user's answer — must describe observable behavior}

## Log

---
### [{YYYY-MM-DD HH:MM}] 생성
{background/motivation for this plan}
```

### Step 4: Update INDEX.md

Append row to `docs/plan/INDEX.md`:

```
| P{NNN} | {title} | draft | {YYYY-MM-DD} | | |
```

### Step 5: Confirm

Tell user: "Created P{NNN} in draft status. Review and approve before creating tickets."

---

## Update Mode

When argument matches `P\d{3}` pattern:

### Step 1: Read existing document

Glob `docs/plan/P{NNN}-*.md`. If not found, stop.

### Step 2: Append log entry

Append to end of document:

```

---
### [{YYYY-MM-DD HH:MM}] {entry_type}
{content}
```

Entry types:
- General update (default)
- `승인` — user approved the plan
- `상태변경: {old} → {new}`
- `티켓 추가: P{NNN}_T{NNN}` — when a ticket is created (auto-appended by ticketing skill)

### Step 3: Update INDEX.md if needed

Update status column and/or Tickets column in `docs/plan/INDEX.md`.

### Status Transitions

- `draft` → `approved` (user approves — REQUIRED before tickets)
- `approved` → `in-progress` (first ticket starts work)
- `in-progress` → `done` (all tickets verified)
- any → `abandoned`

---

## Rules

1. **NEVER modify existing content.** Only append to Log section, Tickets section, and agent result sections (분석 결과, 리뷰 결과, 의도 점검).
2. **Tickets section:** Only receives appended lines like `- P{NNN}_T{NNN}: {title}` when ticketing skill creates a ticket.
3. **Plan checkboxes:** Never modify. Progress is tracked in Log entries.
4. **INDEX.md** is the only file where status may be modified.
5. When plan comes from a discussion/research, note `D{NNN}` or `R{NNN}` in INDEX.md Related column and add to first log entry.
6. **하위 미완료 시 상위 전환 금지:** P는 관련 티켓이 전부 `verified`일 때만 `done`으로 전환 가능. 티켓이 하나라도 미완료면 `done` 전환 거부.
7. **완료 시 상위 자동 종결:** P가 `done`이 되면 → Related 컬럼의 D/R을 자동으로 `concluded`로 업데이트하고 해당 문서에 로그 추가. (ticketing cascade에서 트리거됨)
8. **Mandatory work log:** After performing any work related to this document, append a log entry to the Log section using the existing format (`### [{YYYY-MM-DD HH:MM}] {entry_type}`). This applies regardless of whether this skill was explicitly invoked — if the work touched or advanced this plan's purpose, log it.
9. **검증 결과 append 의무:** Work Agent, Review Agent, Orchestrator는 각자의 실행 결과를 P 문서의 해당 섹션(분석 결과, 리뷰 결과, 의도 점검)에 반드시 append해야 한다. 구두 보고만으로는 불충분하며, 문서에 기록되지 않은 검증은 수행하지 않은 것과 동일하다.
10. **전수조사 검증 기준:** **검증 정의:** 검증 = 믿음과 현실 사이의 간극을 관찰로 닫는 것. 직접 실행 + 관찰이 최우선, 간접 수단은 직접 실행이 어려울 때만. — 검증은 "파일에 존재한다" 수준이 아닌, 실제 실행 가능성과 동작을 확인하는 수준이어야 한다. 직접 검증 가능한 것은 직접, 간접만 가능한 것은 모든 간접 수단 동원, 검증 불가한 것은 "미검증" 명시.
