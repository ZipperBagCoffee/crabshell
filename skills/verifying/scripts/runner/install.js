'use strict';
// Copy a runner (its launcher and the runner/ folder beside it) into a project's
// verification folder. A single-file runner from before the split has no runner/
// folder; only its launcher is copied.
//
// Each file is written to a temporary name and renamed into place, and modules the new
// runner dropped are removed last, so a runner starting meanwhile (another session, or
// two session starts at once) never reads a half-written file.

const fs = require('fs');
const path = require('path');
const { LAUNCHER_FILE, MODULE_DIR } = require('./layout');

const RENAME_TRIES = 5;
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Write `content` to `file` whole: a temporary file beside it, then a rename. Windows can
// refuse a rename while another process has the target open; retry briefly, and accept a
// target that already holds the same bytes (another process put them there).
function writeWhole(file, content) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, content);
  try {
    for (let attempt = 1; ; attempt++) {
      try { fs.renameSync(temporary, file); return; } catch (error) {
        try { if (fs.readFileSync(file).equals(content)) return; } catch (_) {}
        if (attempt >= RENAME_TRIES || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
        pause(20 * attempt);
      }
    }
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) {}
  }
}

// The runner/ modules beside `fromLauncherFile` into `toDir`/runner/; returns the files written.
function copyModules(fromLauncherFile, toDir) {
  const fromModules = path.join(path.dirname(fromLauncherFile), MODULE_DIR);
  if (!fs.existsSync(fromModules)) return [];
  const toModules = path.join(toDir, MODULE_DIR);
  fs.mkdirSync(toModules, { recursive: true });
  const names = fs.readdirSync(fromModules).filter(file => file.endsWith('.js')).sort();
  const copied = [];
  for (const name of names) {
    writeWhole(path.join(toModules, name), fs.readFileSync(path.join(fromModules, name)));
    copied.push(path.join(toModules, name));
  }
  // A module an older runner had and this one does not is left over, not the user's:
  // runner/ holds only runner code, and every .js file in it counts as the runner.
  for (const stale of fs.readdirSync(toModules).filter(file => file.endsWith('.js') && !names.includes(file))) {
    try { fs.unlinkSync(path.join(toModules, stale)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return copied;
}

// Modules first: a launcher that needs runner/ must not land before it.
function copyRunner(launcherFile, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  const modules = copyModules(launcherFile, toDir);
  writeWhole(path.join(toDir, LAUNCHER_FILE), fs.readFileSync(launcherFile));
  return [path.join(toDir, LAUNCHER_FILE), ...modules];
}

module.exports = { copyRunner, copyModules, writeWhole };
