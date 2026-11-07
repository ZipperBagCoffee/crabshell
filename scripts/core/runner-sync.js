'use strict';
// SessionStart keeps a project's runner copy current (D143_T016, v2 §7): a project with a
// manifest gets the plugin's runner/ modules when they differ, and its launcher when the
// launcher is missing or is one Crabshell released (any past version, line ends as LF).
// A launcher the user edited stays, with one line saying so. A project that holds the
// runner source (the plugin's own repository) is left alone, so an installed older copy
// never overwrites the one being developed. Every failure means "nothing done".

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { STORAGE_ROOT, MEMORY_DIR } = require('../constants');
const { readJsonOrDefault, writeJson } = require('../utils');
const { copyModules, writeWhole } = require('../../skills/verifying/scripts/runner/install');
const { MODULE_DIR, LAUNCHER_FILE } = require('../../skills/verifying/scripts/runner/layout');

const RELEASED_FILE = 'released-launchers.json';
const SYNC_RECORD = 'runner-sync.json';
const PLUGIN_ROOT = path.join(__dirname, '..', '..');
// The plugin's launcher sits beside the runner modules this file loads.
const PLUGIN_LAUNCHER = path.join(path.dirname(path.dirname(require.resolve('../../skills/verifying/scripts/runner/layout'))), LAUNCHER_FILE);

const lf = text => String(text).replace(/\r\n/g, '\n');
// A launcher's identity: sha256 of its text with line ends as LF (an install can change them).
const launcherHash = text => crypto.createHash('sha256').update(lf(text)).digest('hex');

// Names and bytes of the .js modules in a folder, as one hash; null when there are none.
function moduleIdentity(moduleDir) {
  let names;
  try { names = fs.readdirSync(moduleDir).filter(name => name.endsWith('.js')).sort(); } catch (_) { return null; }
  if (!names.length) return null;
  const hash = crypto.createHash('sha256');
  for (const name of names) hash.update(name).update('\0').update(fs.readFileSync(path.join(moduleDir, name))).update('\0');
  return hash.digest('hex');
}

function releasedHashes(pluginLauncher) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(path.dirname(pluginLauncher), RELEASED_FILE), 'utf8')).launchers;
    return new Set((Array.isArray(list) ? list : []).map(item => item && item.sha256).filter(Boolean));
  } catch (_) { return new Set(); }
}

// Returns { copiedModules, launcher: 'written'|'replaced'|'kept-edited'|'same', notice } or null.
function syncRunner(projectDir, { pluginLauncher = PLUGIN_LAUNCHER, pluginRoot = PLUGIN_ROOT } = {}) {
  try {
    const verification = path.join(projectDir, STORAGE_ROOT, 'verification');
    if (!fs.existsSync(path.join(verification, 'manifest.json')) || !fs.existsSync(pluginLauncher)) return null;
    // The project holds the runner source where the plugin keeps it: the plugin itself.
    if (fs.existsSync(path.join(projectDir, path.relative(pluginRoot, pluginLauncher)))) return null;
    const result = { copiedModules: false, launcher: null, notice: null };
    if (moduleIdentity(path.join(path.dirname(pluginLauncher), MODULE_DIR)) !== moduleIdentity(path.join(verification, MODULE_DIR))) {
      copyModules(pluginLauncher, verification);
      result.copiedModules = true;
    }
    const launcher = path.join(verification, LAUNCHER_FILE);
    const pluginBytes = fs.readFileSync(pluginLauncher);
    if (!fs.existsSync(launcher)) {
      writeWhole(launcher, pluginBytes);
      result.launcher = 'written';
      return result;
    }
    const current = lf(fs.readFileSync(launcher, 'utf8'));
    if (current === lf(pluginBytes.toString('utf8'))) {
      result.launcher = 'same';
    } else if (releasedHashes(pluginLauncher).has(launcherHash(current))) {
      writeWhole(launcher, pluginBytes);
      result.launcher = 'replaced';
    } else {
      result.launcher = 'kept-edited';
      // Named once per launcher content: a launcher kept on purpose is not named every
      // session; a further edit is named again.
      const record = path.join(projectDir, STORAGE_ROOT, MEMORY_DIR, SYNC_RECORD);
      const hash = launcherHash(current);
      if ((readJsonOrDefault(record, {}) || {}).keptLauncher === hash) return result;
      writeJson(record, { keptLauncher: hash });
      result.notice = `[CRABSHELL] ${path.relative(projectDir, launcher).replace(/\\/g, '/')} differs from every launcher Crabshell released, so it was kept; the runner modules beside it ${result.copiedModules ? 'were updated' : 'are current'}. To use them, replace it with the plugin's launcher (${pluginLauncher.replace(/\\/g, '/')}).`;
    }
    return result;
  } catch (_) {
    return null;
  }
}

// The line for the session start context, or ''.
function runnerSyncNotice(projectDir) {
  const result = syncRunner(projectDir);
  return (result && result.notice) || '';
}

module.exports = { syncRunner, runnerSyncNotice, moduleIdentity, PLUGIN_LAUNCHER, PLUGIN_ROOT, RELEASED_FILE, launcherHash };
