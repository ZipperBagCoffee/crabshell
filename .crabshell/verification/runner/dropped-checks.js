'use strict';
// Persist and compare the actual obligations of the last accepted pass, not their counts.

const fs = require('fs');
const path = require('path');
const { checkedNames } = require('./checked-names');

const DROPPED_FILE = 'dropped-checks.json';
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function readApprovals(manifestPath) {
  const file = path.join(path.dirname(manifestPath), DROPPED_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`${DROPPED_FILE}: ${error.message}`); }
  let approvals;
  try { approvals = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`${DROPPED_FILE}: ${error.message}`); }
  if (!object(approvals)) throw new Error(`${DROPPED_FILE} must map check ids to approvals`);
  for (const [id, approval] of Object.entries(approvals)) {
    if (!object(approval) || typeof approval.reason !== 'string' || !approval.reason.trim()) {
      throw new Error(`${DROPPED_FILE}: ${id} needs a non-empty reason`);
    }
    for (const field of ['contract', 'names']) {
      if (approval[field] !== undefined && (!Array.isArray(approval[field]) || !approval[field].every(item => typeof item === 'string'))) {
        throw new Error(`${DROPPED_FILE}: ${id}.${field} must be an array of strings`);
      }
    }
    if (Object.keys(approval).some(key => !['reason', 'contract', 'names'].includes(key))) {
      throw new Error(`${DROPPED_FILE}: ${id} accepts only reason, contract and names`);
    }
  }
  return approvals;
}

// Sorting recurses through objects, preserving array order within an assertion.
function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedValue(value[key])]));
}

function contractItems(entry) {
  const contract = entry.contract || {};
  return [...new Set([
    ...(Array.isArray(contract.assertions) ? contract.assertions : []).map(assertion => JSON.stringify(sortedValue(assertion))),
    ...(Array.isArray(contract.forbiddenChanges) ? contract.forbiddenChanges : []).map(file => `forbid:${file}`),
    `exitCode:${contract.exitCode}`,
  ])].sort();
}

function contractReduced(entry, record) {
  if (!record || !Array.isArray(record.contractItems)) return false;
  const current = new Set(contractItems(entry));
  return record.contractItems.some(item => !current.has(item));
}

function failure(id, error) {
  return { id, status: 'FAIL', error, output: '', durationMs: 0, failureClass: 'assertion' };
}

// Include missing records from every source (including a concurrently written map).
// An id restored to the expanded manifest is no longer retired.
function collectRetired(ids, ...sources) {
  const active = new Set(ids);
  const retired = new Map();
  for (const source of sources) {
    for (const [id, record] of Object.entries(source || {})) {
      if (!active.has(id) && record && Array.isArray(record.passHistory) && record.passHistory.some(Boolean)) retired.set(id, record);
    }
  }
  return Object.fromEntries(retired);
}

function removedChecks(retired, approvals) {
  const kept = { ...retired };
  const results = [];
  const approved = [];
  for (const [id, record] of Object.entries(retired)) {
    const approval = Object.hasOwn(approvals, id) ? approvals[id] : null;
    // Item approvals do not authorize deleting the whole check.
    if (approval && approval.contract === undefined && approval.names === undefined) {
      delete kept[id];
      approved.push({ id, items: ['removed check'], reason: approval.reason });
    } else results.push(failure(`REMOVED:${id}`, `Check ${id}${record.test ? ` (${record.test})` : ''} disappeared from the expanded manifest. Restore it or record its reason in ${DROPPED_FILE}; if renamed, approve the old id ${id}.`));
  }
  return { retired: kept, results, approved };
}

function weakenedCheck(entry, previous, stdout, approvals) {
  const baseline = { contractItems: contractItems(entry) };
  const names = checkedNames(entry, stdout);
  if (names !== undefined) baseline.checkedNames = names;
  const approval = Object.hasOwn(approvals, entry.id) ? approvals[entry.id] : {};
  const missing = [];
  const allowed = [];
  for (const [field, key, label] of [['contractItems', 'contract', 'contract'], ['checkedNames', 'names', 'name']]) {
    if (!Array.isArray(previous[field]) || !Array.isArray(baseline[field])) continue;
    const current = new Set(baseline[field]);
    const authorized = new Set(approval[key] || []);
    for (const item of previous[field]) {
      if (current.has(item)) continue;
      (authorized.has(item) ? allowed : missing).push(`${label}: ${item}`);
    }
  }
  return {
    baseline,
    result: missing.length ? failure(`WEAKENED:${entry.id}`, `Check ${entry.id} dropped ${missing.join('; ')}. Restore these items or approve each in ${DROPPED_FILE} with a reason.`) : null,
    // A partial approval is not applied until all missing obligations are authorized.
    approved: !missing.length && allowed.length ? [{ id: entry.id, items: allowed, reason: approval.reason }] : [],
  };
}

// One line per approval this run did not apply: an approval stays visible, with its reason,
// in every run for as long as it is in the file (the file is one the working model can
// write, so being shown is the guarantee). applied: the approvals printed as applied now.
function standingApprovalLines(approvals, applied = []) {
  const appliedIds = new Set(applied.map(approval => approval.id));
  return Object.entries(approvals || {}).filter(([id]) => !appliedIds.has(id)).map(([id, approval]) => {
    const items = [...(approval.contract || []).map(item => `contract: ${item}`), ...(approval.names || []).map(item => `name: ${item}`)];
    return `Approval on file (${DROPPED_FILE}): ${id} (${items.length ? items.join('; ') : 'removed check'}) — ${approval.reason}`;
  });
}

module.exports = { readApprovals, contractItems, contractReduced, collectRetired, removedChecks, weakenedCheck, standingApprovalLines };
