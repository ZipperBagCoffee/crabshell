'use strict';
// The wide-selection notice (D171): when what changed or failed last time pulls in more than a
// share of all checks, name what pulled the most — a changed input, the checks that use the
// whole project, or a kind of reason such as a failure in the last run — so the over-broad
// inputs are found without reading --explain line by line. It changes nothing about which
// checks run.

const { reasonGroup, fromChanges, projectReasonKind } = require('./select');

// Defaults of the manifest settings `wideSelectionShare` and `wideSelectionMinChecks`.
const DEFAULT_SHARE = 0.5;
const DEFAULT_MIN_CHECKS = 10;
// How many causes the notice names.
const SHOWN_CAUSES = 5;

// What pulled one check in: each input that differs from its record; for a check that uses
// the whole project (or every file outside its report scope), that fact, since the file its
// reason names is only the first that changed; else the kind of its reason.
function causesOf(id, reasons, changedInputs) {
  const differences = changedInputs && Array.isArray(changedInputs[id]) ? changedInputs[id] : [];
  if (differences.length) return [...new Set(differences)];
  const reason = reasons[id];
  const kind = projectReasonKind(reason);
  if (kind === 'unknown inputs') return ['unknown inputs (any project file)'];
  if (kind) return ['files outside the report scope'];
  const group = reasonGroup(reason);
  return [group === 'with changed inputs' ? reason : group];
}

// selected: the ids the run chose; reasons and changedInputs: planRun's; total: the checks the
// run could choose from. Returns null when the selection is not wide.
function wideSelection({ selected, reasons, changedInputs, total, share = DEFAULT_SHARE, minChecks = DEFAULT_MIN_CHECKS }) {
  const pulled = (selected || []).filter(id => fromChanges(reasons[id]));
  if (!total || pulled.length < minChecks || pulled.length / total <= share) return null;
  const counts = new Map();
  for (const id of pulled) for (const cause of causesOf(id, reasons, changedInputs)) counts.set(cause, (counts.get(cause) || 0) + 1);
  const causes = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SHOWN_CAUSES).map(([cause, checks]) => ({ cause, checks }));
  return { selected: pulled.length, total, percent: Math.round((100 * pulled.length) / total), causes };
}

function wideSelectionLine(wide) {
  return `Wide selection: ${wide.selected} of ${wide.total} checks (${wide.percent}%) chosen by what changed or failed last time. `
    + `Most checks pulled by: ${wide.causes.map(item => `${item.cause} (${item.checks})`).join(', ')} — read --explain, then narrow the widest inputs (select-by-use).`;
}

module.exports = { wideSelection, wideSelectionLine, causesOf, DEFAULT_SHARE, DEFAULT_MIN_CHECKS };
