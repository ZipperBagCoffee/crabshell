'use strict';
// The folders git ignores, so the project walk can skip them (D143_T021): a dependency
// folder of thousands of files made every walk — and every hook call that needs one —
// slow. The list comes from git itself (`git ls-files -o -i --exclude-standard
// --directory`), not from a list of names, and is kept beside the records with what it was
// built from: the folders walked then and the rule files (.gitignore files in the project
// and above it, and the repository's info/exclude where git keeps it). Git is asked again
// only when a rule file changed or the walk met a folder it had not seen. The verification
// folder and the folders above it are walked even when git ignores them. Without git (or
// when it fails) nothing is skipped. A broken or missing list counts as none.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeWhole } = require('./install');
const { insideRoot } = require('./trace');

const RECORD_FILE = 'ignored-folders.json';
const RULE_FILE = '.gitignore';

function git(cwd, args) {
  try {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return result.status === 0 ? result.stdout : null;
  } catch (_) { return null; }
}
const statKey = file => { try { const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}`; } catch (_) { return 'missing'; } };

function readRecord(file) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!record || !Array.isArray(record.ignored) || !Array.isArray(record.walked) || !record.rules || typeof record.rules !== 'object') return null;
    return record;
  } catch (_) { return null; }
}

// The rule files git reads for this project that lie outside its walk: .gitignore files
// in the folders above it up to the repository's top, and info/exclude where git keeps it
// (a worktree or a subfolder project has no .git/info/exclude at its own root).
function outsideRules(projectRoot) {
  const rules = [];
  const exclude = git(projectRoot, ['rev-parse', '--git-path', 'info/exclude']);
  if (exclude) rules.push(path.resolve(projectRoot, exclude.trim()));
  const top = git(projectRoot, ['rev-parse', '--show-toplevel']);
  if (top) {
    const topDir = path.resolve(top.trim());
    // Up from the project to the repository's top, each folder's .gitignore.
    let dir = path.resolve(projectRoot);
    while (insideRoot(topDir, dir) !== null) {
      dir = path.dirname(dir);
      rules.push(path.join(dir, RULE_FILE));
    }
  }
  return rules;
}

// Whether a .git (folder, or a worktree's file) is in the project or a folder above it.
function repositoryAround(projectRoot) {
  for (let dir = path.resolve(projectRoot); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

// layout: the runner's layout (its launcher folder holds the kept list).
function ignoredFolders({ projectRoot, layout }) {
  const recordPath = path.join(layout.launcherDir, RECORD_FILE);
  const launcher = insideRoot(projectRoot, layout.launcherDir);
  const keep = rel => Boolean(launcher) && `${launcher}/`.startsWith(rel);
  let record = readRecord(recordPath);
  let ignored = new Set(record ? record.ignored : []);
  const save = next => { try { writeWhole(recordPath, Buffer.from(JSON.stringify(next) + '\n')); record = next; } catch (_) {} };
  // The rule files' identities now: those the walk saw in the project, and those outside it.
  const rulesNow = (files, outside) => {
    const rules = {};
    for (const [rel, stat] of files) if (path.posix.basename(rel) === RULE_FILE) rules[rel] = `${stat[0]}:${stat[1]}`;
    for (const file of outside) rules[file] = statKey(file);
    return rules;
  };
  const sameRules = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);

  return {
    recordPath,
    skip: rel => ignored.has(rel) && !keep(rel),
    // After a walk (its files and folders): whether the kept list still holds. When it does
    // not, git is asked once and the list saved; true when the walk must run again (the
    // folders to skip changed).
    refresh(files, folders) {
      const walked = [...folders.keys()].filter(Boolean);
      const outside = record ? Object.keys(record.rules).filter(key => path.isAbsolute(key)) : [];
      // A list made without git holds only while there is still no repository around the
      // project (a later `git init` must be noticed).
      const gitAppeared = record && record.git === false && repositoryAround(projectRoot);
      if (record && !gitAppeared && sameRules(record.rules, rulesNow(files, outside))) {
        const seen = new Set(record.walked);
        if (walked.every(rel => seen.has(rel))) return false;
      }
      const listed = git(projectRoot, ['ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z']);
      const next = new Set(listed === null ? [] : listed.split('\0').filter(rel => rel.endsWith('/')));
      const changed = next.size !== ignored.size || [...next].some(rel => !ignored.has(rel));
      ignored = next;
      save({ git: listed !== null, ignored: [...next].sort(), walked: walked.sort(), rules: rulesNow(files, listed === null ? [] : outsideRules(projectRoot)) });
      return changed;
    },
    // The folders of the walk that counted, so a later walk knows which ones are new.
    remember(folders) {
      if (!record) return;
      const walked = [...folders.keys()].filter(Boolean).sort();
      if (walked.length === record.walked.length && walked.every((rel, index) => rel === record.walked[index])) return;
      save({ ...record, walked });
    },
  };
}

module.exports = { ignoredFolders, RECORD_FILE };
