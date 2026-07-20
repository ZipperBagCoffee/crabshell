'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateSessionStartOutput } = require('./core/memory-context');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell alternating hosts '));
const projectRoot = path.join(tempRoot, 'shared project');
const storageRoot = path.join(projectRoot, '.crabshell');
const memoryDir = path.join(storageRoot, 'memory');
const claudeData = path.join(tempRoot, 'claude plugin data');
const codexData = path.join(tempRoot, 'codex plugin data');
const claudeConfig = path.join(tempRoot, 'claude config');
const claudeSession = path.join(__dirname, 'load-memory.js');
const claudePrompt = path.join(__dirname, 'inject-rules.js');
const claudeCounter = path.join(__dirname, 'counter.js');
const codexSession = path.join(__dirname, 'adapters', 'codex', 'session-start.js');
const codexPrompt = path.join(__dirname, 'adapters', 'codex', 'user-prompt-submit.js');
const memoryCommand = path.join(__dirname, 'codex-memory.js');
const CLAUDE_MARKER = 'CLAUDE_SESSION_MEMORY_MARKER_' + 'C'.repeat(80);
const CODEX_MARKER = 'CODEX_SESSION_MEMORY_MARKER_' + 'X'.repeat(80);
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function snapshot(root) {
  const result = {};
  if (!fs.existsSync(root)) return result;
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

function run(script, args, payload, env = {}) {
  return spawnSync(process.execPath, [script, ...(args || [])], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    input: payload === undefined ? undefined : JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
}

function context(result) {
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  assert.strictEqual(validateSessionStartOutput(output), true);
  return output.hookSpecificOutput.additionalContext;
}

function requireMarker(text, marker) {
  if (!text.includes(marker)) throw new Error(`missing marker: ${marker.slice(0, 32)}`);
  return true;
}

try {
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(claudeData, { recursive: true });
  fs.mkdirSync(codexData, { recursive: true });
  fs.mkdirSync(claudeConfig, { recursive: true });
  fs.writeFileSync(path.join(storageRoot, 'project.md'), 'ALTERNATING_HOST_PROJECT\n');
  fs.writeFileSync(path.join(memoryDir, 'memory-index.json'), JSON.stringify({
    rulesInjectionFrequency: 1,
    feedbackPressure: { level: 0, consecutiveCount: 0, decayCounter: 0, oscillationCount: 0, lastShownLevel: 0 },
    tooGoodSkepticism: { retryCount: 0 },
    rotatedFiles: [],
  }, null, 2));
  fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), '# Alternating host fixture\n');
  const docHashes = {};
  for (const [dir, id] of [['discussion', 'D900'], ['plan', 'P900'], ['ticket', 'P900_T001'], ['investigation', 'I900']]) {
    fs.mkdirSync(path.join(storageRoot, dir), { recursive: true });
    const docPath = path.join(storageRoot, dir, `${id}-fixture.md`);
    fs.writeFileSync(docPath, `---\nid: ${id}\nstatus: open\n---\n\n# ${id}\n`);
    docHashes[path.relative(projectRoot, docPath)] = snapshot(path.dirname(docPath))[path.basename(docPath)];
  }

  const claudeStart = context(run(claudeSession, [], {
    hook_event_name: 'SessionStart', source: 'startup', session_id: 'claude-session-1', cwd: projectRoot,
  }, {
    CLAUDE_PROJECT_DIR: projectRoot,
    CLAUDE_PLUGIN_DATA: claudeData,
    CLAUDE_CONFIG_DIR: claudeConfig,
  }));
  assert.match(claudeStart, /ALTERNATING_HOST_PROJECT/);
  const claudeExec = run(claudePrompt, [], {
    hook_event_name: 'UserPromptSubmit', prompt: 'Implement the Claude fixture change.', session_id: 'claude-session-1', cwd: projectRoot,
  }, {
    CLAUDE_PROJECT_DIR: projectRoot,
    CLAUDE_PLUGIN_DATA: claudeData,
    CLAUDE_CONFIG_DIR: claudeConfig,
  });
  assert.strictEqual(claudeExec.status, 0, claudeExec.stderr || claudeExec.stdout);
  const claudeDataAfterClaude = snapshot(claudeData);
  const codexDataBeforeCodex = snapshot(codexData);

  const transcriptPath = path.join(tempRoot, 'claude-session-1.jsonl');
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ type: 'human', message: { content: 'Implement the Claude fixture change.' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: CLAUDE_MARKER }] } }),
  ].join('\n') + '\n');
  const claudeFinal = run(claudeCounter, ['final'], {
    hook_event_name: 'SessionEnd', session_id: 'claude-session-1', transcript_path: transcriptPath,
  }, {
    CLAUDE_PROJECT_DIR: projectRoot,
    CLAUDE_PLUGIN_DATA: claudeData,
    CLAUDE_CONFIG_DIR: claudeConfig,
  });
  assert.strictEqual(claudeFinal.status, 0, claudeFinal.stderr || claudeFinal.stdout);

  const codexStartContext = context(run(codexSession, [], {
    hook_event_name: 'SessionStart', source: 'startup', session_id: 'codex-session-1', cwd: projectRoot,
  }, { PLUGIN_DATA: codexData }));

  test('Codex independently reads memory saved by the previous Claude session', () => {
    requireMarker(codexStartContext, CLAUDE_MARKER);
  });

  const codexExec = run(codexPrompt, [], {
    hook_event_name: 'UserPromptSubmit', prompt: 'Implement the Codex fixture change.', session_id: 'codex-session-1', cwd: projectRoot,
  }, { PLUGIN_DATA: codexData });
  assert.strictEqual(codexExec.status, 0, codexExec.stderr || codexExec.stdout);
  const codexSave = run(memoryCommand, ['save', `--message=${CODEX_MARKER}`, `--project-dir=${projectRoot}`], undefined, { PLUGIN_DATA: codexData });
  assert.strictEqual(codexSave.status, 0, codexSave.stderr || codexSave.stdout);

  test('Codex execution changes only Codex plugin data', () => {
    assert.deepStrictEqual(snapshot(claudeData), claudeDataAfterClaude);
    assert.notDeepStrictEqual(snapshot(codexData), codexDataBeforeCodex);
  });

  const codexDataAfterCodex = snapshot(codexData);
  const claudeSecondContext = context(run(claudeSession, [], {
    hook_event_name: 'SessionStart', source: 'startup', session_id: 'claude-session-2', cwd: projectRoot,
  }, {
    CLAUDE_PROJECT_DIR: projectRoot,
    CLAUDE_PLUGIN_DATA: claudeData,
    CLAUDE_CONFIG_DIR: claudeConfig,
  }));
  const claudeSecondExec = run(claudePrompt, [], {
    hook_event_name: 'UserPromptSubmit', prompt: 'Implement the second Claude fixture change.', session_id: 'claude-session-2', cwd: projectRoot,
  }, {
    CLAUDE_PROJECT_DIR: projectRoot,
    CLAUDE_PLUGIN_DATA: claudeData,
    CLAUDE_CONFIG_DIR: claudeConfig,
  });
  assert.strictEqual(claudeSecondExec.status, 0, claudeSecondExec.stderr || claudeSecondExec.stdout);

  test('Claude independently reads memory saved by Codex', () => {
    requireMarker(claudeSecondContext, CODEX_MARKER);
  });

  test('second Claude execution does not change Codex plugin data', () => {
    assert.deepStrictEqual(snapshot(codexData), codexDataAfterCodex);
  });

  test('D/P/T/I documents remain byte-identical across host alternation', () => {
    for (const [relative, expectedHash] of Object.entries(docHashes)) {
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(projectRoot, relative))).digest('hex');
      assert.strictEqual(actualHash, expectedHash, relative);
    }
  });

  test('host runtime markers and paths do not leak into shared project state', () => {
    const forbidden = [claudeData, codexData, 'session-lifecycle'];
    function inspect(current) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) inspect(child);
        else {
          const text = fs.readFileSync(child, 'utf8');
          for (const value of forbidden) assert.ok(!text.includes(value), `${value} leaked into ${child}`);
        }
      }
    }
    inspect(storageRoot);
  });

  test('missing-memory mutation is detected by exact marker assertion', () => {
    assert.throws(() => requireMarker(codexStartContext.replace(CLAUDE_MARKER, ''), CLAUDE_MARKER), /missing marker/);
  });

  test('cross-host marker mutation is detected by host-data snapshot', () => {
    const before = snapshot(codexData);
    fs.writeFileSync(path.join(codexData, 'forbidden-claude-write.json'), '{}\n');
    assert.notDeepStrictEqual(snapshot(codexData), before);
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
