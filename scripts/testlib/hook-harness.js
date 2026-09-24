'use strict';
// Shared harness for tests that drive real hook scripts as separate processes.
// Every project lives under os.tmpdir(); nothing here may touch the live repository state.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..');
const workRoots = [];

function makeWorkRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `crabshell-${prefix}-`));
  workRoots.push(root);
  return root;
}

function makeProject(root, name, options = {}) {
  const project = path.join(root, name);
  fs.mkdirSync(path.join(project, '.crabshell', 'memory'), { recursive: true });
  if (options.git !== false) fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# fixture\n');
  return project;
}

function hookEnv(project, root) {
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: project,
    CLAUDE_PLUGIN_DATA: path.join(root, '_claude-plugin-data'),
    CLAUDE_CONFIG_DIR: path.join(root, '_claude-config'),
    PLUGIN_DATA: path.join(root, '_codex-plugin-data'),
  };
  delete env.CRABSHELL_BACKGROUND;
  delete env.CRABSHELL_HOOK_CAPTURE_DIR;
  delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}

function runHook(root, script, args, payload, project, extraEnv = {}) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    cwd: project, env: { ...hookEnv(project, root), ...extraEnv }, input: JSON.stringify(payload),
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function runHookAsync(root, script, args, payload, project) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), ...args], {
      cwd: project, env: hookEnv(project, root), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

const memoryPath = (project, ...parts) => path.join(project, '.crabshell', 'memory', ...parts);
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const forward = value => value.replace(/\\/g, '/');

function writeTranscript(file, entries, append = false) {
  const text = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  if (append) fs.appendFileSync(file, text); else fs.writeFileSync(file, text);
}
const userLine = (text, ts) => ({ type: 'user', timestamp: ts, message: { content: text } });
const assistantLine = (text, ts) => ({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text }] } });

function sessionL1Lines(project, sessionId) {
  const dir = memoryPath(project, 'sessions');
  const sid8 = sessionId.slice(0, 8);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith('.l1.jsonl') && file.includes('_' + sid8)) : [];
  return files.flatMap(file => fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/).filter(Boolean));
}

function markerCounts(lines, prefix) {
  const counts = {};
  for (const line of lines) {
    const match = line.match(new RegExp(prefix + '-\\d{3}'));
    if (match) counts[match[0]] = (counts[match[0]] || 0) + 1;
  }
  return counts;
}

function createReporter(title) {
  let passed = 0, failed = 0;
  const failures = [];
  return {
    check(name, condition, detail) {
      if (condition) { passed++; console.log(`PASS: ${name}`); }
      else { failed++; failures.push(name); console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }
    },
    finish() {
      console.log(`\n${title}: ${passed} passed, ${failed} failed out of ${passed + failed}`);
      if (failures.length) console.log('Failed: ' + failures.join(' | '));
      process.exitCode = failed > 0 ? 1 : 0;
    },
  };
}

function cleanup() {
  for (const root of workRoots) { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} }
}
process.on('exit', cleanup);

module.exports = {
  SCRIPTS,
  assistantLine,
  createReporter,
  forward,
  hookEnv,
  makeProject,
  makeWorkRoot,
  markerCounts,
  memoryPath,
  readJson,
  runHook,
  runHookAsync,
  sessionL1Lines,
  userLine,
  writeTranscript,
};
