'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = path.join(__dirname, '..', 'codex-skills', 'load-memory', 'scripts', 'codex-memory.js');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell codex memory '));
const projectRoot = path.join(testRoot, 'project with spaces');
const storageRoot = path.join(projectRoot, '.crabshell');
const memoryRoot = path.join(storageRoot, 'memory');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args, `--project-dir=${projectRoot}`], {
    cwd: projectRoot,
    env: { ...process.env, CLAUDE_PROJECT_DIR: path.join(testRoot, 'conflicting hook project') },
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), '# fixture\n');
  fs.writeFileSync(path.join(storageRoot, 'project.md'), '# Fixture project\nPROJECT_MEMORY_MARKER\n');
  const originalLogbook = '# Existing logbook\n\nBASELINE_MEMORY_MARKER\n';
  fs.writeFileSync(path.join(memoryRoot, 'logbook.md'), originalLogbook);
  fs.writeFileSync(path.join(memoryRoot, 'logbook_20260101_000000.md'), '# Archive\nARCHIVE_MEMORY_MARKER\n');
  fs.writeFileSync(path.join(memoryRoot, 'logbook_20260101_000000.summary.json'), JSON.stringify({
    overallSummary: 'ROTATED_SUMMARY_MARKER',
    themes: [{ name: 'history', summary: 'ARCHIVE_THEME_MARKER' }],
    keyDecisions: [],
    issues: [],
  }, null, 2));
  const initialIndex = {
    version: 1,
    current: 'logbook.md',
    rotatedFiles: [{
      file: 'logbook_20260101_000000.md',
      rotatedAt: '2026-01-01T00:00:00.000Z',
      tokens: 4,
      bytes: 40,
      summary: 'logbook_20260101_000000.summary.json',
      summaryGenerated: true,
      dateRange: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T00:01:00.000Z' },
    }],
    stats: { totalRotations: 1, lastRotation: '2026-01-01T00:01:00.000Z' },
    preservedCustomField: { source: 'fixture' },
  };
  fs.writeFileSync(path.join(memoryRoot, 'memory-index.json'), JSON.stringify(initialIndex, null, 2));

  const loaded = run(['load', '--tail-lines=20']);
  test('load returns project, rotated summary, and current logbook from a spaces path', () => {
    assert.match(loaded, /PROJECT_MEMORY_MARKER/);
    assert.match(loaded, /ROTATED_SUMMARY_MARKER/);
    assert.match(loaded, /BASELINE_MEMORY_MARKER/);
  });

  test('search covers preserved L3 summary and L2 archive formats', () => {
    assert.match(run(['search', 'ARCHIVE_THEME_MARKER']), /L3 summaries/);
    assert.match(run(['search', 'ARCHIVE_MEMORY_MARKER']), /L2 archives/);
  });

  run(['save', '--title=Codex fixture note', '--message=NEW_CODEX_MEMORY_MARKER']);
  const savedLogbook = fs.readFileSync(path.join(memoryRoot, 'logbook.md'), 'utf8');
  test('save appends without changing existing logbook bytes', () => {
    assert.ok(savedLogbook.startsWith(originalLogbook));
    assert.ok(savedLogbook.length > originalLogbook.length);
    assert.match(savedLogbook, /NEW_CODEX_MEMORY_MARKER/);
  });

  test('save preserves the index schema and custom fields', () => {
    const observedIndex = JSON.parse(fs.readFileSync(path.join(memoryRoot, 'memory-index.json'), 'utf8'));
    assert.deepStrictEqual(observedIndex, initialIndex);
  });

  test('search finds the newly appended Codex note', () => {
    assert.match(run(['search', 'NEW_CODEX_MEMORY_MARKER']), /logbook\.md/);
  });

  test('status reports the actual project and rotation state', () => {
    const status = JSON.parse(run(['status']));
    assert.strictEqual(path.resolve(status.projectDir), path.resolve(projectRoot));
    assert.strictEqual(path.resolve(status.memoryDir), path.resolve(memoryRoot));
    assert.strictEqual(status.rotations, 1);
    assert.strictEqual(status.rotatedFiles, 1);
    assert.strictEqual(status.logbookBytes, Buffer.byteLength(savedLogbook));
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
