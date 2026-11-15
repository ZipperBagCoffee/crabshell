'use strict';
// D175_T003: a command that makes files is not started unnoticed while another worktree of
// the same repository has changes to its inputs: once those changes land, what the run made
// is out of date and must be made again. PreToolUse judges a shell command that runs a
// declaration with `outputs` in the verification manifest (a check entry or a launch). Its
// inputs are the declaration's `inputs` and the project files its command line names;
// another worktree's changes are its uncommitted files (git status, without taking its index
// lock) and the files its commits changed that the command's worktree lacks (git diff
// HEAD...<its HEAD>). The answer is one line, or a refusal when the manifest says
// `pendingInputs: "refuse"`. Commands that make no files are not judged: they waste nothing,
// and a notice at every edit in a worktree would be noise. The project is found on the file
// system, so git runs only after a declaration matched — except in a linked worktree that
// holds no manifest, which asks git where the main worktree is. CRABSHELL_OVERLAP=1 before
// the command runs it anyway. Every failure means "no decision".

const fs = require('fs');
const path = require('path');
const { STORAGE_ROOT } = require('../constants');
const { shellCommand } = require('./tool-shape');
const { overrideSyntax, readJsonObject } = require('./overlap-text');

const RUNNER_DIR = '../../skills/verifying/scripts/runner';
const MANIFEST = path.join(STORAGE_ROOT, 'verification', 'manifest.json');
// The sentence every notice ends with.
const OUT_OF_DATE = 'What this run makes will be out of date once those changes land.';
// How many files a notice names per worktree before "(n more)".
const MAX_LISTED = 10;

const runner = name => require(`${RUNNER_DIR}/${name}`);
const fold = value => (process.platform === 'win32' ? value.toLowerCase() : value);

// A path as the file system spells it (links and short names resolved), so it compares with
// the paths git prints; the resolved path itself when it does not exist.
function realPath(file) {
  try { return fs.realpathSync.native(file); } catch (_) { return path.resolve(file); }
}
const samePath = (a, b) => fold(realPath(a)) === fold(realPath(b));

// file relative to root as a POSIX path ('' for root itself), or null when it is outside.
function relativeInside(root, file) {
  const relative = path.relative(root, file);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
  return relative.replace(/\\/g, '/');
}

// The nearest folder at or above dir holding a `.git` entry, as git itself finds a worktree:
// { root, linked } (linked: a .git file — a linked worktree), or null outside git.
function gitEntryAbove(dir) {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    try { return { root: current, linked: fs.statSync(path.join(current, '.git')).isFile() }; } catch (_) {}
    if (path.dirname(current) === current) return null;
  }
}

// The nearest folder from dir up to root that holds the manifest, or null.
function manifestFolderAbove(dir, root) {
  for (let current = path.resolve(dir); relativeInside(root, current) !== null; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, MANIFEST))) return current;
    if (path.dirname(current) === current) break;
  }
  return null;
}

// git in a folder, never taking optional locks (runner/resources.js): its output, or null.
const git = (cwd, args) => runner('resources').git(args, cwd);

// The paths of `git status --porcelain=v1 -z`: each record is "XY path"; a rename or a copy
// (R or C in XY) is followed by its source path as a field of its own.
function statusPaths(out) {
  const fields = out.split('\0');
  const paths = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (field.length < 4) continue;
    paths.push(field.slice(3));
    if (/[RC]/.test(field.slice(0, 2)) && fields[index + 1]) paths.push(fields[++index]);
  }
  return paths;
}

// What another worktree has that this one lacks, as repo-relative paths: its uncommitted
// files (tracked and untracked) and the files its commits since the common base changed.
// A part git cannot tell is empty.
function pendingChanges(here, there) {
  const status = git(there, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const head = git(there, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const theirs = head ? head.trim() : '';
  // --no-renames: an input moved there is named at its old path too.
  const diff = theirs ? git(here, ['diff', '--name-only', '-z', '--no-renames', `HEAD...${theirs}`]) : null;
  return { uncommitted: status === null ? [] : statusPaths(status), committed: diff === null ? [] : diff.split('\0').filter(Boolean) };
}

// The declarations whose command makes files: check entries (discovered ones expanded) and
// launches, each with `outputs`.
function producersOf(manifest, projectRoot, patternList) {
  let entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  try { entries = runner('manifest').expandEntries(manifest, projectRoot); } catch (_) {}
  const launches = Array.isArray(manifest.launches) ? manifest.launches : [];
  return [...entries.filter(entry => entry && entry.type !== 'manual'), ...launches]
    .filter(item => item && typeof item === 'object' && item.command && patternList(item.outputs).length > 0);
}

// The project files a command names: each word that is not a flag and resolves, from the
// folder the command runs in, to an existing file inside the project root.
function namedFiles(segment, projectRoot) {
  const files = [];
  for (const token of segment.tokens) {
    if (!token || token.startsWith('-') || token.includes('://')) continue;
    try {
      const absolute = realPath(path.resolve(segment.cwd || projectRoot, token));
      if (!fs.statSync(absolute).isFile()) continue;
      const relative = relativeInside(projectRoot, absolute);
      if (relative) files.push(relative);
    } catch (_) {}
  }
  return files;
}

// The files of one worktree by kind, at most MAX_LISTED in all:
// "a, b (uncommitted); c (2 more) (committed there)".
function listing(groups) {
  let left = MAX_LISTED;
  return groups.filter(([files]) => files.length).map(([files, label]) => {
    const shown = files.slice(0, Math.max(left, 0));
    left -= shown.length;
    const hidden = files.length - shown.length;
    if (shown.length === 0) return `${hidden} more (${label})`;
    return `${shown.join(', ')}${hidden ? ` (${hidden} more)` : ''} (${label})`;
  }).join('; ');
}

// The notices for the matched commands that run in one project folder (sideRoot): what each
// other worktree has changed among their inputs. here: the run folder's worktree root.
function sideNotices({ sideRoot, matches, command, here, select, resources }) {
  const gitRoot = resources.worktreeRoot(sideRoot);
  if (!gitRoot) return [];
  // Where the project sits in its worktree: git prints paths from the worktree root.
  const prefix = relativeInside(realPath(gitRoot), sideRoot);
  if (prefix === null) return [];
  const projectPath = file => (prefix === '' ? file : fold(file).startsWith(fold(`${prefix}/`)) ? file.slice(prefix.length + 1) : null);

  // Inputs: the declared ones, and the files the commands name that they do not make.
  const declared = [...new Set(matches.flatMap(({ item }) => select.patternList(item.inputs)))];
  const outputs = matches.flatMap(({ item }) => select.patternList(item.outputs));
  const named = new Set(matches.flatMap(({ segment }) => namedFiles(segment, sideRoot))
    .filter(file => !outputs.some(pattern => select.underPattern(pattern, file))).map(fold));
  if (declared.length === 0 && named.size === 0) return [];
  const isInput = file => {
    const relative = projectPath(file);
    return relative !== null && (named.has(fold(relative)) || declared.some(pattern => select.matchesInput(pattern, relative)));
  };

  const where = here && samePath(here, gitRoot) ? 'this worktree' : gitRoot;
  const notices = [];
  for (const worktree of resources.worktrees(gitRoot)) {
    if (samePath(worktree, gitRoot)) continue;
    const { uncommitted, committed } = pendingChanges(gitRoot, worktree);
    const pending = [...new Set(uncommitted.filter(isInput))];
    const landed = [...new Set(committed.filter(isInput))].filter(file => !pending.includes(file));
    if (pending.length === 0 && landed.length === 0) continue;
    notices.push(`Worktree ${worktree} has changes to inputs of \`${command}\` not in ${where}: ${listing([[pending, 'uncommitted'], [landed, 'committed there']])}.`);
  }
  return notices;
}

// { reason } to refuse, { context } for one line, or null.
function pendingInputsDecision(payload, projectDir) {
  try {
    const command = shellCommand(payload);
    if (!command) return null;
    const start = payload.tool_input.workdir || payload.cwd || projectDir;
    if (typeof start !== 'string' || !start) return null;
    const runDir = realPath(start);

    // The project: the nearest folder holding a manifest in the run folder's worktree, else —
    // in a linked worktree — the worktree root, judged by the main worktree's manifest.
    const place = gitEntryAbove(runDir);
    if (!place) return null;
    let projectRoot = manifestFolderAbove(runDir, place.root);
    let manifestPath = projectRoot ? path.join(projectRoot, MANIFEST) : null;
    const resources = runner('resources');
    if (!projectRoot) {
      if (!place.linked) return null;
      projectRoot = place.root;
      manifestPath = resources.manifestPathFor(projectRoot, MANIFEST);
    }
    const manifest = manifestPath ? readJsonObject(manifestPath) : null;
    if (!manifest) return null;
    const select = runner('select');
    const producers = producersOf(manifest, projectRoot, select.patternList);
    if (producers.length === 0) return null;

    const { shellSegments, matchesCommand } = runner('command-match');
    const { OVERRIDE_ENV } = runner('run-record');
    const segments = shellSegments(command, runDir, { wrappers: manifest.wrappers });
    if (segments.some(segment => segment.env && segment.env[OVERRIDE_ENV] === '1')) return null;
    // The project folder a folder belongs to: this project, or the same folder in another
    // worktree (a `cd` there); paths on both sides of a match are read from it.
    const prefix = relativeInside(place.root, projectRoot);
    if (prefix === null) return null;
    const sideOf = folder => {
      const resolved = path.resolve(folder);
      if (relativeInside(projectRoot, resolved) !== null) return projectRoot;
      const other = gitEntryAbove(resolved);
      const candidate = other ? path.join(other.root, prefix) : null;
      return candidate && relativeInside(candidate, resolved) !== null ? candidate : null;
    };
    const rootOf = folder => sideOf(folder) || folder;
    const sides = new Map();
    for (const segment of segments) {
      const sideRoot = sideOf(segment.cwd || runDir);
      if (!sideRoot) continue;
      for (const item of producers) {
        const declaredCwd = path.resolve(projectRoot, typeof item.command.cwd === 'string' ? item.command.cwd : '.');
        const whenArgs = Array.isArray(item.whenArgs) ? item.whenArgs : [];
        if (!matchesCommand(item.command, segment, { declaredCwd, rootOf, whenArgs })) continue;
        const key = fold(sideRoot);
        if (!sides.has(key)) sides.set(key, { sideRoot, matches: [] });
        sides.get(key).matches.push({ segment, item });
      }
    }
    if (sides.size === 0) return null;

    const notices = [...sides.values()].flatMap(({ sideRoot, matches }) =>
      sideNotices({ sideRoot, matches, command, here: place.root, select, resources }));
    if (notices.length === 0) return null;
    const text = `${notices.join(' ')} ${OUT_OF_DATE}`;
    if (manifest.pendingInputs === 'refuse') {
      return { reason: `${text} Finish or drop those changes first, or run it anyway with ${overrideSyntax(payload, command, OVERRIDE_ENV)}.` };
    }
    return { context: `[CRABSHELL] ${text}` };
  } catch (_) {
    return null;
  }
}

module.exports = { pendingInputsDecision, OUT_OF_DATE };
