'use strict';
// D123 T2: a ticket under a discussion is created only after the discussion's
// plan exists and with its own part of it; a ticket is verified only after its
// result is compared with the discussion (Intent Fidelity). Runs the docs guard,
// the log guard and the Codex document tool on temp projects.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');

const report = h.createReporter('plan-first-guards');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-first-guards-'));
const CRAB = '.crabshell';

function project(name, discussion) {
  const dir = fs.mkdtempSync(path.join(base, `${name}-`));
  for (const folder of ['discussion', 'ticket', 'memory']) fs.mkdirSync(path.join(dir, CRAB, folder), { recursive: true });
  if (discussion !== null) fs.writeFileSync(path.join(dir, CRAB, 'discussion', 'D001-topic.md'), discussion);
  return dir;
}
const EMPTY_PLAN = '# D001 - topic\n\n## Intent\nx\n\n## Plan\n(placeholder — plan before tickets)\n\n## Discussion Log\n';
const TEMPLATE_PLAN = '# D001 - topic\n\n## Plan\n{How it will be built}\n**Approach:** {how}\n**Changes (file → what):** {each file}\n**User confirmation:** {the user\'s words}\n\n## Discussion Log\n';
const FILLED_PLAN = '# D001 - topic\n\n## Plan\n**Approach:** add a guard\n**Changes (file → what):** scripts/a.js → check()\n**User confirmation:** "go" 2026-09-25\n\n## Discussion Log\n';
const CYCLE_PLAN = '# D001 - topic\n\n## Discussion Log\n\n---\n### [2026-09-25 10:00] Cycle 1 plan\n**Approach:** x\n';
const ticket = details => `# D001_T001 - t\n\n## Scope\nIncluded: a\n\n## Implementation Details\n${details}\n\n## Acceptance Criteria\n- AC-1\n`;

// The docs guard runs with the ticketing skill active, as when the skill writes the ticket.
function guard(dir, content, { tool = 'Write', existing = false } = {}) {
  const file = path.join(dir, CRAB, 'ticket', 'D001_T001-t.md');
  if (existing) fs.writeFileSync(file, 'old');
  const flag = path.join(dir, CRAB, 'memory', 'skill-active.json');
  fs.writeFileSync(flag, JSON.stringify({ skill: 'ticketing', activatedAt: new Date().toISOString(), sessions: { s1: { skill: 'ticketing', activatedAt: new Date().toISOString() } } }));
  const { evaluateDocsGuard } = require('./docs-guard');
  const input = tool === 'Write' ? { file_path: file, content } : { file_path: file, old_string: 'old', new_string: content };
  return evaluateDocsGuard({ tool_name: tool, session_id: 's1', tool_input: input }, dir);
}

const { checkTicketPlan } = require('./docs-guard');
{
  const dir = project('empty', EMPTY_PLAN);
  const file = path.join(dir, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/');
  const reason = checkTicketPlan(file, 'Write', ticket('- scripts/a.js → check()'), dir);
  report.check('G1 a new ticket under a discussion whose Plan is still a placeholder is blocked, naming /discussing D001',
    /no plan yet/.test(reason || '') && /args="D001"/.test(reason || ''), String(reason).slice(0, 160));
  const template = project('template', TEMPLATE_PLAN);
  report.check('G2 a Plan left as the unfilled template is not a plan',
    /no plan yet/.test(checkTicketPlan(path.join(template, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/'), 'Write', ticket('- a'), template) || ''));
  for (const [name, content] of [['filled', FILLED_PLAN], ['cycle', CYCLE_PLAN]]) {
    const ok = project(name, content);
    report.check(`G3 ${name}: a filled Plan${name === 'cycle' ? ' (a regressing "Cycle 1 plan" log entry)' : ''} lets the ticket through`,
      checkTicketPlan(path.join(ok, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/'), 'Write', ticket('- scripts/a.js → check()'), ok) === null);
  }
  const noDetails = project('nodetails', FILLED_PLAN);
  const noDetailsFile = path.join(noDetails, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/');
  report.check('G4 a new ticket with empty or TBD Implementation Details is blocked',
    /Implementation Details is empty/.test(checkTicketPlan(noDetailsFile, 'Write', ticket(''), noDetails) || '')
    && /Implementation Details is empty/.test(checkTicketPlan(noDetailsFile, 'Write', ticket('TBD.'), noDetails) || ''));
  const existingDir = project('existing', EMPTY_PLAN);
  const existingFile = path.join(existingDir, CRAB, 'ticket', 'D001_T001-t.md');
  fs.writeFileSync(existingFile, 'old');
  report.check('G5 control: an existing ticket, an Edit, a plan-parent ticket and a missing parent are not checked',
    checkTicketPlan(existingFile.replace(/\\/g, '/'), 'Write', ticket(''), existingDir) === null
    && checkTicketPlan(path.join(dir, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/'), 'Edit', '', dir) === null
    && checkTicketPlan(path.join(dir, CRAB, 'ticket', 'P001_T001-t.md').replace(/\\/g, '/'), 'Write', ticket(''), dir) === null
    && checkTicketPlan(path.join(dir, CRAB, 'ticket', 'D009_T001-t.md').replace(/\\/g, '/'), 'Write', ticket(''), dir) === null);
  const through = guard(project('hook', EMPTY_PLAN), ticket('- scripts/a.js → check()'));
  report.check('G6 through the guard entry point with the ticketing skill active, the ticket is still blocked',
    Boolean(through) && /no plan yet/.test(through.reason), JSON.stringify(through).slice(0, 200));
}

// Log guard: verified needs Intent Fidelity; done does not; old tickets without it are unaffected.
{
  const { validatePendingSections } = require('./log-guard');
  const filled = '## Execution Results\ndone\n\n## Verification Results\nok\n\n';
  const fidelityPending = `${filled}## Intent Fidelity\n(placeholder — parent compares the result with the discussion's Intent Anchor and Plan here)\n\n## Final Verification\nok\n`;
  const fidelityFilled = `${filled}## Intent Fidelity\n| IA-1 | met | none | test | — |\n\n## Final Verification\nok\n`;
  const old = `${filled}## Final Verification\nok\n`;
  const toVerified = validatePendingSections(fidelityPending, 'D001_T001', 'verified');
  report.check('L1 verified is blocked while Intent Fidelity holds its placeholder, and the reason names it',
    toVerified.valid === false && /Intent Fidelity/.test(toVerified.reason), toVerified.reason.slice(0, 200));
  report.check('L2 done is not blocked by Intent Fidelity', validatePendingSections(fidelityPending, 'D001_T001', 'done').valid === true);
  report.check('L3 a filled Intent Fidelity passes, and an older ticket without the section is unaffected',
    validatePendingSections(fidelityFilled, 'D001_T001', 'verified').valid === true && validatePendingSections(old, 'D001_T001', 'verified').valid === true);
}

// Codex document tool
{
  const dir = project('codex', null);
  const run = args => spawnSync(process.execPath, [path.join(__dirname, 'codex-docs.js'), ...args, `--project-dir=${dir}`], { cwd: dir, encoding: 'utf8', windowsHide: true });
  const noPlan = run(['discussion', 'No plan yet']);
  const discussionFile = fs.readdirSync(path.join(dir, CRAB, 'discussion')).find(f => f.startsWith('D001-'));
  const discussionText = discussionFile ? fs.readFileSync(path.join(dir, CRAB, 'discussion', discussionFile), 'utf8') : '';
  report.check('X1 a Codex discussion starts with a Plan section (placeholder without --how)', noPlan.status === 0 && /## Plan\n\(placeholder/.test(discussionText));
  const refused = run(['ticket', 'Too early', '--parent=D001', '--details=- a.js → f()']);
  report.check('X2 a Codex ticket under a discussion with no plan is refused and nothing is written',
    refused.status === 1 && /no plan yet/.test(refused.stderr) && !fs.readdirSync(path.join(dir, CRAB, 'ticket')).some(f => f.startsWith('D001_T')), refused.stderr.slice(0, 160));
  const planned = run(['discussion', 'With plan', '--how=**Approach:** add a guard; scripts/a.js → check()']);
  const noDetails = run(['ticket', 'No details', '--parent=D002']);
  report.check('X3 --how fills the Plan; a ticket without --details is refused', planned.status === 0 && noDetails.status === 1 && /--details/.test(noDetails.stderr), noDetails.stderr.slice(0, 160));
  const made = run(['ticket', 'Made', '--parent=D002', '--details=scripts/a.js → check(): add the guard']);
  const ticketFile = fs.readdirSync(path.join(dir, CRAB, 'ticket')).find(f => f.startsWith('D002_T001-'));
  const ticketText = ticketFile ? fs.readFileSync(path.join(dir, CRAB, 'ticket', ticketFile), 'utf8') : '';
  report.check('X4 with a plan and --details the ticket is created with Implementation Details and an Intent Fidelity placeholder',
    made.status === 0 && /## Implementation Details\nscripts\/a\.js → check\(\): add the guard/.test(ticketText) && /## Intent Fidelity\n\(placeholder/.test(ticketText), made.stderr.slice(0, 160));
}

report.finish();
