#!/usr/bin/env node
'use strict';
// The launchers Crabshell has released (D143_T016): every version of
// skills/verifying/scripts/run-verify.js in git history, plus the current file, as sha256 of
// its text with line ends as LF (an install can change them). SessionStart replaces a
// project's launcher only when it matches one of these — a launcher the user edited stays.
// Run at release (the version bump checklist); writes skills/verifying/scripts/released-launchers.json.
// Usage: node scripts/build-released-launchers.js [--out <file>]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { PLUGIN_LAUNCHER, PLUGIN_ROOT, RELEASED_FILE, launcherHash } = require('./core/runner-sync');
const { writeJson } = require('./utils');

const REPO = PLUGIN_ROOT;
// The launcher's path in git, from where the plugin keeps it.
const LAUNCHER = path.relative(REPO, PLUGIN_LAUNCHER).replace(/\\/g, '/');
const DEFAULT_OUT = path.join(path.dirname(PLUGIN_LAUNCHER), RELEASED_FILE);

function releasedLaunchers(repo = REPO) {
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const commits = git(['log', '--format=%H', '--', LAUNCHER]).split(/\r?\n/).filter(Boolean);
  const seen = new Map();
  for (const commit of commits) {
    let text;
    try { text = git(['show', `${commit}:${LAUNCHER}`]); } catch (_) { continue; } // deleted in that commit
    const sha256 = launcherHash(text);
    if (!seen.has(sha256)) seen.set(sha256, commit.slice(0, 12));
  }
  const current = launcherHash(fs.readFileSync(path.join(repo, LAUNCHER), 'utf8'));
  if (!seen.has(current)) seen.set(current, 'working-tree');
  return [...seen].map(([sha256, commit]) => ({ sha256, commit }));
}

function main(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--out');
  const out = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : DEFAULT_OUT;
  const launchers = releasedLaunchers();
  writeJson(out, { launchers });
  console.log(`${launchers.length} released launchers → ${out}`);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { releasedLaunchers, main };
