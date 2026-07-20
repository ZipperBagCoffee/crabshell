'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const sessionStart = path.join(__dirname, 'load-memory.js');
const userPrompt = path.join(__dirname, 'inject-rules.js');
const codexUserPrompt = path.join(__dirname, 'adapters', 'codex', 'user-prompt-submit.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell claude preservation '));
const projectRoot = path.join(tempRoot, 'project');
const memoryDir = path.join(projectRoot, '.crabshell', 'memory');
const pluginDataRoot = path.join(tempRoot, 'claude plugin data');
const claudeConfigRoot = path.join(tempRoot, 'claude config');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL: ${name} --- ${error.message}`);
  }
}

function treeSnapshot(root) {
  const result = {};
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name);
      result[childRelative] = entry.isDirectory()
        ? '<directory>'
        : crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex');
      if (entry.isDirectory()) visit(child, childRelative);
    }
  }
  visit(root);
  return result;
}

function run(script, payload, options = {}) {
  const cwd = options.projectRoot || projectRoot;
  return spawnSync(process.execPath, [script], {
    cwd,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: options.claudeProjectDir === undefined ? cwd : options.claudeProjectDir,
      CLAUDE_PLUGIN_DATA: options.pluginDataRoot === undefined ? pluginDataRoot : options.pluginDataRoot,
      CLAUDE_CONFIG_DIR: options.claudeConfigRoot === undefined ? claudeConfigRoot : options.claudeConfigRoot,
      ...(options.env || {}),
    },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
}

try {
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), '# Project instructions\n');
  fs.writeFileSync(path.join(memoryDir, 'memory-index.json'), JSON.stringify({
    deltaReady: false,
    rulesInjectionFrequency: 1,
    rulesInjectionCount: 0,
    feedbackPressure: {
      level: 1,
      consecutiveCount: 1,
      decayCounter: 0,
      oscillationCount: 3,
      lastShownLevel: 1,
    },
    tooGoodSkepticism: { retryCount: 2 },
    rotatedFiles: [],
  }, null, 2));
  fs.writeFileSync(path.join(memoryDir, 'delta_temp.txt'), 'STALE_DELTA\n');
  fs.writeFileSync(path.join(memoryDir, 'skill-active.json'), '{"skill":"regressing"}\n');

  const start = run(sessionStart, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'preservation-session-1' });
  const prompt = run(userPrompt, { hook_event_name: 'UserPromptSubmit', prompt: 'Implement the requested change.', session_id: 'preservation-session-1' });

  test('Claude SessionStart and execution prompt both exit successfully', () => {
    if (start.status !== 0) throw new Error(start.stderr || start.stdout);
    if (prompt.status !== 0) throw new Error(prompt.stderr || prompt.stdout);
  });

  test('execution session preserves stale-delta cleanup', () => {
    if (fs.existsSync(path.join(memoryDir, 'delta_temp.txt'))) throw new Error('stale delta_temp.txt remains');
  });

  test('execution session preserves stale skill flag cleanup', () => {
    if (fs.existsSync(path.join(memoryDir, 'skill-active.json'))) throw new Error('stale skill-active.json remains');
  });

  test('execution session preserves per-session pressure reset', () => {
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
    if (index.feedbackPressure.oscillationCount !== 0) throw new Error(`oscillationCount=${index.feedbackPressure.oscillationCount}`);
    if (index.tooGoodSkepticism.retryCount !== 0) throw new Error(`retryCount=${index.tooGoodSkepticism.retryCount}`);
  });

  test('execution session preserves automatic Claude rule synchronization', () => {
    const claudeMd = fs.readFileSync(path.join(projectRoot, 'CLAUDE.md'), 'utf8');
    if (!claudeMd.includes('CRITICAL RULES')) throw new Error('CLAUDE.md was not synchronized');
  });

  test('execution session preserves the Claude built-in memory distinction warning', () => {
    const sanitized = projectRoot.replace(/[^a-zA-Z0-9-]/g, '-');
    const memoryPath = path.join(claudeConfigRoot, 'projects', sanitized, 'memory', 'MEMORY.md');
    const content = fs.readFileSync(memoryPath, 'utf8');
    if (!content.includes('These are SEPARATE systems')) throw new Error('built-in memory warning missing');
  });

  test('session marker is stored outside the project under Claude plugin data', () => {
    const markerDir = path.join(pluginDataRoot, 'session-lifecycle');
    const markers = fs.readdirSync(markerDir).filter(file => file.endsWith('.json'));
    if (markers.length !== 1) throw new Error(`expected one marker, found ${markers.length}`);
    if (JSON.stringify(markers).includes(projectRoot)) throw new Error('marker name exposes project path');
  });

  const sameSessionIndex = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
  sameSessionIndex.feedbackPressure.oscillationCount = 7;
  sameSessionIndex.tooGoodSkepticism = { retryCount: 4 };
  fs.writeFileSync(path.join(memoryDir, 'memory-index.json'), JSON.stringify(sameSessionIndex, null, 2));
  fs.writeFileSync(path.join(memoryDir, 'skill-active.json'), '{"skill":"current-session"}\n');
  const repeat = run(userPrompt, { hook_event_name: 'UserPromptSubmit', prompt: 'Implement the next requested change.', session_id: 'preservation-session-1' });

  test('same session does not repeat cleanup or erase current-session counters', () => {
    if (repeat.status !== 0) throw new Error(repeat.stderr || repeat.stdout);
    if (!fs.existsSync(path.join(memoryDir, 'skill-active.json'))) throw new Error('current-session skill flag was removed');
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
    if (index.feedbackPressure.oscillationCount !== 7) throw new Error(`oscillationCount=${index.feedbackPressure.oscillationCount}`);
    if (index.tooGoodSkepticism.retryCount !== 4) throw new Error(`retryCount=${index.tooGoodSkepticism.retryCount}`);
  });

  const nextSession = run(userPrompt, { hook_event_name: 'UserPromptSubmit', prompt: 'Implement the final requested change.', session_id: 'preservation-session-2' });
  test('new Claude session runs cleanup and reset again', () => {
    if (nextSession.status !== 0) throw new Error(nextSession.stderr || nextSession.stdout);
    if (fs.existsSync(path.join(memoryDir, 'skill-active.json'))) throw new Error('new-session skill flag cleanup did not run');
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
    if (index.feedbackPressure.oscillationCount !== 0) throw new Error(`oscillationCount=${index.feedbackPressure.oscillationCount}`);
    if (index.tooGoodSkepticism.retryCount !== 0) throw new Error(`retryCount=${index.tooGoodSkepticism.retryCount}`);
  });

  test('question-only Claude lifecycle leaves project, plugin data, and Claude home unchanged', () => {
    const questionProject = path.join(tempRoot, 'question project');
    const questionData = path.join(tempRoot, 'question plugin data');
    const questionConfig = path.join(tempRoot, 'question claude config');
    fs.mkdirSync(path.join(questionProject, '.git'), { recursive: true });
    fs.mkdirSync(questionData, { recursive: true });
    fs.mkdirSync(questionConfig, { recursive: true });
    fs.writeFileSync(path.join(questionProject, 'CLAUDE.md'), '# Question fixture\n');
    const before = {
      project: treeSnapshot(questionProject),
      data: treeSnapshot(questionData),
      config: treeSnapshot(questionConfig),
    };
    const options = { projectRoot: questionProject, pluginDataRoot: questionData, claudeConfigRoot: questionConfig };
    const questionStart = run(sessionStart, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'question-session' }, options);
    const questionPrompt = run(userPrompt, { hook_event_name: 'UserPromptSubmit', prompt: 'What does this change do?', session_id: 'question-session' }, options);
    if (questionStart.status !== 0) throw new Error(questionStart.stderr || questionStart.stdout);
    if (questionPrompt.status !== 0) throw new Error(questionPrompt.stderr || questionPrompt.stdout);
    const after = {
      project: treeSnapshot(questionProject),
      data: treeSnapshot(questionData),
      config: treeSnapshot(questionConfig),
    };
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('question-only lifecycle changed a fixture root');
  });

  test('Codex execution uses separate plugin data and never writes Claude surfaces', () => {
    const codexProject = path.join(tempRoot, 'codex project');
    const codexMemory = path.join(codexProject, '.crabshell', 'memory');
    const codexData = path.join(tempRoot, 'codex plugin data');
    const codexClaudeConfig = path.join(tempRoot, 'codex claude config');
    fs.mkdirSync(path.join(codexProject, '.git'), { recursive: true });
    fs.mkdirSync(codexMemory, { recursive: true });
    fs.mkdirSync(codexData, { recursive: true });
    fs.mkdirSync(codexClaudeConfig, { recursive: true });
    fs.writeFileSync(path.join(codexProject, 'CLAUDE.md'), '# CODEX MUST NOT CHANGE THIS\n');
    fs.writeFileSync(path.join(codexMemory, 'delta_temp.txt'), 'STALE\n');
    fs.writeFileSync(path.join(codexMemory, 'skill-active.json'), '{"skill":"stale"}\n');
    fs.writeFileSync(path.join(codexMemory, 'memory-index.json'), JSON.stringify({
      deltaReady: false,
      rulesInjectionFrequency: 1,
      feedbackPressure: { level: 0, consecutiveCount: 0, decayCounter: 0, oscillationCount: 5, lastShownLevel: 0 },
      tooGoodSkepticism: { retryCount: 6 },
      rotatedFiles: [],
    }, null, 2));
    const claudeBefore = fs.readFileSync(path.join(codexProject, 'CLAUDE.md'), 'utf8');
    const configBefore = treeSnapshot(codexClaudeConfig);
    const result = run(codexUserPrompt, {
      hook_event_name: 'UserPromptSubmit',
      cwd: codexProject,
      prompt: 'Implement the requested Codex change.',
      session_id: 'codex-execution-session',
    }, {
      projectRoot: codexProject,
      pluginDataRoot: '',
      claudeConfigRoot: codexClaudeConfig,
      env: { PLUGIN_DATA: codexData },
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    if (fs.existsSync(path.join(codexMemory, 'delta_temp.txt'))) throw new Error('Codex stale delta remains');
    if (fs.existsSync(path.join(codexMemory, 'skill-active.json'))) throw new Error('Codex stale skill flag remains');
    const index = JSON.parse(fs.readFileSync(path.join(codexMemory, 'memory-index.json'), 'utf8'));
    if (index.feedbackPressure.oscillationCount !== 0 || index.tooGoodSkepticism.retryCount !== 0) {
      throw new Error('Codex per-session counters were not reset');
    }
    if (fs.readFileSync(path.join(codexProject, 'CLAUDE.md'), 'utf8') !== claudeBefore) throw new Error('Codex changed CLAUDE.md');
    if (JSON.stringify(treeSnapshot(codexClaudeConfig)) !== JSON.stringify(configBefore)) throw new Error('Codex wrote Claude built-in memory');
    const markers = fs.readdirSync(path.join(codexData, 'session-lifecycle')).filter(file => file.endsWith('.json'));
    if (markers.length !== 1) throw new Error(`expected one Codex marker, found ${markers.length}`);
  });

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
