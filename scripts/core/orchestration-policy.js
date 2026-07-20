'use strict';

const fs = require('fs');

const TASK_CONTRACT_FIELDS = Object.freeze([
  'original_request',
  'required_outcomes',
  'non_goals',
  'named_references',
  'allowed_changes',
  'forbidden_side_effects',
  'observable_success',
  'blocking_unknowns'
]);

const BLOCKING_KINDS = new Set([
  'destructive',
  'irreversible',
  'outside_workspace_write',
  'external_install',
  'product_decision'
]);

function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.slice() : [value];
}

function createTaskContract(input = {}) {
  const contract = {};
  for (const field of TASK_CONTRACT_FIELDS) {
    if (field === 'original_request') contract[field] = String(input[field] || '').trim();
    else contract[field] = toArray(input[field]);
  }
  return contract;
}

function shouldAskUser(contract) {
  const normalized = createTaskContract(contract);
  return normalized.blocking_unknowns.some(unknown => {
    const item = typeof unknown === 'string' ? { kind: unknown } : (unknown || {});
    return BLOCKING_KINDS.has(item.kind) && item.resolvable_by_inspection !== true;
  });
}

function resolveNamedReference(filePath, keyPath) {
  let value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const key of String(keyPath || '').split('.').filter(Boolean)) {
    value = value[key];
  }
  return value;
}

function evaluateCompletion(contract, evidence = {}) {
  const normalized = createTaskContract(contract);
  const observations = toArray(evidence.observations);
  const reopened = new Set(toArray(evidence.parent_reopened_references).map(String));
  const commands = toArray(evidence.command_results);
  const sideEffects = toArray(evidence.forbidden_side_effects_observed);
  const reasons = [];

  for (const outcome of normalized.required_outcomes) {
    const match = observations.find(item => item && item.outcome === outcome);
    if (!match || match.observed !== true || match.passed !== true) {
      reasons.push(`missing or failing observation: ${outcome}`);
    }
  }

  for (const reference of normalized.named_references) {
    const id = typeof reference === 'string' ? reference : reference?.id;
    if (id && !reopened.has(String(id))) reasons.push(`parent did not reopen reference: ${id}`);
  }

  for (const result of commands) {
    if (!result || result.executed !== true || result.exit_code !== 0) {
      reasons.push(`decisive command failed or was not executed: ${result?.name || 'unknown'}`);
    }
  }

  if (sideEffects.length > 0) reasons.push(`forbidden side effects observed: ${sideEffects.join(', ')}`);
  if (shouldAskUser(normalized)) reasons.push('blocking unknown remains');

  return {
    complete: reasons.length === 0,
    reasons,
    worker_claims_ignored: toArray(evidence.worker_claims).length
  };
}

module.exports = {
  TASK_CONTRACT_FIELDS,
  BLOCKING_KINDS,
  createTaskContract,
  shouldAskUser,
  resolveNamedReference,
  evaluateCompletion
};
