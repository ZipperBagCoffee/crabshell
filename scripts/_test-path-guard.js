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

// expect: true = block (exit 2), false = allow silently, 'advise' = allow and tell the
// model (hookSpecificOutput.additionalContext) that the path is not this project's.
function runTest(name, hookData, expect) {
  runTestWithDir(name, hookData, expect, projectDir);
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
    const advised = /"additionalContext"/.test(result);
    if (expectBlock === true) {
      console.log(`FAIL: ${name} — expected block but got allow. stdout: ${result}`);
      failed++;
    } else if ((expectBlock === 'advise') !== advised) {
      console.log(`FAIL: ${name} — expected ${expectBlock === 'advise' ? 'an advisory' : 'no advisory'}. stdout: ${result}`);
      failed++;
    } else {
      console.log(`PASS: ${name} — allowed (exit 0${advised ? ', advisory' : ''})`);
      passed++;
    }
  } catch (e) {
    if (e.status === 2 && expectBlock === true) {
      console.log(`PASS: ${name} — blocked (exit 2)`);
      passed++;
    } else if (e.status === 2) {
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

runTest('Read: wrong forward slash path (read — allow + advisory)',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/YesPresident/.crabshell/memory/file.md' } },
  'advise'
);

runTest('Read: correct forward slash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/logbook.md' } },
  false
);

runTest('Read: wrong backslash path (read — allow + advisory)',
  { tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\chulg\\Documents\\YesPresident\\.crabshell\\memory\\file.md' } },
  'advise'
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

runTest('Grep: wrong path (read — allow + advisory)',
  { tool_name: 'Grep', tool_input: { path: 'C:/Users/chulg/Documents/YesPresident/.crabshell/memory/', pattern: 'test' } },
  'advise'
);

runTest('Grep: correct path',
  { tool_name: 'Grep', tool_input: { path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/', pattern: 'test' } },
  false
);

console.log('\n--- Subprocess: Glob tests ---');

runTest('Glob: wrong path (read — allow + advisory)',
  { tool_name: 'Glob', tool_input: { path: 'C:/Users/chulg/Documents/YesPresident/.crabshell/memory/', pattern: '*.md' } },
  'advise'
);

runTest('Glob: correct project path (allow)',
  { tool_name: 'Glob', tool_input: { path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/', pattern: '*.md' } },
  false
);

console.log('\n--- Subprocess: Bash tests ---');

runTest('Bash: cat of wrong path (read — allow + advisory)',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/YesPresident/.crabshell/memory/delta_temp.txt' } },
  'advise'
);

runTest('Bash: correct path in command',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/delta_temp.txt' } },
  false
);

runTest('Bash: cat of correct+wrong paths (reads — allow + advisory)',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/YesPresident/.crabshell/memory/file.md && cat C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/logbook.md' } },
  'advise'
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

runTest('Read: parent traversal resolving to wrong project (read — allow + advisory)',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/../YesPresident/.crabshell/memory/file.md' } },
  'advise'
);

console.log('\n--- Subprocess: Quoted paths with spaces ---');

runTest('Bash: cat of quoted path with spaces (read — allow + advisory)',
  { tool_name: 'Bash', tool_input: { command: 'cat "C:/Users/some user/Documents/YesPresident/.crabshell/memory/file.md"' } },
  'advise'
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

runTestWithDir('Bash: cat of double-quoted path with spaces (wrong project read — allow + advisory)',
  { tool_name: 'Bash', tool_input: { command: 'cat "D:/Other Project/.crabshell/memory/file.md"' } },
  'advise',
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

console.log('\n--- Subprocess: writes to a wrong .crabshell stay blocked (P178_T002) ---');

const WRONG = 'C:/Users/chulg/Documents/YesPresident/.crabshell/memory/file.md';
const RIGHT = 'C:/Users/chulg/Documents/memory-keeper-plugin/.crabshell/memory/logbook.md';
runTest('Bash write: redirect to wrong path (block)', { tool_name: 'Bash', tool_input: { command: `echo x >> ${WRONG}` } }, true);
runTest('Bash write: tee to wrong path (block)', { tool_name: 'Bash', tool_input: { command: `echo x | tee -a ${WRONG}` } }, true);
runTest('Bash write: rm of wrong path (block)', { tool_name: 'Bash', tool_input: { command: `rm -f ${WRONG}` } }, true);
runTest('Bash write: sed -i on wrong path (block)', { tool_name: 'Bash', tool_input: { command: `sed -i s/a/b/ ${WRONG}` } }, true);
runTest('Bash write: cp from this project to wrong path (destination — block)', { tool_name: 'Bash', tool_input: { command: `cp ${RIGHT} ${WRONG}` } }, true);
runTest('Bash read: cp from wrong path into this project (source read — allow + advisory)', { tool_name: 'Bash', tool_input: { command: `cp ${WRONG} ${RIGHT}.copy` } }, 'advise');
runTest('Bash write: redirect to quoted path with spaces (block)', { tool_name: 'Bash', tool_input: { command: 'echo x > "C:/Users/some user/Documents/YesPresident/.crabshell/memory/file.md"' } }, true);
runTest('Bash write: touch through parent traversal to wrong project (block)', { tool_name: 'Bash', tool_input: { command: 'touch C:/Users/chulg/Documents/memory-keeper-plugin/../YesPresident/.crabshell/memory/file.md' } }, true);
runTest('Bash write: mkdir under $HOME/.crabshell (block)', { tool_name: 'Bash', tool_input: { command: 'mkdir -p $HOME/.crabshell/memory/' } }, true);
runTest('Bash write: rm under ${HOME}/.crabshell (braces — block)', { tool_name: 'Bash', tool_input: { command: 'rm ${HOME}/.crabshell/memory/logbook.md' } }, true);
runTest('Bash write: redirect under ~/.crabshell (block)', { tool_name: 'Bash', tool_input: { command: 'echo x > ~/.crabshell/memory/something' } }, true);
runTest('Bash write: node -e writeFileSync to wrong path (block)', { tool_name: 'Bash', tool_input: { command: `node -e "require('fs').writeFileSync('${WRONG}', 'x')"` } }, true);
runTest('Bash read: node -e readFileSync of wrong path (allow + advisory)', { tool_name: 'Bash', tool_input: { command: `node -e "console.log(require('fs').readFileSync('${WRONG}', 'utf8'))"` } }, 'advise');
runTest('Bash write: bash -c with redirect to wrong path (block)', { tool_name: 'Bash', tool_input: { command: `bash -c "echo x > ${WRONG}"` } }, true);
runTest('Bash write: python heredoc writing wrong path (block)', { tool_name: 'Bash', tool_input: { command: `python - <<'PY'\nopen('${WRONG}', 'w').write('x')\nPY` } }, true);
runTest('Bash text: cat heredoc body naming wrong path (data, not a target — allow)', { tool_name: 'Bash', tool_input: { command: `cat > notes.txt <<'EOF'\nrm ${WRONG}\nEOF` } }, false);
runTest('Bash text: comment naming wrong path (allow)', { tool_name: 'Bash', tool_input: { command: `ls # then rm ${WRONG}` } }, false);
runTest('Bash write: lower-case drive letter of this project is the same folder (allow)', { tool_name: 'Bash', tool_input: { command: 'echo x >> c:/users/chulg/documents/memory-keeper-plugin/.crabshell/memory/logbook.md' } }, process.platform === 'win32' ? false : true);

console.log('\n--- Unit: Bash write analysis (P178_T002 independent review cases) ---');
{
  const { evaluatePathPolicy } = require('./core/path-policy');
  const P = projectDir.replace(/\\/g, '/');
  const D = '.crab' + 'shell';
  const OC = `${P.replace(/\/[^/]+$/, '')}/OtherProj/${D}`;
  const TMP = os.tmpdir().replace(/\\/g, '/');
  const verdict = r => !r ? 'allow' : r.reason ? 'block' : 'advise';
  const cases = [
    // Writes the first parser missed (the pre-cycle guard blocked every mention).
    ['whole folder removed without a trailing slash', 'block', `rm -rf ${OC}`],
    ['whole folder moved', 'block', `mv ${OC} ${OC}.bak`],
    ['glob delete', 'block', `rm -rf ${OC}/memory/*`],
    ['brace-expansion delete', 'block', `rm ${OC}/memory/{a,b}.md`],
    ['cp destination with 2>/dev/null', 'block', `cp a.md ${OC}/memory/a.md 2>/dev/null`],
    ['cp destination with 2>&1 | tail', 'block', `cp a.md ${OC}/memory/a.md 2>&1 | tail -1`],
    ['cp -t destination folder', 'block', `cp -t ${OC}/memory/ a.md`],
    ['>& redirect to a file', 'block', `echo x >& ${OC}/memory/f`],
    ['find | xargs rm', 'block', `find ${OC}/memory -name "*.bak" | xargs rm -f`],
    ['node execSync rm', 'block', `node -e "require('child_process').execSync('rm -rf ${OC}/memory')"`],
    ['python subprocess rm list', 'block', `python -c "import subprocess; subprocess.run(['rm','-rf','${OC}/memory'])"`],
    ['python os.system rm', 'block', `python -c "import os; os.system('rm -rf ${OC}/memory')"`],
    ['cat heredoc piped into node', 'block', `cat <<'EOF' | node\nrequire('fs').writeFileSync('${OC}/memory/x','y')\nEOF`],
    ['tar extract into the folder', 'block', `tar -xf mem.tar -C ${OC}/memory`],
    ['curl -o into the folder', 'block', `curl -sSo ${OC}/memory/x.json https://example.com/x.json`],
    ['powershell Remove-Item', 'block', `powershell -Command "Remove-Item -Recurse ${OC}/memory"`],
    ['cmd rmdir with backslashes', 'block', `cmd //c "rmdir /s /q ${OC.replace(/\//g, '\\')}\\memory"`],
    ['$(rm ...) inside double quotes', 'block', `echo "removed: $(rm -v ${OC}/memory/x.md)"`],
    ['variable assigned in the same command', 'block', `T=${OC.replace('/' + D, '')}; rm -rf $T/${D}/memory`],
    ['for-loop items removed', 'block', `for f in ${OC}/memory/a.md ${OC}/memory/b.md; do rm "$f"; done`],
    ['bash heredoc with backslash delimiter', 'block', `bash <<\\EOF\nrm -rf ${OC}/memory\nEOF`],
    ['here-string code for node', 'block', `node <<< "require('fs').writeFileSync('${OC}/memory/x','y')"`],
    ['nested bash -c', 'block', `bash -c "bash -c 'rm -rf ${OC}/memory/x'"`],
    // Harmless commands the guard must not block.
    ['node write through CLAUDE_PROJECT_DIR + literal', 'allow', `node -e "require('fs').writeFileSync(process.env.CLAUDE_PROJECT_DIR + '/${D}/memory/x.json','{}')"`],
    ['sed -i script naming the folder', 'allow', `sed -i 's/\\.crabshell\\//X/' README.md`],
    ['perl -pi script naming the folder', 'allow', `perl -pi -e 's/old\\/${D}\\/memory/new/' notes.md`],
    ['dd of= this project', 'allow', `dd if=/dev/zero of=${P}/${D}/tmp/zero bs=1 count=1`],
    ['node reads another project, writes here', 'advise', `node -e "const fs=require('fs');fs.writeFileSync('copy.md', fs.readFileSync('${OC}/memory/logbook.md','utf8'))"`],
    ['python shutil.copy from another project', 'advise', `python -c "import shutil; shutil.copy('${OC}/memory/logbook.md','copy.md')"`],
    ['python open with encoding=ascii (read)', 'advise', `python -c "print(open('${OC}/memory/logbook.md', encoding='ascii').read())"`],
    ['find -exec grep (read)', 'advise', `find ${OC}/memory -name "*.md" -exec grep -l foo {} +`],
    ['ln -s pointing at another project (read)', 'advise', `ln -s ${OC}/memory ./other-mem`],
    ['this project written with doubled backslashes in code', 'allow', `node -e "require('fs').appendFileSync('${P.replace(/\//g, '\\\\\\\\')}\\\\\\\\${D}\\\\\\\\memory\\\\\\\\x.md','y')"`],
    ['relative fixture folder inside the project', 'allow', `mkdir -p test/fixtures/${D}/memory`],
    ['OS temp folder', 'allow', `echo x > ${TMP}/fx/${D}/memory/logbook.md`],
    ['commit message heredoc naming a path', 'allow', `git commit -m "$(cat <<'EOF'\nfix: rm ${OC}/memory no longer blocked\nEOF\n)"`],
    ['grep pattern with an escaped dot', 'allow', `grep -rn "\\${D}/" scripts`],
  ];
  if (process.platform === 'win32') {
    cases.push(['upper-case folder name on Windows', 'block', `rm -rf ${OC.replace(D, '.CRABSHELL')}/memory`]);
    cases.push(['Git Bash /tmp path', 'allow', `mkdir -p /tmp/fixture/${D}/memory`]);
    cases.push(['Git Bash /c/ form of this project', 'allow', `echo x >> /${P[0].toLowerCase()}${P.slice(2)}/${D}/memory/logbook.md`]);
  }
  for (const [name, expected, command] of cases) {
    unitTest(`Bash analysis: ${name} → ${expected}`, () => {
      const observed = verdict(evaluatePathPolicy({ tool_name: 'Bash', tool_input: { command } }, P));
      assertEq(observed, expected, command.slice(0, 120));
    });
  }
  unitTest('Bash analysis: a 200KB command is judged in under a second', () => {
    const big = 'node -e "' + `'${OC}/x';` + 'open('.repeat(40000) + '"';
    const started = Date.now();
    evaluatePathPolicy({ tool_name: 'Bash', tool_input: { command: big } }, P);
    assert(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  });
}

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
runTest('Shell: ls $HOME/.crabshell/memory/ (homedir read — allow + advisory)',
  { tool_name: 'Bash', tool_input: { command: 'ls $HOME/.crabshell/memory/' } },
  'advise'
);

runTest('Shell: cat ${HOME}/.crabshell/memory/ (braces, homedir read — allow + advisory)',
  { tool_name: 'Bash', tool_input: { command: 'cat ${HOME}/.crabshell/memory/logbook.md' } },
  'advise'
);

// ~ resolves to home dir → block (not project dir)
runTest('Shell: cat ~/.crabshell/memory/ (tilde, homedir read — allow + advisory)',
  { tool_name: 'Bash', tool_input: { command: 'cat ~/.crabshell/memory/something' } },
  'advise'
);

// $PROJECT_DIR resolves to project dir → allow
runTest('Shell: $PROJECT_DIR/.crabshell/memory/ (alias for project dir — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $PROJECT_DIR/.crabshell/memory/' } },
  false
);

// $USERPROFILE resolves to home dir → block
runTest('Shell: Read $USERPROFILE/.crabshell/memory/ (homedir read — allow + advisory)',
  { tool_name: 'Read', tool_input: { file_path: '$USERPROFILE/.crabshell/memory/logbook.md' } },
  'advise'
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

runTest('Shell: $RANDOM_VAR/.crabshell/memory/ (unknown var cannot be judged — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $RANDOM_VAR/.crabshell/memory/' } },
  false
);

runTest('Shell: $FOO/.crabshell/memory/ (unknown var cannot be judged — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat $FOO/.crabshell/memory/file.md' } },
  false
);

runTest('Shell: ${UNKNOWN_DIR}/.crabshell/memory/ (unknown braces var cannot be judged — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls ${UNKNOWN_DIR}/.crabshell/memory/' } },
  false
);

runTest('Shell: $UNKNOWN_VAR/.crabshell/memory/ via Read (unknown var cannot be judged — allow)',
  { tool_name: 'Read', tool_input: { file_path: '$UNKNOWN_VAR/.crabshell/memory/' } },
  false
);

console.log('\n--- Subprocess: Mixed paths with variables ---');

runTest('Shell: cat $HOME/../other/.crabshell/ (traversal after resolve, read — allow + advisory)',
  { tool_name: 'Bash', tool_input: { command: 'cat $HOME/../other/.crabshell/memory/file.md' } },
  'advise'
);

runTest('Shell: Read $CLAUDE_PROJECT_DIR/.crabshell/ (allow)',
  { tool_name: 'Read', tool_input: { file_path: '$CLAUDE_PROJECT_DIR/.crabshell/memory/logbook.md' } },
  false
);

runTest('Shell: Read ${CLAUDE_PROJECT_DIR}/.crabshell/ (brace syntax — allow)',
  { tool_name: 'Read', tool_input: { file_path: '${CLAUDE_PROJECT_DIR}/.crabshell/memory/logbook.md' } },
  false
);

runTest('Shell: Read $HOME/.crabshell/ (wrong dir read — allow + advisory)',
  { tool_name: 'Read', tool_input: { file_path: '$HOME/.crabshell/memory/logbook.md' } },
  'advise'
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
runTest('Shell: Read $(pwd)/.crabshell/memory/ (subshell cannot be judged — allow)',
  { tool_name: 'Read', tool_input: { file_path: '$(pwd)/.crabshell/memory/logbook.md' } },
  false
);

// Bash with subshell prefix + visible .crabshell/
runTest('Shell: Bash $(pwd)/.crabshell/memory/ (subshell cannot be judged — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat $(pwd)/.crabshell/memory/logbook.md' } },
  false
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
