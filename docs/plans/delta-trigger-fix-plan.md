# Delta Trigger Mechanism Fix Plan

**작성일**: 2026-02-02
**상태**: 계획 완료, 구현 대기

---

## 1. 문제 요약

- **문서**: SKILL.md는 `[MEMORY_KEEPER_DELTA] file=delta_temp.txt` 트리거 기대
- **실제**: inject-rules.js는 additionalContext에 숨겨진 DELTA_INSTRUCTION만 주입
- **결과**: Claude가 패턴 못 찾음 → 스킬 미실행 → lastMemoryUpdateTs = null

---

## 2. 수정 방안 분석

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | stderr에 명시적 패턴 출력 | 최소 변경, 문서와 일치 | stderr 인식 의존 |
| B | 문서만 수정 | 코드 변경 없음 | 근본 문제 미해결 |
| C | additionalContext에 패턴 포함 | 컨텍스트 내 패턴 | 트리거로 스캔 안 될 수 있음 |
| **D (권장)** | stderr 패턴 + 강화된 지시문 + 문서 수정 | 다중 신호, 최대 성공률 | 변경 사항 다소 많음 |

---

## 3. 구현 계획 (옵션 D)

### Step 1: inject-rules.js stderr 출력 수정

**파일**: `scripts/inject-rules.js` (라인 219-228)

**현재**:
```javascript
if (indicators.length > 0) {
  console.error(`[rules + ${indicators.join(' + ')} pending]`);
} else {
  console.error('[rules injected]');
}
```

**수정**:
```javascript
if (hasPendingDelta) {
  console.error(`[MEMORY_KEEPER_DELTA] file=delta_temp.txt`);
  if (pendingRotations.length > 0) {
    console.error(`[MEMORY_KEEPER_ROTATE] pending=${pendingRotations.length}`);
  }
} else if (pendingRotations.length > 0) {
  console.error(`[MEMORY_KEEPER_ROTATE] pending=${pendingRotations.length}`);
} else {
  console.error('[rules injected]');
}
```

### Step 2: DELTA_INSTRUCTION 강화

**파일**: `scripts/inject-rules.js` (라인 18-30)

**수정**:
```javascript
const DELTA_INSTRUCTION = `
## [MEMORY_KEEPER_DELTA] - BLOCKING PREREQUISITE

**TRIGGER DETECTED: [MEMORY_KEEPER_DELTA] file=delta_temp.txt**

STOP. Before generating ANY text response to the user:

1. Invoke Skill tool NOW: skill="memory-delta"
2. Complete ALL steps in the skill
3. ONLY THEN respond to user

This is a MANDATORY SYSTEM MAINTENANCE TASK.
- You CANNOT skip this
- You CANNOT respond to user first
- Your response is BLOCKED until delta processing completes

If you see this instruction, the delta file EXISTS and MUST be processed.
`;
```

### Step 3: SKILL.md 트리거 조건 수정

**파일**: `skills/memory-delta/SKILL.md` (라인 20-22)

**수정**:
```markdown
## Trigger Condition

Auto-invoked when EITHER:
1. Hook stderr outputs: `[MEMORY_KEEPER_DELTA] file=delta_temp.txt`
2. Context contains: `[MEMORY_KEEPER_DELTA]` trigger pattern

If you see `[MEMORY_KEEPER_DELTA]` anywhere in your context, execute this skill immediately.
```

---

## 4. 검증 단계

```bash
# 1. 현재 상태 확인
cat .claude/memory/memory-index.json | grep lastMemoryUpdateTs

# 2. delta 트리거 후 stderr 확인
# [MEMORY_KEEPER_DELTA] file=delta_temp.txt 출력되어야 함

# 3. 스킬 실행 후 확인
cat .claude/memory/memory-index.json | grep lastMemoryUpdateTs
# null이 아닌 ISO timestamp 있어야 함

# 4. cleanup 확인
ls .claude/memory/delta_temp.txt
# 파일 없어야 함 (삭제됨)
```

---

## 5. 체크리스트

- [ ] `[MEMORY_KEEPER_DELTA]` stderr 출력 확인
- [ ] Claude가 트리거 인식
- [ ] memory-delta 스킬 실행
- [ ] Haiku 요약 완료
- [ ] memory.md에 추가
- [ ] mark-updated 실행 (lastMemoryUpdateTs 업데이트)
- [ ] cleanup 실행 (delta_temp.txt 삭제)

---

## 6. 롤백 계획

문제 발생 시:
1. inject-rules.js stderr → `[rules + delta pending]`으로 복원
2. DELTA_INSTRUCTION 변경은 유지 (무해)
3. SKILL.md 문서 복원

---

## 7. 수정 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| scripts/inject-rules.js:219-228 | stderr에 `[MEMORY_KEEPER_DELTA]` 출력 |
| scripts/inject-rules.js:18-30 | DELTA_INSTRUCTION 강화 |
| skills/memory-delta/SKILL.md:20-22 | 트리거 조건 문서 수정 |
