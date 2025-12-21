# Memory Keeper

**Claude Code는 세션이 끝나면 모든 것을 잊습니다.** 어제 무슨 결정을 했는지, 어떤 버그를 고쳤는지, 프로젝트 구조가 어떤지 - 새 세션마다 처음부터 다시 설명해야 합니다.

Memory Keeper는 이 문제를 해결합니다. **자동으로 세션 내용을 저장하고, 다음 세션에서 자동으로 불러옵니다.**

## 설치

```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper
```

설치 후 **아무것도 할 필요 없습니다**. 자동으로 작동합니다.

## 작동 방식

1. **세션 시작** - 이전 세션에서 저장한 내용을 자동으로 Claude에게 전달
2. **작업 중** - 5번 도구 사용할 때마다 자동으로 저장 트리거
3. **세션 종료** - 전체 대화 내용 백업 + 최종 저장

## 저장되는 내용

### 자동 저장 (건드릴 필요 없음)
- `memory.md` - 매 세션 요약이 누적됨
- `facts.json` - 결정사항, 패턴, 이슈가 구조화되어 저장됨
- `sessions/` - 각 세션별 상세 기록

### 수동 설정 (선택사항)
프로젝트에 대해 Claude가 항상 알았으면 하는 정보가 있다면:

```bash
# 프로젝트 개요 설정
node scripts/counter.js memory-set project "
React + TypeScript 웹 앱.
백엔드는 Node.js + PostgreSQL.
현재 사용자 인증 기능 개발 중.
"

# 아키텍처 설정
node scripts/counter.js memory-set architecture "
src/
  components/  - React 컴포넌트
  hooks/       - 커스텀 훅
  services/    - API 호출
  utils/       - 유틸리티

상태관리: Zustand 사용
API: REST, /api/v1/ 프리픽스
"

# 코딩 컨벤션 설정
node scripts/counter.js memory-set conventions "
- 함수형 컴포넌트만 사용
- 테스트 필수 (Jest + React Testing Library)
- 커밋 전 lint 통과 필수
- 변수명은 camelCase
"
```

이렇게 설정하면 **모든 새 세션에서 Claude가 이 정보를 알고 시작**합니다.

## 실제 사용 예시

### 자동 저장 트리거
5번째 도구 사용 후 Claude가 이런 메시지를 받습니다:
```
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - 5 tool uses reached
```
그러면 Claude가 알아서 현재까지의 작업 내용을 저장합니다.

### 결정사항 검색
```bash
# "인증" 관련 결정사항 찾기
node scripts/counter.js search "인증"

# 출력 예시:
# [DECISION d001] [technology] 2025-12-21: JWT 사용
#   Reason: 세션 기반보다 확장성 좋음
# [DECISION d003] [architecture] 2025-12-21: 토큰 갱신은 클라이언트에서
#   Reason: 서버 부하 감소
```

### 수동으로 중요한 결정 기록
```bash
# 중요한 기술 결정 기록
node scripts/counter.js add-decision "PostgreSQL 대신 MongoDB 사용" "문서 기반 데이터가 많아서" technology

# 발견한 패턴 기록
node scripts/counter.js add-pattern "API 에러는 항상 { error: string, code: number } 형태로 반환" convention

# 해결한 이슈 기록
node scripts/counter.js add-issue "로그인 후 리다이렉트 안 됨" "resolved" bugfix
```

## 슬래시 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/memory-keeper:save-memory` | 지금 바로 저장 (자동 저장 기다리기 싫을 때) |
| `/memory-keeper:load-memory` | 메모리 다시 불러오기 (수동 편집 후) |
| `/memory-keeper:search-memory 검색어` | 과거 세션 검색 |
| `/memory-keeper:clear-memory old` | 30일 지난 파일 정리 |

## 저장 위치

```
[프로젝트]/.claude/memory/
├── memory.md              # 세션 요약 누적 (자동)
├── project.md             # 프로젝트 개요 (memory-set으로 생성)
├── architecture.md        # 아키텍처 (memory-set으로 생성)
├── conventions.md         # 코딩 규칙 (memory-set으로 생성)
├── facts.json             # 구조화된 결정/패턴/이슈 (자동)
└── sessions/
    ├── 2025-12-21_0300.md      # 세션별 요약
    └── 2025-12-21_0300.raw.jsonl # 전체 대화 백업
```

## 설정

`.claude/memory/config.json`:
```json
{
  "saveInterval": 5
}
```
- `saveInterval`: 몇 번 도구 사용 후 저장할지 (기본: 5)

## CLI 명령어 전체 목록

```bash
# 메모리 조회
node scripts/counter.js memory-list            # 설정된 메모리 파일 목록
node scripts/counter.js memory-get             # 모든 메모리 내용 보기
node scripts/counter.js memory-get project     # project.md 내용만 보기

# 메모리 설정
node scripts/counter.js memory-set project "내용"
node scripts/counter.js memory-set architecture "내용"
node scripts/counter.js memory-set conventions "내용"

# 검색
node scripts/counter.js search                 # 저장된 facts 요약
node scripts/counter.js search "키워드"        # 키워드로 검색
node scripts/counter.js search --type=architecture  # 타입으로 필터
node scripts/counter.js search --concept=인증       # 개념으로 필터

# 수동 기록
node scripts/counter.js add-decision "결정내용" "이유" [타입]
node scripts/counter.js add-pattern "패턴" [타입]
node scripts/counter.js add-issue "이슈" "open|resolved" [타입]

# 관리
node scripts/counter.js compress               # 30일 지난 파일 아카이브
node scripts/counter.js clear-facts            # facts.json 초기화
node scripts/counter.js reset                  # 카운터 리셋
```

**타입 옵션:**
- decisions: `architecture`, `technology`, `approach`
- patterns: `convention`, `best-practice`, `anti-pattern`
- issues: `bugfix`, `performance`, `security`, `feature`

## 문서

- [User Manual](docs/USER-MANUAL.md) - 상세 사용법
- [Architecture](docs/ARCHITECTURE.md) - 시스템 구조

## 버전

| 버전 | 변경사항 |
|------|----------|
| 7.0.1 | clearFacts 버그 수정, 슬래시 커맨드 추가 |
| 7.0.0 | 계층형 메모리 (project/architecture/conventions) |
| 6.5.0 | 파일 참조 + 개념 태깅 |
| 6.4.0 | 타입 분류 + 프라이버시 태그 |

## 라이선스

MIT
