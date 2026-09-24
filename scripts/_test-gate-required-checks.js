'use strict';
// D119 P179_T001: only the project's required checks (manifest tools, package.json
// "test") unlock the commit gate. A single manifest entry's command still counts as
// a declared check for completion evidence, but passing it does not unlock a commit.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const root = h.makeWorkRoot('gate-required-checks');
const report = h.createReporter('gate-required-checks');
const fwd = value => value.replace(/\\/g, '/');

function project(name, { manifest = true, packageTest = false } = {}) {
  const dir = h.makeProject(root, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  for (const file of ['check-full.js', 'check-changed.js', 'check-one.js']) fs.writeFileSync(path.join(dir, file), 'process.exit(0);\n');
  if (manifest) {
    fs.mkdirSync(path.join(dir, '.crabshell', 'verification'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({
      schemaVersion: 2,
      tools: { test: 'node check-full.js', changed: 'node check-changed.js' },
      entries: [{ id: 'V001', ia: 'one check', type: 'structural', command: { file: 'node', args: ['check-one.js'] }, contract: { exitCode: 0 } }],
    }));
  }
  if (packageTest) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node check-full.js' } }));
  return dir;
}
let seq = 0;
const bashPre = command => ({ hook_event_name: 'PreToolUse', session_id: A, tool_use_id: `b${++seq}`, tool_name: 'Bash', tool_input: { command } });
function edit(dir) {
  h.runHook(root, 'verification-sequence.js', ['record'], { hook_event_name: 'PostToolUse', session_id: A, tool_use_id: `e${++seq}`, tool_name: 'Edit', tool_input: { file_path: fwd(path.join(dir, 'src', 'app.js')) }, tool_response: {} }, dir);
}
// A declared check as the host reports it: PreToolUse (start) then a successful PostToolUse.
function passCheck(dir, command) {
  const pre = bashPre(command);
  h.runHook(root, 'verification-sequence.js', ['gate'], pre, dir);
  h.runHook(root, 'verification-sequence.js', ['record'], { ...pre, hook_event_name: 'PostToolUse', tool_response: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } }, dir);
}
function commitBlocked(dir) {
  const result = h.runHook(root, 'verification-sequence.js', ['gate'], bashPre('git commit -m "x"'), dir);
  return result.status === 2;
}

{
  const dir = project('entry-only');
  edit(dir);
  passCheck(dir, 'node check-one.js');
  report.check('G1 a single manifest entry passing does not unlock the commit gate', commitBlocked(dir), JSON.stringify(h.readJson(h.memoryPath(dir, 'verification-state.json'))).slice(0, 160));
}
{
  const dir = project('changed');
  edit(dir);
  passCheck(dir, 'node check-changed.js');
  report.check('G2 the declared changed-files check (tools.changed) unlocks the commit gate', !commitBlocked(dir));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 2;\n');
  edit(dir);
  report.check('G3 a source edit after that check locks the gate again', commitBlocked(dir));
}
{
  const dir = project('full');
  edit(dir);
  passCheck(dir, 'node check-full.js');
  report.check('G4 control: the full declared check (tools.test) unlocks the commit gate', !commitBlocked(dir));
}
{
  const dir = project('package-test', { manifest: false, packageTest: true });
  edit(dir);
  passCheck(dir, 'npm test');
  report.check('G5 control: package.json "test" unlocks the gate in a project without a manifest', !commitBlocked(dir));
}
// G7/G8 (independent review, P179): an interrupt in another session must not turn a
// single-entry pass into a verified tree, and running an entry after a required
// pass must not re-lock an unchanged tree.
{
  const dir = project('interrupt');
  edit(dir);
  passCheck(dir, 'node check-one.js');
  require('./verification-sequence').interruptVerification(dir, { hook_event_name: 'UserPromptSubmit', session_id: 'bbbbbbbb-2222-4222-8222-222222222222', turn_id: 'tb' });
  report.check('G7 another session\'s interrupt does not unlock a tree that only passed a single entry', commitBlocked(dir), JSON.stringify(h.readJson(h.memoryPath(dir, 'verification-state.json'))).slice(0, 140));
}
{
  const dir = project('entry-after-required');
  edit(dir);
  passCheck(dir, 'node check-full.js');
  passCheck(dir, 'node check-one.js');
  report.check('G8 running a single entry after a required pass does not re-lock an unchanged tree', !commitBlocked(dir), JSON.stringify(h.readJson(h.memoryPath(dir, 'verification-state.json'))).slice(0, 140));
}
{
  const dir = project('evidence');
  const { checkKeyForCommand } = require('./core/command-observation');
  report.check('G6 control: a manifest entry command is still a declared check (completion evidence)', Boolean(checkKeyForCommand('node check-one.js', dir, dir)));
}

report.finish();
