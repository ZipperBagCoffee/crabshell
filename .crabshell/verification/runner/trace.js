'use strict';
// What a check reads: the Node tracer loaded into checked processes (files it reads and
// programs it starts), whether that trace is complete, and the files its assertions read.

const fs = require('fs');
const path = require('path');
const { toPosix } = require('./manifest');
const { findExecutable, programName } = require('./fingerprint');

// Tracer loaded into every checked Node process through NODE_OPTIONS: records the repo
// files and folders each process requires, reads, lists, copies or opens, and every
// program it starts (file, arguments, working folder, whether through a shell), and
// appends them to CRABSHELL_TRACE_FILE on exit. It re-adds itself to child processes
// whose callers build a fresh environment or their own NODE_OPTIONS, so Node children
// are traced too.
const TRACER_SOURCE = `'use strict';
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const out = process.env.CRABSHELL_TRACE_FILE;
const root = process.env.CRABSHELL_TRACE_ROOT;
const requireFlag = process.env.CRABSHELL_TRACE_REQUIRE;
if (out && root) {
  const seen = new Set();
  const children = [];
  const note = target => {
    try {
      if (target instanceof URL) target = fileURLToPath(target);
      else if (typeof target === 'string' && target.startsWith('file:')) target = fileURLToPath(target);
      if (typeof target === 'string') seen.add(path.resolve(target));
    } catch (_) {}
  };
  const wrap = (object, name, positions = [0]) => {
    const original = object && object[name];
    if (typeof original !== 'function') return;
    object[name] = function (...args) { for (const index of positions) note(args[index]); return original.apply(this, args); };
  };
  for (const name of ['readFileSync', 'readFile', 'createReadStream', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'readdir', 'opendirSync', 'openSync', 'open']) wrap(fs, name);
  for (const name of ['copyFileSync', 'copyFile', 'cpSync', 'cp']) wrap(fs, name, [0]);
  if (fs.promises) {
    for (const name of ['readFile', 'readdir', 'open', 'stat', 'opendir']) wrap(fs.promises, name);
    for (const name of ['copyFile', 'cp']) wrap(fs.promises, name, [0]);
  }
  const cp = require('child_process');
  const remember = (file, args, options, shell) => {
    try {
      const cwd = options && typeof options === 'object' && options.cwd ? String(options.cwd) : process.cwd();
      children.push({ file: String(file), args: Array.isArray(args) ? args.map(String) : [], cwd: path.resolve(cwd),
        shell: Boolean(shell || (options && typeof options === 'object' && options.shell)) });
    } catch (_) {}
  };
  const traced = options => {
    const copy = options && typeof options === 'object' ? { ...options } : {};
    const env = { ...(copy.env || process.env) };
    // A child that already carries a trace target (a nested runner tracing its own
    // checks) keeps it; only a child that lost tracing gets this process's target.
    if (!env.CRABSHELL_TRACE_FILE) {
      env.CRABSHELL_TRACE_FILE = out;
      env.CRABSHELL_TRACE_ROOT = root;
      if (requireFlag) env.CRABSHELL_TRACE_REQUIRE = requireFlag;
    }
    const flag = env.CRABSHELL_TRACE_REQUIRE || requireFlag;
    const current = env.NODE_OPTIONS || '';
    if (flag && !current.includes(flag)) env.NODE_OPTIONS = current ? flag + ' ' + current : flag;
    copy.env = env;
    return copy;
  };
  // Where the options object sits: (file, args?, options?, callback?) or (command, options?, callback?).
  const withArgs = (original, kind) => function (...args) {
    const hasArgList = kind !== 'shell';
    let index = hasArgList && Array.isArray(args[1]) ? 2 : 1;
    const given = args[index] && typeof args[index] === 'object' ? args[index] : null;
    if (kind === 'fork') remember(process.execPath, [args[0], ...(Array.isArray(args[1]) ? args[1] : [])], given, false);
    else if (kind === 'shell') remember(args[0], [], given, true);
    else remember(args[0], Array.isArray(args[1]) ? args[1] : [], given, false);
    if (typeof args[index] === 'function' || args[index] === undefined || args[index] === null) {
      if (typeof args[index] === 'function') args.splice(index, 0, traced(null));
      else args[index] = traced(null);
    } else if (typeof args[index] === 'object') args[index] = traced(args[index]);
    return original.apply(this, args);
  };
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) if (typeof cp[name] === 'function') cp[name] = withArgs(cp[name], 'file');
  if (typeof cp.fork === 'function') cp.fork = withArgs(cp.fork, 'fork');
  for (const name of ['exec', 'execSync']) if (typeof cp[name] === 'function') cp[name] = withArgs(cp[name], 'shell');
  process.on('exit', () => {
    try {
      const files = new Set([...seen, ...Object.keys(require.cache)]);
      fs.appendFileSync(out, JSON.stringify([...files]) + '\\n');
      if (children.length) fs.appendFileSync(out, JSON.stringify({ children }) + '\\n');
    } catch (_) {}
  });
}
`;

// A path's place in the project ('/'-separated), or null outside it. git's own data is
// not a project file; everything else a check reads is an input (installed dependencies
// included — updating them changes what the check runs).
function insideRoot(projectRoot, absolute) {
  // fs.cpSync can report Windows extended-length paths, including UNC shares.
  const ordinary = value => value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  const relative = path.relative(ordinary(projectRoot), ordinary(absolute));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const posix = toPosix(relative);
  if (posix.split('/').includes('.git')) return null;
  return posix;
}

function traceLines(traceFile) {
  if (!traceFile || !fs.existsSync(traceFile)) return [];
  const lines = [];
  for (const line of fs.readFileSync(traceFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { lines.push(JSON.parse(line)); } catch (_) {}
  }
  return lines;
}

// The project files and folders ("x/") the traced processes touched.
function readTrace(traceFile, projectRoot) {
  const files = new Set();
  for (const line of traceLines(traceFile)) {
    if (!Array.isArray(line)) continue;
    for (const absolute of line) {
      try {
        const relative = insideRoot(projectRoot, absolute);
        if (!relative) continue;
        if (!fs.existsSync(absolute)) { files.add(relative); continue; }
        const stat = fs.statSync(absolute);
        if (stat.isFile()) files.add(relative);
        else if (stat.isDirectory()) files.add(relative + '/');
      } catch (_) {}
    }
  }
  return files;
}

// The programs the traced processes started.
function readChildren(traceFile) {
  return traceLines(traceFile).filter(line => line && !Array.isArray(line) && Array.isArray(line.children)).flatMap(line => line.children);
}

// Words of a shell command line (quoted parts kept together).
function commandWords(command) {
  return (String(command).match(/"[^"]*"|'[^']*'|\S+/g) || []).map(word => word.replace(/^["']|["']$/g, ''));
}

// Why a trace is incomplete: a started program the tracer cannot follow that works in
// the project or is handed a project path. A Node child carries the tracer (it is the
// same program as the runner's own Node); a program that only works outside the project
// cannot read project files the check depends on.
function incompleteChildren(children, projectRoot) {
  const ownProgram = programName(process.execPath);
  const reasons = new Set();
  for (const child of children) {
    const words = child.shell ? commandWords(child.file) : [child.file, ...(child.args || [])];
    const program = words[0] || '';
    const resolved = /[\\/]/.test(program) ? path.resolve(child.cwd || projectRoot, program) : (findExecutable(program) || program);
    if (programName(resolved) === ownProgram) continue;
    const cwd = path.resolve(child.cwd || projectRoot);
    const inProject = cwd === path.resolve(projectRoot) || insideRoot(projectRoot, cwd) !== null;
    const namesProject = words.slice(1).some(word => {
      try {
        const target = path.resolve(cwd, word);
        return insideRoot(projectRoot, target) !== null && fs.existsSync(target);
      } catch (_) { return false; }
    });
    if (inProject || namesProject) reasons.add(`runs ${programName(resolved) || program} inside the project`);
  }
  return [...reasons];
}

// Files a check's assertions read. (forbiddenChanges paths are compared before and
// after the run, so editing them does not change the check's outcome.)
function contractPaths(entry) {
  const paths = [];
  const contract = entry && entry.contract || {};
  for (const assertion of Array.isArray(contract.assertions) ? contract.assertions : []) {
    for (const value of [assertion && assertion.path, assertion && assertion.actual && assertion.actual.path, assertion && assertion.expected && assertion.expected.path]) {
      if (typeof value === 'string') paths.push(toPosix(value));
    }
  }
  return paths;
}

function traceEnvironment(env, trace, projectRoot) {
  if (!trace) return env;
  const require = `--require "${toPosix(trace.tracer)}"`;
  return { ...env, NODE_OPTIONS: env.NODE_OPTIONS ? `${require} ${env.NODE_OPTIONS}` : require, CRABSHELL_TRACE_FILE: trace.file, CRABSHELL_TRACE_ROOT: projectRoot, CRABSHELL_TRACE_REQUIRE: require };
}

module.exports = { TRACER_SOURCE, insideRoot, readTrace, readChildren, incompleteChildren, commandWords, contractPaths, traceEnvironment };
