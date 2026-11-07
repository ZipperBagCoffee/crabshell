'use strict';
// Same-state rerun (D143 §6): a manifest entry that the runner already passed with the
// same inputs is not run again by hand. PreToolUse answers from the runner's record before
// any start is recorded, and a parent waiting for evidence gets that pass. CRABSHELL_RERUN=1
// before the command runs it anyway. The runner's own command and the manifest's tools are
// never judged here (the runner reuses passes itself). Every failure means "no decision".

const crypto = require('crypto');
const { shellCommand } = require('./tool-shape');
const { findDeclaration, unwrappedDeclaration, checkKeyForCommand } = require('./command-observation');

function localTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an earlier run';
  const two = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

// { reason } to deny the rerun, { context } for a one-line hint, or null.
function rerunDecision(payload, projectDir) {
  try {
    const command = shellCommand(payload);
    if (!command || !projectDir) return null;
    const cwd = payload.tool_input?.workdir || payload.cwd || projectDir;
    const declaration = findDeclaration(command, projectDir, cwd);
    if (!declaration) {
      const unwrapped = unwrappedDeclaration(command, projectDir, cwd);
      return unwrapped ? { context: `[CRABSHELL] \`${unwrapped.prefix.join(' ')}\` before the declared check is not a declared wrapper, so this run does not count as that check. If it only wraps the command, add it to the manifest's "wrappers".` } : null;
    }
    if (declaration.source !== 'entry' || !declaration.entryId || declaration.env?.CRABSHELL_RERUN) return null;
    // Without the runner's judgment (its modules unavailable) nothing is blocked.
    const projectState = require('./project-state');
    const view = projectState.viewFor(payload, projectDir);
    const upToDate = view ? projectState.entryUpToDate(projectDir, declaration.entryId, view) : null;
    if (!upToDate) return null;
    // The runner keeps no output of a reused check, so the reason points at the record.
    const reason = `\`${command}\` passed at ${localTime(upToDate.record.passedAt)} with the same inputs (runner record for ${declaration.entryId} in ${upToDate.recordPath}). Its pass is reused instead of running it again; to run it anyway, put CRABSHELL_RERUN=1 before the command.`;
    const excerpt = `runner record: ${declaration.entryId} passed with the same inputs`;
    require('./completion-control').adoptRecordedPass(projectDir, payload, {
      command,
      executed: false,
      conclusive: true,
      exitCode: 0,
      passed: true,
      excerpt,
      fingerprint: crypto.createHash('sha256').update(`${command}\n0\n${excerpt}`).digest('hex'),
      callId: payload.tool_use_id || null,
      evidenceSource: 'runner-record',
      checkKey: checkKeyForCommand(command, projectDir, cwd),
      required: declaration.required !== false,
      background: false,
      outcome: 'passed',
    });
    return { reason, entryId: declaration.entryId };
  } catch (_) {
    return null;
  }
}

module.exports = { rerunDecision };
