'use strict';
// D123 T2: a ticket under a discussion is created only after the discussion's
// plan exists and with its own part of it; a ticket is verified only after its
// result is compared with the discussion (Intent Fidelity). Runs the docs guard,
// the log guard and the Codex document tool on temp projects.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');

const report = h.createReporter('plan-first-guards');
// The harness work root is removed on exit, with every project made under it.
const base = h.makeWorkRoot('plan-first-guards');
const CRAB = '.crabshell';

function project(name, discussion) {
  const dir = fs.mkdtempSync(path.join(base, `${name}-`));
  for (const folder of ['discussion', 'ticket', 'memory']) fs.mkdirSync(path.join(dir, CRAB, folder), { recursive: true });
  if (discussion !== null) fs.writeFileSync(path.join(dir, CRAB, 'discussion', 'D001-topic.md'), discussion);
  return dir;
}
const EMPTY_PLAN = '# D001 - topic\n\n## Intent\nx\n\n## Plan\n(placeholder — plan before tickets)\n\n## Discussion Log\n';
const TEMPLATE_PLAN = '# D001 - topic\n\n## Plan\n{How it will be built}\n**Approach:** {how}\n**Changes (file → what):** {each file}\n**User confirmation:** {the user\'s words}\n\n## Discussion Log\n';
const FILLED_PLAN = '# D001 - topic\n\n## Plan\n**Approach:** add a guard\n**Reader Structure:** none: no visible result\n**Values:** none: no new names or numbers\n**Structure:** one function\n**Start state:** old discussions keep their tickets\n**User burden:** none: nothing to do\n**Design review:** none: low risk\n**Changes (file → what):** scripts/a.js → check()\n**User confirmation:** "go" 2026-09-25\n\n## Discussion Log\n';
const CYCLE_PLAN = '# D001 - topic\n\n## Discussion Log\n\n---\n### [2026-09-25 10:00] Cycle 1 plan\n**Approach:** x\n**Reader Structure:** none: no visible result\n**Values:** none: no new names or numbers\n**Structure:** one function\n**Start state:** old discussions keep their tickets\n**User burden:** none: nothing to do\n**Design review:** none: low risk\n';
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
  const reason = checkTicketPlan(file, 'whole', ticket('- scripts/a.js → check()'), dir);
  report.check('G1 a new ticket under a discussion whose Plan is still a placeholder is blocked, naming /discussing D001',
    /no plan yet/.test(reason || '') && /args="D001"/.test(reason || ''), String(reason).slice(0, 160));
  const template = project('template', TEMPLATE_PLAN);
  report.check('G2 a Plan left as the unfilled template is not a plan',
    /no plan yet/.test(checkTicketPlan(path.join(template, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/'), 'whole', ticket('- a'), template) || ''));
  for (const [name, content] of [['filled', FILLED_PLAN], ['cycle', CYCLE_PLAN]]) {
    const ok = project(name, content);
    report.check(`G3 ${name}: a filled Plan${name === 'cycle' ? ' (a regressing "Cycle 1 plan" log entry)' : ''} lets the ticket through`,
      checkTicketPlan(path.join(ok, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/'), 'whole', ticket('- scripts/a.js → check()'), ok) === null);
  }
  const noDetails = project('nodetails', FILLED_PLAN);
  const noDetailsFile = path.join(noDetails, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/');
  report.check('G4 a new ticket with empty or TBD Implementation Details is blocked',
    /Implementation Details is empty/.test(checkTicketPlan(noDetailsFile, 'whole', ticket(''), noDetails) || '')
    && /Implementation Details is empty/.test(checkTicketPlan(noDetailsFile, 'whole', ticket('TBD.'), noDetails) || ''));
  const existingDir = project('existing', EMPTY_PLAN);
  const existingFile = path.join(existingDir, CRAB, 'ticket', 'D001_T001-t.md');
  fs.writeFileSync(existingFile, 'old');
  report.check('G5 control: an existing ticket, an Edit, a plan-parent ticket and a missing parent are not checked',
    checkTicketPlan(existingFile.replace(/\\/g, '/'), 'whole', ticket(''), existingDir) === null
    && checkTicketPlan(path.join(dir, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/'), 'edit', '', dir) === null
    && checkTicketPlan(path.join(dir, CRAB, 'ticket', 'P001_T001-t.md').replace(/\\/g, '/'), 'whole', ticket(''), dir) === null
    && checkTicketPlan(path.join(dir, CRAB, 'ticket', 'D009_T001-t.md').replace(/\\/g, '/'), 'whole', ticket(''), dir) === null);
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
  const planned = run(['discussion', 'With plan', '--how=**Approach:** add a guard; scripts/a.js → check()\n**Reader Structure:** none: no visible result\n**Values:** none: no new names\n**Structure:** one function\n**Start state:** unchanged\n**User burden:** none: nothing\n**Design review:** none: low risk']);
  const noDetails = run(['ticket', 'No details', '--parent=D002']);
  report.check('X3 --how fills the Plan; a ticket without --details is refused', planned.status === 0 && noDetails.status === 1 && /--details/.test(noDetails.stderr), noDetails.stderr.slice(0, 160));
  const made = run(['ticket', 'Made', '--parent=D002', '--details=scripts/a.js → check(): add the guard']);
  const ticketFile = fs.readdirSync(path.join(dir, CRAB, 'ticket')).find(f => f.startsWith('D002_T001-'));
  const ticketText = ticketFile ? fs.readFileSync(path.join(dir, CRAB, 'ticket', ticketFile), 'utf8') : '';
  report.check('X4 with a plan and --details the ticket is created with Implementation Details and an Intent Fidelity placeholder',
    made.status === 0 && /## Implementation Details\nscripts\/a\.js → check\(\): add the guard/.test(ticketText) && /## Intent Fidelity\n\(placeholder/.test(ticketText), made.stderr.slice(0, 160));
  // D145_T003: each design line has its own argument (like --reader), named from DESIGN_FIELDS.
  const { DESIGN_FIELDS, missingDesignFields } = require('./core/plan-entry');
  const argName = field => field.toLowerCase().replace(/\s+/g, '-');
  const designArgs = DESIGN_FIELDS.map(field => `--${argName(field)}=${field} line`);
  run(['discussion', 'Design by arguments', '--how=**Approach:** one function', '--reader=none: no visible result', ...designArgs]);
  run(['discussion', 'One line short', '--how=**Approach:** one function', '--reader=none: no visible result', ...designArgs.slice(0, -1)]);
  const docOf = id => { const name = fs.readdirSync(path.join(dir, CRAB, 'discussion')).find(f => f.startsWith(`${id}-`)); return name ? fs.readFileSync(path.join(dir, CRAB, 'discussion', name), 'utf8') : ''; };
  const full = missingDesignFields(docOf('D003'));
  const short = missingDesignFields(docOf('D004'));
  report.check('X5 the Codex discussion command writes each design line from its own argument; leaving one out leaves only that one missing',
    full.length === 0 && short.length === 1 && short[0] === DESIGN_FIELDS[DESIGN_FIELDS.length - 1], `full=${full} short=${short}`);
}

// D133: a plan names who reads the result; a ticket records who tried it and how a correction spread.
{
  const NO_READER = '# D001 - topic\n\n## Plan\n**Approach:** add a screen\n**Values:** none: no new names or numbers\n**Structure:** one function\n**Start state:** old discussions keep their tickets\n**User burden:** none: nothing to do\n**Design review:** none: low risk\n**Changes (file → what):** ui.js → menu()\n**User confirmation:** "go"\n\n## Discussion Log\n';
  const check = content => { const d = project('reader', content); return checkTicketPlan(path.join(d, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/'), 'whole', ticket('- a.js → f()'), d); };
  const withField = line => NO_READER.replace('**Changes', `${line}\n**Changes`);
  const blocked = check(NO_READER) || '';
  report.check('R1 a filled Plan with no Reader Structure line blocks the ticket and names the skills to use',
    /Reader Structure/.test(blocked) && /structuring/.test(blocked) && /args="D001"/.test(blocked), blocked.slice(0, 160));
  for (const [name, line] of [['template', '**Reader Structure:** {tasks and visible text, or "none: reason"}'], ['empty', '**Reader Structure:**'], ['TBD', '**Reader Structure:** TBD'], ['bare none', '**Reader Structure:** none']]) {
    report.check(`R2 ${name}: an unfilled Reader Structure still blocks`, /Reader Structure/.test(check(withField(line)) || ''));
  }
  report.check('R3 "none: reason" passes', check(withField('**Reader Structure:** none: only a hook changes')) === null);
  report.check('R4 a task and text list on the next lines passes', check(withField('**Reader Structure:**\n- change volume → settings → "Sound"')) === null);
  report.check('R5 a Plan revision log entry holding the line passes (a discussion that already has tickets)',
    check(`${NO_READER}\n---\n### [2026-11-01 10:00] Plan revision\n**Reader Structure:** none: no visible result\n`) === null);
  const { validatePendingSections } = require('./log-guard');
  const results = reader => `# D001_T001 - t\n\n## Execution Results\nran\n\n## Verification Results\nok\n\n## Reader Check\n${reader}\n\n## Intent Fidelity\nsame\n\n## Final Verification\nok\n`;
  const pending = validatePendingSections(results('(placeholder — person check)'), 'D001_T001', 'verified');
  report.check('R6 a Reader Check still holding its placeholder blocks verified but not done',
    pending.valid === false && /Reader Check/.test(pending.reason) && validatePendingSections(results('(placeholder — person check)'), 'D001_T001', 'done').valid === true);
  report.check('R7 a filled Reader Check passes verified; an older ticket with no such section still passes',
    validatePendingSections(results('Person check: not confirmed. Correction sweep: none.'), 'D001_T001', 'verified').valid === true
    && validatePendingSections('# D001_T001 - t\n\n## Execution Results\nran\n', 'D001_T001', 'verified').valid === true);
  const dir = project('codex-reader', null);
  const run = args => spawnSync(process.execPath, [path.join(__dirname, 'codex-docs.js'), ...args, `--project-dir=${dir}`], { cwd: dir, encoding: 'utf8', windowsHide: true });
  run(['discussion', 'No reader', '--how=**Approach:** add a screen']);
  const refused = run(['ticket', 'Too early', '--parent=D001', '--details=a.js → f()']);
  report.check('R8 Codex refuses a ticket when the plan has no Reader Structure line', refused.status === 1 && /Reader Structure/.test(refused.stderr), refused.stderr.slice(0, 160));
  run(['discussion', 'Reader', '--how=**Approach:** x\n**Reader Structure:** none: no visible result\n**Values:** none: no new names\n**Structure:** one function\n**Start state:** unchanged\n**User burden:** none: nothing\n**Design review:** none: low risk']);
  const made = run(['ticket', 'Made', '--parent=D002', '--details=a.js → f()']);
  const viaFlag = run(['discussion', 'Flag', '--how=**Approach:** x\n**Values:** none: no new names\n**Structure:** one function\n**Start state:** unchanged\n**User burden:** none: nothing\n**Design review:** none: low risk', '--reader=none: no visible result']);
  const flagTicket = run(['ticket', 'Via flag', '--parent=D003', '--details=a.js → f()']);
  report.check('R10 Codex --reader writes the line and the ticket goes through', viaFlag.status === 0 && flagTicket.status === 0, flagTicket.stderr.slice(0, 160));
  const file = fs.readdirSync(path.join(dir, CRAB, 'ticket')).find(f => f.startsWith('D002_T001-'));
  report.check('R9 a Codex ticket carries a Reader Check placeholder', made.status === 0 && Boolean(file) && /## Reader Check\n\(placeholder/.test(fs.readFileSync(path.join(dir, CRAB, 'ticket', file), 'utf8')));
}

// D145: the design is checked before building — a plan without the five design-check lines blocks a new ticket.
{
  const { DESIGN_FIELDS } = require('./core/plan-entry');
  const FULL = FILLED_PLAN;
  const check = content => { const d = project('design', content); return checkTicketPlan(path.join(d, CRAB, 'ticket', 'D001_T001-t.md').replace(/\\/g, '/'), 'whole', ticket('- a.js → f()'), d); };
  const without = field => FULL.split('\n').filter(line => !line.startsWith(`**${field}:**`)).join('\n');
  report.check('D0 plan-entry names the five design-check lines', Array.isArray(DESIGN_FIELDS) && DESIGN_FIELDS.join('|') === 'Values|Structure|Start state|User burden|Design review', String(DESIGN_FIELDS));
  for (const field of ['Values', 'Structure', 'Start state', 'User burden', 'Design review']) {
    const reason = check(without(field)) || '';
    report.check(`D1 a plan without **${field}:** blocks the ticket and the message names that line and the discussing skill`,
      reason.includes(`**${field}:**`) && /args="D001"/.test(reason), reason.slice(0, 160));
  }
  const missingTwo = check(without('Values').split('\n').filter(line => !line.startsWith('**Design review:**')).join('\n')) || '';
  report.check('D2 every missing line is named, with what goes there', missingTwo.includes('**Values:**') && missingTwo.includes('**Design review:**') && /did not write the plan/.test(missingTwo), missingTwo.slice(0, 200));
  report.check('D3 a template line ({...}), TBD or a bare "none" does not count',
    ['**Design review:** {reviewer, findings → fixes}', '**Design review:** TBD', '**Design review:** none'].every(line =>
      (check(FULL.replace('**Design review:** none: low risk', line)) || '').includes('**Design review:**')));
  report.check('D4 "none: <reason>" on every line passes', check(FULL) === null);
  report.check('D5 the lines in a Plan revision log entry pass (a discussion that already has tickets)',
    check(`${without('Values').split('\n').filter(l => !/^\*\*(Structure|Start state|User burden|Design review):\*\*/.test(l)).join('\n')}\n---\n### [2026-11-07 10:00] Plan revision\n**Values:** none: no new names or numbers\n**Structure:** one function\n**Start state:** old discussions keep their tickets\n**User burden:** none: nothing to do\n**Design review:** none: low risk\n`) === null);
  report.check('D6 a "**Reader Structure:**" line is not read as "**Structure:**"',
    (check(without('Structure')) || '').includes('**Structure:**'));
  const dir = project('codex-design', null);
  const run = args => spawnSync(process.execPath, [path.join(__dirname, 'codex-docs.js'), ...args, `--project-dir=${dir}`], { cwd: dir, encoding: 'utf8', windowsHide: true });
  run(['discussion', 'No design', '--how=**Approach:** x\n**Reader Structure:** none: no visible result']);
  const refused = run(['ticket', 'Too early', '--parent=D001', '--details=a.js → f()']);
  report.check('D7 Codex refuses a ticket when design-check lines are missing, naming them',
    refused.status === 1 && refused.stderr.includes('**Design review:**') && !fs.readdirSync(path.join(dir, CRAB, 'ticket')).some(f => f.startsWith('D001_T')), refused.stderr.slice(0, 200));
}

// D133: the structuring skill reaches both hosts and stays general.
{
  const repo = path.join(__dirname, '..');
  const claudeSkill = fs.readFileSync(path.join(repo, 'skills', 'structuring', 'SKILL.md'), 'utf8');
  const codexSkill = fs.readFileSync(path.join(repo, 'codex-skills', 'structuring', 'SKILL.md'), 'utf8');
  report.check('R11 the structuring skill is named in its frontmatter, and Claude and Codex carry the same text',
    /^---\nname: structuring\ndescription: /.test(claudeSkill.replace(/\r/g, '')) && claudeSkill === codexSkill);
}

report.finish();
