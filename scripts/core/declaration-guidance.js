'use strict';
// The project keeps its check list right by itself (D143_T015). After a declared manifest
// entry run by hand, a one-line hint says what to declare: "inputs" (it runs a program
// other than the runner's Node, so its inputs are unknown), "slow" (it took longer than
// slowAfterSeconds), "outputs" (it wrote files while it ran). An undeclared command that
// took longer than suggestAfterSeconds and finished twice on the same files gets one hint
// to declare it. Each hint is shown once. Nothing here blocks, and every failure is silent.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { STORAGE_ROOT, MEMORY_DIR, RUN_SNAPSHOT_MAX_AGE_MS } = require('../constants');
const { readJsonOrDefault, writeJson } = require('../utils');
const { shellCommand } = require('./tool-shape');
const { findDeclaration, checkInvocation, isToolFailure } = require('./command-observation');

// The OWASP budget for a pre-commit hook (D143 10:55, I096): a command slower than this
// is worth declaring when it repeats. A manifest's suggestAfterSeconds overrides it.
const DEFAULT_SUGGEST_AFTER_SECONDS = 15;
const REPEAT_RECORDS = 50;
const NAMES_SHOWN = 5;

const memoryFile = (projectDir, name) => path.join(projectDir, STORAGE_ROOT, MEMORY_DIR, name);
const beforeRunFolder = projectDir => memoryFile(projectDir, 'run-snapshots');
const cwdOf = (payload, projectDir) => payload.tool_input?.workdir || payload.cwd || projectDir;
const safeName = id => String(id).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);

function manifestOf(projectDir) {
  const manifest = readJsonOrDefault(path.join(projectDir, STORAGE_ROOT, 'verification', 'manifest.json'), {});
  return manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : {};
}

function manifestEntries(projectDir, manifest) {
  try {
    return require('../../skills/verifying/scripts/runner/manifest').expandEntries(manifest, projectDir);
  } catch (_) { return []; }
}

// Size and modification time of every file in a snapshot of the project.
function fileStats(snapshot) {
  const stats = {};
  for (const rel of snapshot.list()) { const stat = snapshot.stat(rel); stats[rel] = [stat[0], stat[1]]; }
  return stats;
}

// PreToolUse, for an allowed run of a declared entry: the project's files as they are now,
// so the run's written files can be named afterwards.
function beforeRun(payload, projectDir) {
  try {
    const command = shellCommand(payload);
    if (!command || !payload.tool_use_id || !projectDir) return null;
    const declaration = findDeclaration(command, projectDir, cwdOf(payload, projectDir));
    if (!declaration || declaration.source !== 'entry') return null;
    const folder = beforeRunFolder(projectDir);
    fs.mkdirSync(folder, { recursive: true });
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name);
      try { if (Date.now() - fs.statSync(file).mtimeMs > RUN_SNAPSHOT_MAX_AGE_MS) fs.rmSync(file, { force: true }); } catch (_) {}
    }
    // The same walk the rerun check of this hook call made (core/project-state viewFor).
    const { viewFor } = require('./project-state');
    writeJson(path.join(folder, `${safeName(payload.tool_use_id)}.json`), { entryId: declaration.entryId, stats: fileStats(viewFor(payload, projectDir).snapshot) });
  } catch (_) {}
  return null;
}

// Claude reports duration_ms; Codex's own completion record has the start and end.
function durationOf(payload, projectDir, host) {
  if (Number.isFinite(payload.duration_ms)) return payload.duration_ms;
  if (host !== 'codex') return null;
  try {
    const record = require('./host-tool-result').readCodexCommandResult(payload, projectDir);
    return record && Number.isFinite(record.startedAtMs) && Number.isFinite(record.completedAtMs) ? record.completedAtMs - record.startedAtMs : null;
  } catch (_) { return null; }
}

// Files new or changed between the before-run record and now, minus the entry's declared
// outputs (the snapshot leaves those out already; checked again here by the entry's own list).
function writtenDuringRun(payload, projectDir, entry) {
  const file = path.join(beforeRunFolder(projectDir), `${safeName(payload.tool_use_id)}.json`);
  let before = null;
  try { before = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
  try { fs.rmSync(file, { force: true }); } catch (_) {}
  const now = fileStats(require('./project-state').projectState(projectDir).snapshot());
  const { patternList, matchesInput } = require('../../skills/verifying/scripts/runner/select');
  const declared = patternList(entry.outputs);
  return Object.keys(now)
    .filter(rel => !before.stats[rel] || before.stats[rel][0] !== now[rel][0] || before.stats[rel][1] !== now[rel][1])
    .filter(rel => !declared.some(pattern => matchesInput(pattern, rel)))
    .sort();
}

// Another session or an editor can change files while a check runs, so a file counts as the
// entry's product only when it changed during two runs of that entry in a row (D143_T015
// review): this run's changes are kept, and the overlap with the previous run's is returned.
// entryIds: the manifest's entries now; ids it no longer has are dropped from the file.
function writtenInTwoRuns(projectDir, entryId, written, entryIds) {
  const file = memoryFile(projectDir, 'output-candidates.json');
  const stored = readJsonOrDefault(file, {}) || {};
  const previous = Array.isArray(stored[entryId]) ? stored[entryId] : null;
  const candidates = Object.fromEntries(Object.entries(stored).filter(([id]) => entryIds.includes(id)));
  candidates[entryId] = written;
  writeJson(file, candidates);
  return previous ? written.filter(rel => previous.includes(rel)) : [];
}

function entryHints(payload, projectDir, declaration, durationMs) {
  const manifest = manifestOf(projectDir);
  const entries = manifestEntries(projectDir, manifest);
  const entry = entries.find(item => item.id === declaration.entryId);
  if (!entry) return [];
  const id = declaration.entryId;
  const hints = [];
  const { runsOnRunnerNode } = require('../../skills/verifying/scripts/runner/fingerprint');
  if (!runsOnRunnerNode(entry.command) && !(Array.isArray(entry.inputs) && entry.inputs.length)) {
    hints.push({ key: `${id}:inputs`, text: `[CRABSHELL] ${id} runs a program other than the runner's Node, so its inputs are unknown and any project change reruns it. Declare "inputs" for it in the manifest (the files it reads) so it reruns only when they change.` });
  }
  const { DEFAULT_SLOW_AFTER_SECONDS } = require('../../skills/verifying/scripts/runner/select');
  const slowAfter = Number.isFinite(manifest.slowAfterSeconds) && manifest.slowAfterSeconds > 0 ? manifest.slowAfterSeconds : DEFAULT_SLOW_AFTER_SECONDS;
  if (durationMs !== null && durationMs > slowAfter * 1000 && entry.slow !== true) {
    hints.push({ key: `${id}:slow`, text: `[CRABSHELL] ${id} took ${Math.round(durationMs / 1000)} s, over slowAfterSeconds (${slowAfter}). Mark it "slow": true so routine --changed runs leave it to requested and release runs.` });
  }
  const written = writtenInTwoRuns(projectDir, id, writtenDuringRun(payload, projectDir, entry), entries.map(item => item.id));
  if (written.length) {
    const names = written.slice(0, NAMES_SHOWN).join(', ') + (written.length > NAMES_SHOWN ? ` and ${written.length - NAMES_SHOWN} more` : '');
    hints.push({ key: `${id}:outputs`, text: `[CRABSHELL] ${id} wrote ${names} in two runs in a row. If these are its products, declare them as its "outputs" so they are not taken as its inputs.` });
  }
  return hints;
}

function repeatHint(command, payload, projectDir, durationMs) {
  const manifest = manifestOf(projectDir);
  const after = Number.isFinite(manifest.suggestAfterSeconds) && manifest.suggestAfterSeconds > 0 ? manifest.suggestAfterSeconds : DEFAULT_SUGGEST_AFTER_SECONDS;
  if (durationMs === null || durationMs < after * 1000) return [];
  const invocation = checkInvocation(command, cwdOf(payload, projectDir), projectDir);
  if (!invocation) return [];
  const key = crypto.createHash('sha256').update(JSON.stringify({ tokens: invocation.tokens, cwd: path.resolve(invocation.cwd || projectDir) })).digest('hex').slice(0, 16);
  const identity = require('./project-state').contentIdentity(projectDir);
  const file = memoryFile(projectDir, 'command-repeats.json');
  const repeats = readJsonOrDefault(file, { commands: {} }) || { commands: {} };
  const commands = repeats.commands && typeof repeats.commands === 'object' ? repeats.commands : {};
  // An unknown project identity is never "the same files".
  const same = Boolean(commands[key]) && require('./project-state').sameIdentity(commands[key].identity, identity);
  commands[key] = { identity, at: Date.now(), command: command.slice(0, 200) };
  const kept = Object.entries(commands).sort((a, b) => b[1].at - a[1].at).slice(0, REPEAT_RECORDS);
  writeJson(file, { commands: Object.fromEntries(kept) });
  // A project without a manifest gets its checks declared through the verifying skill.
  const where = fs.existsSync(path.join(projectDir, STORAGE_ROOT, 'verification', 'manifest.json'))
    ? 'declare it in .crabshell/verification/manifest.json (tools or an entry)'
    : "run the verifying skill (/verifying) to create .crabshell/verification/manifest.json with the project's checks";
  return same ? [{ key: `repeat:${key}`, text: `[CRABSHELL] \`${command.slice(0, 200)}\` took ${Math.round(durationMs / 1000)} s and ran twice on the same files. If it is a check, ${where} so a repeat can be answered from its record.` }] : [];
}

// Hints not shown before; the shown ones are remembered.
function onlyNew(projectDir, hints) {
  if (!hints.length) return [];
  const file = memoryFile(projectDir, 'hook-hints.json');
  const shown = readJsonOrDefault(file, { shown: [] }) || { shown: [] };
  const seen = new Set(Array.isArray(shown.shown) ? shown.shown : []);
  const fresh = hints.filter(hint => !seen.has(hint.key));
  if (fresh.length) writeJson(file, { shown: [...seen, ...fresh.map(hint => hint.key)].slice(-500) });
  return fresh;
}

// PostToolUse of a shell call: the hint lines to add to the model's context, or null.
function afterRun(payload, projectDir, { host = 'claude' } = {}) {
  try {
    const command = shellCommand(payload);
    if (!command || !projectDir || payload.hook_event_name === 'PostToolUseFailure' || isToolFailure(payload.tool_response)) return null;
    const durationMs = durationOf(payload, projectDir, host);
    const declaration = findDeclaration(command, projectDir, cwdOf(payload, projectDir));
    const hints = declaration ? (declaration.source === 'entry' ? entryHints(payload, projectDir, declaration, durationMs) : [])
      : repeatHint(command, payload, projectDir, durationMs);
    const fresh = onlyNew(projectDir, hints);
    return fresh.length ? fresh.map(hint => hint.text).join('\n') : null;
  } catch (_) {
    return null;
  }
}

module.exports = { afterRun, beforeRun, DEFAULT_SUGGEST_AFTER_SECONDS };
