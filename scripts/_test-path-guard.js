// Comprehensive path-guard.js test suite
// Tests: subprocess (original + shell variable resolution), unit (exports)
const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const scriptPath = path.join(__dirname, 'path-guard.js');
const nodePath = process.execPath;
const projectDir = 'C:\\Users\\chulg\\Documents\\memory-keeper-plugin';
const homeDir = os.homedir().replace(/\\/g, '/');

let passed = 0;
let failed = 0;

function runTest(name, hookData, expectBlock) {
  const json = JSON.stringify(hookData);
  try {
    const result = execSync(
      `"${nodePath}" "${scriptPath}"`,
      {
        input: json,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        timeout: 5000,
        encoding: 'utf8'
      }
    );
    if (expectBlock) {
      console.log(`FAIL: ${name} — expected block but got allow. stdout: ${result}`);
      failed++;
    } else {
      console.log(`PASS: ${name} — allowed (exit 0)`);
      passed++;
    }
  } catch (e) {
    if (e.status === 2 && expectBlock) {
      console.log(`PASS: ${name} — blocked (exit 2)`);
      passed++;
    } else if (e.status === 2 && !expectBlock) {
      console.log(`FAIL: ${name} — expected allow but got block. stdout: ${e.stdout}`);
      failed++;
    } else {
      console.log(`FAIL: ${name} — unexpected exit ${e.status}`);
      failed++;
    }
  }
}

function runTestWithDir(name, hookData, expectBlock, customProjectDir) {
  const json = JSON.stringify(hookData);
  try {
    const result = execSync(
      `"${nodePath}" "${scriptPath}"`,
      {
        input: json,
        env: { ...process.env, CLAUDE_PROJECT_DIR: customProjectDir },
        timeout: 5000,
        encoding: 'utf8'
      }
    );
    if (expectBlock) {
      console.log(`FAIL: ${name} — expected block but got allow. stdout: ${result}`);
      failed++;
    } else {
      console.log(`PASS: ${name} — allowed (exit 0)`);
      passed++;
    }
  } catch (e) {
    if (e.status === 2 && expectBlock) {
      console.log(`PASS: ${name} — blocked (exit 2)`);
      passed++;
    } else if (e.status === 2 && !expectBlock) {
      console.log(`FAIL: ${name} — expected allow but got block. stdout: ${e.stdout}`);
      failed++;
    } else {
      console.log(`FAIL: ${name} — unexpected exit ${e.status}`);
      failed++;
    }
  }
}

function unitTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ============================================================
// SECTION 1: Subprocess tests (original)
// ============================================================

console.log('\n--- Subprocess: Read tests ---');

runTest('Read: wrong forward slash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/YesPresident/.crabshell/memory/file.md' } },
  true
);

runTest('Read: correct forward slash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/logbook.md' } },
  false
);

runTest('Read: wrong backslash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\chulg\\Documents\\YesPresident\\.crabshell\\memory\\file.md' } },
  true
);

runTest('Read: correct backslash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\chulg\\Documents\\memory-keeper-plugin\\.crabshell\\memory\\file.md' } },
  false
);

runTest('Read: relative path',
  { tool_name: 'Read', tool_input: { file_path: '.crabshell/memory/logbook.md' } },
  false
);

runTest('Read: non-memory path',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/README.md' } },
  false
);

console.log('\n--- Subprocess: Grep tests ---');

runTest('Grep: wrong path',
  { tool_name: 'Grep', tool_input: { path: 'C:/Users/chulg/Documents/YesPresident/.crabshell/memory/', pattern: 'test' } },
  true
);

runTest('Grep: correct path',
  { tool_name: 'Grep', tool_input: { path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/', pattern: 'test' } },
  false
);

console.log('\n--- Subprocess: Glob tests ---');

runTest('Glob: wrong path',
  { tool_name: 'Glob', tool_input: { path: 'C:/Users/chulg/Documents/YesPresident/.crabshell/memory/', pattern: '*.md' } },
  true
);

runTest('Glob: correct project path (allow)',
  { tool_name: 'Glob', tool_input: { path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/', pattern: '*.md' } },
  false
);

console.log('\n--- Subprocess: Bash tests ---');

runTest('Bash: wrong path in command',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/YesPresident/.crabshell/memory/delta_temp.txt' } },
  true
);

runTest('Bash: correct path in command',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/delta_temp.txt' } },
  false
);

runTest('Bash: mixed correct+wrong paths',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/YesPresident/.crabshell/memory/file.md && cat C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/logbook.md' } },
  true
);

runTest('Bash: no memory path',
  { tool_name: 'Bash', tool_input: { command: 'ls -la /tmp' } },
  false
);

console.log('\n--- Subprocess: Edge cases ---');

runTest('Empty input',
  {},
  false
);

runTest('Unknown tool',
  { tool_name: 'Write', tool_input: { file_path: 'C:/Users/chulg/Documents/YesPresident/.crabshell/memory/file.md' } },
  false
);

runTest('No tool_input',
  { tool_name: 'Read' },
  false
);

console.log('\n--- Subprocess: Parent traversal ---');

runTest('Read: parent traversal resolving to correct project (allow)',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/scripts/../.crabshell/memory/logbook.md' } },
  false
);

runTest('Read: parent traversal resolving to wrong project (block)',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/../YesPresident/.crabshell/memory/file.md' } },
  true
);

console.log('\n--- Subprocess: Quoted paths with spaces ---');

runTest('Bash: quoted path with spaces (block)',
  { tool_name: 'Bash', tool_input: { command: 'cat "C:/Users/some user/Documents/YesPresident/.crabshell/memory/file.md"' } },
  true
);

runTest('Bash: echo mentioning .crabshell/memory/ in quoted string (allow)',
  { tool_name: 'Bash', tool_input: { command: 'echo "Files are in .crabshell/memory/ directory"' } },
  false
);

runTestWithDir('Bash: double-quoted path with spaces (correct project — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat "D:/Public Analysis/.crabshell/memory/file.md"' } },
  false,
  'D:/Public Analysis'
);

runTestWithDir('Bash: double-quoted path with spaces (wrong project — block)',
  { tool_name: 'Bash', tool_input: { command: 'cat "D:/Other Project/.crabshell/memory/file.md"' } },
  true,
  'D:/Public Analysis'
);

runTestWithDir('Bash: single-quoted path with spaces (correct project — allow)',
  { tool_name: 'Bash', tool_input: { command: "cat 'D:/Public Analysis/.crabshell/memory/file.md'" } },
  false,
  'D:/Public Analysis'
);

runTestWithDir('Bash: backslash quoted path with spaces (correct project — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat "D:\\Public Analysis\\.crabshell\\memory\\file.md"' } },
  false,
  'D:/Public Analysis'
);

// ============================================================
// SECTION 2: Subprocess tests — Shell variable resolution (v21.8.0)
// ============================================================

console.log('\n--- Subprocess: Known variable resolution ---');

// $CLAUDE_PROJECT_DIR resolves to the actual project dir → correct project → allow
runTest('Shell: $CLAUDE_PROJECT_DIR/.crabshell/memory/ (resolves to project — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $CLAUDE_PROJECT_DIR/.crabshell/memory/' } },
  false
);

runTest('Shell: ${CLAUDE_PROJECT_DIR}/.crabshell/memory/ (braces — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat ${CLAUDE_PROJECT_DIR}/.crabshell/memory/file.md' } },
  false
);

// $HOME resolves to home dir, which is NOT the project dir → wrong path → block
runTest('Shell: $HOME/.crabshell/memory/ (resolves to homedir, not project — block)',
  { tool_name: 'Bash', tool_input: { command: 'ls $HOME/.crabshell/memory/' } },
  true
);

runTest('Shell: ${HOME}/.crabshell/memory/ (braces, resolves to homedir — block)',
  { tool_name: 'Bash', tool_input: { command: 'cat ${HOME}/.crabshell/memory/logbook.md' } },
  true
);

// ~ resolves to home dir → block (not project dir)
runTest('Shell: ~/.crabshell/memory/ (tilde resolves to homedir — block)',
  { tool_name: 'Bash', tool_input: { command: 'cat ~/.crabshell/memory/something' } },
  true
);

// $PROJECT_DIR resolves to project dir → allow
runTest('Shell: $PROJECT_DIR/.crabshell/memory/ (alias for project dir — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $PROJECT_DIR/.crabshell/memory/' } },
  false
);

// $USERPROFILE resolves to home dir → block
runTest('Shell: $USERPROFILE/.crabshell/memory/ (resolves to homedir — block)',
  { tool_name: 'Read', tool_input: { file_path: '$USERPROFILE/.crabshell/memory/logbook.md' } },
  true
);

// When project dir IS home dir, $HOME should allow
runTestWithDir('Shell: $HOME/.crabshell/ when projectDir=homedir (allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $HOME/.crabshell/memory/' } },
  false,
  homeDir
);

runTestWithDir('Shell: ~/.crabshell/ when projectDir=homedir (allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat ~/.crabshell/memory/logbook.md' } },
  false,
  homeDir
);

console.log('\n--- Subprocess: Unknown variable blocking ---');

runTest('Shell: $RANDOM_VAR/.crabshell/memory/ (unknown var — block)',
  { tool_name: 'Bash', tool_input: { command: 'ls $RANDOM_VAR/.crabshell/memory/' } },
  true
);

runTest('Shell: $FOO/.crabshell/memory/ (unknown var — block)',
  { tool_name: 'Bash', tool_input: { command: 'cat $FOO/.crabshell/memory/file.md' } },
  true
);

runTest('Shell: ${UNKNOWN_DIR}/.crabshell/memory/ (unknown braces var — block)',
  { tool_name: 'Bash', tool_input: { command: 'ls ${UNKNOWN_DIR}/.crabshell/memory/' } },
  true
);

runTest('Shell: $UNKNOWN_VAR/.crabshell/memory/ via Read (block)',
  { tool_name: 'Read', tool_input: { file_path: '$UNKNOWN_VAR/.crabshell/memory/' } },
  true
);

console.log('\n--- Subprocess: Mixed paths with variables ---');

runTest('Shell: $HOME/../other/.crabshell/ (traversal after resolve — block)',
  { tool_name: 'Bash', tool_input: { command: 'cat $HOME/../other/.crabshell/memory/file.md' } },
  true
);

runTest('Shell: Read $CLAUDE_PROJECT_DIR/.crabshell/ (allow)',
  { tool_name: 'Read', tool_input: { file_path: '$CLAUDE_PROJECT_DIR/.crabshell/memory/logbook.md' } },
  false
);

runTest('Shell: Read ${CLAUDE_PROJECT_DIR}/.crabshell/ (brace syntax — allow)',
  { tool_name: 'Read', tool_input: { file_path: '${CLAUDE_PROJECT_DIR}/.crabshell/memory/logbook.md' } },
  false
);

runTest('Shell: Read $HOME/.crabshell/ (resolves to wrong dir — block)',
  { tool_name: 'Read', tool_input: { file_path: '$HOME/.crabshell/memory/logbook.md' } },
  true
);

console.log('\n--- Subprocess: Non-.crabshell/ paths with vars (should NOT be affected) ---');

runTest('Shell: $HOME/some/regular/path (no .crabshell — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $HOME/some/regular/path' } },
  false
);

runTest('Shell: $RANDOM_VAR/other/dir (no .crabshell — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $RANDOM_VAR/other/dir' } },
  false
);

runTest('Shell: ~/documents/file.txt (no .crabshell — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat ~/documents/file.txt' } },
  false
);

runTest('Shell: Read $HOME/regular-file.txt (not .crabshell — allow)',
  { tool_name: 'Read', tool_input: { file_path: '$HOME/regular-file.txt' } },
  false
);

console.log('\n--- Subprocess: Backtick/subshell patterns ---');

// When .crabshell is INSIDE the subshell (no literal .crabshell/ in text), regex can't detect it → allow
// This is a known limitation of static analysis — the guard can't parse shell expansion
runTest('Shell: $(echo .crabshell)/memory/ (subshell hides .crabshell — not detectable, allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat $(echo .crabshell)/memory/logbook.md' } },
  false
);

runTest('Shell: `echo .crabshell`/memory/ (backtick hides .crabshell — not detectable, allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat `echo .crabshell`/memory/logbook.md' } },
  false
);

// When .crabshell/ IS visible in the path (subshell is the prefix), the guard CAN detect+block
runTest('Shell: Read $(pwd)/.crabshell/memory/ (subshell prefix, .crabshell/ visible — block)',
  { tool_name: 'Read', tool_input: { file_path: '$(pwd)/.crabshell/memory/logbook.md' } },
  true
);

// Bash with subshell prefix + visible .crabshell/
runTest('Shell: Bash $(pwd)/.crabshell/memory/ (subshell prefix, .crabshell/ visible — block)',
  { tool_name: 'Bash', tool_input: { command: 'cat $(pwd)/.crabshell/memory/logbook.md' } },
  true
);

// ============================================================
// SECTION 3: Unit tests — exported functions (v21.8.0)
// ============================================================

const {
  checkPath, hasShellVariable, resolveShellVariables, hasUnresolvedVariables,
  resolveDotsInPath, extractMemoryPathsFromCommand
} = require('./path-guard');

console.log('\n--- Unit: hasShellVariable ---');

unitTest('hasShellVariable: $HOME/path', () => {
  assert(hasShellVariable('$HOME/.crabshell/memory/'), '$HOME should match');
});

unitTest('hasShellVariable: ~/path', () => {
  assert(hasShellVariable('~/.crabshell/memory/'), '~ should match');
});

unitTest('hasShellVariable: ~ alone', () => {
  assert(hasShellVariable('~'), '~ alone should match');
});

unitTest('hasShellVariable: ${VAR}/path', () => {
  assert(hasShellVariable('${HOME}/.crabshell/'), '${} should match');
});

unitTest('hasShellVariable: $(cmd)', () => {
  assert(hasShellVariable('$(pwd)/.crabshell/'), '$() should match');
});

unitTest('hasShellVariable: backtick', () => {
  assert(hasShellVariable('`pwd`/.crabshell/'), 'backtick should match');
});

unitTest('hasShellVariable: mid-path $VAR', () => {
  assert(hasShellVariable('/some/$VAR/.crabshell/'), '/$ should match');
});

unitTest('hasShellVariable: plain path (no match)', () => {
  assert(!hasShellVariable('/some/plain/path'), 'plain path should not match');
});

unitTest('hasShellVariable: .crabshell relative (no match)', () => {
  assert(!hasShellVariable('.crabshell/memory/'), 'relative .crabshell should not match');
});

unitTest('hasShellVariable: Windows absolute (no match)', () => {
  assert(!hasShellVariable('C:/Users/foo/.crabshell/'), 'Windows path should not match');
});

console.log('\n--- Unit: resolveShellVariables ---');

const testProjectDir = 'C:/Users/chulg/Documents/memory-keeper-plugin';

unitTest('resolveShellVariables: $CLAUDE_PROJECT_DIR', () => {
  const result = resolveShellVariables('$CLAUDE_PROJECT_DIR/.crabshell/memory/', testProjectDir);
  assertEq(result, testProjectDir + '/.crabshell/memory/');
});

unitTest('resolveShellVariables: ${CLAUDE_PROJECT_DIR}', () => {
  const result = resolveShellVariables('${CLAUDE_PROJECT_DIR}/.crabshell/memory/', testProjectDir);
  assertEq(result, testProjectDir + '/.crabshell/memory/');
});

unitTest('resolveShellVariables: $HOME', () => {
  const result = resolveShellVariables('$HOME/.crabshell/memory/', testProjectDir);
  assertEq(result, homeDir + '/.crabshell/memory/');
});

unitTest('resolveShellVariables: ${HOME}', () => {
  const result = resolveShellVariables('${HOME}/.crabshell/memory/', testProjectDir);
  assertEq(result, homeDir + '/.crabshell/memory/');
});

unitTest('resolveShellVariables: ~', () => {
  const result = resolveShellVariables('~/.crabshell/memory/', testProjectDir);
  assertEq(result, homeDir + '/.crabshell/memory/');
});

unitTest('resolveShellVariables: ~ alone', () => {
  const result = resolveShellVariables('~', testProjectDir);
  assertEq(result, homeDir);
});

unitTest('resolveShellVariables: $PROJECT_DIR', () => {
  const result = resolveShellVariables('$PROJECT_DIR/.crabshell/', testProjectDir);
  assertEq(result, testProjectDir + '/.crabshell/');
});

unitTest('resolveShellVariables: $USERPROFILE', () => {
  const result = resolveShellVariables('$USERPROFILE/.crabshell/', testProjectDir);
  assertEq(result, homeDir + '/.crabshell/');
});

unitTest('resolveShellVariables: unknown var left as-is', () => {
  const result = resolveShellVariables('$RANDOM_VAR/.crabshell/', testProjectDir);
  assertEq(result, '$RANDOM_VAR/.crabshell/');
});

unitTest('resolveShellVariables: mixed known+unknown', () => {
  const result = resolveShellVariables('$CLAUDE_PROJECT_DIR/$FOO/.crabshell/', testProjectDir);
  assert(result.includes('$FOO'), 'unknown var should remain');
  assert(result.startsWith(testProjectDir), 'known var should resolve');
});

unitTest('resolveShellVariables: no vars (passthrough)', () => {
  const result = resolveShellVariables('/some/plain/path', testProjectDir);
  assertEq(result, '/some/plain/path');
});

unitTest('resolveShellVariables: ~ not in middle of path', () => {
  const result = resolveShellVariables('/path/with~inside', testProjectDir);
  assertEq(result, '/path/with~inside', 'tilde in middle should not resolve');
});

console.log('\n--- Unit: hasUnresolvedVariables ---');

unitTest('hasUnresolvedVariables: $FOO', () => {
  assert(hasUnresolvedVariables('$FOO/.crabshell/'), '$FOO is unresolved');
});

unitTest('hasUnresolvedVariables: ${UNKNOWN}', () => {
  assert(hasUnresolvedVariables('${UNKNOWN}/.crabshell/'), '${UNKNOWN} is unresolved');
});

unitTest('hasUnresolvedVariables: $(cmd)', () => {
  assert(hasUnresolvedVariables('$(pwd)/.crabshell/'), '$(cmd) is unresolved');
});

unitTest('hasUnresolvedVariables: backtick', () => {
  assert(hasUnresolvedVariables('`pwd`/.crabshell/'), 'backtick is unresolved');
});

unitTest('hasUnresolvedVariables: clean path (no)', () => {
  assert(!hasUnresolvedVariables('/some/clean/path'), 'clean path has no vars');
});

unitTest('hasUnresolvedVariables: resolved home (no)', () => {
  assert(!hasUnresolvedVariables(homeDir + '/.crabshell/'), 'resolved path has no vars');
});

unitTest('hasUnresolvedVariables: $_ single char var', () => {
  assert(hasUnresolvedVariables('$_VAR/.crabshell/'), '$_ is a valid var start');
});

console.log('\n--- Unit: checkPath with shell variables ---');

unitTest('checkPath: $CLAUDE_PROJECT_DIR/.crabshell/ (valid)', () => {
  const r = checkPath('$CLAUDE_PROJECT_DIR/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === true, 'should be valid — resolves to correct project');
});

unitTest('checkPath: ${CLAUDE_PROJECT_DIR}/.crabshell/ (valid)', () => {
  const r = checkPath('${CLAUDE_PROJECT_DIR}/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === true, 'should be valid');
});

unitTest('checkPath: $HOME/.crabshell/ (invalid — wrong dir)', () => {
  const r = checkPath('$HOME/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === false, 'should be invalid — home != project');
});

unitTest('checkPath: $HOME/.crabshell/ when projectDir=homedir (valid)', () => {
  const r = checkPath('$HOME/.crabshell/memory/', homeDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === true, 'should be valid — home == project');
});

unitTest('checkPath: ~/.crabshell/ (invalid — wrong dir)', () => {
  const r = checkPath('~/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === false, 'should be invalid — home != project');
});

unitTest('checkPath: ~/.crabshell/ when projectDir=homedir (valid)', () => {
  const r = checkPath('~/.crabshell/memory/', homeDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === true, 'should be valid — home == project');
});

unitTest('checkPath: $RANDOM_VAR/.crabshell/ (block — unknown var)', () => {
  const r = checkPath('$RANDOM_VAR/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === false, 'should block — unresolved var');
});

unitTest('checkPath: $FOO/.crabshell/ (block — unknown var)', () => {
  const r = checkPath('$FOO/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === false, 'should block — unresolved var');
});

unitTest('checkPath: $(echo x)/.crabshell/ (block — subshell)', () => {
  const r = checkPath('$(echo x)/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === false, 'should block — subshell unresolvable');
});

unitTest('checkPath: `pwd`/.crabshell/ (block — backtick)', () => {
  const r = checkPath('`pwd`/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === false, 'should block — backtick unresolvable');
});

unitTest('checkPath: non-.crabshell path with $VAR (not targeted)', () => {
  const r = checkPath('$HOME/documents/file.txt', testProjectDir);
  assert(r.targets === false, 'should not target — no .crabshell');
  assert(r.valid === true, 'should be valid (irrelevant)');
});

unitTest('checkPath: $HOME/../other/.crabshell/ (block — traversal after resolve)', () => {
  const r = checkPath('$HOME/../other/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === false, 'should block — resolved path is wrong project');
});

unitTest('checkPath: plain correct path (no vars)', () => {
  const r = checkPath(testProjectDir + '/.crabshell/memory/logbook.md', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === true, 'should be valid');
});

unitTest('checkPath: plain wrong path (no vars)', () => {
  const r = checkPath('C:/Other/Project/.crabshell/memory/', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === false, 'should be invalid');
});

unitTest('checkPath: relative .crabshell/ (valid)', () => {
  const r = checkPath('.crabshell/memory/logbook.md', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === true, 'should be valid — relative path allowed');
});

unitTest('checkPath: ./.crabshell/ (valid)', () => {
  const r = checkPath('./.crabshell/memory/logbook.md', testProjectDir);
  assert(r.targets === true, 'should target');
  assert(r.valid === true, 'should be valid — relative path allowed');
});

console.log('\n--- Unit: resolveDotsInPath ---');

unitTest('resolveDotsInPath: simple ..', () => {
  assertEq(resolveDotsInPath('a/b/../c'), 'a/c');
});

unitTest('resolveDotsInPath: simple .', () => {
  assertEq(resolveDotsInPath('a/./b'), 'a/b');
});

unitTest('resolveDotsInPath: multiple ..', () => {
  assertEq(resolveDotsInPath('a/b/c/../../d'), 'a/d');
});

unitTest('resolveDotsInPath: .. at start', () => {
  assertEq(resolveDotsInPath('../a'), 'a');
});

unitTest('resolveDotsInPath: no dots', () => {
  assertEq(resolveDotsInPath('a/b/c'), 'a/b/c');
});

console.log('\n--- Unit: extractMemoryPathsFromCommand ---');

unitTest('extractMemoryPathsFromCommand: simple unquoted', () => {
  const r = extractMemoryPathsFromCommand('cat /project/.crabshell/memory/file.md');
  assert(r.some(p => p.includes('.crabshell')), 'should find .crabshell path');
});

unitTest('extractMemoryPathsFromCommand: double-quoted', () => {
  const r = extractMemoryPathsFromCommand('cat "D:/My Project/.crabshell/memory/file.md"');
  assert(r.some(p => p.includes('.crabshell')), 'should find .crabshell in quotes');
});

unitTest('extractMemoryPathsFromCommand: no .crabshell', () => {
  const r = extractMemoryPathsFromCommand('ls -la /tmp');
  assertEq(r.length, 0, 'no .crabshell paths');
});

unitTest('extractMemoryPathsFromCommand: $VAR path', () => {
  const r = extractMemoryPathsFromCommand('cat $HOME/.crabshell/memory/logbook.md');
  assert(r.some(p => p.includes('.crabshell')), 'should find $VAR/.crabshell path');
});

unitTest('extractMemoryPathsFromCommand: multiple paths', () => {
  const r = extractMemoryPathsFromCommand('cat /a/.crabshell/x && cat /b/.crabshell/y');
  assert(r.length >= 2, 'should find multiple .crabshell paths');
});

console.log('\n--- Unit: module.exports structure ---');

unitTest('path-guard exports checkPath', () => {
  assert(typeof checkPath === 'function');
});

unitTest('path-guard exports hasShellVariable', () => {
  assert(typeof hasShellVariable === 'function');
});

unitTest('path-guard exports resolveShellVariables', () => {
  assert(typeof resolveShellVariables === 'function');
});

unitTest('path-guard exports hasUnresolvedVariables', () => {
  assert(typeof hasUnresolvedVariables === 'function');
});

unitTest('path-guard exports resolveDotsInPath', () => {
  assert(typeof resolveDotsInPath === 'function');
});

unitTest('path-guard exports extractMemoryPathsFromCommand', () => {
  assert(typeof extractMemoryPathsFromCommand === 'function');
});

// ============================================================
// SECTION 4: skill-active.json block tests (v21.38.0)
// ============================================================

console.log('\n--- Subprocess: skill-active.json block ---');

runTest('Write: skill-active.json (block)',
  { tool_name: 'Write', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/skill-active.json', content: '{}' } },
  true
);

runTest('Edit: skill-active.json (block)',
  { tool_name: 'Edit', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/skill-active.json', old_string: '{}', new_string: '{"active":true}' } },
  true
);

runTest('Write: other json file (allow)',
  { tool_name: 'Write', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/memory-index.json', content: '{}' } },
  false
);

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
if (failed > 0) {
  process.exit(1);
}
