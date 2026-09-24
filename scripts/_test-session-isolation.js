'use strict';
// D119 P177_T001: one session's activity must not change another session's verification,
// completion or skill decisions, and harmless work must not be blocked. Real hook
// scripts, temp projects only.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const C = 'cccccccc-3333-4333-8333-333333333333';
const root = h.makeWorkRoot('session-isolation');
const report = h.createReporter('session-isolation');

const SUCCESS = { stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
let callId = 0;
const nextId = prefix => `${prefix}-${++callId}`;

function projectWithCheck(name, options = {}) {
  const project = h.makeProject(root, name);
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'x.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(project, 'check.js'), 'process.exit(0);\n');
  if (options.declared !== false) {
    fs.mkdirSync(path.join(project, '.crabshell', 'verification'), { recursive: true });
    fs.writeFileSync(path.join(project, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ tools: { unit: 'node check.js' }, entries: [] }));
  }
  return project;
}
const edit = (project, sid, file) => h.runHook(root, 'verification-sequence.js', ['record'], {
  hook_event_name: 'PostToolUse', session_id: sid, tool_name: 'Edit', tool_use_id: nextId('edit'),
  tool_input: { file_path: h.forward(path.join(project, file)), old_string: 'a', new_string: 'b' }, tool_response: {},
}, project);
const read = (project, sid) => h.runHook(root, 'verification-sequence.js', ['record'], {
  hook_event_name: 'PostToolUse', session_id: sid, tool_name: 'Read', tool_use_id: nextId('read'), tool_input: { file_path: 'README.md' }, tool_response: {},
}, project);
function runCheck(project, sid, response, eventName = 'PostToolUse') {
  const id = nextId('check');
  const base = { session_id: sid, cwd: project, tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'node check.js' } };
  h.runHook(root, 'verification-sequence.js', ['gate'], { ...base, hook_event_name: 'PreToolUse' }, project);
  const payload = { ...base, hook_event_name: eventName, tool_response: response };
  if (eventName === 'PostToolUseFailure') { payload.error = response; payload.tool_result_is_error = true; }
  return h.runHook(root, 'verification-sequence.js', ['record'], payload, project);
}
const commit = (project, sid) => h.runHook(root, 'verification-sequence.js', ['gate'], {
  hook_event_name: 'PreToolUse', session_id: sid, cwd: project, tool_name: 'Bash', tool_use_id: nextId('commit'), tool_input: { command: 'git commit -m "change"' },
}, project);

// --- Commit gate ---
{
  const project = projectWithCheck('s1-control-edit');
  edit(project, A, 'src/x.js');
  report.check('S1 control: unverified source edit blocks the same session\'s commit', commit(project, A).status === 2);
}
{
  const project = projectWithCheck('s2-other-session-read');
  edit(project, A, 'src/x.js');
  const stateFile = h.memoryPath(project, 'verification-state.json');
  const state = h.readJson(stateFile);
  if (state) { state.lastUpdated = new Date(Date.now() - 6 * 60 * 1000).toISOString(); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
  read(project, B);
  const gate = commit(project, A);
  report.check('S2 (E5) another session\'s Read does not clear A\'s unverified edit — commit still blocked', gate.status === 2, `exit=${gate.status}`);
}
{
  const project = projectWithCheck('s3-control-failed-check');
  edit(project, A, 'src/x.js');
  runCheck(project, A, 'Error: Exit code 1\nfailed', 'PostToolUseFailure');
  report.check('S3 control: a failed declared check keeps the commit blocked', commit(project, A).status === 2);
}
{
  const project = projectWithCheck('s4-docs-after-pass');
  edit(project, A, 'src/x.js');
  runCheck(project, A, SUCCESS);
  const afterPass = commit(project, A).status;
  fs.writeFileSync(path.join(project, 'README.md'), 'changelog line\n');
  edit(project, A, 'README.md');
  const gate = commit(project, A);
  report.check('S4 control: passing declared check allows the commit', afterPass === 0, `exit=${afterPass}`);
  report.check('S4 (R1) a documentation-only edit after a passing check does not block the commit', gate.status === 0, `exit=${gate.status} ${gate.stdout.slice(0, 160)}`);
}
{
  const project = projectWithCheck('s5-no-declared-check', { declared: false });
  edit(project, A, 'src/x.js');
  const gate = commit(project, A);
  report.check('S5 (R2) a project with no declared check is not permanently blocked', gate.status === 0, `exit=${gate.status}`);
  report.check('S5 (R2) the allowed commit says how to declare a check', /\/verifying/.test(gate.stderr), gate.stderr.slice(0, 200));
}
{
  const project = projectWithCheck('s6-css');
  edit(project, A, 'src/x.js');
  runCheck(project, A, SUCCESS);
  fs.writeFileSync(path.join(project, 'src', 'style.css'), 'body { color: red; }\n');
  edit(project, A, 'src/style.css');
  const gate = commit(project, A);
  report.check('S6 (R3) a stylesheet edit is not treated as unverified source', gate.status === 0, `exit=${gate.status}`);
}
{
  const project = projectWithCheck('s7-background');
  edit(project, A, 'src/x.js');
  runCheck(project, A, { ...SUCCESS, stdout: '', backgroundTaskId: 'bk-test-1' });
  const gate = commit(project, A);
  report.check('S7 a check started in the background is not recorded as passing', gate.status === 2, `exit=${gate.status}`);
}
{
  const project = projectWithCheck('s8-read-no-write');
  edit(project, A, 'src/x.js');
  const stateFile = h.memoryPath(project, 'verification-state.json');
  const before = fs.statSync(stateFile).mtimeMs;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
  read(project, A);
  report.check('S8 a Read does not rewrite the verification state', fs.statSync(stateFile).mtimeMs === before);
}

{
  const project = projectWithCheck('s16-interrupt');
  edit(project, A, 'src/x.js');
  runCheck(project, A, SUCCESS);
  h.runHook(root, 'verification-sequence.js', ['record'], {
    hook_event_name: 'PostToolUse', session_id: B, tool_name: 'Bash', tool_use_id: nextId('int'),
    tool_input: { command: 'node check.js' }, tool_response: { ...SUCCESS, interrupted: true },
  }, project);
  const gate = commit(project, A);
  report.check('S16 another session\'s interrupt does not invalidate A\'s passing check', gate.status === 0, `exit=${gate.status}`);
}
{
  const project = projectWithCheck('s16b-own-interrupt');
  edit(project, A, 'src/x.js');
  runCheck(project, A, SUCCESS);
  h.runHook(root, 'verification-sequence.js', ['record'], {
    hook_event_name: 'PostToolUse', session_id: A, tool_name: 'Bash', tool_use_id: nextId('int'),
    tool_input: { command: 'node check.js' }, tool_response: { ...SUCCESS, interrupted: true },
  }, project);
  const gate = commit(project, A);
  report.check('S16b a session\'s own interrupt invalidates its passing check — commit blocked', gate.status === 2, `exit=${gate.status}`);
}
{
  const project = projectWithCheck('s18-config-edit');
  edit(project, A, 'src/x.js');
  runCheck(project, A, SUCCESS);
  fs.mkdirSync(path.join(project, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(project, 'hooks', 'hooks.json'), '{"hooks":{}}\n');
  edit(project, A, 'hooks/hooks.json');
  const gate = commit(project, A);
  report.check('S18 a configuration file edit after a passing check needs a new check', gate.status === 2, `exit=${gate.status}`);
}
{
  const project = projectWithCheck('s19-unrunnable-manifest', { declared: false });
  fs.mkdirSync(path.join(project, '.crabshell', 'verification'), { recursive: true });
  fs.writeFileSync(path.join(project, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ tools: { unit: 'node check.js && node other.js' }, entries: [] }));
  edit(project, A, 'src/x.js');
  const gate = commit(project, A);
  report.check('S19 a manifest with no runnable single command blocks with its own reason, not the advisory', gate.status === 2 && /no runnable single command/.test(gate.stdout + gate.stderr), `exit=${gate.status}`);
  const bom = projectWithCheck('s19b-bom-manifest', { declared: false });
  fs.mkdirSync(path.join(bom, '.crabshell', 'verification'), { recursive: true });
  fs.writeFileSync(path.join(bom, '.crabshell', 'verification', 'manifest.json'), '﻿' + JSON.stringify({ tools: { unit: 'node check.js' }, entries: [] }));
  edit(bom, A, 'src/x.js');
  runCheck(bom, A, SUCCESS);
  const bomGate = commit(bom, A);
  report.check('S19b a manifest saved with a byte-order mark still declares its check', bomGate.status === 0 && !/\/verifying/.test(bomGate.stderr + bomGate.stdout), `exit=${bomGate.status} ${bomGate.stderr.slice(0, 120)}`);
}
{
  const project = projectWithCheck('s22-codex-notice', { declared: false });
  edit(project, A, 'src/x.js');
  const result = h.runHook(root, 'adapters/codex/pre-tool-use.js', [], {
    session_id: A, turn_id: 't1', cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: nextId('codex'), tool_input: { command: 'git commit -m "change"' },
  }, project);
  let context = '';
  try { context = JSON.parse(result.stdout.trim().split('\n').pop()).hookSpecificOutput.additionalContext; } catch {}
  report.check('S22 Codex also tells the model to declare a check when none exists', result.status === 0 && /\/verifying/.test(context), `exit=${result.status} stdout=${result.stdout.slice(0, 160)}`);
}

// --- Completion decision ---
function transcript(name, prompt) {
  const file = path.join(root, `${name}.jsonl`);
  h.writeTranscript(file, [h.userLine(prompt, new Date().toISOString())]);
  return file;
}
const prompt = (project, sid, text, file) => h.runHook(root, 'inject-rules.js', [], { hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: text, transcript_path: file, cwd: project }, project);
const stop = (project, sid, file) => h.runHook(root, 'completion-controller.js', [], { hook_event_name: 'Stop', session_id: sid, transcript_path: file, stop_hook_active: false }, project);
{
  const project = h.makeProject(root, 's9-completion');
  fs.writeFileSync(h.memoryPath(project, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution', cycle: 1, totalCycles: 1, discussion: 'D900', lastUpdatedAt: new Date().toISOString() }));
  const tA = transcript('s9-A', 'Implement the A fixture change.'), tB = transcript('s9-B', 'Implement the unrelated B fixture change.');
  prompt(project, A, 'Implement the A fixture change.', tA);
  h.runHook(root, 'completion-controller.js', [], { hook_event_name: 'SubagentStop', session_id: A, transcript_path: tA, agent_type: 'worker', last_assistant_message: 'Done. All tests pass.' }, project);
  const before = stop(project, A, tA).status;
  prompt(project, B, 'Implement the unrelated B fixture change.', tB);
  const after = stop(project, A, tA).status;
  report.check('S9 control: a child completion claim blocks A\'s Stop until parent evidence', before === 2, `exit=${before}`);
  report.check('S9 (E2) B\'s prompt does not erase A\'s pending child claim', after === 2, `exit=${after}`);
}
{
  const project = h.makeProject(root, 's10-owned-regressing');
  fs.writeFileSync(h.memoryPath(project, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution', cycle: 1, totalCycles: 1, discussion: 'D900', sessionId: A, lastUpdatedAt: new Date().toISOString() }));
  const tB = transcript('s10-B', 'Implement the unrelated B fixture change.');
  prompt(project, B, 'Implement the unrelated B fixture change.', tB);
  const result = stop(project, B, tB);
  report.check('S10 a regressing workflow owned by A does not force B to continue', result.status === 0, `exit=${result.status} ${result.stdout.slice(0, 160)}`);
}
{
  const project = h.makeProject(root, 's17-unowned-regressing');
  fs.writeFileSync(h.memoryPath(project, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution', cycle: 1, totalCycles: 1, discussion: 'D900', lastUpdatedAt: new Date().toISOString() }));
  const tB = transcript('s17-B', 'Implement the B fixture change.');
  prompt(project, B, 'Implement the B fixture change.', tB);
  const result = stop(project, B, tB);
  report.check('S17 control: a workflow without an owner still asks the executing session to continue (legacy)', result.status === 2, `exit=${result.status}`);
}
{
  const project = h.makeProject(root, 's20-own-worklog');
  fs.writeFileSync(h.memoryPath(project, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution', cycle: 1, totalCycles: 1, discussion: 'D900', sessionId: A, lastUpdatedAt: new Date().toISOString() }));
  fs.mkdirSync(path.join(project, '.crabshell', 'worklog'), { recursive: true });
  fs.writeFileSync(path.join(project, '.crabshell', 'worklog', 'W900-fixture.md'), '---\nid: W900\nstatus: in-progress\n---\n# W900\n\n## Outcomes\n- [ ] finish the fixture\n');
  const tB = transcript('s20-B', 'Implement the B fixture change.');
  prompt(project, B, 'Implement the B fixture change.', tB);
  const result = stop(project, B, tB);
  report.check('S20 another session\'s regressing run does not switch off this session\'s active worklog', result.status === 2, `exit=${result.status}`);
}
{
  const project = h.makeProject(root, 's21-ownership-moves');
  fs.writeFileSync(h.memoryPath(project, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'planning', cycle: 1, totalCycles: 1, discussion: 'D900', sessionId: A, lastUpdatedAt: new Date().toISOString() }));
  h.runHook(root, 'counter.js', ['check'], { hook_event_name: 'PostToolUse', session_id: C, tool_name: 'Skill', tool_input: { skill: 'crabshell:planning' } }, project);
  const owner = (h.readJson(h.memoryPath(project, 'regressing-state.json')) || {}).sessionId;
  report.check('S21 the session that runs the workflow\'s next skill becomes its owner (after /clear or relaunch)', owner === C, `owner=${owner}`);
}
{
  const project = h.makeProject(root, 's23-no-session-payload');
  fs.writeFileSync(h.memoryPath(project, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution', cycle: 1, totalCycles: 1, discussion: 'D900', lastUpdatedAt: new Date().toISOString() }));
  const tA = transcript('s23-A', 'Implement the A fixture change.');
  prompt(project, A, 'Implement the A fixture change.', tA);
  h.runHook(root, 'completion-controller.js', [], { hook_event_name: 'SubagentStop', session_id: A, transcript_path: tA, agent_type: 'worker', last_assistant_message: 'Done.' }, project);
  h.runHook(root, 'inject-rules.js', [], { hook_event_name: 'UserPromptSubmit', prompt: 'Implement something without a session.', cwd: project }, project);
  report.check('S23 a payload without a session id does not overwrite a real session\'s record', stop(project, A, tA).status === 2);
}
{
  const project = h.makeProject(root, 's11-notification');
  const note = '<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n<summary>Agent "Implement fixture" finished</summary>\n<result>Implemented the parser fix and ran tests.</result>\n</task-notification>';
  prompt(project, C, note, transcript('s11-C', note));
  const start = h.runHook(root, 'load-memory.js', [], { hook_event_name: 'SessionStart', session_id: C, source: 'resume', cwd: project }, project);
  report.check('S11 (R8) a background-task notification is not recorded as the user\'s request', !start.stdout.includes('task-notification'), start.stdout.slice(0, 200));
}

// --- Skill flag for document writes ---
function docProject(name) {
  const project = h.makeProject(root, name);
  const inv = path.join(project, '.crabshell', 'investigation');
  fs.mkdirSync(inv, { recursive: true });
  fs.writeFileSync(path.join(inv, 'I900-fixture.md'), '# I900\n\n## Constraints\n- fixture\n');
  return { project, invDoc: h.forward(path.join(inv, 'I900-fixture.md')), planDoc: h.forward(path.join(project, '.crabshell', 'plan', 'P900-fixture.md')) };
}
const activate = (project, sid, skill) => h.runHook(root, 'skill-tracker.js', [], { hook_event_name: 'PostToolUse', session_id: sid, tool_name: 'Skill', tool_input: { skill } }, project);
const docWrite = (project, sid, file, tool = 'Edit') => h.runHook(root, 'docs-guard.js', [], {
  hook_event_name: 'PreToolUse', session_id: sid, tool_name: tool,
  tool_input: tool === 'Edit' ? { file_path: file, old_string: 'fixture', new_string: 'fixture2' } : { file_path: file, content: 'x' },
}, project);
function ageSkillFlags(project, minutes) {
  const stack = [h.memoryPath(project)];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (/skill-active.*\.json$/.test(entry.name)) {
        const data = h.readJson(file);
        if (data && data.activatedAt) { data.activatedAt = new Date(Date.now() - minutes * 60000).toISOString(); fs.writeFileSync(file, JSON.stringify(data)); }
      }
    }
  }
}
{
  const { project, invDoc } = docProject('s12-control');
  report.check('S12 control: a document write without any skill is blocked', docWrite(project, A, invDoc).status === 2);
  activate(project, A, 'crabshell:investigating');
  report.check('S12 control: the session that invoked the skill may write', docWrite(project, A, invDoc).status === 0);
}
{
  const { project, invDoc, planDoc } = docProject('s13-shared-flag');
  activate(project, A, 'crabshell:investigating');
  const bWrite = docWrite(project, B, planDoc, 'Write');
  report.check('S13 (E1) A\'s skill does not let B write documents without a skill', bWrite.status === 2, `exit=${bWrite.status}`);
  prompt(project, B, 'Implement the B fixture change.', transcript('s13-B', 'Implement the B fixture change.'));
  const aWrite = docWrite(project, A, invDoc);
  report.check('S13 (E1) B\'s first prompt does not remove A\'s skill flag', aWrite.status === 0, `exit=${aWrite.status}`);
}
{
  const { project, invDoc } = docProject('s14-long-skill');
  activate(project, A, 'crabshell:investigating');
  ageSkillFlags(project, 16);
  const result = docWrite(project, A, invDoc);
  report.check('S14 (R5) a skill used for more than 15 minutes still lets its session write its document', result.status === 0, `exit=${result.status}`);
}
{
  const { project, invDoc } = docProject('s15-compaction');
  activate(project, A, 'crabshell:investigating');
  h.runHook(root, 'load-memory.js', [], { hook_event_name: 'SessionStart', session_id: A, source: 'compact', cwd: project }, project);
  const result = docWrite(project, A, invDoc);
  report.check('S15 after compaction the session must invoke the skill again before writing documents', result.status === 2, `exit=${result.status}`);
}

report.finish();
