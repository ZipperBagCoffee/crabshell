# Memory-Keeper Plugin 프로젝트 구조

**버전**: 7.0.1 | **작성자**: TaWa | **라이선스**: MIT

## 개요
Memory Keeper는 Claude Code 플러그인으로, 세션 메모리를 자동 저장하고 관리합니다. 백그라운드 에이전트 요약, 구조화된 facts 저장, 계층형 아카이빙, 계층형 메모리 구조(v7.0.0)를 지원합니다.

## 디렉토리 구조

```
memory-keeper-plugin/
├── .claude/                          # Claude Code 로컬 저장소
│   ├── settings.local.json           # 로컬 플러그인 설정
│   └── memory/                       # 프로젝트 메모리 저장
│       ├── memory.md                 # 롤링 세션 요약 (자동 생성)
│       ├── project.md                # 프로젝트 개요 (선택적, memory-set으로 생성)
│       ├── architecture.md           # 아키텍처 결정 (선택적, memory-set으로 생성)
│       ├── conventions.md            # 코딩 컨벤션 (선택적, memory-set으로 생성)
│       ├── facts.json                # 구조화된 결정/패턴/이슈 + 카운터 + 개념 인덱스
│       ├── debug-hook.json           # 훅 실행 디버그 정보
│       └── sessions/                 # 세션별 아카이브 (자동 생성)
│           ├── 2025-12-21_0233.md    # 세션 요약 파일 예시
│           ├── 2025-12-21_0234.raw.jsonl  # Raw 트랜스크립트 예시
│           └── archive/              # 월별 아카이브 (YYYY-MM.md)
│
├── .claude-plugin/                   # 플러그인 설정
│   ├── plugin.json                   # 플러그인 메타데이터 (v7.0.0)
│   └── marketplace.json              # 마켓플레이스 등록
│
├── agents/                           # 백그라운드 에이전트 정의
│   ├── memory-keeper.md              # 세션 요약기 (haiku 모델)
│   └── context-loader.md             # 컨텍스트 검색 전문가
│
├── commands/                         # CLI 명령어
│   ├── save-memory.md                # 수동 저장 명령
│   ├── load-memory.md                # 메모리 로드 명령
│   ├── search-memory.md              # 세션 검색 명령
│   └── clear-memory.md               # 정리 명령
│
├── hooks/                            # 라이프사이클 훅
│   ├── hooks.json                    # 훅 설정 (SessionStart, PostToolUse, Stop)
│   └── run-hook.cmd                  # Windows용 훅 실행 래퍼
│
├── scripts/                          # 핵심 구현 (Node.js)
│   ├── counter.js                    # 메인 엔진 (카운터, fact 관리, 메모리 관리)
│   ├── load-memory.js                # 세션 시작 시 메모리 로드
│   ├── save-prompt.js                # 저장 프롬프트 포맷터
│   └── utils.js                      # 공유 유틸리티
│
├── skills/                           # 슬래시 커맨드 스킬
│   ├── memory-save/SKILL.md          # 자동 트리거 메모리 저장 (훅 출력 시)
│   ├── save-memory/SKILL.md          # /memory-keeper:save-memory 수동 저장
│   ├── load-memory/SKILL.md          # /memory-keeper:load-memory 메모리 로드
│   ├── search-memory/SKILL.md        # /memory-keeper:search-memory 검색
│   └── clear-memory/SKILL.md         # /memory-keeper:clear-memory 정리
│
├── docs/                             # 문서
│   ├── ARCHITECTURE.md               # 시스템 아키텍처
│   ├── USER-MANUAL.md                # 사용자 매뉴얼
│   ├── CANDIDATES.md                 # 기능 후보
│   └── plans/                        # 버전별 설계 문서
│       ├── 2024-12-21-memory-keeper-design.md
│       ├── 2024-12-21-memory-keeper-v3-design.md
│       ├── 2024-12-21-memory-keeper-v4-design.md
│       ├── 2024-12-21-memory-keeper-v4-implementation.md
│       ├── 2025-12-21-v6.4.0-design.md
│       ├── 2025-12-21-v6.5.0-design.md
│       └── 2025-12-21-v7.0.0-design.md
│
├── .gitignore                        # Git 무시 규칙
├── README.md                         # 프로젝트 문서
└── STRUCTURE.md                      # 이 파일 (프로젝트 구조 문서)
```

## 핵심 파일 설명

### scripts/counter.js
- 메인 자동화 엔진
- facts.json의 `_meta.counter` 관리
- `check`: 도구 사용 후 카운터 증가, 임계값 도달 시 `[MEMORY_KEEPER]` 저장 지시 출력
- `final`: 세션 종료 핸들러, raw 트랜스크립트 복사
- `reset`: 카운터 초기화
- `compress`: 30일 이상 파일 월별 아카이브로 압축
- `memory-set`: 계층형 메모리 파일 설정 (v7.0.0+)
- `memory-get`: 계층형 메모리 파일 읽기 (v7.0.0+)
- `memory-list`: 메모리 파일 목록 (v7.0.0+)
- `add-decision`: 결정 추가 (type, files, concepts 지원)
- `add-pattern`: 패턴 추가 (type, files, concepts 지원)
- `add-issue`: 이슈 추가 (type, files, concepts 지원)
- `search`: facts.json 검색 (--type, --concept, --file 필터)
- `extract-facts`: 세션 파일에서 facts 자동 추출
- `clear-facts`: facts 배열 초기화

### scripts/utils.js
- 공유 유틸리티 함수
- `getProjectDir()`: `.claude/memory/` 경로 반환
- `ensureDir()`: 디렉토리 재귀 생성
- `readJsonOrDefault()`: 안전한 JSON 읽기
- `writeJson()`: JSON 저장
- `getTimestamp()`: 타임스탬프 생성

### scripts/load-memory.js
- 세션 시작 시 실행
- 계층형 메모리 파일 로드 (project.md, architecture.md, conventions.md)
- memory.md 파일 마지막 N줄 읽기
- Claude에게 이전 컨텍스트 제공

### agents/memory-keeper.md
- haiku 모델 사용
- 세션 분석 후 JSON 형식 출력 (summary, decisions, patterns, issues)

### agents/context-loader.md
- haiku 모델 사용
- facts.json 검색 전문가
- 관련 결정/패턴/이슈 찾기

## 훅 플로우

```
1. SessionStart
   └─> load-memory.js 실행
       └─> 계층형 메모리 + memory.md + facts 요약 출력

2. PostToolUse (매 도구 사용 후)
   └─> counter.js check 실행
       ├─> facts.json._meta.counter 증가
       ├─> 임계값 도달 시 [MEMORY_KEEPER] 출력
       └─> 트리거 후 자동 카운터 리셋

3. Stop (세션 종료)
   └─> counter.js final 실행
       └─> raw 트랜스크립트 아카이브 + 최종 저장 지시
```

## facts.json 스키마 (v6.5.0+)

```json
{
  "_meta": {
    "counter": 0,
    "lastSave": "2025-12-21_1430"
  },
  "decisions": [
    {
      "id": "d001",
      "type": "architecture",
      "date": "2025-12-21",
      "content": "Use structured markdown",
      "reason": "Easier to parse",
      "files": ["src/parser.ts"],
      "concepts": ["parsing", "architecture"]
    }
  ],
  "patterns": [
    {
      "id": "p001",
      "type": "convention",
      "date": "2025-12-21",
      "content": "Always use heredoc for bash",
      "concepts": ["bash", "workflow"]
    }
  ],
  "issues": [
    {
      "id": "i001",
      "type": "bugfix",
      "date": "2025-12-21",
      "content": "JSON editing fails",
      "status": "resolved",
      "files": ["scripts/counter.js"],
      "concepts": ["json", "cli"]
    }
  ],
  "concepts": {
    "architecture": ["d001"],
    "parsing": ["d001"],
    "bash": ["p001"]
  }
}
```

## 계층형 메모리 구조 (v7.0.0)

**참고:** `project.md`, `architecture.md`, `conventions.md`는 **선택적**입니다. `memory-set` 명령으로 생성합니다.

| 파일 | 용도 | 생성 방법 | 자동 업데이트 |
|------|------|----------|--------------|
| `project.md` | 프로젝트 개요, 목표, 기술 스택 | `memory-set project` | 아니오 |
| `architecture.md` | 아키텍처 결정, 구조 다이어그램 | `memory-set architecture` | 아니오 |
| `conventions.md` | 코딩 스타일, 네이밍 규칙 | `memory-set conventions` | 아니오 |
| `memory.md` | 세션 요약 (rolling) | 자동 생성 | 예 |

### CLI 명령어 (v7.0.0)

```bash
# 계층형 메모리 관리
node counter.js memory-set project "This is a React app..."
node counter.js memory-set architecture "Uses MVC pattern..."
node counter.js memory-set conventions "Use camelCase for..."
node counter.js memory-get project
node counter.js memory-get            # 모든 메모리 파일 보기
node counter.js memory-list           # 메모리 파일 목록
```

## 세션 파일 형식 (v6.5.0+)

```markdown
# Session 2025-12-21_0300

## Summary
[작업 내용 요약]

## Decisions
- [architecture|technology|approach] 결정 내용: 이유
  - files: path/to/file1.ts, path/to/file2.ts
  - concepts: concept1, concept2

## Patterns
- [convention|best-practice|anti-pattern] 패턴 설명
  - concepts: testing, workflow

## Issues
- [bugfix|performance|security|feature] 이슈 내용: open|resolved
  - files: path/to/fixed-file.ts
  - concepts: performance
```

**Privacy Tags:** `<private>민감정보</private>`로 facts.json 제외

## 설정 옵션

`config.json` (선택적):
```json
{
  "saveInterval": 5
}
```

위치 우선순위:
1. `.claude/memory/config.json` (프로젝트)
2. `~/.claude/memory-keeper/config.json` (전역)
3. 기본값: 5

## 주요 특징

- **프로젝트 격리**: 각 프로젝트별 독립 메모리 저장
- **계층형 메모리 (v7.0.0)**: project/architecture/conventions 분리 저장
- **자동 저장 트리거**: 카운터 기반 (기본 5회)
- **구조화된 facts**: type, files, concepts 태깅 지원 (v6.5.0+)
- **개념 인덱스**: concepts로 빠른 검색
- **Privacy 태그**: 민감 정보 facts.json 제외 (v6.4.0+)
- **이중 저장**: 요약(memory.md) + raw 트랜스크립트(jsonl) + 구조화된 facts
- **트리거 후 자동 리셋**: 저장 지시 출력 후 카운터 자동 리셋
- **계층형 아카이빙**: 30일 이상 세션 월별 자동 아카이브
- **Windows 호환**: Node.js 사용으로 Windows 경로 문제 해결

## 의존성

- Node.js v18+ (내장 fs, path 모듈만 사용)
- Claude Code 프레임워크 (hooks, agents, commands, skills)
- 외부 npm 패키지 없음

## 버전 히스토리

| 버전 | 주요 변경사항 |
|------|--------------|
| 7.0.1 | clearFacts에서 concepts 인덱스 초기화 수정, skills 폴더 완성 |
| 7.0.0 | 계층형 메모리 구조 (project/architecture/conventions.md) |
| 6.5.0 | 파일 참조 + 개념 태깅 (files, concepts) |
| 6.4.0 | 관측 유형 (type) + Privacy 태그 |
| 6.3.0 | 구조화된 세션 파일에서 facts 자동 추출 |
| 6.2.0 | 명령 경로 수정 및 search/clear-facts 기능 추가 |
| 6.1.0 | CLI 명령어로 안전한 facts.json 업데이트 |
| 6.0.1 | 비동기 stdin 읽기로 transcript_path 캡처 수정 |
| 6.0.0 | 명시적 지시 출력 방식, 트리거 후 자동 카운터 리셋 |
| 5.0.1 | facts.json._meta.counter 기반 저장 트리거 |
