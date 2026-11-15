'use strict';
// Declared resources and the machine around a run (D175_T002): who holds a resource, the
// worktrees of the project, and the processes running now. The runner and the PreToolUse
// hook ask the same questions here. A resource is held by a live run's check that `uses` it
// (run-record.js) or, when the manifest names a `lockFile`, by the live process that file
// names. Every failure means "unknown": callers decide nothing on it.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pidAlive } = require('./run-record');

const DEFAULTS = { scope: 'worktree', onHeld: 'refuse', pidKey: 'pid', staleAfterSeconds: 60 };
const PROCESS_LIST_TIMEOUT_MS = 5000;
const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

// A declared resource with its defaults.
function resourceOf(manifest, name) {
  const declared = manifest && manifest.resources && typeof manifest.resources === 'object' ? manifest.resources[name] : null;
  return declared && typeof declared === 'object' ? { name, ...DEFAULTS, ...declared } : null;
}

// git in a folder, never taking optional locks (another worktree's index is left as it is):
// its output, or null.
function git(args, cwd) {
  try {
    const result = spawnSync('git', ['--no-optional-locks', ...args], { cwd, encoding: 'utf8', windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
    return result.status === 0 && typeof result.stdout === 'string' ? result.stdout : null;
  } catch (_) { return null; }
}

// The folders of every worktree of the repository `dir` is in (just `dir` without git).
function worktrees(dir) {
  const out = git(['worktree', 'list', '--porcelain', '-z'], dir);
  if (!out) return [path.resolve(dir)];
  const roots = out.split('\0').filter(row => row.startsWith('worktree ')).map(row => path.resolve(row.slice('worktree '.length)));
  return roots.length ? roots : [path.resolve(dir)];
}

// The worktree root `dir` is in, or null outside git.
function worktreeRoot(dir) {
  const out = git(['rev-parse', '--show-toplevel'], dir);
  return out ? path.resolve(out.trim()) : null;
}

// The main worktree of a linked worktree, read from files alone (no git process): its `.git`
// file names the worktree's git folder, whose `commondir` names the shared one. Null for a
// main worktree or a folder outside git.
function mainWorktreeOf(root) {
  try {
    const marker = path.join(root, '.git');
    if (!fs.statSync(marker).isFile()) return null;
    const gitdir = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(marker, 'utf8'));
    if (!gitdir) return null;
    const worktreeGit = path.resolve(root, gitdir[1].trim());
    const common = path.resolve(worktreeGit, fs.readFileSync(path.join(worktreeGit, 'commondir'), 'utf8').trim());
    return path.dirname(common);
  } catch (_) { return null; }
}

// The manifest a worktree's commands are judged by: its own, else the main worktree's (a
// project whose .crabshell/ git ignores has none in its other worktrees). Files only.
function manifestPathFor(root, relativeManifest) {
  const own = path.join(root, relativeManifest);
  if (fs.existsSync(own)) return own;
  const main = mainWorktreeOf(root);
  const theirs = main ? path.join(main, relativeManifest) : null;
  return theirs && fs.existsSync(theirs) ? theirs : null;
}

// Who holds a resource's lock file in one worktree: { pid, label, startedAt, file } for a
// live owner, { pid: null, file } for a file without a readable owner written within
// staleAfterSeconds (still being written), { unknown: true, file } when it cannot be read,
// or null when nothing holds it.
function lockHolder(worktree, resource) {
  if (!resource || typeof resource.lockFile !== 'string' || !resource.lockFile) return null;
  const file = path.join(worktree, resource.lockFile);
  let text;
  let stat;
  try { stat = fs.statSync(file); text = fs.readFileSync(file, 'utf8'); } catch (error) {
    return error && error.code === 'ENOENT' ? null : { unknown: true, file };
  }
  let owner = null;
  try { const parsed = JSON.parse(text); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) owner = parsed; } catch (_) {}
  const pid = owner ? Number(owner[resource.pidKey || DEFAULTS.pidKey]) : NaN;
  if (Number.isInteger(pid) && pid > 0) {
    if (!pidAlive(pid)) return null;
    const startedAt = typeof owner.started_at === 'string' ? Date.parse(owner.started_at) : NaN;
    return { pid, label: typeof owner.label === 'string' ? owner.label : null, startedAt: Number.isFinite(startedAt) ? startedAt : stat.mtimeMs, file };
  }
  const staleMs = 1000 * (typeof resource.staleAfterSeconds === 'number' ? resource.staleAfterSeconds : DEFAULTS.staleAfterSeconds);
  return Date.now() - stat.mtimeMs <= staleMs ? { pid: null, file } : null;
}

// A holder whose pid now belongs to a process started after the lock was taken is gone
// (the pid was reused). `processes` is a process list (or null: kept as held).
function stillHolding(holder, processes) {
  if (!holder || !holder.pid || !Array.isArray(processes)) return Boolean(holder);
  const process = processes.find(item => item.pid === holder.pid);
  if (!process) return true;
  return !(Number.isFinite(process.startedAt) && Number.isFinite(holder.startedAt) && process.startedAt > holder.startedAt + 1000);
}

// Splits a Windows command line the way programs read it (quotes, backslashes before quotes).
function windowsArgv(line) {
  const args = [];
  let current = '';
  let quoted = false;
  let any = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\') {
      let slashes = 0;
      while (line[i] === '\\') { slashes++; i++; }
      if (line[i] === '"') { current += '\\'.repeat(Math.floor(slashes / 2)); if (slashes % 2) { current += '"'; } else { quoted = !quoted; } any = true; }
      else { current += '\\'.repeat(slashes); i--; any = true; }
    } else if (char === '"') { quoted = !quoted; any = true; }
    else if (!quoted && /\s/.test(char)) { if (any) { args.push(current); current = ''; any = false; } }
    else { current += char; any = true; }
  }
  if (any) args.push(current);
  return args;
}

function parseWindows(stdout) {
  let rows = JSON.parse(stdout || '[]');
  if (!Array.isArray(rows)) rows = [rows];
  return rows.filter(row => row && Number.isInteger(row.ProcessId)).map(row => {
    const date = /\/Date\((\d+)\)\//.exec(String(row.CreationDate || ''));
    const line = typeof row.CommandLine === 'string' ? row.CommandLine : '';
    return { pid: row.ProcessId, ppid: row.ParentProcessId, name: String(row.Name || ''), argv: line ? windowsArgv(line) : [String(row.Name || '')],
      unknownArgs: !line, startedAt: date ? Number(date[1]) : NaN };
  });
}

function parsePosix(stdout) {
  return String(stdout || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    // pid ppid Www Mmm dd hh:mm:ss yyyy args...
    const parts = line.split(/\s+/);
    const started = Date.parse(parts.slice(2, 7).join(' '));
    const argv = parts.slice(7);
    return { pid: Number(parts[0]), ppid: Number(parts[1]), name: argv[0] ? path.basename(argv[0]) : '', argv, unknownArgs: argv.length === 0, startedAt: started };
  }).filter(item => Number.isInteger(item.pid));
}

// The processes running now: [{ pid, ppid, name, argv, unknownArgs, startedAt }], or null
// when they cannot be listed in timeoutMs.
function processList({ timeoutMs = PROCESS_LIST_TIMEOUT_MS } = {}) {
  try {
    if (process.platform === 'win32') {
      const command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress';
      const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
      return result.status === 0 ? parseWindows(result.stdout) : null;
    }
    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,lstart=,args='], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
    return result.status === 0 ? parsePosix(result.stdout) : null;
  } catch (_) { return null; }
}

// The pids of a process and its parents in a process list.
function ancestorsOf(processes, pid) {
  const byPid = new Map((processes || []).map(item => [item.pid, item]));
  const chain = new Set();
  let current = pid;
  while (Number.isInteger(current) && current > 0 && !chain.has(current)) {
    chain.add(current);
    const item = byPid.get(current);
    current = item ? item.ppid : null;
  }
  return chain;
}

module.exports = { DEFAULTS, git, resourceOf, worktrees, worktreeRoot, mainWorktreeOf, manifestPathFor, lockHolder, stillHolding, windowsArgv, parseWindows, parsePosix, processList, ancestorsOf };
