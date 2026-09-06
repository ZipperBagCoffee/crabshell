'use strict';
const path = require('path');
const {getStorageRoot,readJsonOrDefault}=require('../utils');

function buildRecoveryContext(projectDir) {
  const file=path.join(getStorageRoot(projectDir),'memory','completion-control.json');
  const state=readJsonOrDefault(file,null),record=state?.recovery;
  if(!record)return '';
  const verification=readJsonOrDefault(path.join(getStorageRoot(projectDir),'memory','verification-state.json'),null);
  const observed=verification && require('./check-history').currentCheck(verification);
  const check=record.lastCheck || (observed ? {
    command: observed.command?.slice(0,400), passed: observed.passed,
    exitCode: observed.exitCode, observedAt: verification.lastUpdated,
  } : null);
  const output=[
    '## Crabshell Last Work Record',
    'Historical observations, not current permission or proof that current files pass. Follow the latest user request and reopen the named task documents.',
    `Source: ${file}`,
    `Observed: ${state.updatedAt || 'unknown'}; status: ${record.status}`,
    `Initial request excerpt: ${record.initialRequest || 'unrecorded'}`,
    `Latest request/correction excerpt: ${record.latestRequest || 'unrecorded'}`,
    check ? `Last observed check: ${check.command}; passed=${check.passed}; exit=${check.exitCode}; at=${check.observedAt}` : 'Last check: no current parent evidence recorded.',
    `Remaining: ${record.remaining}`,
  ];
  return output.join('\n').slice(0,3500)+'\n';
}
module.exports={buildRecoveryContext};
