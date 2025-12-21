const path = require('path');
const { getProjectDir, getProjectName, readFileOrDefault, writeFile, readJsonOrDefault, ensureDir } = require('./utils');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'memory-keeper', 'config.json');
const DEFAULT_INTERVAL = 5;

function getConfig() {
  return readJsonOrDefault(CONFIG_PATH, { saveInterval: DEFAULT_INTERVAL });
}

function getCounterPath() {
  return path.join(getProjectDir(), 'counter.txt');
}

function getCounter() {
  const counterPath = getCounterPath();
  const value = readFileOrDefault(counterPath, '0');
  return parseInt(value, 10) || 0;
}

function setCounter(value) {
  const counterPath = getCounterPath();
  ensureDir(path.dirname(counterPath));
  writeFile(counterPath, String(value));
}

function check() {
  const config = getConfig();
  const interval = config.saveInterval || DEFAULT_INTERVAL;

  let counter = getCounter();
  counter++;
  setCounter(counter);

  if (counter >= interval) {
    const projectDir = getProjectDir();
    const scriptPath = process.argv[1].replace(/\\/g, '/');

    // JSON 형식으로 출력해야 Claude가 볼 수 있음
    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `[MEMORY_KEEPER_SAVE] 도구 ${counter}회 사용됨. 메모리 저장 필요.\n\n다음을 수행하라:\n1. 이 세션의 작업 내용을 200자 이내로 요약\n2. ${projectDir.replace(/\\/g, '/')}/memory.md에 저장 (Write tool)\n3. 저장 후 Bash로 node "${scriptPath}" reset 실행하여 카운터 리셋`
      }
    };
    console.log(JSON.stringify(output));
  }
}

function final() {
  const projectName = getProjectName();
  const projectDir = getProjectDir().replace(/\\/g, '/');
  const timestamp = new Date().toISOString();

  const output = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `[MEMORY_KEEPER_FINAL] 세션 종료. 최종 메모리 저장.\n\n다음을 수행하라:\n1. 이 세션 전체를 300자 이내로 요약\n2. ${projectDir}/memory.md에 저장\n\n저장 형식:\n# Project Memory: ${projectName}\n\n## Current State\n- 마지막 업데이트: ${timestamp}\n- 상태: [현재 상태]\n\n## Recent Context\n[최근 작업 요약]\n\n## Known Issues\n[알려진 문제들]`
    }
  };
  console.log(JSON.stringify(output));

  setCounter(0);
}

function reset() {
  setCounter(0);
  console.log('[MEMORY_KEEPER] 카운터 리셋됨.');
}

// Main
const command = process.argv[2];

switch (command) {
  case 'check':
    check();
    break;
  case 'final':
    final();
    break;
  case 'reset':
    reset();
    break;
  default:
    console.log('Usage: counter.js [check|final|reset]');
}
