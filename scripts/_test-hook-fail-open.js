'use strict';
// D143_T018: hooks stay fail-open when the verification runner's modules cannot be
// loaded (a partial or broken copy). The path guard still denies what it denies, every
// hook ends with exit 0 and at most one JSON object on stdout, the missing runner is named
// once, a blocking check without a judgment does not block, and evidence without a
// fingerprint is no evidence (null never equals null).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-fail-open-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}

// A copy of the plugin with the runner's modules removed.
const plugin = path.join(base, 'plugin');
for (const folder of ['scripts', 'hooks', 'skills']) fs.cpSync(path.join(REPO, folder), path.join(plugin, folder), { recursive: true });
fs.rmSync(path.join(plugin, 'skills', 'verifying', 'scripts', 'runner'), { recursive: true, force: true });

function project(name) {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, '.crabshell', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, '.crabshell', 'verification'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'check.js'), "require('assert').strictEqual(require('./app'), 1);\n");
  fs.writeFileSync(path.join(root, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ schemaVersion: 2, tools: { test: 'node check.js' },
    entries: [{ id: 'CHECK', type: 'structural', command: { file: 'node', args: ['check.js'] }, contract: { exitCode: 0 } }] }));
  return root;
}
// A write the path guard denies wherever the project is: a .crabshell folder in the home
// folder (not this project's, not under the OS temp folder, which the guard allows). The
// hook only judges the command; nothing is written.
const FORBIDDEN_WRITE = 'echo x > ~/.crabshell/memory/note.txt';
const HOOKS = {
  claude: { pre: 'scripts/adapters/claude/pre-tool-use.js', post: 'scripts/adapters/claude/post-tool-use.js', start: 'scripts/load-memory.js' },
  codex: { pre: 'scripts/adapters/codex/pre-tool-use.js', post: 'scripts/adapters/codex/post-tool-use.js', start: 'scripts/adapters/codex/session-start.js' },
};
function hook(host, kind, root, payload) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: host === 'claude' ? root : '', CRABSHELL_BACKGROUND: '' };
  const result = spawnSync(process.execPath, [path.join(plugin, HOOKS[host][kind])], { cwd: root, env, input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const lines = result.stdout.split(/\r?\n/).filter(line => line.trim());
  let output = null;
  if (lines.length === 1) { try { output = JSON.parse(lines[0]); } catch (_) {} }
  return { status: result.status, lines, output, stderr: result.stderr };
}
const shell = (root, command, extra = {}) => ({ session_id: 's', turn_id: 't', cwd: root, tool_use_id: `u${Math.random()}`, tool_name: 'Bash', tool_input: { command }, ...extra });
const denied = run => Boolean(run.output && run.output.hookSpecificOutput && run.output.hookSpecificOutput.permissionDecision === 'deny');

for (const host of ['claude', 'codex']) {
  const root = project(`${host}-project`);
  const first = hook(host, 'pre', root, shell(root, FORBIDDEN_WRITE, { hook_event_name: 'PreToolUse' }));
  test(`${host} PreToolUse: the path guard still denies a write to a .crabshell folder that is not this project's`, () => {
    assert.strictEqual(first.status, 0, first.stderr);
    assert.ok(denied(first), first.lines.join(' | ') || first.stderr.slice(-300));
  });
  test(`${host} PreToolUse: a declared check is not blocked without the runner's judgment, and output is one JSON object or nothing`, () => {
    const run = hook(host, 'pre', root, shell(root, 'node check.js', { hook_event_name: 'PreToolUse' }));
    assert.strictEqual(run.status, 0, run.stderr);
    assert.ok(run.lines.length === 0 || run.output, `stdout: ${run.lines.join(' | ')}`);
    assert.ok(!denied(run), run.lines.join(' | '));
  });
  test(`${host} PostToolUse and SessionStart end with exit 0`, () => {
    const post = hook(host, 'post', root, shell(root, 'node check.js', { hook_event_name: 'PostToolUse', tool_response: host === 'codex' ? 'ok' : { stdout: 'ok', stderr: '', interrupted: false } }));
    assert.strictEqual(post.status, 0, post.stderr);
    assert.ok(post.lines.length === 0 || post.output, `post stdout: ${post.lines.join(' | ')}`);
    const start = hook(host, 'start', root, { hook_event_name: 'SessionStart', source: 'startup', session_id: 's', cwd: root });
    assert.strictEqual(start.status, 0, start.stderr);
    assert.ok(start.output && start.output.hookSpecificOutput, `start stdout: ${start.lines.join(' | ').slice(0, 200)}`);
  });
  test(`${host}: the missing runner is named once`, () => {
    const fresh = project(`${host}-notice`);
    const runs = [1, 2].map(() => hook(host, 'pre', fresh, shell(fresh, 'node check.js', { hook_event_name: 'PreToolUse' })));
    const named = runs.map(run => /runner modules could not be loaded/i.test(run.stderr));
    assert.deepStrictEqual(named, [true, false], runs.map(run => run.stderr.trim().slice(0, 200)).join(' || '));
    // A working runner clears the note, so a later failure is named again.
    const note = path.join(fresh, '.crabshell', 'memory', 'runner-unavailable.json');
    assert.ok(fs.existsSync(note), 'no note after the failure');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: host === 'claude' ? fresh : '', CRABSHELL_BACKGROUND: '' };
    spawnSync(process.execPath, [path.join(REPO, HOOKS[host].pre)], { cwd: fresh, env, encoding: 'utf8', windowsHide: true, timeout: 30000,
      input: JSON.stringify(shell(fresh, 'node check.js', { hook_event_name: 'PreToolUse' })) });
    assert.ok(!fs.existsSync(note), 'the note stayed after the runner loaded');
  });
}

// Evidence without a fingerprint: a recorded pass whose fingerprint is null must not
// survive a file edit as if nothing changed (null === null was a match).
test('a pass recorded without a fingerprint is dropped by the next file edit', () => {
  const root = project('evidence');
  const P = rel => require(path.join(plugin, 'scripts', rel));
  const completion = P('core/completion-control');
  const common = { session_id: 'e', turn_id: 'e1', cwd: root };
  // A workflow is active while the work is authorized and a child claims completion
  // (the same preparation as _test-native-result-evidence.js).
  const regressing = path.join(root, '.crabshell', 'memory', 'regressing-state.json');
  fs.writeFileSync(regressing, JSON.stringify({ active: true, lastUpdatedAt: new Date().toISOString() }));
  completion.noteExecutionAuthorization(root, { ...common, prompt: 'Implement and verify the fixture.' });
  completion.noteSubagentStop(root, { ...common, last_assistant_message: 'Fixture child claim' });
  fs.writeFileSync(regressing, '{}');
  const state = completion.loadState(root, common);
  completion.saveState(root, { ...state, observation: { checkKey: 'node check.js', passed: true, conclusive: true, sourceFingerprint: null, observedAt: new Date().toISOString() } }, common);
  P('completion-controller').handlePayload({ ...common, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: 'w1',
    tool_input: { file_path: path.join(root, 'app.js'), content: 'module.exports = 2;\n' }, tool_response: { filePath: path.join(root, 'app.js') } }, { host: 'claude', projectDir: root });
  assert.strictEqual(completion.loadState(root, common).observation, null, JSON.stringify(completion.loadState(root, common).observation));
});

// With the runner present (the repository itself as the plugin), Codex PreToolUse output
// keeps its shape through the shared check runner: a deny, a notice, or nothing.
test('codex PreToolUse output keeps its shape: deny, notice as additionalContext, or nothing', () => {
  const root = project('codex-shape');
  const run = command => {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: '', CRABSHELL_BACKGROUND: '' };
    const result = spawnSync(process.execPath, [path.join(REPO, HOOKS.codex.pre)], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30000,
      input: JSON.stringify(shell(root, command, { hook_event_name: 'PreToolUse' })) });
    assert.strictEqual(result.status, 0, result.stderr);
    const lines = result.stdout.split(/\r?\n/).filter(line => line.trim());
    return lines.length ? JSON.parse(lines[0]) : null;
  };
  const deny = run(FORBIDDEN_WRITE);
  assert.deepStrictEqual(Object.keys(deny.hookSpecificOutput).sort(), ['hookEventName', 'permissionDecision', 'permissionDecisionReason'], JSON.stringify(deny));
  assert.strictEqual(deny.hookSpecificOutput.permissionDecision, 'deny');
  // An undeclared program in front of a declared check gets a one-line notice.
  const notice = run('xyzwrap node check.js');
  assert.deepStrictEqual(notice && Object.keys(notice), ['hookSpecificOutput'], JSON.stringify(notice));
  assert.deepStrictEqual(Object.keys(notice.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName'], JSON.stringify(notice));
  assert.strictEqual(notice.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(run('echo plain'), null);
});

try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
