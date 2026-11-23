'use strict';
// The broken-reports notice (D183): a check whose last report the runner could not use is
// chosen as if it had not reported (its declared or traced inputs, else every project file),
// so one broken report can rerun it on every change. The run summary, --explain and --dry-run
// name how many checks are in that state and why, on every run until the reports are fixed.
// It changes nothing about which checks run.

const { problemReason } = require('./used-report');

// ids: the manifest's checks, in manifest order; records: their records (test-map.json).
// A failing check is left out: it runs again as failed last time whatever its report says.
// Returns null when no record holds a usable reason.
function brokenReports({ ids, records }) {
  const byReason = new Map();
  let checks = 0;
  for (const id of ids || []) {
    const record = records && records[id];
    if (!record || typeof record !== 'object' || record.lastFailedAt) continue;
    const reason = problemReason(record.reportProblem);
    if (!reason) continue;
    checks++;
    const found = byReason.get(reason);
    if (found) found.checks++;
    else byReason.set(reason, { reason, checks: 1, example: id });
  }
  if (!checks) return null;
  const reasons = [...byReason.values()].sort((a, b) => b.checks - a.checks || a.reason.localeCompare(b.reason));
  return { checks, total: (ids || []).length, reasons };
}

function brokenReportsLine(broken) {
  return `Broken reports: ${broken.checks} of ${broken.total} checks last wrote a report the runner could not use, `
    + 'so they are chosen as without a report (by their declared or traced inputs, else by every project file). '
    + `Reasons: ${broken.reasons.map(item => `${item.reason} (${item.checks}, such as ${item.example})`).join(', ')}. `
    + "Fix each check's report, or give its entry a reportScope or inputs (select-by-use); its record in test-map.json holds the whole reason (reportProblem).";
}

module.exports = { brokenReports, brokenReportsLine };
