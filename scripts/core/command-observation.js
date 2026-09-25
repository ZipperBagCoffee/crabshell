'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readCodexCommandResult } = require('./host-tool-result');
const { readJsonOrDefault } = require('../utils');
const { NON_SOURCE_EXTENSIONS, NON_SOURCE_BASENAMES, SOURCE_EXCLUDED_DIRS, STORAGE_ROOT } = require('../constants');

// Parse one invocation, never search quoted arguments for command names. Shell
// composition needs per-process results, which a single tool result cannot prove.
function commandTokens(command) {
  if (typeof command !== 'string') return null;
  const tokens = [];
  let token = '', quote = null, started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && command[i + 1] === quote) token += command[++i];
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/[|;&<>\r\n`]/.test(char) || (char === '$' && command[i + 1] === '(')) {
      return null;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(token);
      token = '';
      started = false;
    } else {
      token += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) tokens.push(token);
  return tokens.length ? tokens : null;
}

// A check run counts in the forms that keep its own exit status (v21.135.0): one
// leading `cd <dir> &&`, trailing output redirection (`> file`, `2>&1`), and the
// `rtk` pass-through wrapper that some setups put before every command. Pipes, `;`,
// `||` and other chaining stay unaccepted: the exit status would belong to another
// command, so a failing check could look like a pass.
const LEADING_CD = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s"'&|;<>]+))\s*&&\s*/;
const TRAILING_REDIRECT = /\s+(?:\d?>>?|&>>?)\s*(?:&\d|"[^"]*"|'[^']*'|[^\s"'&|;<>]+)\s*$/;
const PASS_THROUGH = new Set(['rtk']);

function hostPath(dir) {
  // Git Bash spells C:\x as /c/x.
  return process.platform === 'win32' && /^\/[a-z]\//i.test(dir) ? `${dir[1]}:${dir.slice(2)}` : dir;
}

function checkInvocation(command, cwd) {
  if (typeof command !== 'string') return null;
  let rest = command;
  let dir = null;
  const cd = rest.match(LEADING_CD);
  if (cd) {
    dir = path.resolve(cwd || '.', hostPath(cd[1] || cd[2] || cd[3]));
    rest = rest.slice(cd[0].length);
  }
  for (let previous = null; previous !== rest;) {
    previous = rest;
    rest = rest.replace(TRAILING_REDIRECT, '');
  }
  const tokens = commandTokens(rest);
  if (!tokens) return null;
  while (tokens.length > 1 && PASS_THROUGH.has(path.basename(tokens[0].replace(/\\/g, '/')).replace(/\.(exe|cmd)$/i, ''))) tokens.shift();
  return { tokens, cwd: dir || cwd, changedDir: Boolean(dir) };
}

function samePath(a, b) {
  const norm = value => path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function readJson(file) {
  return readJsonOrDefault(file, {}) || {};
}

// True when the project has any check configuration at all (a verification
// manifest file or a package.json test script), even if nothing in it is runnable.
function hasCheckConfiguration(projectDir) {
  if (!projectDir) return false;
  if (fs.existsSync(path.join(projectDir, STORAGE_ROOT, 'verification', 'manifest.json'))) return true;
  return typeof (readJson(path.join(projectDir, 'package.json')).scripts || {}).test === 'string';
}

function declaredCommands(projectDir) {
  if (!projectDir) return [];
  const manifest = readJson(path.join(projectDir, STORAGE_ROOT, 'verification', 'manifest.json'));
  const declarations = [];
  for (const command of Object.values(manifest.tools || {})) {
    const tokens = commandTokens(command);
    if (tokens) declarations.push({ tokens, cwd: projectDir, source: 'tools' });
  }
  for (const entry of manifest.entries || []) {
    if (entry.type === 'manual') continue;
    const command = entry.command;
    const tokens = typeof command === 'string' ? commandTokens(command)
      : command?.file && Array.isArray(command.args) ? [command.file, ...command.args] : null;
    if (tokens) declarations.push({ tokens, cwd: path.resolve(projectDir, command.cwd || '.'), contract: entry.contract, source: 'entry' });
  }
  const scripts = readJson(path.join(projectDir, 'package.json')).scripts || {};
  // Test lifecycle configuration is authoritative; custom names can be declared
  // in manifest.tools/entries, without extending this recognizer.
  if (typeof scripts.test === 'string') {
    // Every package manager's spelling of the same "test" script (v21.135.0).
    for (const tokens of [['npm', 'test'], ['npm', 'run', 'test'], ['pnpm', 'test'], ['pnpm', 'run', 'test'],
      ['yarn', 'test'], ['yarn', 'run', 'test'], ['bun', 'run', 'test']]) {
      declarations.push({ tokens, cwd: projectDir, source: 'package' });
    }
  }
  // A manifest's own runner runs every entry, so it is the project's full check even
  // when the manifest declares no tools (v21.135.0).
  const runner = path.join(STORAGE_ROOT, 'verification', 'run-verify.js');
  if (manifest.entries && fs.existsSync(path.join(projectDir, runner))
    && !declarations.some(declaration => declaration.source === 'tools' && declaration.tokens.length === 2
      && canonicalToken(declaration.tokens[1], 1, declaration.cwd) === path.resolve(projectDir, runner))) {
    declarations.push({ tokens: ['node', runner.replace(/\\/g, '/')], cwd: projectDir, source: 'tools' });
  }
  // Follow package scripts referenced by declared checks, including arbitrary
  // names. The project, rather than a maintained list of tool names, chooses.
  const expanded = new Set();
  for (let index = 0; index < declarations.length; index++) {
    const tokens = declarations[index].tokens;
    const name = tokens[0] === 'npm' ? (tokens[1] === 'run' ? tokens[2] : tokens[1]) : null;
    if (!name || expanded.has(name) || typeof scripts[name] !== 'string') continue;
    expanded.add(name);
    const command = commandTokens(scripts[name]);
    if (command) declarations.push({ tokens: command, cwd: projectDir, source: declarations[index].source });
  }
  return declarations;
}

function canonicalToken(token, index, cwd) {
  if (index === 0) return path.basename(token.replace(/\\/g, '/')).replace(/\.(exe|cmd)$/i, '');
  if (/^[\w./\\: -]+$/.test(token) && /[./\\]/.test(token) && !token.startsWith('-')) {
    return path.resolve(cwd, token);
  }
  return token;
}

function findDeclaration(command, projectDir, cwd = projectDir) {
  const invocation = checkInvocation(command, cwd);
  if (!invocation || !projectDir) return null;
  const { tokens } = invocation;
  // A `cd` prefix must land where the check is declared; otherwise another
  // folder's tests would unlock this project's commit.
  const matches = declaredCommands(projectDir).filter(declaration => tokens.length === declaration.tokens.length
    && (!invocation.changedDir || samePath(invocation.cwd, declaration.cwd))
    && tokens.every((token, index) => canonicalToken(token, index, invocation.cwd)
      === canonicalToken(declaration.tokens[index], index, declaration.cwd)));
  // A generic tool alias must not bypass the same command's entry contract.
  const chosen = matches.find(declaration => declaration.contract) || matches[0] || null;
  // Required = the project's own check commands (manifest tools, package.json test);
  // a single manifest entry is evidence but does not unlock the commit gate.
  return chosen && { ...chosen, required: matches.some(declaration => declaration.source !== 'entry') };
}

function isTrivialTest(command) {
  const invocation = checkInvocation(command, null);
  return !invocation || /^(echo|printf)$/i.test(invocation.tokens[0]);
}

function isTestExecution(command, projectDir, cwd = projectDir) {
  return !isTrivialTest(command) && Boolean(findDeclaration(command, projectDir, cwd));
}

function declarationKey(declaration) {
  return crypto.createHash('sha256').update(JSON.stringify({
    tokens: declaration.tokens.map((token, index) => canonicalToken(token, index, declaration.cwd)),
    cwd: declaration.cwd,
  })).digest('hex');
}

function checkKeyForCommand(command, projectDir, cwd = projectDir) {
  const declaration = findDeclaration(command, projectDir, cwd);
  return declaration ? declarationKey(declaration) : null;
}
// True when the command is one of the project's own checks (manifest tools,
// package.json test) — the only checks that arm or unlock the commit gate.
function isRequiredCheck(command, projectDir, cwd = projectDir) {
  const declaration = findDeclaration(command, projectDir, cwd);
  return Boolean(declaration && declaration.required !== false);
}

// A path (relative to the project, or absolute) whose edits need a passing check:
// anything but prose, stylesheets and images outside generated/state directories.
function isSourceFile(filePath) {
  if (!filePath) return false;
  const normalized = String(filePath).replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/');
  if (segments.some(segment => SOURCE_EXCLUDED_DIRS.includes(segment))) return false;
  const extension = path.extname(normalized);
  if (NON_SOURCE_EXTENSIONS.includes(extension)) return false;
  return !(extension === '' && NON_SOURCE_BASENAMES.includes(path.basename(normalized)));
}

// Keep the content identity with the existing observation, not in another
// change journal. Only files that need verification count (a README or
// stylesheet edit after a passing check leaves the evidence current), plus the
// project's verification configuration: the manifest, its runner, package.json.
function projectFingerprint(projectDir) {
  const hash = crypto.createHash('sha256');
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SOURCE_EXCLUDED_DIRS.includes(entry.name)) continue;
        visit(path.join(directory, entry.name), name);
      } else if (entry.isFile() && isSourceFile(name)) {
        hash.update(JSON.stringify(name)).update(fs.readFileSync(path.join(directory, entry.name)));
      }
    }
  }
  visit(projectDir);
  for (const file of [path.join(STORAGE_ROOT, 'verification', 'manifest.json'), path.join(STORAGE_ROOT, 'verification', 'run-verify.js'), 'package.json']) {
    const absolute = path.join(projectDir, file);
    if (fs.existsSync(absolute)) hash.update(file).update(fs.readFileSync(absolute));
  }
  return hash.digest('hex');
}

function isGitCommit(command) {
  return typeof command === 'string' && /\bgit\s+commit\b/.test(command.trim());
}

function responseText(toolResponse) {
  if (toolResponse === undefined || toolResponse === null) return '';
  if (typeof toolResponse === 'string') return toolResponse;
  try { return JSON.stringify(toolResponse); } catch { return String(toolResponse); }
}

function getExitCode(toolResponse) {
  if (toolResponse && typeof toolResponse === 'object') {
    for (const key of ['exitCode', 'exit_code', 'code']) {
      if (typeof toolResponse[key] === 'number') return toolResponse[key];
    }
    for (const key of ['metadata', 'result', 'details']) {
      const nested = getExitCode(toolResponse[key]);
      if (nested !== null) return nested;
    }
    return null;
  }
  const match = responseText(toolResponse).match(/^(?:Error:\s*)?(?:Process exited with code|Exit code|exit_code):?\s+(-?\d+)\s*$/im);
  return match ? Number(match[1]) : null;
}

function isToolFailure(toolResponse) {
  if (toolResponse && typeof toolResponse === 'object') {
    if (toolResponse.is_error === true || toolResponse.isError === true || toolResponse.interrupted === true
      || toolResponse.success === false || toolResponse.error || toolResponse.signal
      || /^(error|failed|interrupted|cancelled|canceled|timed_out)$/i.test(toolResponse.status || '')) return true;
    if (['metadata', 'result', 'details'].some(key => isToolFailure(toolResponse[key]))) return true;
  }
  const exitCode = getExitCode(toolResponse);
  if (exitCode !== null) return exitCode !== 0;
  return false;
}

function isRunning(response) {
  if (response && typeof response === 'object') {
    // Claude reports a background launch as backgroundTaskId; Codex uses session_id / background_task_id.
    if (response.session_id != null || response.background_task_id != null || response.backgroundTaskId != null || response.running === true
      || /^(running|pending|in_progress|in-progress)$/i.test(response.status || '')) return true;
    return ['metadata', 'result', 'details'].some(key => isRunning(response[key]));
  }
  return /^(?:Script running with cell ID|Process running with session ID)/im.test(responseText(response));
}

function commandObservation(hookData = {}, projectDir, options = {}) {
  const command = hookData.tool_input?.command;
  const cwd = hookData.tool_input?.workdir || hookData.cwd || projectDir;
  if (hookData.tool_name !== 'Bash' || isTrivialTest(command)) return null;
  const declaration = findDeclaration(command, projectDir, cwd);
  if (!declaration) return null;
  const host = options.host || 'claude';
  const nativeResult = host === 'codex' ? readCodexCommandResult(hookData, projectDir) : null;
  const failureEvent = host === 'claude' && hookData.hook_event_name === 'PostToolUseFailure';
  const response = nativeResult || (failureEvent && typeof hookData.error === 'string' ? hookData.error : hookData.tool_response);
  const displayResponse = nativeResult ? { exit_code: nativeResult.exit_code, status: nativeResult.status,
    stdout: nativeResult.stdout, stderr: nativeResult.stderr } : response;
  const text = responseText(displayResponse).replace(/\s+/g, ' ').trim();
  const failed = isToolFailure(response) || isToolFailure(hookData)
    || hookData.tool_result_is_error === true || failureEvent;
  const running = isRunning(response);
  const interrupted = hookData.is_interrupt === true || response?.interrupted === true;
  // Codex string output can be arbitrary stdout, even "Exit code: 0". Only
  // structured host evidence or the bound completion record supplies its code.
  const codeResponse = failureEvent && typeof response === 'string' ? response.trimStart().split(/\r?\n/, 1)[0] : response;
  let exitCode = host === 'codex' && typeof response === 'string' ? null : getExitCode(codeResponse);
  // Claude PostToolUse receives a structured Output only after success. Its
  // Bash Output has no exit-code field. Codex also emits PostToolUse on failure,
  // so the caller must retain host provenance and explicit codes take priority.
  const claudeSuccessEvent = host === 'claude'
    && hookData.hook_event_name === 'PostToolUse'
    && response !== null && typeof response === 'object' && !Array.isArray(response)
    && !failed && !running;
  if (exitCode === null && claudeSuccessEvent) exitCode = 0;
  let conclusive = !running && !interrupted && (exitCode !== null || (failureEvent && typeof hookData.error === 'string' && hookData.error.length > 0));
  let contractPassed = true;
  if (conclusive && !failed && declaration.contract) {
    const contract = declaration.contract;
    // A post-tool event cannot reconstruct a before/after forbidden-change
    // assertion. Such entries need the declared verification runner.
    if (contract.forbiddenChanges?.length) conclusive = false;
    const { evaluateAssertion } = require('../../skills/verifying/scripts/run-verify');
    const context = {
      projectRoot: projectDir, exitCode,
      stdout: typeof response === 'object' ? response?.stdout ?? response?.output ?? '' : responseText(response),
      stderr: typeof response === 'object' ? response?.stderr || '' : '',
    };
    contractPassed = (contract.assertions || []).every(assertion => evaluateAssertion(assertion, context).pass);
  }
  const excerpt = text.slice(0, 500);
  const fingerprint = crypto.createHash('sha256')
    .update(`${command}\n${exitCode}\n${excerpt}`)
    .digest('hex');
  return {
    command,
    executed: true,
    conclusive,
    exitCode,
    passed: conclusive && exitCode === 0 && !failed && contractPassed,
    excerpt,
    fingerprint,
    callId: hookData.tool_use_id || null,
    startedAtMs: nativeResult?.startedAtMs || null,
    completedAtMs: nativeResult?.completedAtMs || null,
    evidenceSource: nativeResult?.evidenceSource || (failureEvent ? 'claude-failure-event' : 'hook-result'),
    checkKey: declarationKey(declaration),
    required: declaration.required !== false,
    outcome: interrupted ? 'interrupted' : running ? 'running' : !conclusive ? 'unknown' : failed || exitCode !== 0 || !contractPassed ? 'failed' : 'passed',
  };
}

module.exports = {
  checkInvocation,
  commandObservation,
  commandTokens,
  findDeclaration,
  declaredCommands,
  getExitCode,
  hasCheckConfiguration,
  isGitCommit,
  isTestExecution,
  isToolFailure,
  isTrivialTest,
  isSourceFile,
  projectFingerprint,
  checkKeyForCommand,
  isRequiredCheck,
  responseText,
};
