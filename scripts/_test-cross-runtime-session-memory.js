'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateSessionStartOutput } = require('./core/memory-context');

const repoRoot = path.resolve(__dirname, '..');
const claudeAdapter = path.join(__dirname, 'load-memory.js');
const codexAdapter = path.join(__dirname, 'adapters', 'codex', 'session-start.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell session memory '));
const emptyProject = path.join(tempRoot, 'empty project with spaces');
const memoryProject = path.join(tempRoot, 'memory project with spaces');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function snapshot(root) {
  const result = {};
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        result[childRelative] = '<directory>';
        visit(child, childRelative);
      } else {
        result[childRelative] = crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex');
      }
    }
  }
  visit(root);
  return result;
}

function payload(projectDir) {
  return {
    session_id: 'session-memory-fixture',
    transcript_path: null,
    cwd: projectDir,
    hook_event_name: 'SessionStart',
    source: 'startup',
    model: 'fixture-model',
    permission_mode: 'default',
  };
}

function run(adapter, projectDir) {
  const result = spawnSync(process.execPath, [adapter], {
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: adapter === claudeAdapter ? projectDir : '' },
    input: JSON.stringify(payload(projectDir)),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  assert.strictEqual(validateSessionStartOutput(output), true);
  return output.hookSpecificOutput.additionalContext;
}

function createProject(root) {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), '.crabshell/\n');
}

try {
  createProject(emptyProject);
  createProject(memoryProject);
  const memoryRoot = path.join(memoryProject, '.crabshell', 'memory');
  fs.mkdirSync(path.join(memoryRoot, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(memoryProject, '.crabshell', 'project.md'), 'PROJECT_MEMORY_MARKER\n');
  fs.writeFileSync(path.join(memoryRoot, 'logbook.md'), '## Recent\nROLLING_MEMORY_MARKER\n');
  fs.writeFileSync(path.join(memoryRoot, 'latest.summary.json'), JSON.stringify({ overallSummary: 'SUMMARY_MEMORY_MARKER' }));
  fs.writeFileSync(path.join(memoryRoot, 'memory-index.json'), JSON.stringify({
    rotatedFiles: [
      { file: 'old.jsonl', summaryGenerated: false },
      { file: 'latest.jsonl', summaryGenerated: true, summary: 'latest.summary.json' },
    ],
  }));
  fs.writeFileSync(path.join(memoryRoot, 'sessions', 'latest.l1.jsonl'), JSON.stringify({
    role: 'assistant',
    text: 'UNREFLECTED_MEMORY_MARKER ' + 'context '.repeat(12),
  }) + '\n');

  const emptyBefore = snapshot(emptyProject);
  const emptyClaude = run(claudeAdapter, emptyProject);
  const emptyCodex = run(codexAdapter, emptyProject);

  test('empty Claude and Codex SessionStart use the same native memory context', () => {
    assert.strictEqual(emptyClaude, emptyCodex);
    assert.match(emptyClaude, /No memory for empty project with spaces/);
  });

  test('empty native SessionStart leaves every project path and byte unchanged', () => {
    assert.deepStrictEqual(snapshot(emptyProject), emptyBefore);
  });

  const memoryBefore = snapshot(memoryProject);
  const memoryClaude = run(claudeAdapter, memoryProject);
  const memoryCodex = run(codexAdapter, memoryProject);

  test('populated Claude and Codex SessionStart consume one exact memory context', () => {
    assert.strictEqual(memoryClaude, memoryCodex);
    for (const marker of ['PROJECT_MEMORY_MARKER', 'ROLLING_MEMORY_MARKER', 'SUMMARY_MEMORY_MARKER', 'UNREFLECTED_MEMORY_MARKER']) {
      assert.match(memoryClaude, new RegExp(marker));
    }
  });

  test('populated automatic memory load is read-only', () => {
    assert.deepStrictEqual(snapshot(memoryProject), memoryBefore);
  });

  test('divergent source and wrong-event mutations are rejected', () => {
    assert.notStrictEqual(memoryClaude.replace('PROJECT_MEMORY_MARKER', 'DIVERGENT_MEMORY'), memoryCodex);
    assert.throws(() => validateSessionStartOutput({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: memoryClaude },
    }), /SessionStart/);
  });

  test('stale-memory mutation is rejected by the current-source marker check', () => {
    const staleContext = memoryClaude.replace('ROLLING_MEMORY_MARKER', 'STALE_MEMORY_MARKER');
    assert.doesNotMatch(staleContext, /ROLLING_MEMORY_MARKER/);
    assert.notStrictEqual(staleContext, memoryCodex);
  });

  test('independent sentinel-write mutation is detected by the tree snapshot', () => {
    const sentinel = path.join(emptyProject, 'forbidden-session-write.txt');
    fs.writeFileSync(sentinel, 'mutation');
    assert.notDeepStrictEqual(snapshot(emptyProject), emptyBefore);
    fs.rmSync(sentinel);
  });

  test('test executes both source adapters from this repository', () => {
    assert.strictEqual(path.dirname(claudeAdapter), path.join(repoRoot, 'scripts'));
    assert.strictEqual(path.dirname(path.dirname(path.dirname(codexAdapter))), path.join(repoRoot, 'scripts'));
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
