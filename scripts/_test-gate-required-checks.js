'use strict';
// D119 P179_T001, updated D143: commits are never blocked. The record keeps declared
// checks as they ran (checkHistory): the project's required checks (manifest tools,
// package.json "test") are recorded as required; a single manifest entry's command still
// counts as a declared check, recorded as not required. Edits are not recorded (D143_T013).
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const root = h.makeWorkRoot('gate-required-checks');
const report = h.createReporter('gate-required-checks');
const fwd = value => value.replace(/\\/g, '/');
const COMMIT = ['git', 'commit', '-m', '"x"'].join(' ');

function project(name, { manifest = true, packageTest = false, tools = true } = {}) {
  const dir = h.makeProject(root, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  for (const file of ['check-full.js', 'check-changed.js', 'check-one.js']) fs.writeFileSync(path.join(dir, file), 'process.exit(0);\n');
  if (manifest) {
    fs.mkdirSync(path.join(dir, '.crabshell', 'verification'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({
      schemaVersion: 2,
      ...(tools ? { tools: { test: 'node check-full.js', changed: 'node check-changed.js' } } : {}),
      entries: [{ id: 'V001', ia: 'one check', type: 'structural', command: { file: 'node', args: ['check-one.js'] }, contract: { exitCode: 0 } }],
    }));
  }
  if (packageTest) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node check-full.js' } }));
  return dir;
}
let seq = 0;
const bashPre = command => ({ hook_event_name: 'PreToolUse', session_id: A, tool_use_id: `b${++seq}`, tool_name: 'Bash', tool_input: { command } });
function edit(dir) {
  h.runHook(root, 'verification-sequence.js', ['record'], { hook_event_name: 'PostToolUse', session_id: A, tool_use_id: `e${++seq}`, tool_name: 'Edit', tool_input: { file_path: fwd(path.join(dir, 'src', 'app.js')), old_string: 'old', new_string: 'new' }, tool_response: {} }, dir);
}
// A declared check as the host reports it: PreToolUse (start) then a successful PostToolUse.
function passCheck(dir, command) {
  const pre = bashPre(command);
  h.runHook(root, 'verification-sequence.js', ['gate'], pre, dir);
  h.runHook(root, 'verification-sequence.js', ['record'], { ...pre, hook_event_name: 'PostToolUse', tool_response: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } }, dir);
}
function commitAllowed(dir) {
  const result = h.runHook(root, 'verification-sequence.js', ['gate'], bashPre(COMMIT), dir);
  return result.status === 0 && !/"decision"\s*:\s*"block"/.test(result.stdout || '');
}
const record = dir => h.readJson(h.memoryPath(dir, 'verification-state.json'));
const lastCheck = dir => { const state = record(dir); return state ? require('./core/check-history').currentCheck(state) : null; };
const show = dir => { const check = lastCheck(dir); return JSON.stringify(check && { command: check.command, passed: check.passed, required: check.required }); };
const passedAs = (dir, command, required) => { const check = lastCheck(dir); return Boolean(check && check.passed === true && check.command === command && check.required === required); };

{
  const dir = project('unchecked');
  edit(dir);
  report.check('G1 a commit after an unchecked source edit is allowed', commitAllowed(dir), String(show(dir)));
}
{
  const dir = project('changed');
  edit(dir);
  passCheck(dir, 'node check-changed.js');
  report.check('G2 the declared changed-files check (tools.changed) is recorded as a passing required check', passedAs(dir, 'node check-changed.js', true), String(show(dir)));
  const before = JSON.stringify(record(dir));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 2;\n');
  edit(dir);
  report.check('G3 a source edit after that check leaves the record as it is (what to rerun is the runner\'s), and the commit is allowed', JSON.stringify(record(dir)) === before && commitAllowed(dir), String(show(dir)));
}
{
  const dir = project('full');
  edit(dir);
  passCheck(dir, 'node check-full.js');
  report.check('G4 the full declared check (tools.test) is recorded as a passing required check', passedAs(dir, 'node check-full.js', true), String(show(dir)));
}
{
  const dir = project('package-test', { manifest: false, packageTest: true });
  edit(dir);
  passCheck(dir, 'npm test');
  // D143_T014: package.json "test" is not a declared check (the manifest declares checks).
  report.check('G5 package.json "test" alone is not a declared check: nothing is recorded', lastCheck(dir) === null, String(show(dir)));
}
{
  const dir = project('evidence');
  const { checkKeyForCommand } = require('./core/command-observation');
  report.check('G6 a manifest entry command is still a declared check (completion evidence)', Boolean(checkKeyForCommand('node check-one.js', dir, dir)));
}
{
  const dir = project('entry-only');
  edit(dir);
  passCheck(dir, 'node check-one.js');
  report.check('G7 a single manifest entry passing is recorded as not required, and the commit is allowed', passedAs(dir, 'node check-one.js', false) && commitAllowed(dir), String(show(dir)));
}
{
  const dir = project('interrupt');
  edit(dir);
  passCheck(dir, 'node check-one.js');
  require('./verification-sequence').interruptVerification(dir, { hook_event_name: 'UserPromptSubmit', session_id: 'bbbbbbbb-2222-4222-8222-222222222222', turn_id: 'tb' });
  report.check('G8 another session\'s interrupt leaves this session\'s single-entry pass recorded as it was', passedAs(dir, 'node check-one.js', false), String(show(dir)));
}
{
  const dir = project('entries-only', { tools: false });
  edit(dir);
  passCheck(dir, 'node check-one.js');
  const shared = require('./verification-sequence').gateVerification(bashPre(COMMIT), dir);
  report.check('G9 the shared gate used by the Codex adapter allows the commit with no reason', shared.exitCode === 0 && !shared.reason, JSON.stringify(shared).slice(0, 200));
}
{
  const dir = project('no-config', { manifest: false });
  edit(dir);
  const result = h.runHook(root, 'verification-sequence.js', ['gate'], bashPre(COMMIT), dir);
  report.check('G10 a project with no declared check: the commit is allowed and no notice is printed', result.status === 0 && !(result.stdout || '').trim(), (result.stdout || '').slice(0, 200));
}

report.finish();
