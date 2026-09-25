'use strict';
// D123 T4 (v21.135.0): the commit gate accepts a declared check in the forms that
// keep its own exit status — `cd <project> &&` before it, output redirection after
// it, the `rtk` pass-through wrapper, pnpm/yarn/bun for package.json "test", and the
// verification runner itself when a manifest exists. Pipes, `;` and `||` stay out:
// the exit status would belong to another command.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const root = h.makeWorkRoot('gate-loosening');
const report = h.createReporter('gate-loosening');
const fwd = value => value.replace(/\\/g, '/');
const { findDeclaration, isRequiredCheck } = require('./core/command-observation');

function project(name, { packageTest = true, manifestEntriesOnly = false } = {}) {
  const dir = h.makeProject(root, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'check-full.js'), 'process.exit(0);\n');
  if (packageTest) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node check-full.js' } }));
  if (manifestEntriesOnly) {
    fs.mkdirSync(path.join(dir, '.crabshell', 'verification'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ schemaVersion: 2,
      entries: [{ id: 'V001', ia: 'one check', type: 'structural', command: { file: 'node', args: ['check-full.js'] }, contract: { exitCode: 0 } }] }));
    fs.writeFileSync(path.join(dir, '.crabshell', 'verification', 'run-verify.js'), 'process.exit(0);\n');
  }
  return dir;
}

{
  const dir = project('forms');
  const accepted = [`cd ${fwd(dir)} && npm test`, `cd "${fwd(dir)}" && npm test`, 'npm test > out.txt', 'npm test 2>&1', 'npm test > out.txt 2>&1',
    'rtk npm test', 'pnpm test', 'yarn test', 'bun run test'];
  const missed = accepted.filter(command => !isRequiredCheck(command, dir, dir));
  report.check('F1 accepted forms keep the exit status: cd-prefix, redirects, rtk, pnpm/yarn/bun', missed.length === 0, missed.join(' | '));
  const rejected = ['npm test | tail -5', 'npm test; echo done', 'npm test || true', `cd ${fwd(path.join(dir, 'other'))} && npm test`, 'echo npm test', 'npm test && git commit -m x'];
  const let_through = rejected.filter(command => isRequiredCheck(command, dir, dir));
  report.check('F2 forms that hide the exit status or run elsewhere stay unaccepted', let_through.length === 0, let_through.join(' | '));
}
{
  const dir = project('runner', { packageTest: false, manifestEntriesOnly: true });
  report.check('F3 with a manifest and its runner, the runner is the full check; --changed is not',
    isRequiredCheck('node .crabshell/verification/run-verify.js', dir, dir)
    && !isRequiredCheck('node .crabshell/verification/run-verify.js --changed', dir, dir)
    && findDeclaration('node .crabshell/verification/run-verify.js', dir, dir)?.source === 'tools');
}

// Through the hooks: edit, commit blocked, a loosened form passes, commit allowed;
// a piped run leaves it blocked and the reason names the accepted forms.
let seq = 0;
const bashPre = command => ({ hook_event_name: 'PreToolUse', session_id: A, tool_use_id: `b${++seq}`, tool_name: 'Bash', tool_input: { command } });
function edit(dir, value) {
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), `module.exports = ${value};\n`);
  h.runHook(root, 'verification-sequence.js', ['record'], { hook_event_name: 'PostToolUse', session_id: A, tool_use_id: `e${++seq}`, tool_name: 'Edit', tool_input: { file_path: fwd(path.join(dir, 'src', 'app.js')) }, tool_response: {} }, dir);
}
function runCheck(dir, command) {
  const pre = bashPre(command);
  h.runHook(root, 'verification-sequence.js', ['gate'], pre, dir);
  h.runHook(root, 'verification-sequence.js', ['record'], { ...pre, hook_event_name: 'PostToolUse', tool_response: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } }, dir);
}
const commit = dir => h.runHook(root, 'verification-sequence.js', ['gate'], bashPre('git commit -m "x"'), dir);
{
  const dir = project('flow');
  edit(dir, 2);
  const before = commit(dir);
  runCheck(dir, 'rtk npm test');
  const after = commit(dir);
  report.check('H1 edit → commit blocked → `rtk npm test` passes → commit allowed', before.status === 2 && after.status === 0, `${before.status}/${after.status}`);
  edit(dir, 3);
  runCheck(dir, `cd ${fwd(dir)} && npm test > out.txt 2>&1`);
  report.check('H2 a cd-prefixed, redirected run unlocks too', commit(dir).status === 0);
  edit(dir, 4);
  runCheck(dir, 'npm test | tail -5');
  const piped = commit(dir);
  const reason = (piped.stdout || '') + (piped.stderr || '');
  report.check('H3 after a piped run the commit stays blocked, and the reason names the command and the accepted forms',
    piped.status === 2 && /npm test/.test(reason) && /cd <dir> &&/.test(reason) && /pipes/.test(reason), reason.slice(0, 300));
}

report.finish();
