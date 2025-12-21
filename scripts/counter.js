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
    const projectName = getProjectName();
    const projectDir = getProjectDir();

    console.log(`
[MEMORY_KEEPER_SAVE]
도구 ${counter}회 사용됨. 메모리 저장 필요.

다음을 수행하라:
1. 백그라운드 에이전트 스폰 (Task tool, run_in_background: false, subagent_type: general-purpose)
2. 에이전트 프롬프트: "이 세션의 작업 내용을 요약하라. 200자 이내로. 핵심 결정, 현재 상태, 최근 작업, 알려진 문제 포함."
3. 에이전트 결과를 ${projectDir}/memory.md에 저장 (Write tool)
4. 저장 후 node "${process.argv[1]}" reset 실행하여 카운터 리셋
`);
  }
}

function final() {
  const projectName = getProjectName();
  const projectDir = getProjectDir();

  console.log(`
[MEMORY_KEEPER_FINAL]
세션 종료. 최종 메모리 저장.

다음을 수행하라:
1. 이 세션 전체를 요약하라 (300자 이내)
2. ${projectDir}/memory.md에 저장
3. ${projectDir}/sessions/ 폴더에 현재 타임스탬프로 세션 기록 저장

저장 형식:
# Project Memory: ${projectName}

## Core Decisions
[핵심 결정들]

## Current State
- 마지막 업데이트: ${new Date().toISOString()}
- 상태: [현재 상태]

## Recent Context
[최근 작업 요약]

## Known Issues
[알려진 문제들]
`);

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
