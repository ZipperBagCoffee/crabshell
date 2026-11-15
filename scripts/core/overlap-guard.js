'use strict';
// D175_T001: a check the runner is running now is not started again by hand. PreToolUse
// reads the live runs' records (skills/verifying/scripts/runner/run-record.js): a shell
// command with a part that is a manifest check a live run of this project is running is
// refused — its result will be in the runner's record. A command that starts the runner
// itself gets one line (the new run waits for the checks it shares and uses their results).
// A running check older than its timeout over every attempt is not counted (a record whose
// process id was taken over). CRABSHELL_OVERLAP=1 before the command runs it anyway. No live
// run means nothing is read beyond the records folder. Every failure means "no decision".

const path = require('path');
const { STORAGE_ROOT } = require('../constants');
const { shellCommand } = require('./tool-shape');
const { localTime } = require('./rerun-guard');
const { overrideSyntax, readJsonObject } = require('./overlap-text');

const RUNNER_DIR = '../../skills/verifying/scripts/runner';
const LAUNCHER = 'run-verify.js';
// Attempts a check may take (the first run and the runner's retry), for the age a record can reach.
const ATTEMPT_ALLOWANCE = 2;

const runner = name => require(`${RUNNER_DIR}/${name}`);
const verificationDir = projectDir => path.join(projectDir, STORAGE_ROOT, 'verification');

// { reason } to refuse, { context } for one line, or null.
function overlapDecision(payload, projectDir) {
  try {
    const command = shellCommand(payload);
    if (!command || !projectDir) return null;
    const dir = verificationDir(projectDir);
    const manifestPath = path.join(dir, 'manifest.json');
    const runRecord = runner('run-record');
    const live = runRecord.liveRecords(manifestPath);
    if (live.length === 0) return null;
    const manifest = readJsonObject(manifestPath);
    if (!manifest) return null;
    const { shellSegments, matchesCommand } = runner('command-match');
    const cwd = (payload.tool_input && payload.tool_input.workdir) || payload.cwd || projectDir;
    const segments = shellSegments(command, cwd, { wrappers: manifest.wrappers });
    if (segments.some(segment => segment.env && segment.env[runRecord.OVERRIDE_ENV] === '1')) return null;
    // Paths on both sides are read from the project root, whatever folder a `cd` reached.
    const root = path.resolve(projectDir);
    const rootOf = folder => {
      const relative = path.relative(root, path.resolve(folder));
      return relative.startsWith('..') || path.isAbsolute(relative) ? folder : root;
    };

    // The runner itself: one line, and its words are not judged as a check.
    const launcher = ['node', path.relative(root, path.join(dir, LAUNCHER)).replace(/\\/g, '/')];
    const runnerParts = segments.filter(segment => matchesCommand(launcher, segment, { declaredCwd: root, rootOf }));
    const others = segments.filter(segment => !runnerParts.includes(segment));

    let entries = Array.isArray(manifest.entries) ? manifest.entries : [];
    try { entries = runner('manifest').expandEntries(manifest, projectDir); } catch (_) {}
    let defaultTimeout = 0;
    try { defaultTimeout = runner('execute').DEFAULT_TIMEOUT_MS || 0; } catch (_) {}
    const byId = new Map(entries.filter(entry => entry && entry.id).map(entry => [entry.id, entry]));
    const running = new Map();
    for (const record of live) {
      for (const item of Array.isArray(record.running) ? record.running : []) {
        if (!item || !item.id || running.has(item.id)) continue;
        const entry = byId.get(item.id);
        const limit = ATTEMPT_ALLOWANCE * ((entry && Number(entry.timeout)) || defaultTimeout);
        const started = Date.parse(item.startedAt || record.startedAt);
        if (limit > 0 && Number.isFinite(started) && Date.now() - started > limit) continue;
        running.set(item.id, { record, item });
      }
    }
    for (const segment of others) {
      for (const entry of entries) {
        if (!entry || entry.type === 'manual' || !entry.command || !running.has(entry.id)) continue;
        const declaredCwd = path.resolve(root, (entry.command && entry.command.cwd) || '.');
        if (!matchesCommand(entry.command, segment, { declaredCwd, rootOf })) continue;
        const { record, item } = running.get(entry.id);
        return {
          reason: `\`${command}\` is check ${entry.id}, and the runner (pid ${record.pid}, since ${localTime(item.startedAt || record.startedAt)}) is running it now; its result will be in the runner's record. Wait for that run, or run it anyway with ${overrideSyntax(payload, command, runRecord.OVERRIDE_ENV)}.`,
          entryId: entry.id,
        };
      }
    }
    if (runnerParts.length) {
      return { context: `[CRABSHELL] A run (pid ${live[0].pid}) is in progress in this project; checks it is running will be waited for and its results used.` };
    }
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = { overlapDecision };
