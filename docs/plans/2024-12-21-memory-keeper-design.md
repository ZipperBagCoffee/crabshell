# Memory Keeper Plugin Design

## Overview

자동 백그라운드 메모리 저장 플러그인. 세션 중 컨텍스트를 자동으로 저장하고, 세션 시작 시 이전 컨텍스트를 로드.

## Requirements

| 항목 | 결정 |
|------|------|
| 저장 트리거 | 토큰 50% 소모 시 자동 (설정 가능) |
| 저장 내용 | 원본 + 요약 |
| 인덱싱 | 키워드 기반 검색 |
| 로드 | 세션 시작 시 요약만 (memory.md) |
| 명령어 | 자동 + 수동 백업 |
| 프로젝트 | 완전 분리 |

## Architecture

### Storage Structure

```
~/.claude/memory-keeper/projects/[project-name]/
├── memory.md           # 롤링 요약 - 세션 시작 시 로드
├── facts.json          # 구조화된 지식 - 검색용
├── sessions/           # 티어드 스토리지
│   ├── YYYY-MM-DD_HHMM.md       # 최근 7일: 개별 요약
│   ├── YYYY-MM-DD_HHMM.raw.md   # 최근 7일: 원본
│   ├── week-NN.md               # 7-30일: 주간 통합
│   └── archive/                 # 30일+: 월별 핵심
└── index.json          # 키워드 인덱스
```

### Rolling Summary (memory.md)

```markdown
# Project Memory: [project-name]

## Core Decisions (영구 보존)
- [중요 결정사항들]

## Current State (매 세션 업데이트)
- 버전: X.X.X
- 상태: [현재 상태]
- 마지막 작업: [최근 작업]

## Recent Context (최근 3세션)
- [날짜]: [요약]

## Known Issues
- [알려진 문제들]
```

### Knowledge Facts (facts.json)

```json
{
  "decisions": [
    {
      "id": "d001",
      "content": "결정 내용",
      "reason": "이유",
      "date": "YYYY-MM-DD",
      "session": "YYYY-MM-DD_HHMM"
    }
  ],
  "patterns": [
    {
      "id": "p001",
      "content": "패턴 설명",
      "date": "YYYY-MM-DD"
    }
  ],
  "issues": [
    {
      "id": "i001",
      "content": "이슈 설명",
      "status": "open|resolved",
      "resolution": "해결 방법"
    }
  ]
}
```

### Tiered Storage

| 기간 | 저장 형태 | 파일명 |
|------|----------|--------|
| 0-7일 | 개별 요약 + 원본 | `YYYY-MM-DD_HHMM.md`, `.raw.md` |
| 7-30일 | 주간 통합 요약 | `week-NN.md` |
| 30일+ | 월별 핵심 | `archive/YYYY-MM.md` |

## Hook Configuration

### PostToolUse - 자동 백그라운드 저장

```json
{
  "PostToolUse": [
    {
      "matcher": ".*",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Check if context usage exceeds 50%. If so, spawn a background agent (Task tool with run_in_background:true) to save current session memory. Include: 1) Update memory.md with current state 2) Extract facts to facts.json 3) Save session summary to sessions/. Do not interrupt current work flow."
        }
      ]
    }
  ]
}
```

### SessionStart - 메모리 로드

```json
{
  "SessionStart": [
    {
      "matcher": "startup",
      "hooks": [
        {
          "type": "command",
          "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" load-memory"
        }
      ]
    }
  ]
}
```

### Stop - 최종 저장 + 압축

```json
{
  "Stop": [
    {
      "matcher": ".*",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Final memory save before session end: 1) Save complete session summary 2) Update memory.md 3) Extract all facts 4) Run tier compression (7+ days -> weekly, 30+ days -> archive). Save to ~/.claude/memory-keeper/projects/[PROJECT_NAME]/"
        }
      ]
    }
  ]
}
```

## Data Flow

```
[세션 시작]
    │
    └── SessionStart 훅
            │
            └── load-memory.js 실행
                    │
                    └── memory.md 내용 출력 → Claude 컨텍스트에 주입

[세션 중 - PostToolUse 훅]
    │
    └── Claude가 컨텍스트 50%+ 확인
            │
            └── 백그라운드 에이전트 스폰
                    │
                    ├── 현재 대화 요약 생성
                    ├── memory.md 업데이트
                    ├── facts.json 업데이트
                    └── sessions/에 저장

[세션 종료 - Stop 훅]
    │
    └── 최종 저장
            │
            ├── 전체 세션 요약
            ├── memory.md 최종 업데이트
            ├── facts 추출
            └── 티어 압축 실행
```

## Commands

| 명령어 | 설명 |
|--------|------|
| `/memory-keeper:save` | 수동 저장 (백업용) |
| `/memory-keeper:recall [query]` | 과거 세션 검색 후 추가 로드 |
| `/memory-keeper:status` | 현재 메모리 상태 확인 |
| `/memory-keeper:clear [all\|old]` | 메모리 정리 |

## Implementation Notes

### Windows Compatibility
- Node.js 사용 (bash 대신)
- `run-hook.cmd` 래퍼로 크로스 플랫폼 지원

### File Operations
- Node.js fs 모듈 사용
- 경로: `os.homedir() + '/.claude/memory-keeper/'`

### Error Handling
- 디렉토리 없으면 자동 생성
- 파일 읽기 실패 시 빈 상태로 시작
- 저장 실패 시 로그만 남기고 진행
