'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readCodexCommandResult } = require('./host-tool-result');
const { readJsonOrDefault } = require('../utils');
const { STORAGE_ROOT } = require('../constants');
const { shellCommand } = require('./tool-shape');

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
// leading `cd <dir> &&`, trailing output redirection (`> file`, `2>&1`), environment
// assignments before the command (POSIX `NAME=value`, PowerShell `$env:NAME = value;`)
// and the wrappers the project declares (manifest `wrappers`, D143_T014). Pipes, `;`,
// `||` and other chaining stay unaccepted: the exit status would belong to another
// command, so a failing check could look like a pass.
const LEADING_CD = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s"'&|;<>]+))\s*&&\s*/;
const TRAILING_REDIRECT = /\s+(?:\d?>>?|&>>?)\s*(?:&\d|"[^"]*"|'[^']*'|[^\s"'&|;<>]+)\s*$/;
const LEADING_POWERSHELL_ENV = /^\s*\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^;\s]+)\s*;\s*/i;
const POSIX_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

function hostPath(dir) {
  // Git Bash spells C:\x as /c/x.
  return process.platform === 'win32' && /^\/[a-z]\//i.test(dir) ? `${dir[1]}:${dir.slice(2)}` : dir;
}

function readJson(file) {
  return readJsonOrDefault(file, {}) || {};
}

const manifestPath = projectDir => path.join(projectDir, STORAGE_ROOT, 'verification', 'manifest.json');

function readManifest(projectDir) {
  if (!projectDir) return {};
  const manifest = readJson(manifestPath(projectDir));
  return manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : {};
}

// A program's name as the shell finds it: its file name, without an extension the
// system runs by itself (PATHEXT, where the system has one), case-folded where file
// names ignore case.
function programName(token) {
  let name = path.basename(String(token).replace(/\\/g, '/'));
  const extension = path.extname(name).toLowerCase();
  const runnable = String(process.env.PATHEXT || '').split(';').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (extension && runnable.includes(extension)) name = name.slice(0, -extension.length);
  return process.platform === 'win32' ? name.toLowerCase() : name;
}

// The project's declared wrappers (manifest `wrappers`: a command string or a token list each).
function wrapperList(manifest) {
  const list = Array.isArray(manifest.wrappers) ? manifest.wrappers : [];
  return list.map(item => (Array.isArray(item) ? item.filter(token => typeof token === 'string') : commandTokens(item)))
    .filter(tokens => Array.isArray(tokens) && tokens.length > 0);
}

function startsWithWrapper(tokens, wrapper) {
  return wrapper.length < tokens.length
    && wrapper.every((token, index) => (index === 0 ? programName(token) === programName(tokens[0]) : token === tokens[index]));
}

// One invocation with the parts that do not change what runs taken off.
// Returns { tokens, cwd, changedDir, env } or null for a form that hides the exit status.
function checkInvocation(command, cwd, projectDir = null) {
  if (typeof command !== 'string') return null;
  let rest = command;
  let dir = null;
  const env = {};
  const cd = rest.match(LEADING_CD);
  if (cd) {
    dir = path.resolve(cwd || '.', hostPath(cd[1] || cd[2] || cd[3]));
    rest = rest.slice(cd[0].length);
  }
  for (let assignment = rest.match(LEADING_POWERSHELL_ENV); assignment; assignment = rest.match(LEADING_POWERSHELL_ENV)) {
    env[assignment[1]] = assignment[2].replace(/^(["'])([\s\S]*)\1$/, '$2');
    rest = rest.slice(assignment[0].length);
  }
  for (let previous = null; previous !== rest;) {
    previous = rest;
    rest = rest.replace(TRAILING_REDIRECT, '');
  }
  const tokens = commandTokens(rest);
  if (!tokens) return null;
  for (let assignment = tokens[0].match(POSIX_ASSIGNMENT); tokens.length > 1 && assignment; assignment = tokens[0].match(POSIX_ASSIGNMENT)) {
    env[assignment[1]] = assignment[2];
    tokens.shift();
  }
  const wrappers = wrapperList(readManifest(projectDir));
  for (let wrapper = wrappers.find(item => startsWithWrapper(tokens, item)); wrapper; wrapper = wrappers.find(item => startsWithWrapper(tokens, item))) {
    tokens.splice(0, wrapper.length);
  }
  return { tokens, cwd: dir || cwd, changedDir: Boolean(dir), env };
}

function samePath(a, b) {
  const norm = value => path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

// The project's declared checks: manifest `tools` and entries — discovered ones expanded
// by the runner, each with its entry id — plus the runner's own launcher forms. Nothing
// else counts (no package.json script or package-manager table, D143_T014): a project
// declares its checks in the manifest, whatever its language. One read per manifest
// version and process.
const declarationCache = new Map();
function declaredCommands(projectDir) {
  if (!projectDir) return [];
  let stamp = 'missing';
  try { const stat = fs.statSync(manifestPath(projectDir)); stamp = `${stat.size}:${stat.mtimeMs}`; } catch (_) {}
  const cached = declarationCache.get(projectDir);
  if (cached && cached.stamp === stamp) return cached.declarations;
  const manifest = readManifest(projectDir);
  const declarations = [];
  for (const command of Object.values(manifest.tools || {})) {
    const tokens = commandTokens(command);
    if (tokens) declarations.push({ tokens, cwd: projectDir, source: 'tools' });
  }
  let entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  try { entries = require('../../skills/verifying/scripts/runner/manifest').expandEntries(manifest, projectDir); } catch (_) {}
  for (const entry of entries) {
    if (!entry || entry.type === 'manual') continue;
    const command = entry.command;
    const tokens = typeof command === 'string' ? commandTokens(command)
      : command?.file && Array.isArray(command.args) ? [command.file, ...command.args] : null;
    if (tokens) declarations.push({ tokens, cwd: path.resolve(projectDir, command.cwd || '.'), contract: entry.contract, source: 'entry', entryId: entry.id });
  }
  // A manifest's own runner runs every entry, so it is the project's full check even
  // when the manifest declares no tools (v21.135.0).
  const runner = path.join(STORAGE_ROOT, 'verification', 'run-verify.js');
  if (manifest.entries && fs.existsSync(path.join(projectDir, runner))
    && !declarations.some(declaration => declaration.source === 'tools' && declaration.tokens.length === 2
      && canonicalToken(declaration.tokens[1], 1, declaration.cwd) === path.resolve(projectDir, runner))) {
    declarations.push({ tokens: ['node', runner.replace(/\\/g, '/')], cwd: projectDir, source: 'tools' });
  }
  // Its changed-file mode is the default check, so it unlocks the gate too, even
  // when the manifest declares no tools.changed (v21.139.0).
  if (manifest.entries && fs.existsSync(path.join(projectDir, runner))
    && !declarations.some(declaration => declaration.source === 'tools' && declaration.tokens.length === 3
      && canonicalToken(declaration.tokens[1], 1, declaration.cwd) === path.resolve(projectDir, runner)
      && declaration.tokens[2] === '--changed')) {
    declarations.push({ tokens: ['node', runner.replace(/\\/g, '/'), '--changed'], cwd: projectDir, source: 'tools' });
  }
  declarationCache.set(projectDir, { stamp, declarations });
  return declarations;
}

function canonicalToken(token, index, cwd) {
  if (index === 0) return programName(token);
  if (/^[\w./\\: -]+$/.test(token) && /[./\\]/.test(token) && !token.startsWith('-')) {
    return path.resolve(cwd, token);
  }
  return token;
}

function matchingDeclarations(tokens, invocation, projectDir) {
  // A `cd` prefix must land where the check is declared; otherwise another
  // folder's tests would unlock this project's commit.
  return declaredCommands(projectDir).filter(declaration => tokens.length === declaration.tokens.length
    && (!invocation.changedDir || samePath(invocation.cwd, declaration.cwd))
    && tokens.every((token, index) => canonicalToken(token, index, invocation.cwd)
      === canonicalToken(declaration.tokens[index], index, declaration.cwd)));
}

function findDeclaration(command, projectDir, cwd = projectDir) {
  const invocation = checkInvocation(command, cwd, projectDir);
  if (!invocation || !projectDir) return null;
  const matches = matchingDeclarations(invocation.tokens, invocation, projectDir);
  // A generic tool alias must not bypass the same command's entry contract.
  const chosen = matches.find(declaration => declaration.contract) || matches[0] || null;
  // Required = the project's own check commands (manifest tools); a single manifest
  // entry is evidence but does not stand for the project's check.
  return chosen && { ...chosen, required: matches.some(declaration => declaration.source !== 'entry'), env: invocation.env };
}

// A declared check behind tokens the project did not declare as a wrapper (`rtk node x.js`
// with no `wrappers: ["rtk"]`): { prefix, declaration }, or null. It does not count as the
// check — the prefix could change what runs — but the project can declare the wrapper.
function unwrappedDeclaration(command, projectDir, cwd = projectDir) {
  const invocation = checkInvocation(command, cwd, projectDir);
  if (!invocation || !projectDir || findDeclaration(command, projectDir, cwd)) return null;
  for (let start = 1; start < invocation.tokens.length; start++) {
    const matches = matchingDeclarations(invocation.tokens.slice(start), invocation, projectDir);
    if (matches.length) return { prefix: invocation.tokens.slice(0, start), declaration: matches[0] };
  }
  return null;
}

function isTestExecution(command, projectDir, cwd = projectDir) {
  return Boolean(findDeclaration(command, projectDir, cwd));
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
// True when the command is one of the project's own checks (manifest tools) — the
// checks recorded as required (completion evidence).
function isRequiredCheck(command, projectDir, cwd = projectDir) {
  const declaration = findDeclaration(command, projectDir, cwd);
  return Boolean(declaration && declaration.required !== false);
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
  // A shell call by its shape (Bash, PowerShell, Codex exec, an MCP shell), not its name.
  const command = shellCommand(hookData);
  const cwd = hookData.tool_input?.workdir || hookData.cwd || projectDir;
  if (!command) return null;
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
  // A Claude background launch never reports its end to a hook, so it is never observed.
  const background = host === 'claude' && (hookData.tool_input?.run_in_background === true || response?.backgroundTaskId != null);
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
    // Without the runner's assertion code (its modules unavailable) the result proves
    // nothing either way (D143_T018: evidence is fail-closed).
    let evaluateAssertion = null;
    try { ({ evaluateAssertion } = require('../../skills/verifying/scripts/run-verify')); } catch (_) { conclusive = false; }
    const context = {
      projectRoot: projectDir, exitCode,
      stdout: typeof response === 'object' ? response?.stdout ?? response?.output ?? '' : responseText(response),
      stderr: typeof response === 'object' ? response?.stderr || '' : '',
    };
    if (evaluateAssertion) contractPassed = (contract.assertions || []).every(assertion => evaluateAssertion(assertion, context).pass);
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
    background,
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
  isGitCommit,
  isTestExecution,
  isToolFailure,
  unwrappedDeclaration,
  checkKeyForCommand,
  isRequiredCheck,
  responseText,
};
