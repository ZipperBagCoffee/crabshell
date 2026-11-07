'use strict';
// D143_T012: hooks recognize a shell call and a file write by the shape of the tool
// input (and, after the call, its response), not by the tool's name. Inputs are real
// captured payloads (scripts/fixtures/hook-payloads); a tool name that appears nowhere
// in the code (mcp__box__run, renamed_patch) proves no name list decides.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scripts = __dirname;
const fixtureDir = path.join(scripts, 'fixtures', 'hook-payloads');
const native = name => JSON.parse(fs.readFileSync(path.join(fixtureDir, 'native', name), 'utf8'));
const transcript = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'claude-transcript-tool-shapes.json'), 'utf8')).records;
const codexFixture = JSON.parse(fs.readFileSync(path.join(scripts, 'fixtures', 'codex', 'pre-tool-use.json'), 'utf8'));

let shape = null;
try { shape = require('./core/tool-shape'); } catch (error) { shape = { loadError: error }; }

let passed = 0;
let failed = 0;
const temps = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${error.message}`); }
}
function need(name) {
  if (typeof shape[name] !== 'function') throw new Error(`core/tool-shape.js does not export ${name}${shape.loadError ? ` (${shape.loadError.message.split('\n')[0]})` : ''}`);
  return shape[name];
}
function tempProject(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `crabshell-shape-${name}-`));
  temps.push(root);
  for (const dir of ['memory', 'verification']) fs.mkdirSync(path.join(root, '.crabshell', dir), { recursive: true });
  return root;
}

// Claude PostToolUse hands the tool's structured Output (the transcript's toolUseResult)
// as tool_response; PostToolUseFailure carries `error` and no tool_response.
const call = (record, extra = {}) => ({ tool_name: record.tool_use.name, tool_input: record.tool_use.input, ...extra });
const powershellPost = call(transcript['powershell-success'], { hook_event_name: 'PostToolUse', tool_response: transcript['powershell-success'].toolUseResult });
const powershellFailure = call(transcript['powershell-failure'], { hook_event_name: 'PostToolUseFailure', error: 'Exit code 3', is_interrupt: false });

// Codex apply_patch: documented contract (https://learn.chatgpt.com/docs/hooks — tool_name
// "apply_patch", the patch body in tool_input.command); no raw capture exists yet.
const patchBody = ['*** Begin Patch', '*** Add File: docs/new.md', '+# Title', '+body line', '*** Update File: src/app.js',
  '@@', '-old', '+new', '*** Delete File: src/gone.js', '*** Update File: src/from.js', '*** Move to: src/to.js', '*** End Patch'].join('\n');
const applyPatch = { tool_name: 'apply_patch', tool_input: { command: patchBody } };

test('captured shell calls are recognized whatever the tool is called (Claude Bash, PowerShell, Codex Bash)', () => {
  const shellCommand = need('shellCommand');
  for (const payload of [native('claude-PreToolUse-success.json'), native('claude-PostToolUse-success.json'),
    native('claude-PostToolUseFailure-failure.json'), native('codex-PreToolUse-success.json'), native('codex-PostToolUse-success.json'),
    codexFixture, call(transcript['powershell-success']), powershellPost, powershellFailure,
    call(transcript['powershell-failure'], { tool_response: transcript['powershell-failure'].toolUseResult })]) {
    assert.strictEqual(shellCommand(payload), payload.tool_input.command, `${payload.tool_name} ${payload.hook_event_name || 'transcript'}`);
  }
});

test('captured writes are recognized by shape: Write = whole, Edit = edit, NotebookEdit = cell', () => {
  const fileWrites = need('fileWrites');
  const write = transcript.write.tool_use.input;
  assert.deepStrictEqual(fileWrites(call(transcript.write)), [{ path: write.file_path, kind: 'whole', content: write.content }]);
  const edit = transcript.edit.tool_use.input;
  assert.deepStrictEqual(fileWrites(call(transcript.edit)), [{ path: edit.file_path, kind: 'edit', oldString: edit.old_string, newString: edit.new_string, replaceAll: false }]);
  assert.deepStrictEqual(fileWrites(call(transcript['notebook-edit'])), [{ path: transcript['notebook-edit'].tool_use.input.notebook_path, kind: 'cell' }]);
  for (const record of [transcript.write, transcript.edit, transcript['notebook-edit']]) {
    assert.strictEqual(need('shellCommand')(call(record)), null, `${record.tool_use.name} is not a shell call`);
  }
});

test('an apply_patch envelope is a write per patched file, never a shell call', () => {
  const writes = need('fileWrites')(applyPatch);
  assert.deepStrictEqual(writes.map(write => [write.path, write.kind]),
    [['docs/new.md', 'patch'], ['src/app.js', 'patch'], ['src/gone.js', 'patch'], ['src/from.js', 'patch'], ['src/to.js', 'patch']]);
  assert.strictEqual(writes[0].content, '# Title\nbody line');
  assert.strictEqual(need('shellCommand')(applyPatch), null);
  assert.deepStrictEqual(need('writtenPaths')(applyPatch), ['docs/new.md', 'src/app.js', 'src/gone.js', 'src/from.js', 'src/to.js']);
});

test('read, search, web and malformed inputs are neither shell calls nor writes, and nothing throws', () => {
  const shellCommand = need('shellCommand');
  const fileWrites = need('fileWrites');
  const payloads = [
    { tool_name: 'Read', tool_input: { file_path: 'C:\\p\\a.js', offset: 1, limit: 5 } },
    { tool_name: 'Grep', tool_input: { pattern: 'x', path: 'src' } },
    { tool_name: 'Glob', tool_input: { pattern: '**/*.js', path: 'src' } },
    { tool_name: 'WebFetch', tool_input: { url: 'https://example.com', prompt: 'read' } },
    // An MCP tool whose argument happens to be called `command`: its result is a content list, not process output.
    { tool_name: 'mcp__notes__add', tool_input: { command: 'remember this' }, tool_response: { content: [{ type: 'text', text: 'ok' }] } },
    { tool_name: 'mcp__notes__add', tool_input: { command: 'remember this' }, tool_response: [{ type: 'text', text: 'ok' }] },
    { tool_name: 'X', tool_input: null }, { tool_name: 'X', tool_input: [] }, { tool_name: 'X', tool_input: 'ls' },
    { tool_name: 'X', tool_input: { command: 42 } }, { tool_name: 'X', tool_input: { command: '   ' } },
    { tool_name: 'X', tool_input: { file_path: 'a.js', content: 5 } }, { tool_name: 'X', tool_input: { file_path: 'a.js', old_string: 'a' } },
    {}, null, undefined,
  ];
  for (const payload of payloads) {
    assert.strictEqual(shellCommand(payload), null, JSON.stringify(payload));
    assert.deepStrictEqual(fileWrites(payload), [], JSON.stringify(payload));
    assert.strictEqual(need('isShellCall')(payload), false);
    assert.strictEqual(need('isFileWrite')(payload), false);
  }
});

test('tool names the code never names are recognized by shape (MCP shell, MCP write, renamed patch)', () => {
  const run = { tool_name: 'mcp__box__run', tool_input: { command: 'node check.js' }, tool_response: { stdout: 'ok', stderr: '', exit_code: 0 } };
  assert.strictEqual(need('shellCommand')(run), 'node check.js');
  assert.deepStrictEqual(need('fileWrites')({ tool_name: 'mcp__fs__write_file', tool_input: { path: 'notes.txt', content: 'x' } }),
    [{ path: 'notes.txt', kind: 'whole', content: 'x' }]);
  assert.strictEqual(need('fileWrites')({ ...applyPatch, tool_name: 'renamed_patch' }).length, 5);
  // Codex's older exec_command spelled the command `cmd`.
  assert.strictEqual(need('shellCommand')({ tool_name: 'exec_command', tool_input: { cmd: 'node check.js' } }), 'node check.js');
});

test('a transcript tool_use block goes through the same shape checks', () => {
  const transcriptCall = need('transcriptCall');
  assert.strictEqual(need('shellCommand')(transcriptCall(transcript['powershell-success'].tool_use)), transcript['powershell-success'].tool_use.input.command);
  assert.strictEqual(need('isFileWrite')(transcriptCall(transcript['notebook-edit'].tool_use)), true);
  assert.strictEqual(transcriptCall(null), null);
});

// --- Hook routing: the dispatcher hands each payload to the checks its shape needs ---

function routed(checks, payload) {
  const { appliesTo } = require('./core/dispatch');
  return checks.filter(check => appliesTo(check, payload)).map(check => check.name);
}

test('Claude PreToolUse routes PowerShell to the shell checks and NotebookEdit to the write checks', () => {
  const { CHECKS } = require('./adapters/claude/pre-tool-use');
  const shellChecks = routed(CHECKS, call(transcript['powershell-success'], { hook_event_name: 'PreToolUse' }));
  for (const name of ['completion-controller', 'path-guard', 'verification-gate']) assert.ok(shellChecks.includes(name), `${name} in ${shellChecks}`);
  assert.ok(!shellChecks.includes('docs-guard'), shellChecks.join(','));
  const writeChecks = routed(CHECKS, call(transcript['notebook-edit'], { hook_event_name: 'PreToolUse' }));
  for (const name of ['path-guard', 'regressing-guard', 'docs-guard', 'log-guard', 'doc-watchdog']) assert.ok(writeChecks.includes(name), `${name} in ${writeChecks}`);
  assert.ok(!writeChecks.includes('verification-gate'), writeChecks.join(','));
  assert.deepStrictEqual(routed(CHECKS, { tool_name: 'Read', tool_input: { file_path: 'a.js' } }), []);
  assert.deepStrictEqual(routed(CHECKS, { tool_name: 'WebFetch', tool_input: { url: 'https://example.com', prompt: 'x' } }), ['web-guard']);
});

test('Claude PostToolUse and PostToolUseFailure route PowerShell results to the recorders', () => {
  const { POST_CHECKS, FAILURE_CHECKS } = require('./adapters/claude/post-tool-use');
  assert.ok(routed(POST_CHECKS, powershellPost).includes('completion-controller'));
  assert.ok(routed(POST_CHECKS, call(transcript['notebook-edit'], { tool_response: transcript['notebook-edit'].toolUseResult })).includes('doc-watchdog'));
  assert.deepStrictEqual(routed(FAILURE_CHECKS, powershellFailure), ['verification-record', 'completion-controller']);
});

test('a payload that is neither a shell call nor a write loads no guard module', () => {
  const probe = `
    const { CHECKS } = require(${JSON.stringify(path.join(scripts, 'adapters', 'claude', 'pre-tool-use.js'))});
    const { runChecks } = require(${JSON.stringify(path.join(scripts, 'core', 'dispatch.js'))});
    runChecks(CHECKS, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a.js' } }, process.cwd()).then(() => {
      const loaded = Object.keys(require.cache).map(file => require('path').basename(file));
      console.log(JSON.stringify(loaded));
    });`;
  const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.strictEqual(result.status, 0, result.stderr);
  const loaded = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  for (const guard of ['path-policy.js', 'docs-guard.js', 'log-guard.js', 'regressing-guard.js', 'doc-watchdog.js', 'verification-sequence.js', 'completion-controller.js']) {
    assert.ok(!loaded.includes(guard), `${guard} was loaded for a Read payload`);
  }
});

// Claude matcher rules (https://code.claude.com/docs/en/hooks): "*", "" or no matcher =
// every tool; only letters, digits, _, -, spaces, "," and "|" = exact names; else an
// unanchored regular expression. Codex treats the matcher as a regex, "*"/""/none = all.
function claudeMatches(matcher, tool) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  if (/^[\w\s,|-]+$/.test(matcher)) return matcher.split(/[|,]/).map(name => name.trim()).includes(tool);
  return new RegExp(matcher).test(tool);
}
function codexMatches(matcher, tool) {
  return matcher === undefined || matcher === '' || matcher === '*' || new RegExp(matcher).test(tool);
}

test('host hook settings hand every tool to the shape checks, except the read tools the hook cost budget names', () => {
  const claude = JSON.parse(fs.readFileSync(path.join(scripts, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  for (const event of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']) {
    for (const tool of ['Bash', 'PowerShell', 'Write', 'Edit', 'NotebookEdit', 'mcp__box__run', 'mcp__fs__read_file', 'WebFetch']) {
      assert.ok(claude[event].some(group => claudeMatches(group.matcher, tool)), `Claude ${event} does not reach ${tool}`);
    }
  }
  // _test-hook-wiring-cost.js W2 (D119): one Read, Grep or Glob call starts at most one
  // synchronous hook process — PostToolUse, which tells about reads of another project.
  for (const tool of ['Read', 'Grep', 'Glob']) {
    assert.ok(!claude.PreToolUse.some(group => claudeMatches(group.matcher, tool)), `Claude PreToolUse starts for ${tool}`);
  }
  const codex = JSON.parse(fs.readFileSync(path.join(scripts, '..', 'hooks', 'codex-hooks.json'), 'utf8')).hooks;
  for (const event of ['PreToolUse', 'PostToolUse']) {
    for (const tool of ['Bash', 'apply_patch', 'mcp__box__run']) {
      assert.ok(codex[event].some(group => codexMatches(group.matcher, tool)), `Codex ${event} does not reach ${tool}`);
    }
  }
});

// --- End to end: the real hook process records what the shape says happened ---

function runHook(script, root, payload) {
  const result = spawnSync(process.execPath, [path.join(scripts, ...script)], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, CRABSHELL_BACKGROUND: '' },
    input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result;
}
// The last declared check on record (D143_T013: the record keeps checks, not edits).
function lastCheck(root) {
  const state = JSON.parse(fs.readFileSync(path.join(root, '.crabshell', 'memory', 'verification-state.json'), 'utf8'));
  return require('./core/check-history').currentCheck(state);
}

test('a declared check run through PowerShell is recorded as passing; its failure as failed', () => {
  const root = tempProject('powershell');
  fs.writeFileSync(path.join(root, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ tools: { test: 'node acceptance.js' } }));
  fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = 1;\n');
  const common = { session_id: 'shape-session', cwd: root, tool_use_id: 'toolu_shape_1' };
  runHook(['adapters', 'claude', 'post-tool-use.js'], root, { ...powershellPost, ...common, tool_input: { ...powershellPost.tool_input, command: 'node acceptance.js' } });
  assert.strictEqual(lastCheck(root).passed, true);
  runHook(['adapters', 'claude', 'post-tool-use.js'], root, { ...powershellFailure, ...common, tool_use_id: 'toolu_shape_2', tool_input: { ...powershellFailure.tool_input, command: 'node acceptance.js' } });
  assert.strictEqual(lastCheck(root).passed, false);
});

test('a notebook cell edit, a renamed patch tool and an MCP write each count as a code edit', () => {
  const root = tempProject('edits');
  fs.writeFileSync(path.join(root, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ tools: { test: 'node acceptance.js' } }));
  const notebook = path.join(root, 'nb.ipynb');
  runHook(['adapters', 'claude', 'post-tool-use.js'], root, { ...call(transcript['notebook-edit'], { tool_response: transcript['notebook-edit'].toolUseResult }),
    hook_event_name: 'PostToolUse', session_id: 'shape-session', cwd: root, tool_input: { ...transcript['notebook-edit'].tool_use.input, notebook_path: notebook } });
  runHook(['adapters', 'claude', 'post-tool-use.js'], root, { hook_event_name: 'PostToolUse', session_id: 'shape-session', cwd: root,
    tool_name: 'renamed_patch', tool_input: { command: '*** Begin Patch\n*** Update File: lib.js\n@@\n-a\n+b\n*** End Patch' }, tool_response: 'Success' });
  runHook(['adapters', 'claude', 'post-tool-use.js'], root, { hook_event_name: 'PostToolUse', session_id: 'shape-session', cwd: root,
    tool_name: 'mcp__fs__write_file', tool_input: { path: path.join(root, 'tool.js'), content: 'x' }, tool_response: { content: [{ type: 'text', text: 'ok' }] } });
  // doc-watchdog counts code edits since the last document update, whatever the tool.
  // D147_T004: the edit record is per session.
  const watchdog = require('./core/session-state').readSessionState(root, 'shape-session', require('./doc-watchdog').STATE_NAME, {});
  assert.strictEqual(watchdog.editsSinceDocUpdate, 3, JSON.stringify(watchdog));
  assert.ok(String(watchdog.lastCodeEditFile).replace(/\\/g, '/').endsWith('tool.js'), JSON.stringify(watchdog));
});

test('Codex: a renamed patch tool drops parent evidence through the completion controller', () => {
  const completion = require('./core/completion-control');
  const root = tempProject('codex');
  fs.writeFileSync(path.join(root, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ tools: { test: 'node acceptance.js' } }));
  fs.writeFileSync(path.join(root, '.crabshell', 'memory', 'regressing-state.json'), JSON.stringify({ active: true }));
  const auth = { session_id: 'codex-shape', prompt: 'Implement and verify the active task.' };
  assert.strictEqual(completion.noteExecutionAuthorization(root, auth).recorded, true);
  assert.strictEqual(completion.noteSubagentStop(root, { ...auth, last_assistant_message: 'Ready.' }).recorded, true);
  const check = { ...auth, hook_event_name: 'PostToolUse', tool_use_id: 'c1', tool_name: 'Bash', tool_input: { command: 'node acceptance.js' },
    tool_response: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } };
  assert.strictEqual(completion.recordParentObservation(root, check).recorded, true);
  assert.strictEqual(completion.loadState(root, auth).observation.passed, true);
  fs.writeFileSync(path.join(root, 'added.js'), 'module.exports = 1;\n'); // what the patch wrote
  require('./completion-controller').handlePayload({ hook_event_name: 'PostToolUse', ...auth, cwd: root,
    tool_name: 'renamed_patch', tool_input: { command: '*** Begin Patch\n*** Add File: added.js\n+module.exports = 1;\n*** End Patch' } }, { host: 'codex', projectDir: root });
  assert.strictEqual(completion.loadState(root, auth).observation, null, 'the patch did not drop the evidence');
});

test('path guard reads shapes: a PowerShell write into another project\'s .crabshell is blocked, an MCP read only advised', () => {
  const { evaluatePathPolicy } = require('./core/path-policy');
  const root = tempProject('pathguard');
  // Paths under the system temp folder count as scratch space (allowed), so the other
  // project lives at a non-temporary path, as in fixtures/codex/pre-tool-use.json.
  const target = '/other/.crabshell/memory/logbook.md';
  const write = evaluatePathPolicy({ tool_name: 'PowerShell', tool_input: { command: `echo x > "${target}"` } }, root);
  assert.ok(write && write.reason, `PowerShell write was not blocked: ${JSON.stringify(write)}`);
  const read = evaluatePathPolicy({ tool_name: 'mcp__fs__read_file', tool_input: { path: target } }, root);
  assert.ok(read && read.advisory && !read.reason, `MCP read was not advised: ${JSON.stringify(read)}`);
  const ownLogbook = path.join(root, '.crabshell', 'memory', 'logbook.md');
  const edit = evaluatePathPolicy({ tool_name: 'renamed_edit', tool_input: { file_path: ownLogbook, old_string: 'a', new_string: 'b' } }, root);
  assert.ok(edit && edit.reason && /append-only/.test(edit.reason), `edit-shaped logbook change was not blocked: ${JSON.stringify(edit)}`);
});

test('document guard reads shapes: a renamed whole-file write to a discussion without the skill is blocked like Write', () => {
  const { evaluateDocsGuard } = require('./docs-guard');
  const root = tempProject('docsguard');
  fs.mkdirSync(path.join(root, '.crabshell', 'discussion'), { recursive: true });
  const file = path.join(root, '.crabshell', 'discussion', 'D001-x.md');
  const named = evaluateDocsGuard({ tool_name: 'Write', session_id: 's', tool_input: { file_path: file, content: 'x' } }, root);
  const renamed = evaluateDocsGuard({ tool_name: 'mcp__fs__write_file', session_id: 's', tool_input: { path: file, content: 'x' } }, root);
  assert.ok(named && named.reason, 'Write was not blocked');
  assert.deepStrictEqual(Boolean(renamed && renamed.reason), true, 'a renamed write was not blocked');
});

test('session memory counts a renamed file write as work done', () => {
  const { inspectSessionTranscript } = require('./core/session-intent');
  const root = tempProject('intent');
  const file = path.join(root, 'session.jsonl');
  fs.writeFileSync(file, [
    { type: 'user', message: { content: 'tidy the notes file' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__fs__write_file', input: { path: 'notes.txt', content: 'x' } }] } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  const result = inspectSessionTranscript(file);
  assert.ok(result.persist === true && ['mutating-tool', 'execution-prompt'].includes(result.reason), JSON.stringify(result));
  const readOnly = path.join(root, 'read.jsonl');
  fs.writeFileSync(readOnly, [
    { type: 'user', message: { content: 'tidy the notes file' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__fs__read_file', input: { path: 'notes.txt' } }] } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  assert.strictEqual(inspectSessionTranscript(readOnly).reason === 'mutating-tool', false);
});

test('raw log refinement summarizes a PowerShell command and a renamed write by shape', () => {
  const { processLine } = require('./refine-raw');
  const shell = processLine(JSON.stringify({ type: 'assistant', timestamp: 't', message: { content: [transcript['powershell-success'].tool_use] } }));
  assert.strictEqual(shell && shell.cmd, transcript['powershell-success'].tool_use.input.command);
  const write = processLine(JSON.stringify({ type: 'assistant', timestamp: 't', message: { content: [{ type: 'tool_use', id: 'w', name: 'mcp__fs__write_file', input: { path: 'notes.txt', content: 'abc' } }] } }));
  assert.ok(write && write.target === 'notes.txt' && write.size === 3, JSON.stringify(write));
});

for (const dir of temps) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
