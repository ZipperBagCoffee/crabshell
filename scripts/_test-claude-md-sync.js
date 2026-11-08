'use strict';

// D148: CLAUDE.md's managed rules block follows the installed rules at
// SessionStart and on every execution prompt (not once per session), questions
// stay read-only, and a plugin's own source checkout is never rewritten by an
// installed copy that lives at another path.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const injectRules = path.join(__dirname, 'inject-rules.js');
const loadMemory = path.join(__dirname, 'load-memory.js');
const { RULES, MARKER_START, MARKER_END, classifyUserIntent } = require('./inject-rules');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-claude-md-sync-'));
const pluginData = path.join(tempRoot, 'plugin data');
const claudeConfig = path.join(tempRoot, 'claude config');
const OLD_BLOCK = `${MARKER_START}\n\nOLD RULES TEXT FROM AN EARLIER RELEASE\n\n${MARKER_END}`;
const PROJECT_TAIL = '\n\n- project rule written by the user\n';
const EXECUTION_PROMPT = '진행해';
const QUESTION_PROMPT = '왜 안 바뀜?';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL: ${name} --- ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function snapshot(root) {
  const result = {};
  (function visit(current, relative) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      const key = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        result[key] = '<dir>';
        visit(child, key);
      } else {
        result[key] = crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex');
      }
    }
  })(root, '');
  return result;
}
function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(key => before[key] !== after[key]).sort();
}

function makeProject(name, claudeMd, options = {}) {
  const dir = path.join(tempRoot, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  if (claudeMd !== null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
  if (options.pluginName) {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: options.pluginName }));
  }
  return dir;
}

function run(script, project, payload, options = {}) {
  const result = spawnSync(process.execPath, [script], {
    cwd: project,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CONFIG_DIR: claudeConfig,
      CLAUDE_PLUGIN_ROOT: options.pluginRoot || repoRoot,
    },
    input: JSON.stringify({ cwd: project, ...payload }),
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  assert(result.status === 0, `${path.basename(script)} exit ${result.status}: ${result.stderr}`);
  return result;
}
const prompt = (project, sessionId, text, options) => run(injectRules, project, { hook_event_name: 'UserPromptSubmit', session_id: sessionId, prompt: text }, options);
const sessionStart = (project, sessionId, extra = {}) => run(loadMemory, project, { hook_event_name: 'SessionStart', source: 'startup', session_id: sessionId, ...extra });

const read = project => fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
function assertSynced(content, tail) {
  assert(content.startsWith(RULES.trim()), 'rules block was not rewritten to the installed RULES');
  assert(!content.includes('OLD RULES TEXT'), 'old rules text is still present');
  const end = content.indexOf(MARKER_END);
  assert(end !== -1, 'end marker missing');
  assert(content.slice(end + MARKER_END.length) === tail, 'text below the marker changed');
}

try {
  test('preconditions: the prompts are classified as the test assumes', () => {
    assert(classifyUserIntent(EXECUTION_PROMPT) === 'execution', `${EXECUTION_PROMPT} is not execution`);
    assert(classifyUserIntent(QUESTION_PROMPT) !== 'execution', `${QUESTION_PROMPT} is execution`);
  });

  // (a) A later execution prompt in a session that already used its first one.
  const projectA = makeProject('session-already-ran', OLD_BLOCK + PROJECT_TAIL);
  test('(a) later execution prompt in the same session rewrites a stale rules block', () => {
    prompt(projectA, 'sync-a', EXECUTION_PROMPT);
    fs.writeFileSync(path.join(projectA, 'CLAUDE.md'), OLD_BLOCK + PROJECT_TAIL);
    prompt(projectA, 'sync-a', EXECUTION_PROMPT);
    assertSynced(read(projectA), PROJECT_TAIL);
  });

  // (b) Questions stay read-only.
  test('(b) a question leaves a stale CLAUDE.md byte-identical', () => {
    fs.writeFileSync(path.join(projectA, 'CLAUDE.md'), OLD_BLOCK + PROJECT_TAIL);
    const before = read(projectA);
    prompt(projectA, 'sync-a', QUESTION_PROMPT);
    assert(read(projectA) === before, 'question turn changed CLAUDE.md');
  });

  // (c) Nothing is written when the block already matches.
  test('(c) an execution prompt does not touch an up-to-date CLAUDE.md', () => {
    prompt(projectA, 'sync-a', EXECUTION_PROMPT);
    const file = path.join(projectA, 'CLAUDE.md');
    const synced = read(projectA);
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(file, past, past);
    const mtime = fs.statSync(file).mtimeMs;
    prompt(projectA, 'sync-a', EXECUTION_PROMPT);
    assert(fs.statSync(file).mtimeMs === mtime, 'up-to-date CLAUDE.md was rewritten');
    assert(read(projectA) === synced, 'content changed');
  });

  // (d) A plugin's own source checkout is not rewritten by a copy at another path.
  const ownName = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).name;
  test('(d) own source checkout: an installed copy at another path does not rewrite it', () => {
    const own = makeProject('own-source-checkout', OLD_BLOCK + PROJECT_TAIL, { pluginName: ownName });
    prompt(own, 'sync-d', EXECUTION_PROMPT);
    sessionStart(own, 'sync-d2');
    assert(read(own) === OLD_BLOCK + PROJECT_TAIL, 'own source checkout was rewritten');
  });
  test('(d) own source checkout: the checkout itself as plugin root does rewrite it', () => {
    const own = makeProject('own-source-self', OLD_BLOCK + PROJECT_TAIL, { pluginName: ownName });
    const { syncRulesToClaudeMd } = require('./core/claude-md-rules');
    const result = syncRulesToClaudeMd(own, { rules: RULES, pluginRoot: own });
    assert(result.written === true && !result.error, `result ${JSON.stringify(result)}`);
    assertSynced(read(own), PROJECT_TAIL);
  });
  test('(d) own source checkout: the same folder spelled with another drive-letter case still counts as itself (Windows)', () => {
    if (process.platform !== 'win32') return;
    const own = makeProject('own-source-drive-case', OLD_BLOCK + PROJECT_TAIL, { pluginName: ownName });
    const first = own[0];
    const respelled = (first === first.toLowerCase() ? first.toUpperCase() : first.toLowerCase()) + own.slice(1);
    const { syncRulesToClaudeMd } = require('./core/claude-md-rules');
    const result = syncRulesToClaudeMd(own, { rules: RULES, pluginRoot: respelled });
    assert(result.written === true && !result.skipped, `result ${JSON.stringify(result)}`);
  });
  test('(d) a project declaring another plugin name is rewritten', () => {
    const other = makeProject('other-plugin-checkout', OLD_BLOCK + PROJECT_TAIL, { pluginName: `${ownName}-not-the-same` });
    prompt(other, 'sync-d3', EXECUTION_PROMPT);
    assertSynced(read(other), PROJECT_TAIL);
  });

  // (f) SessionStart updates the managed block of an existing CLAUDE.md, nothing else.
  test('(f) SessionStart rewrites a stale rules block and changes no other file', () => {
    const project = makeProject('session-start-stale', OLD_BLOCK + PROJECT_TAIL);
    const before = snapshot(project);
    sessionStart(project, 'sync-f');
    const changed = changedKeys(before, snapshot(project));
    assert(JSON.stringify(changed) === JSON.stringify(['CLAUDE.md']), `changed: ${JSON.stringify(changed)}`);
    assertSynced(read(project), PROJECT_TAIL);
  });
  test('(f) a /load-memory call (no SessionStart event) does not write', () => {
    const project = makeProject('load-memory-call', OLD_BLOCK + PROJECT_TAIL);
    run(loadMemory, project, { session_id: 'sync-f2' });
    assert(read(project) === OLD_BLOCK + PROJECT_TAIL, '/load-memory rewrote CLAUDE.md');
  });
  test('(f) SessionStart neither creates a missing CLAUDE.md nor prepends rules to one without markers', () => {
    const missing = makeProject('session-start-missing', null);
    const plain = makeProject('session-start-plain', '# My project notes\n');
    const beforeMissing = snapshot(missing);
    const beforePlain = snapshot(plain);
    sessionStart(missing, 'sync-f3');
    sessionStart(plain, 'sync-f4');
    assert(changedKeys(beforeMissing, snapshot(missing)).length === 0, 'SessionStart created a file');
    assert(changedKeys(beforePlain, snapshot(plain)).length === 0, 'SessionStart changed a CLAUDE.md without markers');
  });

  // (g) SessionStart writes nothing when the block already matches.
  test('(g) SessionStart leaves an up-to-date project unchanged', () => {
    const project = makeProject('session-start-current', OLD_BLOCK + PROJECT_TAIL);
    sessionStart(project, 'sync-g1');
    const before = snapshot(project);
    sessionStart(project, 'sync-g2');
    assert(changedKeys(before, snapshot(project)).length === 0, 'up-to-date project changed');
  });

  // (h) A failed write never breaks the hook and is reported.
  test('(h) a failing rewrite exits 0 and reports one stderr line', () => {
    const project = makeProject('write-fails', null);
    fs.mkdirSync(path.join(project, 'CLAUDE.md'));
    const result = prompt(project, 'sync-h', EXECUTION_PROMPT);
    assert(/Claude rule synchronization failed/.test(result.stderr), `stderr: ${result.stderr}`);
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
