'use strict';
// D119 P183: a ticket may have a discussion as its parent (D###_T###) as well as a
// plan (P###_T###, kept for existing documents). Every guard must treat both the
// same way — a pattern that only knows P would skip D tickets without an error.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');

const root = h.makeWorkRoot('d-parent-tickets');
const report = h.createReporter('d-parent-tickets');
const CRAB = '.crab' + 'shell';
const fwd = p => p.replace(/\\/g, '/');

function project(name) {
  const dir = h.makeProject(root, name);
  fs.mkdirSync(path.join(dir, CRAB, 'ticket'), { recursive: true });
  return dir;
}
function regressing(dir, phase, extra = {}) {
  fs.writeFileSync(path.join(dir, CRAB, 'memory', 'regressing-state.json'), JSON.stringify({ active: true, discussion: 'D001', cycle: 1, totalCycles: 10, phase, planId: null, ticketIds: [], lastUpdatedAt: new Date().toISOString(), ...extra }));
}
const readState = dir => JSON.parse(fs.readFileSync(path.join(dir, CRAB, 'memory', 'regressing-state.json'), 'utf8'));
function doc(dir, folder, name, body) {
  fs.mkdirSync(path.join(dir, CRAB, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, CRAB, folder, name), body);
}

for (const parent of ['P001', 'D001']) {
  const kind = parent.startsWith('P') ? 'plan parent (pinned)' : 'discussion parent';
  const id = `${parent}_T001`;
  {
    const { evaluateVerifyGuard } = require('./verify-guard');
    const dir = project(`verify-${parent}`);
    const ticket = path.join(dir, CRAB, 'ticket', `${id}-probe.md`);
    fs.writeFileSync(ticket, '# probe\n');
    const result = evaluateVerifyGuard({ tool_name: 'Edit', tool_input: { file_path: fwd(ticket), old_string: '# probe', new_string: '# probe\n\n## Final Verification\nok' } }, dir);
    report.check(`V ${kind}: verify-guard blocks a Final Verification write without a verification tool`, Boolean(result && result.reason), JSON.stringify(result).slice(0, 160));
  }
  {
    const { evaluateRegressingGuard } = require('./regressing-guard');
    const dir = project(`regress-${parent}`);
    regressing(dir, 'ticketing');
    const ticket = path.join(dir, CRAB, 'ticket', `${id}-probe.md`);
    const result = evaluateRegressingGuard({ tool_name: 'Write', tool_input: { file_path: fwd(ticket), content: '# probe\n' } }, dir);
    report.check(`R ${kind}: regressing-guard blocks writing a ticket directly in the ticketing phase`, Boolean(result && /ticketing/.test(result.reason || '')), JSON.stringify(result).slice(0, 160));
  }
  {
    const { TICKET_DOC_PATTERN, validatePendingSections } = require('./log-guard');
    report.check(`L1 ${kind}: log-guard recognizes the ticket document path`, TICKET_DOC_PATTERN.test(`/x/${CRAB}/ticket/${id}-probe.md`));
    const pending = validatePendingSections('## Execution Results (Work Agent)\n(pending)\n', id);
    report.check(`L2 ${kind}: log-guard flags a ticket whose result sections are still pending`, pending.valid === false, JSON.stringify(pending).slice(0, 160));
  }
}

// The Codex document tool creates discussion-parent tickets; the plan form stays.
{
  const dir = project('codex-docs');
  doc(dir, 'discussion', 'D001-topic.md', '# D001 - topic\n');
  doc(dir, 'plan', 'P001-plan.md', '# P001 - plan\n');
  const run = args => spawnSync(process.execPath, [path.join(__dirname, 'codex-docs.js'), ...args, `--project-dir=${dir}`], { cwd: dir, encoding: 'utf8', windowsHide: true });
  const d = run(['ticket', 'Discussion child', '--parent=D001']);
  const dFile = fs.readdirSync(path.join(dir, CRAB, 'ticket')).find(f => f.startsWith('D001_T001-'));
  report.check('C1 codex-docs creates D001_T001 for --parent=D001', d.status === 0 && Boolean(dFile), `status=${d.status} ${d.stderr.slice(0, 160)}`);
  const p = run(['ticket', 'Plan child', '--plan=P001']);
  const pFile = fs.readdirSync(path.join(dir, CRAB, 'ticket')).find(f => f.startsWith('P001_T001-'));
  report.check('C2 control: codex-docs still creates P001_T001 for --plan=P001', p.status === 0 && Boolean(pFile), `status=${p.status} ${p.stderr.slice(0, 160)}`);
  const index = fs.existsSync(path.join(dir, CRAB, 'ticket', 'INDEX.md')) ? fs.readFileSync(path.join(dir, CRAB, 'ticket', 'INDEX.md'), 'utf8') : '';
  report.check('C3 the ticket INDEX lists the discussion-parent ticket with its parent', /D001_T001/.test(index) && /\| D001 \|/.test(index), index.slice(-200));
  const before = fs.readdirSync(path.join(dir, CRAB, 'ticket')).length;
  const missing = run(['ticket', 'Orphan', '--parent=D999']);
  report.check('C4 a parent that does not exist is refused without writing a ticket', missing.status === 1 && /does not exist/.test(missing.stderr) && fs.readdirSync(path.join(dir, CRAB, 'ticket')).length === before, `status=${missing.status} ${missing.stderr.slice(0, 160)}`);
}

// A discussion-based cycle has no /planning step: recording the cycle plan in the
// discussion (a /discussing call) moves the phase from planning to ticketing.
{
  const { advancePhase } = require('./regressing-state');
  const viaDiscussion = project('phase-discussing');
  regressing(viaDiscussion, 'planning');
  report.check('A1 planning phase + /discussing naming the workflow discussion moves to ticketing', advancePhase('discussing', viaDiscussion, undefined, 'D001') === 'ticketing');
  const other = project('phase-other-session');
  regressing(other, 'planning', { sessionId: 'owner-session' });
  const moved = advancePhase('discussing', other, 'other-session', '"one-pass fix"');
  const after = readState(other);
  report.check('A3 another session\'s unrelated /discussing neither moves the phase nor takes ownership', moved === null && after.phase === 'planning' && after.sessionId === 'owner-session', JSON.stringify({ moved, phase: after.phase, owner: after.sessionId }));
  const viaPlan = project('phase-planning');
  regressing(viaPlan, 'planning');
  report.check('A2 control: planning phase + /planning still moves to ticketing', advancePhase('planning', viaPlan) === 'ticketing');
}

// Context builders for a discussion-based cycle (no plan document).
{
  const dir = project('context');
  regressing(dir, 'execution', { ticketIds: ['D001_T001'] });
  doc(dir, 'discussion', 'D001-topic.md', '# D001 - topic\n\n## Intent\nGoal text\n\n## Convergence Criteria\n- CC-1: probe criterion\n');
  doc(dir, 'ticket', 'D001_T001-work.md', '---\nstatus: in-progress\n---\n# D001_T001\n\n## Intent\nDo the work\n\n## Scope\nIncluded: scripts/a.js\nExcluded: scripts/b.js\n\n## Acceptance Criteria\n- AC-1\n');
  const { activeTaskScope } = require('./core/subagent-context');
  const scope = activeTaskScope(dir);
  report.check('W1 worker scope comes from the ticket Scope when there is no plan', /Allowed changes: Included: scripts\/a\.js/.test(scope) && /Forbidden changes: Excluded: scripts\/b\.js/.test(scope), scope.split('\n').filter(l => /changes/.test(l)).join(' | '));
  fs.writeFileSync(path.join(dir, CRAB, 'ticket', 'D001_T001-work.md'), '---\nstatus: verified\n---\n# D001_T001\n');
  const { regressingContext } = require('./core/workflow-context');
  const text = regressingContext(dir, readState(dir), Date.now());
  report.check('W2 with every ticket finished, unmet outcomes are the discussion convergence criteria', /Unmet outcomes: - CC-1: probe criterion/.test(text), text.split('\n').find(l => /Unmet/.test(l)));
}

// One definition of the ticket ID shape: guards and the document tool derive it.
{
  const literal = /P\\d\{3\}_T\\d\{3\}|\\bP\\d\{3\}\\b/;
  const users = ['verify-guard.js', 'regressing-guard.js', 'log-guard.js', 'codex-docs.js']
    .filter(file => literal.test(fs.readFileSync(path.join(__dirname, file), 'utf8')));
  report.check('S1 no guard or document tool retypes the plan-only ticket ID pattern', users.length === 0, users.join(' '));
}

report.finish();
