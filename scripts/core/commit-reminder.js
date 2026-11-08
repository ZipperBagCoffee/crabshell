'use strict';
// Check once, before the commit (D151_T002): the moment "everything is fixed" is the
// commit. When a commit is about to run and the files in the working tree would make a
// routine check run select checks (they changed since those checks last passed), one
// line says so. It never blocks — commits are not gated (D143) — it is shown once for the
// same project content, and it is silent when nothing would run (a change no check reads,
// no manifest) and on any failure.

const path = require('path');
const { STORAGE_ROOT, MEMORY_DIR } = require('../constants');
const { readJsonOrDefault, writeJson } = require('../utils');
const { shellCommand } = require('./tool-shape');
const { isGitCommit } = require('./command-observation');
const projectState = require('./project-state');

const NAMES_SHOWN = 5;
const SHOWN_FILE = 'commit-reminder.json';

// PreToolUse of a shell call: the reminder line, or null.
function commitReminder(payload, projectDir) {
  try {
    const command = shellCommand(payload);
    if (!command || !projectDir || !isGitCommit(command)) return null;
    const pending = projectState.pendingChecks(projectDir, projectState.viewFor(payload, projectDir));
    if (!Array.isArray(pending) || pending.length === 0) return null;
    const identity = projectState.contentIdentity(projectDir);
    const file = path.join(projectDir, STORAGE_ROOT, MEMORY_DIR, SHOWN_FILE);
    const shown = readJsonOrDefault(file, {}) || {};
    if (projectState.sameIdentity(shown.identity, identity)) return null;
    writeJson(file, { identity, at: new Date().toISOString() });
    const names = pending.slice(0, NAMES_SHOWN).join(', ') + (pending.length > NAMES_SHOWN ? `, and ${pending.length - NAMES_SHOWN} more` : '');
    const launcher = path.posix.join(STORAGE_ROOT, 'verification', 'run-verify.js');
    return `[CRABSHELL] Files changed since these checks last passed: ${names}. Run node ${launcher} --changed once now, before this commit.`;
  } catch (_) {
    return null;
  }
}

module.exports = { commitReminder };
