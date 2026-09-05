'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function declaredCommands(projectDir) {
  if (!projectDir) return [];
  const manifest = readJson(path.join(projectDir, '.crabshell', 'verification', 'manifest.json'));
  const declarations = [];
  for (const command of Object.values(manifest.tools || {})) {
    const tokens = commandTokens(command);
    if (tokens) declarations.push({ tokens, cwd: projectDir });
  }
  for (const entry of manifest.entries || []) {
    if (entry.type === 'manual') continue;
    const command = entry.command;
    const tokens = typeof command === 'string' ? commandTokens(command)
      : command?.file && Array.isArray(command.args) ? [command.file, ...command.args] : null;
    if (tokens) declarations.push({ tokens, cwd: path.resolve(projectDir, command.cwd || '.'), contract: entry.contract });
  }
  const scripts = readJson(path.join(projectDir, 'package.json')).scripts || {};
  // Test lifecycle configuration is authoritative; custom names can be declared
  // in manifest.tools/entries, without extending this recognizer.
  if (typeof scripts.test === 'string') {
    declarations.push({ tokens: ['npm', 'test'], cwd: projectDir });
    declarations.push({ tokens: ['npm', 'run', 'test'], cwd: projectDir });
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
    if (command) declarations.push({ tokens: command, cwd: projectDir });
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
  const tokens = commandTokens(command);
  if (!tokens || !projectDir) return null;
  const matches = declaredCommands(projectDir).filter(declaration => tokens.length === declaration.tokens.length
    && tokens.every((token, index) => canonicalToken(token, index, cwd)
      === canonicalToken(declaration.tokens[index], index, declaration.cwd)));
  // A generic tool alias must not bypass the same command's entry contract.
  return matches.find(declaration => declaration.contract) || matches[0] || null;
}

function isTrivialTest(command) {
  const tokens = commandTokens(command);
  return !tokens || /^(echo|printf)$/i.test(tokens[0]);
}

function isTestExecution(command, projectDir, cwd = projectDir) {
  return !isTrivialTest(command) && Boolean(findDeclaration(command, projectDir, cwd));
}

// Keep the content identity with the existing observation, not in another
// change journal. Ignore generated state and dependencies, but include the
// project's verification configuration and runner.
function projectFingerprint(projectDir) {
  const hash = crypto.createHash('sha256');
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (['.git', '.crabshell', 'node_modules', 'dist', 'build'].includes(entry.name)) continue;
        visit(path.join(directory, entry.name), name);
      } else if (entry.isFile()) {
        hash.update(JSON.stringify(name)).update(fs.readFileSync(path.join(directory, entry.name)));
      }
    }
  }
  visit(projectDir);
  for (const name of ['manifest.json', 'run-verify.js']) {
    const file = path.join(projectDir, '.crabshell', 'verification', name);
    if (fs.existsSync(file)) hash.update(name).update(fs.readFileSync(file));
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
    if (response.session_id != null || response.background_task_id != null || response.running === true
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
  const text = responseText(hookData.tool_response).replace(/\s+/g, ' ').trim();
  const response = hookData.tool_response;
  const failed = isToolFailure(response) || isToolFailure(hookData)
    || hookData.tool_result_is_error === true || hookData.hook_event_name === 'PostToolUseFailure';
  const running = isRunning(response);
  let exitCode = getExitCode(response);
  // Claude PostToolUse receives a structured Output only after success. Its
  // Bash Output has no exit-code field. Codex also emits PostToolUse on failure,
  // so the caller must retain host provenance and explicit codes take priority.
  const claudeSuccessEvent = (options.host || 'claude') === 'claude'
    && hookData.hook_event_name === 'PostToolUse'
    && response !== null && typeof response === 'object' && !Array.isArray(response)
    && !failed && !running;
  if (exitCode === null && claudeSuccessEvent) exitCode = 0;
  let conclusive = exitCode !== null && !running;
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
  };
}

module.exports = {
  commandObservation,
  commandTokens,
  declaredCommands,
  getExitCode,
  isGitCommit,
  isTestExecution,
  isToolFailure,
  isTrivialTest,
  projectFingerprint,
  responseText,
};
