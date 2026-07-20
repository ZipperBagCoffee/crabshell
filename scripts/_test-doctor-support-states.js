'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STATE_KEYS, codexAppState, deriveSupportState } = require('./core/support-state');
const { probeClaudeHooks, selectPlugin } = require('./codex-doctor');

let passed = 0;
const jsonMode = process.argv.includes('--json');
function test(name, fn) {
  fn();
  passed += 1;
  if (!jsonMode) console.log(`PASS: ${name}`);
}

test('state schema exposes all seven requested distinctions', () => {
  const state = deriveSupportState({ supported: true });
  assert.deepStrictEqual(Object.keys(state.states), STATE_KEYS);
});

test('not installed differs from installed but not activated', () => {
  const absent = deriveSupportState({ supported: true, installed: false });
  const installed = deriveSupportState({ supported: true, installed: true, activated: false });
  assert.strictEqual(absent.status, 'not-installed');
  assert.strictEqual(installed.states.installed, true);
  assert.strictEqual(installed.states.activated, false);
  assert.strictEqual(installed.status, 'degraded');
});

test('activated but untrusted is degraded without losing activation', () => {
  const state = deriveSupportState({ supported: true, installed: true, activated: true, trusted: false, behaviorVerified: true });
  assert.strictEqual(state.states.activated, true);
  assert.strictEqual(state.states.trusted, false);
  assert.strictEqual(state.states.degraded, true);
  assert.match(state.reasons.degraded.join(' '), /trust/);
});

test('trusted direct behavior reaches behavior-verified', () => {
  const state = deriveSupportState({ supported: true, installed: true, activated: true, trusted: true, behaviorVerified: true });
  assert.strictEqual(state.status, 'behavior-verified');
  assert.strictEqual(state.states['behavior-verified'], true);
  assert.strictEqual(state.states.degraded, false);
});

test('failed behavior probe is degraded independently from trust', () => {
  const state = deriveSupportState({ supported: true, installed: true, activated: true, trusted: true, behaviorVerified: false });
  assert.strictEqual(state.states.trusted, true);
  assert.strictEqual(state.states['behavior-verified'], false);
  assert.match(state.reasons.degraded.join(' '), /behavior-probe/);
});

test('source/cache mismatch is drifted and takes status precedence', () => {
  const state = deriveSupportState({
    supported: true, installed: true, activated: true, trusted: true, behaviorVerified: true,
    driftReasons: ['hook-source-differs'],
  });
  assert.strictEqual(state.status, 'drifted');
  assert.strictEqual(state.states.drifted, true);
  assert.strictEqual(state.states['behavior-verified'], true);
});

test('unsupported remains distinct even when an old install exists', () => {
  const state = deriveSupportState({ supported: false, installed: true, unsupportedReasons: ['capability-disabled:hooks'] });
  assert.strictEqual(state.status, 'unsupported');
  assert.strictEqual(state.states.installed, true);
  assert.strictEqual(state.states.unsupported, true);
});

test('Codex app does not inherit Codex CLI evidence', () => {
  const state = codexAppState();
  assert.strictEqual(state.status, 'not-directly-exercised');
  assert.strictEqual(state.directlyExercised, false);
  assert.ok(Object.values(state.states).every(value => value === false));
});

test('Claude behavior probe executes both current source native adapters', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-doctor-claude-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    assert.deepStrictEqual(probeClaudeHooks(path.resolve(__dirname, '..'), root), ['SessionStart', 'UserPromptSubmit']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed plugin selection is not hidden by an uninstalled local marketplace row', () => {
  const response = { marketplaces: [
    { name: 'local-marketplace', plugins: [{ name: 'crabshell', id: 'crabshell@local-marketplace', installed: false, source: { type: 'local', path: process.cwd() } }] },
    { name: 'crabshell-repo', plugins: [{ name: 'crabshell', id: 'crabshell@crabshell-repo', installed: true, source: { type: 'git', path: 'remote' } }] },
  ] };
  assert.strictEqual(selectPlugin(response, process.cwd()).plugin.id, 'crabshell@crabshell-repo');
});

test('doctor source contains no hardcoded version compatibility table', () => {
  const source = fs.readFileSync(path.join(__dirname, 'codex-doctor.js'), 'utf8');
  assert.doesNotMatch(source, /SUPPORTED_(?:CODEX|CLAUDE)_VERSIONS|versionCompatibilityTable|compatibilityVersionMap/);
});

if (jsonMode) process.stdout.write(`${JSON.stringify({ passed: true, checks: passed })}\n`);
else console.log(`RESULT: ${passed} passed, 0 failed`);
