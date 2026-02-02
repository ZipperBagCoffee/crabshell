# Documentation Update Analysis

**분석일**: 2026-02-02
**현재 버전**: 13.9.9

---

## 발견된 문제들

### 1. 버전 번호 불일치 (Critical)

| 파일 | 표기 버전 | 문제 |
|------|----------|------|
| plugin.json | 13.9.9 | 현재 버전 (정확) |
| STRUCTURE.md 헤더 | 13.8.7 | **구버전** |
| README.md 버전 테이블 | ~13.8.7 | 13.9.x 누락 |
| ARCHITECTURE.md 버전 테이블 | ~13.9.3 | 13.9.4~13.9.9 누락 |
| USER-MANUAL.md | 13.8.x | 13.9.x 전체 누락 |

### 2. saveInterval 불일치 (Critical)

| 파일 | 값 | 위치 |
|------|-----|------|
| README.md | 5 | line 19, 107 |
| USER-MANUAL.md | 25 | line 37, 175 |
| ARCHITECTURE.md | "5→25" | v13.9.2 변경사항 언급 |

**현재 기본값**: 25 (v13.9.2에서 변경됨)
**README.md가 잘못됨** - 5로 표기

### 3. 30초 사고 규칙 미문서화 (New in v13.9.9)

inject-rules.js에 추가됨:
```
- Before ANY action: use `date` command to check start time, think for at least 30 seconds, verify 30 seconds passed with `date` again.
```

문서화 필요 위치:
- README.md (Critical Rules 섹션 추가 필요)
- ARCHITECTURE.md (inject-rules.js 설명)
- USER-MANUAL.md

### 4. Dual Timestamp 포맷 미문서화 (v13.9.5)

현재 memory.md 헤더 포맷:
```
## 2026-02-01_1727 (local 02-01_0927)
```

memory-delta/SKILL.md에는 있지만:
- README.md에 언급 없음
- ARCHITECTURE.md에 언급 없음
- USER-MANUAL.md에 언급 없음

### 5. 버전 히스토리 누락

README.md와 STRUCTURE.md에 누락된 버전:
- 13.9.9: 30-second thinking rule
- 13.9.8: (확인 필요)
- 13.9.7: lastMemoryUpdateTs preservation fix
- 13.9.6: SKILL.md single command for dual timestamps
- 13.9.5: Dual timestamp headers
- 13.9.4: Delta extraction improvements (append mode)

ARCHITECTURE.md에 누락된 버전:
- 13.9.9: 30-second thinking rule
- 13.9.8: (확인 필요)
- 13.9.7: lastMemoryUpdateTs preservation fix
- 13.9.6: SKILL.md single command
- 13.9.5: Dual timestamp headers
- 13.9.4: Delta extraction append mode

---

## 수정 필요 작업

### 즉시 수정 (버전 정확성)

1. **STRUCTURE.md**: 헤더 버전 13.8.7 → 13.9.9
2. **README.md**: saveInterval 5 → 25
3. **README.md**: 버전 테이블에 13.9.x 추가
4. **ARCHITECTURE.md**: 버전 테이블에 13.9.4~13.9.9 추가
5. **USER-MANUAL.md**: 버전 호환성 13.8.x → 13.9.x

### 기능 문서화

1. **30초 사고 규칙**: 모든 주요 문서에 추가
2. **Dual Timestamp 포맷**: README, ARCHITECTURE에 설명 추가
3. **Critical Rules 전체 목록**: README에 섹션 추가

### 선택적 정리

1. docs/plans/ 내 오래된 플랜 문서 검토
   - memory-rotation-plan.md (1600줄+) - 유지?
   - facts-removal-plan.md - 완료됨, 삭제?
   - delta-trigger-investigation.md - 완료됨, 삭제?
   - trigger-mechanism-analysis.md - 완료됨, 삭제?

---

## 수정 우선순위

| 우선순위 | 파일 | 작업 |
|---------|------|------|
| 1 | STRUCTURE.md | 버전 13.9.9로 수정 |
| 2 | README.md | saveInterval 25, 버전 테이블 업데이트 |
| 3 | ARCHITECTURE.md | 버전 테이블 업데이트 |
| 4 | USER-MANUAL.md | saveInterval 확인, 버전 업데이트 |
| 5 | README.md | 30초 규칙, dual timestamp 문서화 |
