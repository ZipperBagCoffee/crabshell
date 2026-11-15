'use strict';
// D175_T001: PreToolUse refuses to start by hand a manifest check that a live runner run of
// the project is running now (its result will be in the runner's record), in the shell forms
// people use (a pipe, PowerShell's call operator, a cd first). CRABSHELL_OVERLAP=1 runs it
// anyway; the runner's own command gets one line; once the run's process is gone its record
// is ignored and removed. Driven through the real Claude and Codex PreToolUse adapters.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const h = require('./testlib/hook-harness');

const root = h.makeWorkRoot('overlap-guard');
const report = h.createReporter('overlap-guard');
const SESSION = 'bbbbbbbb-2222-4222-8222-222222222222';
const pre = (tool_name, tool_input, cwd) => ({ hook_event_name: 'PreToolUse', session_id: SESSION, tool_use_id: `t-${Math.random().toString(36).slice(2)}`, tool_name, tool_input, cwd });
const denied = result => {
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  try { const last = JSON.parse(lines[lines.length - 1]); return last.hookSpecificOutput?.permissionDecision === 'deny' || last.decision === 'block' ? last : null; } catch { return null; }
};
const reasonOf = result => { const d = denied(result); return d ? (d.hookSpecificOutput?.permissionDecisionReason || d.reason || '') : ''; };
const contextOf = result => { try { const lines = result.stdout.trim().split('\n').filter(Boolean); const last = JSON.parse(lines[lines.length - 1]); return last.hookSpecificOutput?.additionalContext || last.systemMessage || ''; } catch { return ''; } };

const project = h.makeProject(root, 'proj');
fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(project, 'sub'), { recursive: true });
fs.writeFileSync(path.join(project, 'scripts', '_zeta_probe.js'), 'process.exit(0);\n');
const verification = path.join(project, '.crabshell', 'verification');
fs.mkdirSync(verification, { recursive: true });
fs.writeFileSync(path.join(verification, 'manifest.json'), JSON.stringify({ schemaVersion: 2, entries: [
  { id: 'ZP1', type: 'structural', command: { file: 'node', args: ['scripts/_zeta_probe.js'] }, contract: { exitCode: 0 } },
] }, null, 2));
fs.writeFileSync(path.join(verification, 'run-verify.js'), '// launcher placeholder\n');
const recordDir = path.join(verification, require('../skills/verifying/scripts/runner/run-record').DIR_NAME);

(async () => {
  // A live process stands for the run.
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { windowsHide: true, stdio: 'ignore' });
  const ended = new Promise(resolve => holder.on('exit', resolve));
  fs.mkdirSync(recordDir, { recursive: true });
  const recordFile = path.join(recordDir, `${holder.pid}.json`);
  fs.writeFileSync(recordFile, JSON.stringify({ schema: 1, pid: holder.pid, startedAt: new Date().toISOString(), selected: ['ZP1'],
    running: [{ id: 'ZP1', startedAt: new Date().toISOString() }], done: [] }));

  const bash = command => h.runHook(root, 'adapters/claude/pre-tool-use.js', [], pre('Bash', { command }, project), project);
  const ps = command => h.runHook(root, 'adapters/claude/pre-tool-use.js', [], pre('PowerShell', { command }, project), project);

  const piped = bash('node scripts/_zeta_probe.js | tail -5');
  report.check('a running check started by hand behind a pipe is refused', /is check ZP1, and the runner \(pid \d+/.test(reasonOf(piped)), piped.stdout.slice(-300));
  report.check('the refusal says how to run it anyway in Bash syntax', /`CRABSHELL_OVERLAP=1 node scripts\/_zeta_probe\.js \| tail -5`/.test(reasonOf(piped)), reasonOf(piped));
  const call = ps('& node scripts/_zeta_probe.js');
  report.check('PowerShell call-operator form is refused', /is check ZP1/.test(reasonOf(call)), call.stdout.slice(-300));
  report.check('the PowerShell refusal gives PowerShell syntax', reasonOf(call).includes("$env:CRABSHELL_OVERLAP='1';"), reasonOf(call));
  const cdFirst = bash('cd sub && node ../scripts/_zeta_probe.js');
  report.check('a cd first is followed to the same check', /is check ZP1/.test(reasonOf(cdFirst)), cdFirst.stdout.slice(-300));
  const override = bash('CRABSHELL_OVERLAP=1 node scripts/_zeta_probe.js');
  report.check('CRABSHELL_OVERLAP=1 is not refused', !denied(override), override.stdout.slice(-300));
  const other = bash('node scripts/other_tool.js');
  report.check('another command is not refused', !denied(other), other.stdout.slice(-300));
  const runner = bash('node .crabshell/verification/run-verify.js --changed');
  report.check('starting the runner is not refused', !denied(runner), runner.stdout.slice(-300));
  report.check('starting the runner gets one line about the live run', /A run \(pid \d+\) is in progress/.test(contextOf(runner)), runner.stdout.slice(-300));

  // Codex adapter: same decision.
  const codex = h.runHook(root, 'adapters/codex/pre-tool-use.js', [], { hook_event_name: 'PreToolUse', session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'node scripts/_zeta_probe.js' }, cwd: project }, project);
  report.check('the Codex adapter refuses it too', /is check ZP1/.test(JSON.stringify(codex.stdout)), codex.stdout.slice(-300));

  // The run's process ends: its record no longer counts and is removed.
  holder.kill();
  await ended;
  const afterEnd = bash('node scripts/_zeta_probe.js');
  report.check('after the run ends the check is not refused', !denied(afterEnd), afterEnd.stdout.slice(-300));
  report.check('the dead run record is removed', !fs.existsSync(recordFile));

  // A broken record never refuses anything.
  fs.writeFileSync(path.join(recordDir, 'broken.json'), '{ nope');
  const broken = bash('node scripts/_zeta_probe.js');
  report.check('a broken record does not refuse', !denied(broken), broken.stdout.slice(-300));

  report.finish();
})().catch(error => { console.log(`FAIL: test crashed -- ${error.stack}`); process.exitCode = 1; });
