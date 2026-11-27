'use strict';

// D187_T004: guards switched off for a measurement. CRABSHELL_GUARDS_OFF holds guard names
// separated by commas: the names in .crabshell/guard-record.json, which are the names the
// checks carry (the check lists that core/dispatch.js runChecks runs, and the names
// completion-controller.js records). A named check is skipped as if it were not wired;
// every other check runs as before. Unset or empty: nothing is off.
// scripts/guard-experiment.js sets it for the "off" run of each scenario.

const GUARDS_OFF_ENV = 'CRABSHELL_GUARDS_OFF';

function guardsOff(env = process.env) {
  const raw = env && typeof env[GUARDS_OFF_ENV] === 'string' ? env[GUARDS_OFF_ENV] : '';
  return [...new Set(raw.split(',').map(name => name.trim()).filter(Boolean))];
}

function isGuardOff(name, env = process.env) {
  return Boolean(name) && guardsOff(env).includes(name);
}

// One line for SessionStart, so a session that inherited the switch says so.
function guardsOffNotice(env = process.env) {
  const names = guardsOff(env);
  return names.length ? `[CRABSHELL] Guards switched off in this session by ${GUARDS_OFF_ENV}: ${names.join(', ')}.` : '';
}

module.exports = { GUARDS_OFF_ENV, guardsOff, guardsOffNotice, isGuardOff };
