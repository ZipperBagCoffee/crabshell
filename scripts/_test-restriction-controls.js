'use strict';
// D119 P178_T001: restrictions that blocked harmless work during cycle 1 must be
// lifted, and each lifted restriction keeps a control for what it must still block.
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('./testlib/hook-harness');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const root = h.makeWorkRoot('restriction-controls');
const report = h.createReporter('restriction-controls');
const fwd = value => value.replace(/\\/g, '/');
// A project path outside both this project and the OS temp folder (need not exist).
const OTHER = fwd(path.join(os.homedir(), 'crabshell-test-other-project'));
const pathGuard = (project, tool_name, tool_input) => h.runHook(root, 'path-guard.js', [], { hook_event_name: 'PreToolUse', session_id: A, tool_name, tool_input }, project);
const context = result => { try { return JSON.parse(result.stdout.trim().split('\n').pop()).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };

// --- path-guard: mentions and reads are not wrong-path writes ---
{
  const project = h.makeProject(root, 'pg');
  const P = fwd(project);
  // PG1/PG2 are the commands that were actually blocked in the D119 cycle-1 session
  // (project path replaced): escaped quotes inside a node -e script shift the naive
  // quote pairing, so prose and a grep pattern were read as paths.
  const cases = [
    ['PG1 a script whose string mentions ".crabshell/." in prose is allowed',
      { command: `cd "${P}/scripts" && node -e "\nconst fs=require('fs');\nconst pin=\\"\\n// D119 P177_T001: pin the project to a temp dir so the guard never writes the live .crabshell/.\\nprocess.env.CLAUDE_PROJECT_DIR = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'sycophancy-test-project-'));\\n\\";\nconsole.log(pin)" && grep -n "P177_T001" -A1 _test-sycophancy-*.js | head` }],
    ['PG2 a grep pattern naming .crabshell folders is allowed',
      { command: `cd "${P}" && node -e "\nconst fs=require('fs');\nfor(const f of ['.claude-plugin/plugin.json']){let t=fs.readFileSync(f,'utf8');const n=(t.match(/\\"version\\": \\"21\\.123\\.0\\"/g)||[]).length;console.log(f,n)}\n" && grep -rn "21\\.123\\.0" --include=*.md --include=*.json . 2>/dev/null | grep -v "^./.crabshell/\\(discussion\\|plan\\|ticket\\|investigation\\|memory\\|hotfix\\|worklog\\)" | grep -v node_modules | cut -c1-150` }],
    ['PG3 a heredoc body that mentions a .crabshell path is allowed',
      { command: `cat >> notes.md <<'EOF'\nran .crabshell/verification/run-verify.js in ${OTHER}/.crabshell/verification\nEOF` }],
    ['PG4 a path built from an unknown shell variable is allowed (cannot be judged)',
      { command: 'mkdir -p "$SNAPSHOT/copy/.crabshell/verification"' }],
    ['PG5 creating a .crabshell folder under the OS temp folder is allowed',
      { command: `mkdir -p "${fwd(path.join(os.tmpdir(), 'crabshell-fixture', '.crabshell', 'memory'))}"` }],
    ['PG6 reading another project\'s memory with cat is allowed',
      { command: `cat ${OTHER}/.crabshell/memory/logbook.md` }],
  ];
  for (const [name, input] of cases) {
    const result = pathGuard(project, 'Bash', input);
    report.check(name, result.status === 0, `exit=${result.status} ${result.stdout.slice(0, 140)}`);
  }
  const read = pathGuard(project, 'Read', { file_path: `${OTHER}/.crabshell/memory/logbook.md` });
  report.check('PG7 the Read tool on another project\'s .crabshell is allowed', read.status === 0, `exit=${read.status}`);
  report.check('PG7 ...and the model is told it is another project\'s memory', context(read).includes(OTHER), context(read).slice(0, 160));
  const config = pathGuard(project, 'Read', { file_path: fwd(path.join(os.homedir(), '.crabshell', 'config.json')) });
  report.check('PG8 reading the plugin\'s global config (~/.crabshell/config.json) is allowed', config.status === 0, `exit=${config.status}`);

  const controls = [
    ['PGc1 control: appending to another project\'s logbook with a redirect is blocked', { command: `echo note >> "${OTHER}/.crabshell/memory/logbook.md"` }, 2],
    ['PGc2 control: deleting another project\'s memory file is blocked', { command: `rm -f ${OTHER}/.crabshell/memory/logbook.md` }, 2],
    ['PGc3 control: writing the legacy global memory location is blocked', { command: `echo note > ${fwd(path.join(os.homedir(), '.crabshell', 'projects', 'demo', 'memory', 'logbook.md'))}` }, 2],
    ['PGc4 control: writing this project\'s memory through $CLAUDE_PROJECT_DIR is allowed', { command: 'echo note >> "$CLAUDE_PROJECT_DIR/.crabshell/memory/logbook.md"' }, 0],
    ['PGc5 control: writing this project\'s memory by absolute path is allowed', { command: `echo note >> "${P}/.crabshell/memory/logbook.md"` }, 0],
  ];
  for (const [name, input, expected] of controls) {
    const result = pathGuard(project, 'Bash', input);
    report.check(name, result.status === expected, `exit=${result.status}`);
  }
  const logbookEdit = pathGuard(project, 'Edit', { file_path: `${P}/.crabshell/memory/logbook.md`, old_string: 'a', new_string: 'b' });
  report.check('PGc6 control: editing logbook.md in place is still blocked (append-only)', logbookEdit.status === 2, `exit=${logbookEdit.status}`);
}

// --- doc-watchdog: only edits inside the project count ---
function watchdogProject(name) {
  const project = h.makeProject(root, name);
  fs.writeFileSync(h.memoryPath(project, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution', cycle: 1, totalCycles: 1, discussion: 'D900', ticketIds: ['P900_T001'], lastUpdatedAt: new Date().toISOString() }));
  fs.mkdirSync(path.join(project, '.crabshell', 'ticket'), { recursive: true });
  fs.writeFileSync(path.join(project, '.crabshell', 'ticket', 'P900_T001-fixture.md'), '# P900_T001\n\n## Log\n\n---\n### [2026-09-24 00:00] Created\nfixture\n');
  return project;
}
const record = (project, file) => h.runHook(root, 'doc-watchdog.js', ['record'], { hook_event_name: 'PostToolUse', session_id: A, tool_name: 'Edit', tool_input: { file_path: fwd(file), old_string: 'a', new_string: 'b' } }, project);
const stopHook = project => h.runHook(root, 'completion-controller.js', [], { hook_event_name: 'Stop', session_id: A, stop_hook_active: false }, project);
{
  const project = watchdogProject('dw-outside');
  const scratch = path.join(root, 'scratch-outside', 'repro.js');
  fs.mkdirSync(path.dirname(scratch), { recursive: true });
  fs.writeFileSync(scratch, '// scratch\n');
  record(project, scratch);
  const result = stopHook(project);
  report.check('DW1 an edit outside the project does not make Stop demand a ticket log', !/Document update pending/.test(result.stdout + result.stderr), `exit=${result.status} ${result.stdout.slice(0, 160)}`);
}
{
  const project = watchdogProject('dw-inside');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'x.js'), 'module.exports = 1;\n');
  record(project, path.join(project, 'src', 'x.js'));
  const result = stopHook(project);
  report.check('DWc1 control: an in-project source edit with no ticket work log still makes Stop ask', result.status === 2 && /Document update pending/.test(result.stdout + result.stderr), `exit=${result.status}`);
}
{
  const project = watchdogProject('dw-warning');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  for (let i = 0; i < 5; i++) {
    const file = path.join(project, 'src', `f${i}.js`);
    fs.writeFileSync(file, `module.exports = ${i};\n`);
    record(project, file);
  }
  const gate = h.runHook(root, 'doc-watchdog.js', ['gate'], { hook_event_name: 'PreToolUse', session_id: A, tool_name: 'Edit', tool_input: { file_path: fwd(path.join(project, 'src', 'f0.js')), old_string: 'a', new_string: 'b' } }, project);
  report.check('DW2 the five-edit warning reaches the model (hookSpecificOutput.additionalContext)', /DOC-WATCHDOG/.test(context(gate)), gate.stdout.slice(0, 160));
}

// --- web-guard: only this project's search servers count ---
{
  const project = h.makeProject(root, 'wg');
  const web = require('./web-guard');
  const evaluate = (config, mcpJson) => {
    const configPath = path.join(root, `wg-config-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config));
    const mcpPath = path.join(root, `wg-mcp-${Math.random().toString(36).slice(2)}.json`);
    if (mcpJson) fs.writeFileSync(mcpPath, JSON.stringify(mcpJson));
    return web.evaluateWebGuard({ tool_name: 'WebSearch', tool_input: { query: 'q' } }, project, { userConfigPath: configPath, projectMcpJsonPath: mcpPath, mode: 'block' });
  };
  const blocked = decision => Boolean(decision && decision.block);
  const windowsKey = project.replace(/\//g, '\\');
  report.check('WG1 another project\'s search server does not block this project\'s WebSearch',
    !blocked(evaluate({ projects: { [fwd(path.join(os.homedir(), 'other-project'))]: { mcpServers: { tavily: { command: 'x' } } } } })));
  report.check('WG2 a local server merely named "codebase-search" is not a web search server',
    !blocked(evaluate({ mcpServers: { 'codebase-search': { command: 'x' } } })));
  report.check('WG3 a server whose name only contains a provider name ("example-docs" has "exa") is not a web search server',
    !blocked(evaluate({ mcpServers: { 'example-docs': { command: 'x' } } })));
  report.check('WGc1 control: a search server configured for this project (Windows-style key) still blocks',
    blocked(evaluate({ projects: { [windowsKey]: { mcpServers: { tavily: { command: 'x' } } } } })));
  report.check('WGc2 control: a user-wide search server still blocks',
    blocked(evaluate({ mcpServers: { 'brave-search': { command: 'x' } } })));
  report.check('WGc3 control: a search server in the project .mcp.json still blocks',
    blocked(evaluate({}, { mcpServers: { exa: { command: 'x' } } })));
}

report.finish();
