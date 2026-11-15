'use strict';
// D175_T001: the runner's command matcher (skills/verifying/scripts/runner/command-match.js)
// finds a declared command inside composed shell lines — pipes, redirections, PowerShell
// call operator and statements, folder changes, environment activation — that the
// completion-evidence matcher leaves unread, and compares path tokens relative to each
// side's worktree root. Pure unit test: no file is written.

const assert = require('assert');
const os = require('os');
const path = require('path');

// programName reads PATHEXT at call time; give every platform the Windows list so the
// `python.exe` case does not depend on where the test runs.
const savedPathext = process.env.PATHEXT;
if (!savedPathext) process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';

const { programName, programMatches, shellSegments, matchesCommand } = require('../skills/verifying/scripts/runner/command-match');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}

// Folders are only strings: nothing here is created on disk.
const MAIN = path.resolve(os.tmpdir(), 'zeta-main');
const WORKTREE = path.resolve(os.tmpdir(), 'zeta-worktree');
const inside = (dir, root) => {
  const relative = path.relative(root, dir);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};
const rootOf = dir => [MAIN, WORKTREE].find(root => inside(dir, root)) || dir;
const PROBE = { file: 'python', args: ['-B', 'tools/zeta_probe.py'] };
const segmentsIn = (command, cwd = MAIN, options) => shellSegments(command, cwd, options);
const anyMatch = (declared, command, { cwd = MAIN, declaredCwd = MAIN, whenArgs, wrappers } = {}) =>
  segmentsIn(command, cwd, { wrappers }).some(segment => matchesCommand(declared, segment, { declaredCwd, rootOf, whenArgs }));
const samePath = (a, b) => assert.strictEqual(path.resolve(a).toLowerCase(), path.resolve(b).toLowerCase());

// --- The five shapes checkInvocation leaves unread ---

test('a pipe into another program still runs the declared command', () => {
  assert.ok(anyMatch(PROBE, 'python -B tools/zeta_probe.py | tail -5'));
});

test('PowerShell all-stream redirection and its file are not arguments', () => {
  const [segment] = segmentsIn('python -B tools/zeta_probe.py *> zeta.log');
  assert.deepStrictEqual(segment.tokens, ['python', '-B', 'tools/zeta_probe.py']);
  assert.ok(matchesCommand(PROBE, segment, { declaredCwd: MAIN, rootOf }));
});

test('PowerShell call operator with a quoted program path', () => {
  const segments = segmentsIn('& "C:/Python/python.exe" -B tools/zeta_probe.py');
  assert.strictEqual(segments.length, 1);
  assert.strictEqual(segments[0].tokens[0], 'C:/Python/python.exe');
  assert.ok(matchesCommand(PROBE, segments[0], { declaredCwd: MAIN, rootOf }));
});

test('Set-Location before the command moves its folder', () => {
  const segments = segmentsIn('Set-Location sub; python -B tools/zeta_probe.py');
  assert.strictEqual(segments.length, 1, 'the folder change is not returned');
  samePath(segments[0].cwd, path.join(MAIN, 'sub'));
  assert.ok(matchesCommand(PROBE, segments[0], { declaredCwd: path.join(MAIN, 'sub'), rootOf }), 'declared in sub');
  assert.ok(!matchesCommand(PROBE, segments[0], { declaredCwd: MAIN, rootOf }), 'declared at the root names another file');
});

test('activating an environment before the command', () => {
  const segments = segmentsIn('source venv/bin/activate && python -B tools/zeta_probe.py');
  assert.deepStrictEqual(segments.map(segment => segment.tokens[0]), ['source', 'python']);
  assert.ok(anyMatch(PROBE, 'source venv/bin/activate && python -B tools/zeta_probe.py'));
});

// --- Folders ---

test('cd before && resolves the folder the command runs in', () => {
  const [segment] = segmentsIn('cd sub && node zeta_check.js');
  samePath(segment.cwd, path.join(MAIN, 'sub'));
  assert.ok(matchesCommand({ file: 'node', args: ['sub/zeta_check.js'] }, segment, { declaredCwd: MAIN, rootOf }));
  assert.ok(!matchesCommand({ file: 'node', args: ['zeta_check.js'] }, segment, { declaredCwd: MAIN, rootOf }));
});

test('pushd/popd and a parenthesized group restore the folder', () => {
  const pushed = segmentsIn('pushd sub && node a.js && popd && node b.js');
  samePath(pushed[0].cwd, path.join(MAIN, 'sub'));
  samePath(pushed[1].cwd, MAIN);
  const grouped = segmentsIn('(cd sub && node a.js); node b.js');
  samePath(grouped[0].cwd, path.join(MAIN, 'sub'));
  samePath(grouped[1].cwd, MAIN);
});

test('Set-Location -Path and cd -- take the operand, not the flag', () => {
  samePath(segmentsIn("Set-Location -Path 'zeta dir'; node x.js")[0].cwd, path.join(MAIN, 'zeta dir'));
  samePath(segmentsIn('cd -- sub && node x.js')[0].cwd, path.join(MAIN, 'sub'));
});

// --- Splitting ---

test('quoted ; and | are not split', () => {
  const segments = segmentsIn('python -B tools/zeta_probe.py --label "a;b|c" && echo \'x | y; z\'');
  assert.strictEqual(segments.length, 2);
  assert.deepStrictEqual(segments[0].tokens, ['python', '-B', 'tools/zeta_probe.py', '--label', 'a;b|c']);
  assert.deepStrictEqual(segments[1].tokens, ['echo', 'x | y; z']);
});

test('a declared command named inside a quoted string does not run', () => {
  assert.ok(!anyMatch(PROBE, "echo 'python -B tools/zeta_probe.py; done'"));
});

test('||, newline and a background & each end a command', () => {
  const segments = segmentsIn('node a.js || node b.js\nnode c.js & node d.js');
  assert.deepStrictEqual(segments.map(segment => segment.tokens[1]), ['a.js', 'b.js', 'c.js', 'd.js']);
});

test('redirections in every form are dropped with their files', () => {
  for (const command of [
    'python -B tools/zeta_probe.py > zeta.out 2>&1',
    'python -B tools/zeta_probe.py 2>zeta.err',
    'python -B tools/zeta_probe.py >>zeta.log',
    'python -B tools/zeta_probe.py < zeta.in',
    'python -B tools/zeta_probe.py 2>$null',
    'python -B tools/zeta_probe.py &> zeta.all',
  ]) {
    assert.deepStrictEqual(segmentsIn(command)[0].tokens, ['python', '-B', 'tools/zeta_probe.py'], command);
  }
});

test('a heredoc body is data, not a command', () => {
  const segments = segmentsIn('cat <<ZETA\npython -B tools/zeta_probe.py\nZETA\nnode after.js');
  assert.deepStrictEqual(segments.map(segment => segment.tokens[0]), ['cat', 'node']);
});

test('line continuations join one command', () => {
  assert.ok(anyMatch(PROBE, 'python -B \\\n  tools/zeta_probe.py'));
  assert.ok(anyMatch(PROBE, 'python -B `\r\n  tools/zeta_probe.py'));
});

// --- Matching ---

test('different flags (-u -B) still match', () => {
  assert.ok(anyMatch(PROBE, 'python -u tools/zeta_probe.py'));
  assert.ok(anyMatch(PROBE, 'python -u -X dev tools/zeta_probe.py --quick'));
});

test('a different script, or the declared tokens out of order, does not match', () => {
  assert.ok(!anyMatch(PROBE, 'python -B tools/zeta_other.py'));
  const pair = { file: 'zeta-tool', args: ['first.qzx', 'second.qzx'] };
  assert.ok(anyMatch(pair, 'zeta-tool first.qzx --between second.qzx'));
  assert.ok(!anyMatch(pair, 'zeta-tool second.qzx first.qzx'));
});

test('a declared file glob matches python3; a plain name does not', () => {
  assert.ok(anyMatch({ file: 'python*', args: ['tools/zeta_probe.py'] }, 'python3 tools/zeta_probe.py'));
  assert.ok(!anyMatch({ file: 'python', args: ['tools/zeta_probe.py'] }, 'python3 tools/zeta_probe.py'));
  assert.ok(!anyMatch({ file: 'python*', args: ['tools/zeta_probe.py'] }, 'node tools/zeta_probe.py'));
  assert.ok(programMatches('zeta?', 'zetaq') && !programMatches('zeta?', 'zeta'));
});

test('two worktrees match by the same path relative to each root', () => {
  assert.ok(anyMatch(PROBE, 'python -B tools/zeta_probe.py', { cwd: WORKTREE, declaredCwd: MAIN }));
  assert.ok(anyMatch(PROBE, `python -B "${path.join(WORKTREE, 'tools', 'zeta_probe.py')}"`, { cwd: WORKTREE, declaredCwd: MAIN }), 'absolute inside the root');
  assert.ok(!anyMatch(PROBE, `python -B "${path.join(os.tmpdir(), 'zeta-elsewhere', 'tools', 'zeta_probe.py')}"`, { cwd: WORKTREE, declaredCwd: MAIN }), 'absolute outside the root');
  assert.ok(!anyMatch(PROBE, 'python -B tools/zeta_probe.py', { cwd: WORKTREE, declaredCwd: path.join(MAIN, 'sub') }), 'another folder of the root');
});

test('an extension the code never names counts as a path', () => {
  assert.ok(anyMatch({ file: 'zeta-run', args: ['sub/case.qzx'] }, 'cd sub && zeta-run case.qzx'));
});

test('whenArgs: every listed token must be among the arguments', () => {
  const recorder = { file: 'node', args: ['tools/zeta_record.js'] };
  assert.ok(anyMatch(recorder, 'node tools/zeta_record.js --capture --slow', { whenArgs: ['--capture'] }));
  assert.ok(!anyMatch(recorder, 'node tools/zeta_record.js --slow', { whenArgs: ['--capture'] }));
  assert.ok(!anyMatch(recorder, 'node tools/zeta_record.js --capture', { whenArgs: ['--capture', '--slow'] }));
});

test('Windows backslash paths match forward-slash declarations and back', () => {
  assert.ok(anyMatch(PROBE, 'python -B tools\\zeta_probe.py'));
  assert.ok(anyMatch({ file: 'python', args: ['tools\\zeta_probe.py'] }, 'python -B tools/zeta_probe.py'));
  assert.ok(anyMatch({ file: 'node', args: ['sub/inner/zeta_check.js'] }, 'cd sub\\inner && node zeta_check.js'));
});

// --- Environment ---

test('POSIX assignments before a command land in its env and leave its tokens', () => {
  const segments = segmentsIn('CRABSHELL_OVERLAP=1 ZETA_MODE="two words" python -B tools/zeta_probe.py; node later.js');
  assert.deepStrictEqual(segments[0].env, { CRABSHELL_OVERLAP: '1', ZETA_MODE: 'two words' });
  assert.strictEqual(segments[0].tokens[0], 'python');
  assert.deepStrictEqual(segments[1].env, {}, 'one command\'s assignments do not reach the next');
  assert.strictEqual(segmentsIn('"ZETA=1" node x.js')[0].tokens[0], 'ZETA=1', 'a quoted name is not an assignment');
});

test('PowerShell $env: statements set the env of later commands', () => {
  for (const command of ["$env:CRABSHELL_OVERLAP='1'; python -B tools/zeta_probe.py", '$env:CRABSHELL_OVERLAP = "1"; python -B tools/zeta_probe.py']) {
    const segments = segmentsIn(command);
    assert.strictEqual(segments.length, 1, command);
    assert.strictEqual(segments[0].env.CRABSHELL_OVERLAP, '1', command);
    assert.ok(matchesCommand(PROBE, segments[0], { declaredCwd: MAIN, rootOf }), command);
  }
  const both = segmentsIn("$env:ZETA_FLAG = 'on'; node a.js; node b.js");
  assert.deepStrictEqual(both.map(segment => segment.env.ZETA_FLAG), ['on', 'on']);
});

// --- Wrappers ---

test('a declared wrapper is taken off; an undeclared one stays the program', () => {
  assert.ok(anyMatch(PROBE, 'zeta-wrap python -B tools/zeta_probe.py', { wrappers: [['zeta-wrap']] }));
  assert.ok(anyMatch(PROBE, 'zeta-wrap --quiet python -B tools/zeta_probe.py', { wrappers: ['zeta-wrap --quiet'] }));
  assert.ok(!anyMatch(PROBE, 'zeta-wrap python -B tools/zeta_probe.py'));
});

// --- programName and bad input ---

test('programName keeps the shared rule: file name, PATHEXT extension off, case-folded on Windows', () => {
  assert.strictEqual(programName('C:\\Zeta\\python.exe'), 'python');
  assert.strictEqual(programName('/opt/Zeta.EXE'), process.platform === 'win32' ? 'zeta' : 'Zeta');
  assert.strictEqual(programName('/opt/zeta/run.qzx'), 'run.qzx');
  assert.strictEqual(programName(undefined), '');
});

test('the hooks and the runner name programs by one rule', () => {
  const hooks = require('./core/command-observation').programName;
  for (const token of ['C:\\Zeta\\python.exe', '/opt/Zeta.EXE', '/opt/zeta/run.qzx', 'node', 'tools/zeta_probe.py', 'C:/zeta/Godot_v9.9-stable_win64_console.exe']) {
    assert.strictEqual(programName(token), hooks(token), token);
  }
});

test('a declaration of flags only is known by its flags', () => {
  const declared = { file: 'node', args: ['--test'] };
  assert.strictEqual(matchesCommand(declared, segmentsIn('node --test')[0], { declaredCwd: MAIN }), true);
  assert.strictEqual(matchesCommand(declared, segmentsIn('node --test --reporter dot')[0], { declaredCwd: MAIN }), true);
  assert.strictEqual(matchesCommand(declared, segmentsIn('node tools/zeta_probe.js')[0], { declaredCwd: MAIN }), false);
  assert.strictEqual(matchesCommand(declared, segmentsIn('node .crabshell/verification/run-verify.js')[0], { declaredCwd: MAIN }), false);
});

test('a declaration that names no path matches only in its own folder', () => {
  const declared = { file: 'npm', args: ['run', 'zeta-suite'] };
  assert.strictEqual(matchesCommand(declared, segmentsIn('npm run zeta-suite')[0], { declaredCwd: MAIN }), true);
  assert.strictEqual(matchesCommand(declared, segmentsIn('cd other && npm run zeta-suite')[0], { declaredCwd: MAIN }), false);
  assert.strictEqual(matchesCommand(declared, segmentsIn('npm run zeta-suite', path.join(MAIN, 'other'))[0], { declaredCwd: MAIN }), false);
});

test('bad input gives empty or false results, never a throw', () => {
  assert.deepStrictEqual(shellSegments(null, MAIN), []);
  assert.deepStrictEqual(shellSegments('node x.js', undefined, null).map(segment => segment.tokens), [['node', 'x.js']]);
  assert.deepStrictEqual(shellSegments('"unterminated', MAIN).map(segment => segment.tokens), [['unterminated']]);
  assert.strictEqual(matchesCommand(null, null), false);
  assert.strictEqual(matchesCommand(PROBE, { tokens: [42] }), false);
  assert.strictEqual(matchesCommand({ file: 'python', args: [7] }, segmentsIn('python 7')[0]), false);
  assert.strictEqual(matchesCommand(PROBE, segmentsIn('python -B tools/zeta_probe.py')[0], { rootOf: () => { throw new Error('zeta'); } }), true, 'a failing rootOf falls back to the folder');
  assert.strictEqual(matchesCommand(PROBE, segmentsIn('python -B tools/zeta_probe.py')[0], { whenArgs: 'x' }), false);
});

if (savedPathext === undefined) delete process.env.PATHEXT;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
