# Memory Keeper Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Claude Code 플러그인으로 세션 컨텍스트를 자동 백그라운드 저장하고, 세션 시작 시 이전 컨텍스트 로드

**Architecture:** PostToolUse 훅으로 토큰 50% 도달 시 백그라운드 에이전트 스폰하여 저장. SessionStart 훅으로 memory.md 로드. 롤링 요약 + 구조화된 facts + 티어드 스토리지 조합.

**Tech Stack:** Node.js (Windows 호환), Claude Code Plugin System (hooks, commands, agents)

---

### Task 1: 프로젝트 구조 정리

**Files:**
- Delete: `hooks/scripts/load-memory.js` (기존 파일)
- Delete: `hooks/run-hook.cmd` (기존 파일)
- Create: `scripts/load-memory.js`
- Create: `scripts/save-memory.js`
- Create: `scripts/utils.js`

**Step 1: 기존 hooks/scripts 폴더 삭제**

```bash
rm -rf hooks/scripts
rm hooks/run-hook.cmd
```

**Step 2: scripts 폴더 생성**

```bash
mkdir scripts
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: reorganize project structure for new architecture"
```

---

### Task 2: 유틸리티 모듈 생성

**Files:**
- Create: `scripts/utils.js`

**Step 1: utils.js 작성**

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_ROOT = path.join(os.homedir(), '.claude', 'memory-keeper', 'projects');

function getProjectName() {
  return path.basename(process.cwd());
}

function getProjectDir() {
  const projectName = getProjectName();
  return path.join(MEMORY_ROOT, projectName);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readFileOrDefault(filePath, defaultValue) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return defaultValue;
  }
}

function readJsonOrDefault(filePath, defaultValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data) {
  writeFile(filePath, JSON.stringify(data, null, 2));
}

function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}_${hour}${min}`;
}

module.exports = {
  MEMORY_ROOT,
  getProjectName,
  getProjectDir,
  ensureDir,
  readFileOrDefault,
  readJsonOrDefault,
  writeFile,
  writeJson,
  getTimestamp
};
```

**Step 2: Commit**

```bash
git add scripts/utils.js
git commit -m "feat: add utility module for file operations"
```

---

### Task 3: 메모리 로드 스크립트 생성

**Files:**
- Create: `scripts/load-memory.js`

**Step 1: load-memory.js 작성**

```javascript
const path = require('path');
const { getProjectDir, getProjectName, readFileOrDefault } = require('./utils');

function loadMemory() {
  const projectDir = getProjectDir();
  const memoryPath = path.join(projectDir, 'memory.md');
  const projectName = getProjectName();

  const memory = readFileOrDefault(memoryPath, null);

  if (memory) {
    console.log(`\n--- Memory Keeper: Loading context for ${projectName} ---\n`);
    console.log(memory);
    console.log(`\n--- End of Memory ---\n`);
  } else {
    console.log(`\n--- Memory Keeper: No previous memory for ${projectName} ---\n`);
  }
}

loadMemory();
```

**Step 2: 테스트 실행**

```bash
node scripts/load-memory.js
```

Expected: "No previous memory for memory-keeper-plugin" 메시지 출력

**Step 3: Commit**

```bash
git add scripts/load-memory.js
git commit -m "feat: add memory load script for session start"
```

---

### Task 4: Windows 호환 래퍼 스크립트 생성

**Files:**
- Create: `hooks/run-hook.cmd`

**Step 1: run-hook.cmd 작성**

```cmd
@echo off
setlocal

set SCRIPT_DIR=%~dp0
set SCRIPT_NAME=%~1

if "%SCRIPT_NAME%"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

node "%SCRIPT_DIR%..\scripts\%SCRIPT_NAME%.js" %2 %3 %4 %5 %6 %7 %8 %9
```

**Step 2: Commit**

```bash
git add hooks/run-hook.cmd
git commit -m "feat: add Windows-compatible hook wrapper"
```

---

### Task 5: hooks.json 업데이트

**Files:**
- Modify: `hooks/hooks.json`

**Step 1: hooks.json 전체 교체**

```json
{
  "hooks": {
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
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "MEMORY KEEPER AUTO-SAVE CHECK: If this conversation has accumulated significant context (estimate 50%+ of context window), spawn a background agent using Task tool with run_in_background:true to save session memory. The agent should: 1) Summarize current session progress 2) Save to ~/.claude/memory-keeper/projects/[PROJECT_NAME]/sessions/[TIMESTAMP].md 3) Update memory.md with current state 4) Extract key decisions/patterns/issues to facts.json. Do NOT interrupt current work - only spawn background agent if needed."
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "MEMORY KEEPER FINAL SAVE: Before session ends, save complete session memory to ~/.claude/memory-keeper/projects/[PROJECT_NAME]/. Include: 1) Full session summary in sessions/[TIMESTAMP].md 2) Raw conversation backup in sessions/[TIMESTAMP].raw.md 3) Update memory.md (Core Decisions, Current State, Recent Context, Known Issues) 4) Extract facts to facts.json 5) Compress old sessions (7+ days -> weekly, 30+ days -> archive). Create directories if needed."
          }
        ]
      }
    ]
  }
}
```

**Step 2: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: configure hooks for auto-save and session management"
```

---

### Task 6: plugin.json 업데이트

**Files:**
- Modify: `.claude-plugin/plugin.json`

**Step 1: plugin.json 읽기**

현재 내용 확인 필요

**Step 2: plugin.json 업데이트 (commands 추가)**

```json
{
  "name": "memory-keeper",
  "version": "2.0.0",
  "description": "Automatic background session memory - saves context periodically, loads on session start",
  "main": "hooks/hooks.json",
  "commands": [
    {
      "name": "save",
      "description": "Manually save current session memory"
    },
    {
      "name": "recall",
      "description": "Search and load past session context",
      "args": [
        {
          "name": "query",
          "description": "Search keywords",
          "required": false
        }
      ]
    },
    {
      "name": "status",
      "description": "Show current memory status"
    },
    {
      "name": "clear",
      "description": "Clear old memory files",
      "args": [
        {
          "name": "scope",
          "description": "all or old (default: old)",
          "required": false
        }
      ]
    }
  ]
}
```

**Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: add manual commands and update version to 2.0.0"
```

---

### Task 7: marketplace.json 버전 업데이트

**Files:**
- Modify: `.claude-plugin/marketplace.json`

**Step 1: marketplace.json 버전 업데이트**

version을 "2.0.0"으로 변경
description을 "Automatic background session memory - saves context periodically, loads on session start"로 변경

**Step 2: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "chore: update marketplace version to 2.0.0"
```

---

### Task 8: README.md 업데이트

**Files:**
- Modify: `README.md`

**Step 1: README.md 전체 교체**

```markdown
# Memory Keeper

Automatic background session memory for Claude Code. Saves context periodically during sessions, loads previous context on start.

## Features

- **Auto-save**: Background agent saves memory when context reaches 50%
- **Auto-load**: Previous session context loaded on start
- **Rolling summary**: Maintains `memory.md` with current project state
- **Knowledge extraction**: Extracts decisions/patterns/issues to searchable JSON
- **Tiered storage**: Recent sessions preserved, old ones compressed

## Installation

### From GitHub
```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper
```

### Local Development
```bash
claude --plugin-dir /path/to/memory-keeper-plugin
```

## How It Works

### Session Start
1. SessionStart hook runs `load-memory.js`
2. Reads `memory.md` for current project
3. Outputs to Claude's context

### During Session
1. PostToolUse hook checks context usage
2. At ~50%, spawns background agent
3. Agent saves summary without interrupting work

### Session End
1. Stop hook triggers final save
2. Complete session summary saved
3. Tier compression runs (7+ days → weekly, 30+ days → archive)

## Storage Structure

```
~/.claude/memory-keeper/projects/[project]/
├── memory.md           # Rolling summary (loaded at start)
├── facts.json          # Searchable facts database
├── sessions/           # Session history
│   ├── YYYY-MM-DD_HHMM.md      # Recent summaries
│   ├── YYYY-MM-DD_HHMM.raw.md  # Recent raw backups
│   ├── week-NN.md              # Weekly summaries
│   └── archive/                # Monthly archives
└── index.json          # Keyword index
```

## Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save` | Manual save (backup) |
| `/memory-keeper:recall [query]` | Search and load past context |
| `/memory-keeper:status` | Show memory status |
| `/memory-keeper:clear [all\|old]` | Clean up memory files |

## Configuration

No configuration needed. Works automatically.

To disable temporarily:
```bash
/plugin disable memory-keeper
```

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for v2.0.0 architecture"
```

---

### Task 9: 최종 테스트 및 푸시

**Step 1: 전체 구조 확인**

```bash
ls -la
ls -la scripts/
ls -la hooks/
ls -la .claude-plugin/
```

**Step 2: load-memory 테스트**

```bash
node scripts/load-memory.js
```

**Step 3: Git 상태 확인**

```bash
git status
git log --oneline -5
```

**Step 4: GitHub에 푸시**

```bash
git push origin master
```

---

## Execution Options

Plan complete and saved to `docs/plans/2024-12-21-memory-keeper-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
