'use strict';
// One look at the project before a run (D143): every file's size and times. A file's
// content hash is worked out only when a fingerprint needs it, and a hash from the last
// run is reused while the file's size and times are unchanged and the file was last
// written before that run began (git's index rule against same-tick edits).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MISSING = 'MISSING';
const hashBuffer = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

// [size, mtimeMs, ctimeMs, ino] — ino is 0 where the file system has none.
function statOf(stat) {
  return [stat.size, stat.mtimeMs, stat.ctimeMs, Number(stat.ino) || 0];
}

function sameStat(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

// Every file under the project, repo-relative with '/' separators, plus each visited
// folder's names. Folders named .git (git's own data) and excluded paths are skipped;
// symbolic links are not followed.
// skipFolder: folders not walked at all (git-ignored ones — D143_T021); their names still
// appear in their parent's listing.
function walk(projectRoot, isExcluded, skipFolder = () => false) {
  const files = new Map();
  const folders = new Map();
  const visit = (absolute, relative) => {
    let dirents;
    try { dirents = fs.readdirSync(absolute, { withFileTypes: true }); } catch (_) { return; }
    folders.set(relative, dirents.map(dirent => dirent.name).sort());
    for (const dirent of dirents) {
      const rel = relative + dirent.name;
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        if (dirent.name === '.git' || isExcluded(`${rel}/`) || skipFolder(`${rel}/`)) continue;
        visit(path.join(absolute, dirent.name), `${rel}/`);
      } else if (dirent.isFile() && !isExcluded(rel)) {
        try { files.set(rel, statOf(fs.statSync(path.join(absolute, dirent.name)))); } catch (_) {}
      }
    }
  };
  visit(projectRoot, '');
  return { files, folders };
}

// ignored: the git-ignored folders to skip (runner/ignored.js), or none.
function takeSnapshot({ projectRoot, previous = null, isExcluded = () => false, ignored = null }) {
  const takenAt = Date.now();
  let { files, folders } = walk(projectRoot, isExcluded, ignored ? ignored.skip : undefined);
  if (ignored) {
    // The kept list no longer holds (a rule file changed, a folder is new): git was asked
    // again; walk once more when the folders to skip changed.
    if (ignored.refresh(files, folders)) ({ files, folders } = walk(projectRoot, isExcluded, ignored.skip));
    ignored.remember(folders);
  }
  const prior = previous && previous.files && typeof previous.files === 'object' ? previous.files : {};
  const priorTakenAt = previous && Number.isFinite(previous.takenAt) ? previous.takenAt : 0;
  const hashes = new Map();
  // Files a check of this run wrote before later checks read them (D164): how each looked
  // right after (null: not there). restat compares them with that, not with this look.
  const rewritten = new Map();
  const absolute = rel => path.join(projectRoot, ...rel.split('/').filter(Boolean));
  // A hash from the last run still holds for this file.
  const priorHash = rel => {
    const old = prior[rel];
    const stat = files.get(rel);
    return old && typeof old[4] === 'string' && sameStat(stat, old) && stat[1] < priorTakenAt ? old[4] : null;
  };
  const fromDisk = rel => {
    try {
      const target = absolute(rel);
      const stat = fs.statSync(target);
      if (stat.isDirectory()) return hashBuffer(JSON.stringify(fs.readdirSync(target).sort()));
      return hashBuffer(fs.readFileSync(target));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return MISSING;
      throw error; // An unreadable input cannot vouch for a pass.
    }
  };
  // The content identity of a file, or of a folder ("x/": its names).
  const hash = rel => {
    if (hashes.has(rel)) return hashes.get(rel);
    let value;
    if (rel.endsWith('/')) {
      const names = folders.get(rel);
      value = names ? hashBuffer(JSON.stringify(names)) : fromDisk(rel);
    } else {
      value = (files.has(rel) && priorHash(rel)) || fromDisk(rel);
    }
    hashes.set(rel, value);
    return value;
  };
  // The identity of the whole project, for checks whose inputs are unknown: every file's
  // path, size and modification time. Nothing is read, so a touch counts as a change —
  // declaring `inputs` makes such a check precise.
  let project = null;
  const projectIdentity = () => {
    if (project) return project;
    const digest = crypto.createHash('sha256');
    for (const rel of [...files.keys()].sort()) {
      const stat = files.get(rel);
      digest.update(`${rel}\0${stat[0]}\0${stat[1]}\n`);
    }
    project = digest.digest('hex');
    return project;
  };
  // The files that make projectIdentity differ from the last snapshot's: new, gone, or
  // with another size or modification time.
  const projectChanges = () => {
    const changed = [];
    for (const [rel, stat] of files) {
      const old = prior[rel];
      if (!old || old[0] !== stat[0] || old[1] !== stat[1]) changed.push(rel);
    }
    for (const rel of Object.keys(prior)) if (!files.has(rel)) changed.push(rel);
    return changed.sort();
  };
  return {
    takenAt,
    projectIdentity,
    projectChanges,
    has: rel => files.has(rel),
    list: () => [...files.keys()],
    stat: rel => files.get(rel),
    hash,
    // Files that are new, gone or have other content than in the last snapshot. A file
    // whose size and times are unchanged since before that snapshot is not read again.
    changedFiles() {
      const changed = [];
      for (const [rel, stat] of files) {
        const old = prior[rel];
        if (!old) { changed.push(rel); continue; }
        if (sameStat(stat, old) && stat[1] < priorTakenAt) continue;
        if (typeof old[4] !== 'string' || hash(rel) !== old[4]) changed.push(rel);
      }
      for (const rel of Object.keys(prior)) if (!files.has(rel)) changed.push(rel);
      return changed.sort();
    },
    // Files whose size or times differ now from this snapshot (written while checks ran):
    // the given files only, or — with no list — the whole project.
    restat(only = null) {
      const changed = new Set();
      if (only) {
        for (const rel of only) {
          if (rel.endsWith('/')) {
            // A folder input is its names: a file added or removed there changes it.
            let names = null;
            try { names = fs.readdirSync(absolute(rel)).sort(); } catch (_) {}
            const before = folders.get(rel);
            if (JSON.stringify(names) !== JSON.stringify(before === undefined ? names : before)) changed.add(rel);
            continue;
          }
          let now = null;
          try { now = statOf(fs.statSync(absolute(rel))); } catch (_) {}
          if (rewritten.has(rel)) {
            const then = rewritten.get(rel);
            if (then === null ? now !== null : !sameStat(now, then)) changed.add(rel);
            continue;
          }
          if (!files.has(rel)) {
            // A file outside the snapshot (Crabshell's state, `exclude`, `outputs`) had no
            // earlier look: it was written during the run when its times are not older
            // than this snapshot.
            if (now && (now[1] >= takenAt || now[2] >= takenAt)) changed.add(rel);
            continue;
          }
          if (!sameStat(now, files.get(rel))) changed.add(rel);
        }
        return changed;
      }
      const now = walk(projectRoot, isExcluded, ignored ? ignored.skip : undefined).files;
      for (const [rel, stat] of now) if (!sameStat(stat, files.get(rel))) changed.add(rel);
      for (const rel of files.keys()) if (!now.has(rel)) changed.add(rel);
      return changed;
    },
    // Files a check of this run just wrote: their next hash is read from disk, and restat
    // compares each file with how it is now.
    refresh(rels) {
      for (const rel of rels) {
        hashes.delete(rel);
        if (rel.endsWith('/')) continue;
        let now = null;
        try { now = statOf(fs.statSync(absolute(rel))); } catch (_) {}
        rewritten.set(rel, now);
      }
    },
    // Size, times and the hash where one is known, for the next run's snapshot.
    serialize() {
      const out = {};
      for (const [rel, stat] of files) {
        const known = hashes.has(rel) ? hashes.get(rel) : priorHash(rel);
        out[rel] = [...stat, typeof known === 'string' && known !== MISSING ? known : null];
      }
      return { takenAt, files: out };
    },
  };
}

module.exports = { takeSnapshot, MISSING, hashBuffer };
