'use strict';
// D119 P178_T001: the Claude per-event dispatchers must decide exactly like the
// individual guard scripts they replace, and keep every guard's side effects.
//
// Intentionally changed in cycle 2 (covered by _test-restriction-controls.js, not
// here): path-guard no longer blocks reads, mentions inside strings/heredocs/grep
// patterns, OS-temp paths or unknown-variable paths; web-guard looks only at this
// project's MCP servers and known web-search names; doc-watchdog counts only edits
// inside the project; the verification gate is no longer run for Write/Edit (it
// returned without effect for those tools); verify-guard (it runs the declared
// checks and records nothing) is skipped once another guard has denied, so the
// decision is the same deny with fewer reasons listed.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const root = h.makeWorkRoot('dispatcher-parity');
const report = h.createReporter('dispatcher-parity');
const fwd = value => value.replace(/\\/g, '/');

// The PreToolUse wiring before cycle 2 (hooks/hooks.json at v21.124.0).
const OLD_PRE = [
  { matcher: /^Bash$/, script: 'completion-controller.js', args: [] },
  { matcher: /^(Read|Grep|Glob|Bash|Write|Edit)$/, script: 'path-guard.js', args: [] },
  { matcher: /^(WebFetch|WebSearch)$/, script: 'web-guard.js', args: [] },
  { matcher: /^(Write|Edit)$/, script: 'regressing-guard.js', args: [] },
  { matcher: /^(Write|Edit)$/, script: 'docs-guard.js', args: [] },
  { matcher: /^(Write|Edit)$/, script: 'log-guard.js', args: [] },
  { matcher: /^(Write|Edit)$/, script: 'verify-guard.js', args: [] },
  { matcher: /^(Write|Edit|Bash)$/, script: 'verification-sequence.js', args: ['gate'] },
  { matcher: /^(Write|Edit)$/, script: 'doc-watchdog.js', args: ['gate'] },
];
const NEW_PRE = 'adapters/claude/pre-tool-use.js';

function denied(result) {
  if (result.status === 2) return true;
  try {
    const last = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).pop() || '{}');
    return last.hookSpecificOutput?.permissionDecision === 'deny' || last.decision === 'block';
  } catch { return false; }
}
function oldDecision(project, payload, env) {
  return OLD_PRE.filter(entry => entry.matcher.test(payload.tool_name))
    .map(entry => h.runHook(root, entry.script, entry.args, payload, project, env))
    .some(denied);
}
function newDecision(project, payload, env) {
  return denied(h.runHook(root, NEW_PRE, [], payload, project, env));
}

function project(name, setup) {
  const dir = h.makeProject(root, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'check.js'), 'process.exit(0);\n');
  fs.mkdirSync(path.join(dir, '.crabshell', 'verification'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ tools: { unit: 'node check.js' }, entries: [] }));
  fs.writeFileSync(h.memoryPath(dir, 'logbook.md'), 'line 1\nline 2\nline 3\n');
  if (setup) setup(dir);
  return dir;
}
const pre = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', session_id: A, tool_use_id: `t-${Math.random().toString(36).slice(2)}`, tool_name, tool_input });

const cases = [
  ['plain source edit', d => pre('Edit', { file_path: fwd(path.join(d, 'src', 'x.js')), old_string: '1', new_string: '2' })],
  ['ticket document written without a skill', d => pre('Write', { file_path: fwd(path.join(d, '.crabshell', 'ticket', 'P900_T001-x.md')), content: '# x\n' })],
  ['logbook edited in place', d => pre('Edit', { file_path: fwd(h.memoryPath(d, 'logbook.md')), old_string: 'line 1', new_string: 'x' })],
  ['logbook shrunk by Write', d => pre('Write', { file_path: fwd(h.memoryPath(d, 'logbook.md')), content: 'only\n' })],
  ['plan document written during regressing without a skill', d => {
    fs.writeFileSync(h.memoryPath(d, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution', cycle: 1, totalCycles: 1, discussion: 'D900', lastUpdatedAt: new Date().toISOString() }));
    return pre('Write', { file_path: fwd(path.join(d, '.crabshell', 'plan', 'P900-x.md')), content: '# x\n' });
  }],
  ['commit with an unverified source edit', d => {
    h.runHook(root, 'verification-sequence.js', ['record'], { hook_event_name: 'PostToolUse', session_id: A, tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: fwd(path.join(d, 'src', 'x.js')) }, tool_response: {} }, d);
    return pre('Bash', { command: 'git commit -m "x"' });
  }],
  ['commit with nothing edited', () => pre('Bash', { command: 'git commit -m "x"' })],
  ['declared check start', () => pre('Bash', { command: 'node check.js' })],
  ['read of a project file', d => pre('Read', { file_path: fwd(path.join(d, 'src', 'x.js')) })],
  ['direct write to the skill flag', d => pre('Write', { file_path: fwd(h.memoryPath(d, 'skill-active.json')), content: '{}' })],
  ['web fetch while this project has a web-search MCP server', d => {
    fs.writeFileSync(path.join(d, '.mcp.json'), JSON.stringify({ mcpServers: { tavily: { command: 'x' } } }));
    return pre('WebFetch', { url: 'https://example.com', prompt: 'x' });
  }],
];

for (const [name, make] of cases) {
  const oldProject = project(`old-${name.replace(/\W+/g, '-')}`);
  const newProject = project(`new-${name.replace(/\W+/g, '-')}`);
  const env = { CRABSHELL_WEBGUARD_USER_CONFIG: path.join(root, 'no-user-config.json') };
  const before = oldDecision(oldProject, make(oldProject), env);
  const after = newDecision(newProject, make(newProject), env);
  report.check(`P1 same decision: ${name} (${before ? 'deny' : 'allow'})`, before === after, `old=${before} new=${after}`);
}

// P2: a declared check started through the dispatcher is recorded (side effect of the
// verification gate), exactly as with the separate gate hook.
{
  const d = project('side-effect');
  h.runHook(root, NEW_PRE, [], pre('Bash', { command: 'node check.js' }), d);
  const state = h.readJson(h.memoryPath(d, 'verification-state.json')) || {};
  report.check('P2 the dispatcher still records the start of a declared check', Object.keys(state.checkHistory?.pending || {}).length === 1, JSON.stringify(state.checkHistory || null).slice(0, 160));
}

// P3: a guard module that cannot load does not stop the others (per-guard
// fail-open). Runs the dispatcher from a copy of scripts/ without docs-guard.js.
{
  const d = project('fail-open');
  const copy = path.join(root, 'scripts-copy');
  fs.cpSync(h.SCRIPTS, copy, { recursive: true, filter: src => !/[\\/](_test-[^\\/]*|fixtures)$/.test(src) });
  fs.rmSync(path.join(copy, 'docs-guard.js'), { force: true });
  const result = require('child_process').spawnSync(process.execPath, [path.join(copy, NEW_PRE)], {
    cwd: d, env: h.hookEnv(d, root), encoding: 'utf8', windowsHide: true,
    input: JSON.stringify(pre('Edit', { file_path: fwd(h.memoryPath(d, 'logbook.md')), old_string: 'line 1', new_string: 'x' })),
  });
  report.check('P3 one guard that fails to load does not disable the others (logbook edit still denied)', denied(result), `exit=${result.status} ${String(result.stderr).slice(0, 160)}`);
}

report.finish();
