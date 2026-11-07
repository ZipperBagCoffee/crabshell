'use strict';
// The run's summary on stdout and its full results in last-run.json beside the launcher.

const crypto = require('crypto');
const fs = require('fs');
const { shouldWarn } = require('./classify');

function printResults(results, { args, started, resultsPath, plan = null, selected = results.length, failBefore = [], stoppedAt = null, notRun = [], stillFailing = [], notices = [] }) {
  const fullPath = resultsPath;
  const json = JSON.stringify(results, null, 2);
  const save = process.env.CRABSHELL_VERIFY_JSON !== '1' && !args.guardRun && results.length > 0;
  let saveError = null;
  if (save) {
    const temporary = `${fullPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    let temporaryCreated = false;
    try {
      const fd = fs.openSync(temporary, 'wx');
      temporaryCreated = true;
      try { fs.writeFileSync(fd, json + '\n'); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, fullPath);
    } catch (error) { saveError = error.message; }
    finally {
      if (temporaryCreated) { try { fs.unlinkSync(temporary); } catch (_) {} }
    }
  }
  const passCount = results.filter(result => result.status === 'PASS').length;
  const failures = results.filter(result => result.status === 'FAIL');
  const manualCount = results.filter(result => result.status === 'manual').length;
  const selectedResults = results.slice(0, selected);
  const reused = selectedResults.filter(result => result.reused === true).length;
  const covered = selectedResults.filter(result => result.coveredBy);
  const coveringIds = new Set(covered.map(result => result.coveredBy));
  const ran = selectedResults.filter(result => result.status !== 'manual' && result.status !== 'NOT_RUN' && !result.reused && !result.coveredBy).length;
  const passed = selectedResults.filter(result => result.status === 'PASS').length;
  const parts = [];
  if (ran) parts.push(`ran ${ran}`);
  if (reused) parts.push(`reused ${reused} unchanged since they passed`);
  if (covered.length) parts.push(`${covered.length} covered by ${coveringIds.size === 1 ? [...coveringIds][0] : 'other checks'}`);
  if (manualCount) parts.push(`${manualCount} manual check${manualCount === 1 ? '' : 's'} waiting for a person`);
  const counts = parts.length ? ` (${parts.join(', ')})` : '';
  const seconds = (Number(process.hrtime.bigint() - started) / 1e9).toFixed(1);
  // Older installed guards request this flag and parse an array without setting
  // CRABSHELL_VERIFY_JSON. Keep failures visible to those guards too.
  if (args.json || args.guardRun) console.log(json);
  console.log(selected === 0 && failures.length === 0
    ? 'No checks selected — nothing changed that a check reads.'
    : failures.length
      ? `FAIL — ${failures.length} of ${selected} checks failed${counts}, ${seconds}s`
      : `PASS — ${passed} of ${plan ? plan.total : selected} checks${counts}, ${seconds}s`);
  for (const result of failures) {
    const line = String(result.output || '').split(/\r?\n/).find(text => text.startsWith('FAIL'))
      || String(result.error || 'Unknown error').split('; stderr:')[0].split(/\r?\n/)[0];
    console.log(`FAIL ${result.id}: ${line}`);
    const stderr = String(result.stderr || '').trim();
    if (stderr) for (const tail of stderr.split(/\r?\n/).slice(-5)) console.log(`  ${tail}`);
  }
  if (plan) console.log(`\nChanged-files run: ${selected} of ${plan.total} checks (${plan.full ? 'all — ' : ''}${plan.reason})`);
  if (stoppedAt) console.log(`Stopped after a new failure (${stoppedAt}); ${notRun.length} check${notRun.length === 1 ? '' : 's'} not run — they run again after the fix.`);
  if (stillFailing.length) console.log(`Still failing on the inputs they failed with last time (the run went on): ${stillFailing.join(', ')}`);
  for (const notice of notices) console.log(notice);
  if (plan && Array.isArray(plan.slowSkipped) && plan.slowSkipped.length > 0) {
    const states = plan.slowStates || {};
    const names = plan.slowSkipped.map(id => (states[id] ? `${id} (${states[id]})` : id));
    console.log(`Slow checks not run: ${names.join(', ')} — run them with: ${plan.slowCommand || 'node .crabshell/verification/run-verify.js --slow'}`);
    if (Array.isArray(plan.slowHistory) && plan.slowHistory.length) {
      const lines = plan.slowHistory.map(item => `${item.id} ran ${item.runs} time${item.runs === 1 ? '' : 's'}, last failed ${item.lastFailure ? String(item.lastFailure).slice(0, 10) : 'never'}`);
      console.log(`Slow check history: ${lines.join('; ')}.`);
    }
  }
  if (failBefore.length > 0) {
    const count = status => failBefore.filter(result => result.status === status).length;
    console.log(`\nFail-before: ${failBefore.length} changed test(s) also run on HEAD — PASS: ${count('PASS')} / FAIL: ${count('FAIL')} / Manual: ${count('manual')}`);
  }
  console.log(`\nVerification Results: PASS: ${passCount} / FAIL: ${failures.length} / Manual: ${manualCount} / Total: ${results.length}`);
  if (!args.flat && failures.length) {
    const counts = {};
    for (const result of failures) {
      const category = result.failureClass || 'unknown';
      counts[category] = (counts[category] || 0) + 1;
    }
    console.log('\nFailure Categories:');
    for (const category of Object.keys(counts).sort()) console.log(`  ${category}: ${counts[category]}`);
  }
  const warning = shouldWarn(results);
  if (warning.warn) console.error(`[VERIFY] WARN: ${warning.unknownCount}/${warning.failCount} (${warning.ratio}%) failures unclassified; classifier rules may need update`);
  if (save) console.log(`Full results: ${saveError === null ? fullPath : `not saved (${saveError})`}`);
  return failures.length > 0 ? 1 : 0;
}

module.exports = { printResults };
