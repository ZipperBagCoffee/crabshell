// Comprehensive path-guard.js test
const { execSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'path-guard.js');
const nodePath = process.execPath;
const projectDir = 'C:\\Users\\chulg\\Documents\\memory-keeper-plugin';

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
    } else {
      console.log(`PASS: ${name} — allowed (exit 0)`);
    }
  } catch (e) {
    if (e.status === 2 && expectBlock) {
      console.log(`PASS: ${name} — blocked (exit 2)`);
    } else if (e.status === 2 && !expectBlock) {
      console.log(`FAIL: ${name} — expected allow but got block. stdout: ${e.stdout}`);
    } else {
      console.log(`FAIL: ${name} — unexpected exit ${e.status}`);
    }
  }
}

// --- Read tests ---
runTest('Read: wrong forward slash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/YesPresident/.claude/memory/file.md' } },
  true
);

runTest('Read: correct forward slash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.claude/memory/memory.md' } },
  false
);

runTest('Read: wrong backslash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\chulg\\Documents\\YesPresident\\.claude\\memory\\file.md' } },
  true
);

runTest('Read: correct backslash path',
  { tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\chulg\\Documents\\memory-keeper-plugin\\.claude\\memory\\file.md' } },
  false
);

runTest('Read: relative path',
  { tool_name: 'Read', tool_input: { file_path: '.claude/memory/memory.md' } },
  false
);

runTest('Read: non-memory path',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/README.md' } },
  false
);

// --- Grep tests ---
runTest('Grep: wrong path',
  { tool_name: 'Grep', tool_input: { path: 'C:/Users/chulg/Documents/YesPresident/.claude/memory/', pattern: 'test' } },
  true
);

runTest('Grep: correct path',
  { tool_name: 'Grep', tool_input: { path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.claude/memory/', pattern: 'test' } },
  false
);

// --- Glob tests ---
runTest('Glob: wrong path',
  { tool_name: 'Glob', tool_input: { path: 'C:/Users/chulg/Documents/YesPresident/.claude/memory/', pattern: '*.md' } },
  true
);

// --- Bash tests ---
runTest('Bash: wrong path in command',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/YesPresident/.claude/memory/delta_temp.txt' } },
  true
);

runTest('Bash: correct path in command',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/memory-keeper-plugin/.claude/memory/delta_temp.txt' } },
  false
);

runTest('Bash: mixed correct+wrong paths',
  { tool_name: 'Bash', tool_input: { command: 'cat C:/Users/chulg/Documents/YesPresident/.claude/memory/file.md && cat C:/Users/chulg/Documents/memory-keeper-plugin/.claude/memory/memory.md' } },
  true
);

runTest('Bash: no memory path',
  { tool_name: 'Bash', tool_input: { command: 'ls -la /tmp' } },
  false
);

// --- Edge cases ---
runTest('Empty input',
  {},
  false
);

runTest('Unknown tool',
  { tool_name: 'Write', tool_input: { file_path: 'C:/Users/chulg/Documents/YesPresident/.claude/memory/file.md' } },
  false
);

runTest('No tool_input',
  { tool_name: 'Read' },
  false
);

// --- Cycle 2 edge cases: shell variables and .. traversal ---

runTest('Bash: $HOME/.claude/memory/ (shell var — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $HOME/.claude/memory/' } },
  false
);

runTest('Bash: ~/ .claude/memory/ (tilde — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat ~/.claude/memory/something' } },
  false
);

runTest('Bash: $CLAUDE_PROJECT_DIR/.claude/memory/ (env var — allow)',
  { tool_name: 'Bash', tool_input: { command: 'ls $CLAUDE_PROJECT_DIR/.claude/memory/' } },
  false
);

runTest('Bash: ${CLAUDE_PROJECT_DIR}/.claude/memory/ (env var braces — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat ${CLAUDE_PROJECT_DIR}/.claude/memory/file.md' } },
  false
);

runTest('Read: parent traversal resolving to correct project (allow)',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/scripts/../.claude/memory/memory.md' } },
  false
);

runTest('Read: parent traversal resolving to wrong project (block)',
  { tool_name: 'Read', tool_input: { file_path: 'C:/Users/chulg/Documents/memory-keeper-plugin/../YesPresident/.claude/memory/file.md' } },
  true
);

runTest('Bash: quoted path with spaces (block)',
  { tool_name: 'Bash', tool_input: { command: 'cat "C:/Users/some user/Documents/YesPresident/.claude/memory/file.md"' } },
  true
);

runTest('Bash: echo mentioning .claude/memory/ in quoted string (allow)',
  { tool_name: 'Bash', tool_input: { command: 'echo "Files are in .claude/memory/ directory"' } },
  false
);

runTest('Glob: correct project path (allow)',
  { tool_name: 'Glob', tool_input: { path: 'C:/Users/chulg/Documents/memory-keeper-plugin/.claude/memory/', pattern: '*.md' } },
  false
);

// --- Cycle 3: Quoted paths with spaces ---

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
    } else {
      console.log(`PASS: ${name} — allowed (exit 0)`);
    }
  } catch (e) {
    if (e.status === 2 && expectBlock) {
      console.log(`PASS: ${name} — blocked (exit 2)`);
    } else if (e.status === 2 && !expectBlock) {
      console.log(`FAIL: ${name} — expected allow but got block. stdout: ${e.stdout}`);
    } else {
      console.log(`FAIL: ${name} — unexpected exit ${e.status}`);
    }
  }
}

runTestWithDir('Bash: double-quoted path with spaces (correct project — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat "D:/Public Analysis/.claude/memory/file.md"' } },
  false,
  'D:/Public Analysis'
);

runTestWithDir('Bash: double-quoted path with spaces (wrong project — block)',
  { tool_name: 'Bash', tool_input: { command: 'cat "D:/Other Project/.claude/memory/file.md"' } },
  true,
  'D:/Public Analysis'
);

runTestWithDir('Bash: single-quoted path with spaces (correct project — allow)',
  { tool_name: 'Bash', tool_input: { command: "cat 'D:/Public Analysis/.claude/memory/file.md'" } },
  false,
  'D:/Public Analysis'
);

runTestWithDir('Bash: backslash quoted path with spaces (correct project — allow)',
  { tool_name: 'Bash', tool_input: { command: 'cat "D:\\Public Analysis\\.claude\\memory\\file.md"' } },
  false,
  'D:/Public Analysis'
);
