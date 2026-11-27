'use strict';

// D187_T004: one Claude Code session of a guard experiment, run as `claude -p` (the signed-in
// CLI; no API key) on a prepared project. The plugin under test is loaded from its folder
// (--plugin-dir) and every installed copy with the same name is switched off for the session
// (--settings enabledPlugins), so the session runs the development copy only. The stream
// (--output-format stream-json --include-hook-events) is read line by line and only the
// facts the experiment uses are kept; the prompt goes in on stdin.

const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const { writeJson } = require('../utils');
const { GUARDS_OFF_ENV } = require('./guards-off');

// Variables a Claude Code session sets for the processes it starts (they tie a process to
// that session: its id, messaging socket, project and plugin folders) and the plugin's own
// switches. None of them reach an experiment session, so it is a session of its own and each
// arm sets the switch itself; keepEnv names any that must stay (provider settings, say).
const SESSION_BOUND_ENV = Object.freeze([/^CRABSHELL_/i, /^CLAUDECODE$/i, /^CLAUDE_CODE_/i, /^CLAUDE_PROJECT_DIR$/i,
  /^PROJECT_DIR$/i, /^CLAUDE_PLUGIN_/i, /^CLAUDE_PID$/i, /^CLAUDE_EFFORT$/i]);
const TEXT_HEAD = 400;
const STDERR_TAIL = 4000;

function sessionEnv(base, { guardsOff = [], keepEnv = [] } = {}) {
  const env = {};
  for (const [name, value] of Object.entries(base || {})) {
    if (!keepEnv.includes(name) && SESSION_BOUND_ENV.some(pattern => pattern.test(name))) continue;
    env[name] = value;
  }
  if (guardsOff.length) env[GUARDS_OFF_ENV] = guardsOff.join(',');
  return env;
}

// The installed copies of a plugin: every entry of `claude plugin list --json` with its name,
// except the ones the host builds in or a --plugin-dir loads.
function installedCopies(pluginName, { claude = 'claude', env = process.env } = {}) {
  const listed = spawnSync(claude, ['plugin', 'list', '--json'], { encoding: 'utf8', env, windowsHide: true, timeout: 60000 });
  if (listed.error || listed.status !== 0) return { ids: [], error: String(listed.error ? listed.error.message : listed.stderr || `exit ${listed.status}`).trim() };
  let entries;
  try { entries = JSON.parse(listed.stdout); } catch (error) { return { ids: [], error: `plugin list is not JSON: ${error.message}` }; }
  const ids = (Array.isArray(entries) ? entries : []).map(entry => entry && entry.id).filter(id => typeof id === 'string')
    .filter(id => id.split('@')[0] === pluginName && !/@(builtin|inline)$/.test(id));
  return { ids };
}

function writeSessionSettings(file, disabledIds) {
  writeJson(file, { enabledPlugins: Object.fromEntries(disabledIds.map(id => [id, false])) });
  return file;
}

function sessionArgs({ pluginDir, settingsFile, model, session }) {
  return [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--plugin-dir', pluginDir, '--settings', settingsFile,
    '--permission-mode', session.permissionMode, '--permission-prompts', 'none',
    '--max-turns', String(session.maxTurns),
    ...(session.allowedTools.length ? ['--allowedTools', session.allowedTools.join(',')] : []),
    ...(model ? ['--model', model] : []),
  ];
}

const head = (value, size = TEXT_HEAD) => String(value === undefined || value === null ? '' : value).slice(0, size);
const textOf = content => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(part => (part && typeof part.text === 'string' ? part.text : '')).join('\n') : '');

// The deny reason a PreToolUse hook sent, from its stdout.
function hookDenyReason(stdout) {
  try {
    const specific = JSON.parse(String(stdout || '').trim()).hookSpecificOutput;
    return specific && specific.permissionDecision === 'deny' ? String(specific.permissionDecisionReason || '') : '';
  } catch { return ''; }
}

// A denied call's result text that starts like a hook's deny reason was denied by that hook.
const sameStart = (a, b) => { const size = Math.min(a.length, b.length, 120); return size > 0 && a.slice(0, size) === b.slice(0, size); };

function createStreamReader() {
  let init = null;
  let result = null;
  const sessionStart = [];
  const hookDenies = [];
  const errorResults = new Map();
  const models = new Set();
  return {
    line(text) {
      if (!text || !text.trim()) return;
      let event;
      try { event = JSON.parse(text); } catch { return; }
      if (event.type === 'system' && event.subtype === 'init') {
        init = { model: event.model || null, sessionId: event.session_id || null, permissionMode: event.permissionMode || null,
          version: event.claude_code_version || null,
          plugins: (Array.isArray(event.plugins) ? event.plugins : []).map(plugin => ({ name: plugin.name, path: plugin.path, source: plugin.source, version: plugin.version })) };
      } else if (event.type === 'system' && event.subtype === 'hook_response') {
        if (event.hook_event === 'SessionStart') sessionStart.push(String(event.stdout || ''));
        if (event.hook_event === 'PreToolUse') { const reason = hookDenyReason(event.stdout); if (reason) hookDenies.push(reason); }
      } else if (event.type === 'assistant' && event.message) {
        if (typeof event.message.model === 'string' && event.message.model && event.message.model !== '<synthetic>') models.add(event.message.model);
      } else if (event.type === 'user' && event.message && Array.isArray(event.message.content)) {
        for (const block of event.message.content) {
          if (block && block.type === 'tool_result' && block.is_error) errorResults.set(block.tool_use_id, head(textOf(block.content), 1000));
        }
      } else if (event.type === 'result') {
        result = { subtype: event.subtype || null, isError: event.is_error === true, numTurns: event.num_turns ?? null,
          durationMs: event.duration_ms ?? null, text: head(event.result),
          denials: (Array.isArray(event.permission_denials) ? event.permission_denials : []).map(item => ({
            tool: item.tool_name, id: item.tool_use_id, input: head(JSON.stringify(item.tool_input || {}), 200) })) };
      }
    },
    facts() {
      const permissionDenials = (result ? result.denials : []).map(denial => {
        const text = errorResults.get(denial.id) || '';
        return { tool: denial.tool, input: denial.input, byHook: hookDenies.some(reason => sameStart(reason, text)), text: head(text, 200) };
      });
      return { init, sessionStart, answeringModels: [...models].sort(), result, permissionDenials };
    },
  };
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else { try { child.kill('SIGKILL'); } catch {} }
}

// Runs one session; resolves when it ends or its time is up (then its process tree is killed).
function runSession({ claude = 'claude', args, cwd, env, prompt, timeoutMs }) {
  return new Promise(resolve => {
    const started = Date.now();
    const reader = createStreamReader();
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(claude, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ exitCode: null, timedOut, ms: 0, facts: reader.facts(), error: error.message, stderr });
      return;
    }
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => reader.line(line));
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-STDERR_TAIL); });
    child.on('error', error => { stderr = (stderr + error.message).slice(-STDERR_TAIL); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut, ms: Date.now() - started, facts: reader.facts(), stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// The host's own record of a session (transcripts, file history) for a project this run made,
// removed with `claude purge`: a project outside workRoot is never purged.
function purgeSessionData({ claude = 'claude', project, workRoot, env }) {
  const relative = path.relative(path.resolve(workRoot), path.resolve(project));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return { purged: false, reason: 'not a project of this run' };
  const purged = spawnSync(claude, ['purge', project, '-y'], { encoding: 'utf8', env, windowsHide: true, timeout: 120000 });
  return { purged: purged.status === 0, reason: purged.status === 0 ? '' : head(purged.stderr || purged.stdout || (purged.error && purged.error.message), 200) };
}

module.exports = {
  SESSION_BOUND_ENV, createStreamReader, hookDenyReason, installedCopies, purgeSessionData, runSession,
  sessionArgs, sessionEnv, writeSessionSettings,
};
