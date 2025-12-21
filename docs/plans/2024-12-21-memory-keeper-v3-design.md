# Memory Keeper v3 Design

## Overview

도구 사용 횟수 기반 자동 저장. 백그라운드 에이전트가 요약 생성, 메인 Claude가 저장.

## Requirements

| 항목 | 결정 |
|------|------|
| 저장 트리거 | 도구 5회 사용마다 (설정 가능) |
| 저장 방식 | 백그라운드 에이전트 요약 → 메인 Claude 저장 |
| 로드 | 세션 시작 시 memory.md |
| 프로젝트 | 완전 분리 |

## Flow

```
[PostToolUse 훅]
       │
       ▼
[Node.js 카운터 스크립트]
       │
       ├─ 카운터 < 5 → 아무것도 안 함
       │
       └─ 카운터 >= 5 → "MEMORY_SAVE_TRIGGER" 출력
                              │
                              ▼
                     [메인 Claude가 봄]
                              │
                              ▼
                     [백그라운드 에이전트 스폰]
                              │
                              ▼
                     [에이전트가 요약 생성해서 리턴]
                              │
                              ▼
                     [메인 Claude가 파일 저장]
                              │
                              ▼
                     [카운터 리셋]
```

## File Structure

```
scripts/
├── counter.js      # 카운터 관리 (증가, 체크, 리셋)
├── load-memory.js  # 세션 시작 시 메모리 로드
└── utils.js        # 공통 유틸리티

hooks/
├── hooks.json      # 훅 설정
└── run-hook.cmd    # Windows 래퍼
```

## Storage Structure

```
~/.claude/memory-keeper/
├── config.json                    # 전역 설정
└── projects/
    └── [project-name]/
        ├── memory.md              # 롤링 요약
        ├── counter.txt            # 현재 카운터 값
        └── sessions/
            └── YYYY-MM-DD_HHMM.md # 개별 세션
```

## Hooks Configuration

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/load-memory.js\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/counter.js\" check"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/counter.js\" final"
          }
        ]
      }
    ]
  }
}
```

## Counter Script Behavior

**counter.js check:**
- 카운터 증가
- 카운터 >= 설정값이면 트리거 메시지 출력
- Claude가 메시지 보고 백그라운드 에이전트 스폰

**counter.js final:**
- 최종 저장 트리거 메시지 출력
- 카운터 리셋

**counter.js reset:**
- 카운터를 0으로 리셋

## Config File

```json
{
  "saveInterval": 5,
  "summaryMaxLength": 500
}
```

## Memory Format

```markdown
# Project Memory: [project-name]

## Core Decisions
- [핵심 결정들]

## Current State
- 마지막 업데이트: [timestamp]
- 상태: [현재 상태]

## Recent Context
- [최근 작업 요약]

## Known Issues
- [알려진 문제들]
```

## Trigger Messages

**MEMORY_KEEPER_SAVE:**
```
[MEMORY_KEEPER] 저장 트리거. 다음을 수행하라:
1. Task tool로 백그라운드 에이전트 스폰 (run_in_background: false)
2. 에이전트에게 현재 세션 요약 요청
3. 에이전트 결과 받으면 ~/.claude/memory-keeper/projects/[PROJECT]/memory.md에 저장
4. counter.js reset 실행
```

**MEMORY_KEEPER_FINAL:**
```
[MEMORY_KEEPER] 세션 종료. 최종 저장:
1. 현재 세션 전체 요약
2. memory.md 업데이트
3. sessions/에 세션 기록 저장
```
