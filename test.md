# Memory-Keeper Plugin 프로젝트 구조

**버전**: 6.0.0 | **작성자**: TaWa | **라이선스**: MIT

## 개요
Memory Keeper는 Claude Code 플러그인으로, 세션 메모리를 자동 저장하고 관리합니다. 백그라운드 에이전트 요약, 구조화된 facts 저장, 계층형 아카이빙을 지원합니다.

## 디렉토리 구조

```
memory-keeper-plugin/
├── .claude/                          # Claude Code 로컬 저장소
│   ├── settings.local.json           # 로컬 플러그인 설정
│   └── memory/                       # 프로젝트 메모리 저장
│       ├── memory.md                 # 롤링 세션 요약
│       ├── facts.json                # 구조화된 결정/패턴/이슈
│       ├── config.json               # 프로젝트 로컬 설정
│       ├── debug-hook.json           # 훅 실행 디버그 정보
│       └── sessions/                 # 세션별 아카이브
│           ├── YYYY-MM-DD_HHMM.md    # 세션 요약 파일
│           ├── YYYY-MM-DD_HHMM.raw.jsonl  # Raw 트랜스크립트
│           └── archive/              # 월별 아카이브 (YYYY-MM.md)
│
├── .claude-plugin/                   # 플러그인 설정
│   ├── plugin.json                   # 플러그인 메타데이터 (v6.0.0)
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
│   └── hooks.json                    # 훅 설정 (SessionStart, PostToolUse, Stop)
│
├── scripts/                          # 핵심 구현 (Node.js)
│   ├── counter.js                    # 도구 사용 카운터 및 트리거 로직
│   ├── load-memory.js                # 세션 시작 시 메모리 로드
│   ├── save-prompt.js                # 저장 프롬프트 포맷터
│   └── utils.js                      # 공유 유틸리티
│
├── skills/                           # 재사용 가능한 스킬
│   └── memory-save/
│       └── SKILL.md                  # 자동 트리거 메모리 저장 스킬
│
├── docs/                             # 설계 문서
│   └── plans/                        # 버전별 설계 문서
│
├── .gitignore                        # Git 무시 규칙
└── README.md                         # 프로젝트 문서
```

## 핵심 파일 설명

### scripts/counter.js
- 메인 자동화 엔진
- facts.json의 _meta.counter 관리
- check(): 도구 사용 후 카운터 증가, 임계값 도달 시 저장 지시 출력
- final(): 세션 종료 핸들러, raw 트랜스크립트 복사
- reset(): 카운터 초기화
- compress(): 30일 이상 파일 월별 아카이브로 압축

### scripts/utils.js
- 공유 유틸리티 함수
- getProjectDir(): .claude/memory/ 경로 반환
- ensureDir(): 디렉토리 재귀 생성
- readJsonOrDefault(): 안전한 JSON 읽기
- appendFacts(): facts.json에 항목 추가

### scripts/load-memory.js
- 세션 시작 시 실행
- memory.md 파일 읽어서 콘솔 출력
- Claude에게 이전 컨텍스트 제공

### scripts/save-prompt.js
- 세션 종료 시 저장 지시 포맷팅
- 저장 단계별 명령어 출력

### agents/memory-keeper.md
- haiku 모델 사용
- 세션 분석 후 JSON 형식 출력 (summary, decisions, patterns, issues)

### agents/context-loader.md
- haiku 모델 사용
- facts.json 검색 전문가
- 관련 결정/패턴/이슈 찾기

## 훅 플로우

1. **SessionStart** - 이전 세션 컨텍스트 로드
2. **PostToolUse** - 도구 사용 카운트 (기본 5회마다 저장 트리거)
3. **Stop** - 최종 아카이빙 및 카운터 리셋

## facts.json 스키마

```json
{
  "_meta": { "counter": 0, "lastSave": "2025-12-21_1430" },
  "decisions": [{ "id": "d001", "date": "", "content": "", "reason": "", "session": "" }],
  "patterns": [{ "id": "p001", "date": "", "content": "" }],
  "issues": [{ "id": "i001", "date": "", "content": "", "status": "", "resolution": "" }]
}
```

## 설정 옵션 (config.json)

```json
{
  "saveInterval": 5  // 자동 저장 트리거 도구 사용 횟수 (기본값: 5)
}
```

## 주요 특징

- **프로젝트 격리**: 각 프로젝트별 독립 메모리 저장
- **자동 저장 트리거**: 카운터 기반 (기본 5회)
- **이중 저장**: 요약(memory.md) + raw 트랜스크립트(jsonl) + 구조화된 facts
- **백그라운드 요약**: haiku 에이전트로 분석 및 facts 추출
- **계층형 아카이빙**: 30일 이상 세션 월별 자동 아카이브
- **Windows 호환**: Node.js 사용으로 Windows 경로 문제 해결

## 의존성

- Node.js v12+ (내장 fs, path 모듈만 사용)
- Claude Code 프레임워크 (hooks, agents, commands, skills)
- 외부 npm 패키지 없음
