'use strict';
// D119 P178_T003: behavior that moved when Claude hooks became one process per
// event — PostCompact effects now run at SessionStart(compact), the Read notice
// arrives after the read, formerly async observers run inline, and the
// dispatchers stay fail-open on bad input.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const root = h.makeWorkRoot('claude-dispatchers');
const report = h.createReporter('claude-dispatchers');
const fwd = value => value.replace(/\\/g, '/');
const PRE = 'adapters/claude/pre-tool-use.js';
const POST = 'adapters/claude/post-tool-use.js';
const lastJson = result => { try { return JSON.parse(result.stdout.trim().split('\n').filter(Boolean).pop() || 'null'); } catch { return null; } };
const OTHER = fwd(path.join(os.homedir(), 'crabshell-test-other-project'));

// D1: SessionStart after compaction logs the compaction. Contract change (D120 T4): it
// no longer resets the pressure display state, which reached no output.
{
  const project = h.makeProject(root, 'compact');
  const index = h.memoryPath(project, 'memory-index.json');
  const current = h.readJson(index) || {};
  const pressure = { level: 2, consecutiveCount: 2, decayCounter: 0 };
  fs.writeFileSync(index, JSON.stringify({ ...current, feedbackPressure: pressure }));
  const result = h.runHook(root, 'load-memory.js', [], { hook_event_name: 'SessionStart', source: 'compact', session_id: A }, project);
  report.check('D1 SessionStart(compact) appends to compaction.log', result.status === 0 && fs.existsSync(h.memoryPath(project, 'logs', 'compaction.log')), `exit=${result.status}`);
  report.check('D1 ...and leaves the pressure state as it was', JSON.stringify((h.readJson(index) || {}).feedbackPressure) === JSON.stringify(pressure));
  const startup = h.makeProject(root, 'startup');
  h.runHook(root, 'load-memory.js', [], { hook_event_name: 'SessionStart', source: 'startup', session_id: A }, startup);
  report.check('D1 control: SessionStart(startup) writes no compaction log', !fs.existsSync(h.memoryPath(startup, 'logs', 'compaction.log')));
}

// D2: reading another project's .crabshell is allowed and the model is told after the read.
{
  const project = h.makeProject(root, 'read');
  const payload = { hook_event_name: 'PostToolUse', session_id: A, tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: `${OTHER}/.crabshell/memory/logbook.md` }, tool_response: {} };
  const result = h.runHook(root, POST, [], payload, project);
  const output = lastJson(result) || {};
  report.check('D2 PostToolUse Read of another project carries the notice as additionalContext',
    output.hookSpecificOutput && output.hookSpecificOutput.hookEventName === 'PostToolUse' && output.hookSpecificOutput.additionalContext.includes(OTHER),
    `exit=${result.status} ${result.stdout.slice(0, 200)}`);
  const own = h.runHook(root, POST, [], { ...payload, tool_input: { file_path: fwd(h.memoryPath(project, 'logbook.md')) } }, project);
  report.check('D2 control: reading this project\'s memory adds no notice', !lastJson(own), own.stdout.slice(0, 120));
}

// D3: observers that were async hooks now run inline.
{
  const project = h.makeProject(root, 'observers');
  h.runHook(root, POST, [], { hook_event_name: 'PostToolUse', session_id: A, tool_name: 'Skill', tool_use_id: 's1', tool_input: { skill: 'crabshell:ticketing' }, tool_response: { success: true } }, project);
  const flag = h.readJson(path.join(project, '.crabshell', 'memory', 'session-state', A.slice(0, 8), 'skill-active.json'));
  report.check('D3 a document skill call sets this session\'s skill flag before the hook returns', flag && flag.skill === 'ticketing', JSON.stringify(flag));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'x.js'), 'module.exports = 1;\n');
  h.runHook(root, POST, [], { hook_event_name: 'PostToolUse', session_id: A, tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: fwd(path.join(project, 'src', 'x.js')), old_string: '1', new_string: '2' }, tool_response: {} }, project);
  const watchdog = h.readJson(h.memoryPath(project, 'doc-watchdog.json'));
  report.check('D3 a source edit is counted by doc-watchdog', watchdog && watchdog.editsSinceDocUpdate === 1, JSON.stringify(watchdog));
  const verification = h.readJson(h.memoryPath(project, 'verification-state.json'));
  report.check('D3 ...and arms the commit gate', verification && verification.state !== 'CLEAN', JSON.stringify(verification).slice(0, 120));
}

// D2b: a module that prints to stdout inside the dispatcher does not corrupt its one
// JSON object. Here memory rotation prints "Another rotation in progress" because a
// second live process holds the rotation lock (independent review, P178_T003).
{
  const project = h.makeProject(root, 'stdout-noise');
  fs.writeFileSync(h.memoryPath(project, 'config.json'), JSON.stringify({ saveInterval: 1, memoryRotation: { thresholdTokens: 10 } }));
  fs.writeFileSync(h.memoryPath(project, 'logbook.md'), 'word '.repeat(400) + '\n');
  fs.writeFileSync(h.memoryPath(project, '.rotation.lock'), `${process.pid}:held-by-test`);
  const payload = { hook_event_name: 'PostToolUse', session_id: A, tool_name: 'Read', tool_use_id: 'r2', tool_input: { file_path: `${OTHER}/.crabshell/memory/logbook.md` }, tool_response: {} };
  const result = h.runHook(root, POST, [], payload, project);
  let parsed = null;
  try { parsed = JSON.parse(result.stdout.trim()); } catch {}
  report.check('D2b stdout stays one JSON object when a module prints during the checks', Boolean(parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext.includes(OTHER)),
    `stdout=${result.stdout.slice(0, 120)} stderr=${result.stderr.slice(0, 120)}`);
}

// D4: a denied write is reported in the documented format (exit 0, JSON deny).
{
  const project = h.makeProject(root, 'deny');
  const result = h.runHook(root, PRE, [], { hook_event_name: 'PreToolUse', session_id: A, tool_name: 'Write', tool_use_id: 'w1', tool_input: { file_path: fwd(path.join(project, '.crabshell', 'ticket', 'P900_T001-x.md')), content: '# x\n' } }, project);
  const output = lastJson(result) || {};
  report.check('D4 a document written without its skill is denied with permissionDecision "deny"',
    result.status === 0 && output.hookSpecificOutput && output.hookSpecificOutput.permissionDecision === 'deny' && /ticketing/.test(output.hookSpecificOutput.permissionDecisionReason),
    `exit=${result.status} ${result.stdout.slice(0, 160)}`);
}

// D5: fail-open on bad input.
for (const [label, input] of [['empty stdin', ''], ['broken JSON', '{"tool_name":'], ['JSON without a tool', '{}']]) {
  for (const script of [PRE, POST]) {
    const project = h.makeProject(root, `bad-${label.replace(/\W+/g, '-')}-${path.basename(script, '.js')}`);
    const result = spawnSync(process.execPath, [path.join(h.SCRIPTS, script)], { cwd: project, env: h.hookEnv(project, root), input, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    report.check(`D5 ${path.basename(script)} with ${label} exits 0 without a decision`, result.status === 0 && !/"deny"/.test(result.stdout), `exit=${result.status} ${String(result.stderr).slice(0, 120)}`);
  }
}

report.finish();
