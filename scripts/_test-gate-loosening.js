'use strict';
// D123 T4 (v21.135.0), updated D143 (no commit blocking) and D143_T014: a declared check
// (manifest `tools`/entries only — no package.json or package-manager table) counts in the
// forms that keep its own exit status — `cd <project> &&` before it, output redirection
// after it, environment assignments before it, a wrapper the manifest declares, and the
// verification runner itself when a manifest exists. Pipes, `;` and `||` stay out: the
// exit status would belong to another command. Another package manager is another command.
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
  if (packageTest) {
    fs.mkdirSync(path.join(dir, '.crabshell', 'verification'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ schemaVersion: 2, tools: { test: 'npm test' }, wrappers: ['rtk'] }));
  }
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
    'rtk npm test', 'CI=1 npm test', "$env:CI='1'; npm test"];
  const missed = accepted.filter(command => !isRequiredCheck(command, dir, dir));
  report.check('F1 accepted forms keep the exit status: cd-prefix, redirects, a declared wrapper, environment assignments', missed.length === 0, missed.join(' | '));
  const rejected = ['npm test | tail -5', 'npm test; echo done', 'npm test || true', `cd ${fwd(path.join(dir, 'other'))} && npm test`, 'echo npm test', 'npm test && git commit -m x', 'pnpm test', 'yarn test', 'bun run test'];
  const let_through = rejected.filter(command => isRequiredCheck(command, dir, dir));
  report.check('F2 forms that hide the exit status or run elsewhere stay unaccepted', let_through.length === 0, let_through.join(' | '));
}
{
  const dir = project('runner', { packageTest: false, manifestEntriesOnly: true });
  // v21.139.0 (D128): routine updates verify only the diff, so the runner's --changed
  // mode unlocks the gate even when the manifest declares no tools.changed.
  report.check('F3 with a manifest and its runner, the runner and its --changed mode are both required checks',
    isRequiredCheck('node .crabshell/verification/run-verify.js', dir, dir)
    && isRequiredCheck('node .crabshell/verification/run-verify.js --changed', dir, dir)
    && !isRequiredCheck('node .crabshell/verification/run-verify.js --changed --flat', dir, dir)
    && findDeclaration('node .crabshell/verification/run-verify.js', dir, dir)?.source === 'tools'
    && findDeclaration('node .crabshell/verification/run-verify.js --changed', dir, dir)?.source === 'tools');
}

// Through the hooks: edit, commit blocked, a loosened form passes, commit allowed;
// a piped run leaves it blocked and the reason names the accepted forms.
let seq = 0;
const bashPre = command => ({ hook_event_name: 'PreToolUse', session_id: A, tool_use_id: `b${++seq}`, tool_name: 'Bash', tool_input: { command } });
function edit(dir, value) {
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), `module.exports = ${value};\n`);
  h.runHook(root, 'verification-sequence.js', ['record'], { hook_event_name: 'PostToolUse', session_id: A, tool_use_id: `e${++seq}`, tool_name: 'Edit', tool_input: { file_path: fwd(path.join(dir, 'src', 'app.js')), old_string: 'old', new_string: 'new' }, tool_response: {} }, dir);
}
function runCheck(dir, command) {
  const pre = bashPre(command);
  h.runHook(root, 'verification-sequence.js', ['gate'], pre, dir);
  h.runHook(root, 'verification-sequence.js', ['record'], { ...pre, hook_event_name: 'PostToolUse', tool_response: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } }, dir);
}
// D143: commits are never blocked; the accepted forms still decide which runs count as a
// declared check in the record (checkHistory — edits are not recorded since D143_T013).
const commit = dir => h.runHook(root, 'verification-sequence.js', ['gate'], bashPre(['git', 'commit', '-m', '"x"'].join(' ')), dir);
const lastCheck = dir => { const state = h.readJson(h.memoryPath(dir, 'verification-state.json')); return state ? require('./core/check-history').currentCheck(state) : null; };
const passedWith = (dir, command) => { const check = lastCheck(dir); return Boolean(check && check.passed === true && check.command === command); };
{
  const dir = project('flow');
  edit(dir, 2);
  const before = commit(dir);
  runCheck(dir, 'rtk npm test');
  const after = commit(dir);
  report.check('H1 a commit after an unchecked edit is not blocked, and `rtk npm test` counts as a passing check',
    before.status === 0 && !/block/.test(before.stdout || '') && after.status === 0 && passedWith(dir, 'rtk npm test'), `${before.status}/${after.status}/${JSON.stringify(lastCheck(dir))}`);
  edit(dir, 3);
  const redirected = `cd ${fwd(dir)} && npm test > out.txt 2>&1`;
  runCheck(dir, redirected);
  report.check('H2 a cd-prefixed, redirected run counts too', passedWith(dir, redirected));
  edit(dir, 4);
  runCheck(dir, 'npm test | tail -5');
  const piped = commit(dir);
  report.check('H3 a piped run does not count as a check (the last check stays the redirected run), and the commit is still not blocked',
    passedWith(dir, redirected) && piped.status === 0, `${JSON.stringify(lastCheck(dir))}/${piped.status}`);
}
{
  // A project whose manifest has only entries: the commit is not blocked either.
  const dir = project('runner-flow', { packageTest: false, manifestEntriesOnly: true });
  edit(dir, 2);
  const unchecked = commit(dir);
  report.check('H4 an entries-only manifest does not block a commit after an unchecked edit', unchecked.status === 0 && !/block/.test(unchecked.stdout || ''), (unchecked.stdout || '').slice(0, 200));
  runCheck(dir, 'node .crabshell/verification/run-verify.js --changed');
  report.check('H5 a passing `run-verify.js --changed` run counts as a passing check', passedWith(dir, 'node .crabshell/verification/run-verify.js --changed'), JSON.stringify(lastCheck(dir)));
}

report.finish();
