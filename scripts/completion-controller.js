'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { readStdin } = require('./transcript-utils');
const { getProjectDir } = require('./utils');
const { decideStop, noteSubagentStop, recordParentObservation } = require('./core/completion-control');

if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

function legacyClaudeStopReasons(payload) {
  if (payload.stop_hook_active === true) return [];
  // sycophancy-guard and scope-guard retired from Stop dispatch in v21.113.0
  // (I083 R5: behavioral policing moved out of hooks; scripts remain on disk).
  const validators = [
    ['doc-watchdog.js', 'stop'],
  ];
  const reasons = [];
  for (const args of validators) {
    const result = spawnSync(process.execPath, [path.join(__dirname, args[0]), ...args.slice(1)], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, CRABSHELL_STOP_AGGREGATED: '1' },
      windowsHide: true,
      timeout: 30000,
    });
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 2) continue;
    try {
      const parsed = JSON.parse(String(result.stdout || '').trim());
      if (parsed.decision === 'block' && parsed.reason) reasons.push(parsed.reason);
    } catch {
      const fallback = String(result.stderr || '').trim();
      if (fallback) reasons.push(fallback.slice(0, 1000));
    }
  }
  return reasons;
}

function handlePayload(payload, options = {}) {
  const eventName = payload?.hook_event_name;
  const projectDir = options.projectDir || payload?.cwd || getProjectDir();
  if (eventName === 'PostToolUse') {
    return { eventName, result: recordParentObservation(projectDir, payload) };
  }
  if (eventName === 'SubagentStop') {
    return { eventName, result: noteSubagentStop(projectDir, payload) };
  }
  if (eventName !== 'Stop') return { eventName, result: { action: 'allow', reason: 'unsupported-event' } };
  const shared = decideStop(projectDir, payload);
  const legacyReasons = options.host === 'claude' ? legacyClaudeStopReasons(payload) : [];
  const reasons = [shared.action === 'block' ? shared.reason : '', ...legacyReasons].filter(Boolean);
  if (reasons.length === 0) return { eventName, result: shared };
  return { eventName, result: { ...shared, action: 'block', reason: reasons.join('\n\n') } };
}

async function main(options = {}) {
  const payload = await readStdin(2000);
  if (!payload || Object.keys(payload).length === 0) return;
  const handled = handlePayload(payload, options);
  if (handled.eventName !== 'Stop' || handled.result.action !== 'block') {
    if (handled.result.systemMessage) process.stdout.write(JSON.stringify({ systemMessage: handled.result.systemMessage }) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: handled.result.reason }) + '\n');
  if (options.host === 'claude') process.exitCode = 2;
}

if (require.main === module) {
  main({ host: 'claude' }).catch(() => {});
}

module.exports = { handlePayload, legacyClaudeStopReasons, main };
