'use strict';
// D119 P181: "regressing state is stale" is decided by one function
// (regressing-state.isRegressingStale). Each caller keeps its own answer for a
// missing or unreadable timestamp: recovery context and workflow context treat it as
// stale, the lifecycle diagnostic and the prompt reminder stay quiet.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');
const { REGRESSING_STATE_FILE, MEMORY_DIR, STORAGE_ROOT } = require('./constants');
const { REGRESSING_STALE_MS } = require('./core/limits');

const root = h.makeWorkRoot('regressing-stale');
const report = h.createReporter('regressing-stale');
const NOW = Date.parse('2026-09-24T12:00:00Z');
const FRESH = new Date(NOW - 60 * 1000).toISOString();
const OLD = new Date(NOW - REGRESSING_STALE_MS - 60 * 1000).toISOString();

let seq = 0;
function project(name, lastUpdatedAt) {
  const dir = h.makeProject(root, `${name}-${++seq}`);
  const state = { active: true, discussion: 'D001', cycle: 1, totalCycles: 10, phase: 'execution', planId: null, ticketIds: [] };
  if (lastUpdatedAt !== undefined) state.lastUpdatedAt = lastUpdatedAt;
  fs.writeFileSync(path.join(dir, STORAGE_ROOT, MEMORY_DIR, REGRESSING_STATE_FILE), JSON.stringify(state));
  return dir;
}

// 1. The shared decision.
{
  const { isRegressingStale } = require('./regressing-state');
  report.check('S1 regressing-state exports isRegressingStale', typeof isRegressingStale === 'function');
  if (typeof isRegressingStale === 'function') {
    report.check('S2 a timestamp inside the limit is not stale; one past it is', isRegressingStale(FRESH, { now: NOW }) === false && isRegressingStale(OLD, { now: NOW }) === true);
    report.check('S3 a missing or unreadable timestamp gives the caller-chosen answer (default: not stale)',
      isRegressingStale(undefined, { now: NOW }) === false && isRegressingStale('garbage', { now: NOW }) === false
      && isRegressingStale(null, { now: NOW, unknown: true }) === true && isRegressingStale('garbage', { now: NOW, unknown: true }) === true);
  }
}

// 2. Each caller keeps today's meaning (these pass before and after the change).
{
  const { getRegressingSnapshot } = require('./core/compaction-context');
  const snap = value => getRegressingSnapshot(project('snap', value), NOW);
  report.check('C1 recovery snapshot: fresh current, old stale, missing and unreadable stale',
    snap(FRESH).stale === false && snap(OLD).stale === true && snap(undefined).stale === true && snap('garbage').stale === true);
}
{
  const { regressingContext } = require('./core/workflow-context');
  const text = value => regressingContext(project('wf', value), { active: true, discussion: 'D001', ticketIds: [], lastUpdatedAt: value }, NOW);
  report.check('C2 workflow context: fresh current, old/missing/unreadable STALE',
    /Freshness: current/.test(text(FRESH)) && /STALE/.test(text(OLD)) && /STALE/.test(text(undefined)) && /STALE/.test(text('garbage')));
}
{
  const { staleRegressingDiagnostic } = require('./core/execution-lifecycle');
  const diag = value => staleRegressingDiagnostic(path.join(project('life', value), STORAGE_ROOT, MEMORY_DIR), NOW);
  report.check('C3 lifecycle diagnostic: only a readable old timestamp warns',
    diag(FRESH) === null && /stale/.test(String(diag(OLD))) && diag(undefined) === null && diag('garbage') === null);
}
{
  // buildRegressingReminder compares with the real clock.
  const realOld = new Date(Date.now() - REGRESSING_STALE_MS - 60 * 1000).toISOString();
  const { buildRegressingReminder } = require('./core/regressing-reminder');
  const warns = value => /may be stale/.test(buildRegressingReminder(project('rem', value)));
  report.check('C4 prompt reminder: only a readable old timestamp warns',
    warns(realOld) === true && warns(new Date().toISOString()) === false && warns('garbage') === false && warns(undefined) === false);
}

// 3. One definition: the limit is defined in one module (found in the code as
// "REGRESSING_STALE_MS: <number>") and compared only inside regressing-state.js.
{
  const users = [];
  const definers = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!['fixtures', 'testlib', 'node_modules'].includes(entry.name)) walk(full); continue; }
      if (!/\.js$/.test(entry.name) || /^_test-|^_v0/.test(entry.name)) continue;
      const body = fs.readFileSync(full, 'utf8');
      if (!/\bREGRESSING_STALE_MS\b/.test(body)) continue;
      const file = path.relative(__dirname, full).replace(/\\/g, '/');
      users.push(file);
      if (/\bREGRESSING_STALE_MS\s*[:=]\s*\d/.test(body)) definers.push(file);
    }
  };
  walk(__dirname);
  const comparers = users.filter(file => !definers.includes(file));
  report.check('S4 REGRESSING_STALE_MS is defined once and used only in regressing-state.js',
    definers.length === 1 && comparers.join(',') === 'regressing-state.js', `defined in: ${definers.join(' ')} | used in: ${users.join(' ')}`);
}

report.finish();
