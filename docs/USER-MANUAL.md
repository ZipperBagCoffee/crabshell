# Memory Keeper 사용 설명서

## 왜 필요한가?

Claude Code는 세션이 끝나면 **모든 것을 잊습니다:**
- 어제 한 작업
- 내린 결정과 이유
- 프로젝트 구조
- 발견한 버그와 해결 방법

새 세션마다 "이 프로젝트는 React로 만들었고, 상태관리는 Zustand 쓰고, 인증은 JWT로..." 이런 설명을 반복해야 합니다.

Memory Keeper는 이 문제를 해결합니다.

## 설치

```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper
```

**끝입니다.** 설치 후 자동으로 작동합니다.

---

## 기본 사용법 (자동)

### 설치 후 일어나는 일

**1. 세션 시작할 때:**
- 이전 세션 요약 (`memory.md`)을 Claude에게 전달
- 저장된 결정사항/패턴/이슈 (`facts.json`)를 Claude에게 전달
- 설정한 프로젝트 정보 (`project.md` 등)를 Claude에게 전달

**2. 작업 중:**
- 도구를 5번 사용할 때마다 자동 저장 트리거
- Claude가 알아서 현재까지의 작업을 요약해서 저장

**3. 세션 끝날 때:**
- 전체 대화 내용 백업 (`.raw.jsonl`)
- 최종 세션 요약 저장
- 오래된 파일 정리

### 저장되는 것들

```
.claude/memory/
├── memory.md       # 세션 요약 누적 (자동)
├── facts.json      # 결정/패턴/이슈 (자동)
└── sessions/       # 세션별 기록 (자동)
```

---

## 고급 사용법 (수동)

### 프로젝트 정보 설정

Claude가 **매 세션마다 알았으면 하는 정보**를 설정할 수 있습니다.

#### project.md - 프로젝트 개요

```bash
node scripts/counter.js memory-set project "
프로젝트: 온라인 쇼핑몰
기술 스택: Next.js 14, TypeScript, Prisma, PostgreSQL
현재 상태: MVP 개발 중, 결제 기능 구현 단계
팀: 프론트엔드 2명, 백엔드 1명
"
```

#### architecture.md - 시스템 구조

```bash
node scripts/counter.js memory-set architecture "
디렉토리 구조:
src/
  app/           - Next.js 14 App Router
  components/    - React 컴포넌트
    ui/          - 공통 UI (Button, Input, Modal)
    features/    - 기능별 컴포넌트 (Cart, Checkout)
  lib/           - 유틸리티
  services/      - API 호출 래퍼

데이터베이스:
- users: 사용자 정보
- products: 상품
- orders: 주문
- cart_items: 장바구니

API 규칙:
- 모든 API는 /api/v1/ 아래
- 인증 필요한 API는 /api/v1/protected/
- 에러 형식: { error: string, code: number }
"
```

#### conventions.md - 코딩 규칙

```bash
node scripts/counter.js memory-set conventions "
코드 스타일:
- 함수형 컴포넌트만 사용
- 타입은 interface 우선 (type은 유니온에만)
- 파일명: kebab-case
- 컴포넌트명: PascalCase
- 변수/함수명: camelCase

테스트:
- 모든 util 함수는 테스트 필수
- 컴포넌트는 중요한 것만
- 테스트 파일: *.test.ts

커밋:
- 커밋 전 pnpm lint && pnpm test 실행
- 커밋 메시지: feat:, fix:, docs:, refactor:, test:
"
```

### 설정 확인

```bash
# 모든 메모리 파일 목록
node scripts/counter.js memory-list

# 출력 예시:
# [MEMORY_KEEPER] Memory Structure:
#   ✓ project.md (15 lines, 423 bytes)
#   ✓ architecture.md (28 lines, 892 bytes)
#   ○ conventions.md - not created
#   ✓ memory.md (156 lines, 4521 bytes) [rolling]
#   ✓ facts.json (12d/5p/3i)

# 특정 메모리 내용 보기
node scripts/counter.js memory-get project
node scripts/counter.js memory-get architecture
node scripts/counter.js memory-get              # 전부 보기
```

---

## 결정사항 관리

### 자동 추출

Claude가 세션 파일을 저장할 때 이런 형식으로 작성하면:

```markdown
## Decisions
- [technology] JWT 사용: 세션 기반보다 확장성이 좋음
  - concepts: 인증, 보안
- [architecture] API 버저닝: 하위 호환성 유지
  - files: src/app/api/v1/
```

자동으로 `facts.json`에 추출됩니다.

### 수동 추가

중요한 결정을 바로 기록하고 싶을 때:

```bash
# 기본
node scripts/counter.js add-decision "결정 내용" "이유"

# 타입 지정
node scripts/counter.js add-decision "PostgreSQL 사용" "복잡한 쿼리가 많아서" technology

# 관련 파일과 개념도 함께
node scripts/counter.js add-decision "Redis 캐싱 도입" "API 응답 속도 개선" technology "src/lib/cache.ts" "캐싱,성능"
```

**타입 옵션:**
- `architecture` - 시스템 구조 관련
- `technology` - 기술 선택
- `approach` - 구현 방식

### 검색

```bash
# 전체 요약
node scripts/counter.js search

# 키워드 검색
node scripts/counter.js search "인증"

# 타입으로 필터
node scripts/counter.js search --type=technology

# 개념으로 필터
node scripts/counter.js search --concept=보안

# 파일로 필터
node scripts/counter.js search --file=auth

# 조합
node scripts/counter.js search "캐시" --type=architecture
```

---

## 패턴 관리

반복되는 패턴이나 규칙을 기록:

```bash
# 기본
node scripts/counter.js add-pattern "모든 API 응답은 try-catch로 감싸기"

# 타입 지정
node scripts/counter.js add-pattern "컴포넌트는 한 파일에 하나만" convention
node scripts/counter.js add-pattern "DB 쿼리는 트랜잭션 안에서" best-practice
node scripts/counter.js add-pattern "any 타입 사용 금지" anti-pattern
```

**타입 옵션:**
- `convention` - 팀 규칙
- `best-practice` - 좋은 습관
- `anti-pattern` - 피해야 할 것

---

## 이슈 관리

버그나 문제를 기록:

```bash
# 열린 이슈
node scripts/counter.js add-issue "결제 페이지 느림" "open" performance

# 해결된 이슈
node scripts/counter.js add-issue "로그인 토큰 만료 안 됨" "resolved" security

# 관련 파일과 함께
node scripts/counter.js add-issue "장바구니 동기화 버그" "resolved" bugfix "src/hooks/useCart.ts" "장바구니,상태관리"
```

**타입 옵션:**
- `bugfix` - 버그
- `performance` - 성능 문제
- `security` - 보안 이슈
- `feature` - 기능 관련

---

## 슬래시 커맨드

Claude Code에서 직접 사용:

| 커맨드 | 언제 사용 |
|--------|----------|
| `/memory-keeper:save-memory` | 지금 바로 저장하고 싶을 때 |
| `/memory-keeper:load-memory` | 파일 수동 편집 후 다시 불러올 때 |
| `/memory-keeper:search-memory 키워드` | 과거 작업 찾을 때 |
| `/memory-keeper:clear-memory old` | 오래된 파일 정리할 때 |

---

## 유지보수

### 오래된 파일 정리

30일 지난 세션 파일을 월별 아카이브로:

```bash
node scripts/counter.js compress

# sessions/2025-10-15_0300.md -> sessions/archive/2025-10.md
```

### facts 초기화

facts.json을 초기화 (메모리 파일은 유지):

```bash
node scripts/counter.js clear-facts
```

### 카운터 리셋

자동 저장 카운터를 0으로:

```bash
node scripts/counter.js reset
```

---

## 문제 해결

### 메모리가 로드 안 됨

1. `.claude/memory/` 폴더 확인
2. `memory.md` 파일 존재 확인
3. `/memory-keeper:load-memory` 실행

### 자동 저장이 안 됨

1. `facts.json`의 `_meta.counter` 값 확인
2. `config.json`의 `saveInterval` 확인 (기본 5)
3. `node scripts/counter.js reset`으로 카운터 리셋

### 세션 파일이 없음

1. 세션이 정상 종료되었는지 확인 (Ctrl+C가 아닌 `/exit`)
2. `.claude/memory/debug-hook.json` 확인
3. `.claude/memory/error.log` 확인

---

## 설정 옵션

`.claude/memory/config.json`:

```json
{
  "saveInterval": 5
}
```

- `saveInterval`: 도구 몇 번 사용 후 저장할지 (기본: 5, 범위: 1-50)

---

## 버전 호환성

| 버전 | Claude Code | Node.js |
|------|-------------|---------|
| 7.0.x | 1.0+ | 18+ |
| 6.x | 1.0+ | 18+ |
