'use strict';
// D123 T1: the document skills plan in the discussion before tickets, tickets
// carry the plan's specifics, and the result is compared with the discussion.
// Structural checks on the skill text (static); the enforcement code is tested
// in _test-plan-first-guards.js.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const report = h.createReporter('plan-first-docs');
const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const discussing = read('skills/discussing/SKILL.md');
const ticketing = read('skills/ticketing/SKILL.md');
const template = read('skills/ticketing/references/ticket-template.md');
const regressing = read('skills/regressing/SKILL.md');
const cycleVerification = read('skills/regressing/references/cycle-verification.md');
const verifying = read('skills/verifying/SKILL.md');
const codex = name => read(`codex-skills/${name}/SKILL.md`);

const PLAN_FIELDS = ['Approach', 'Changes (file → what)', 'Order', 'Rejected alternatives', 'Risks', 'Analysis', 'Intent Check', 'User confirmation'];
const createTemplate = (discussing.match(/```\n---\ntype: discussion[\s\S]*?```/) || [''])[0];
const planBlock = (createTemplate.match(/## Plan\n[\s\S]*?(?=\n## )/) || [''])[0];

report.check('PF1 the discussion template has a Plan section with every field, before the log',
  Boolean(planBlock) && PLAN_FIELDS.every(field => planBlock.includes(`**${field}:**`))
  && createTemplate.indexOf('## Plan') < createTemplate.indexOf('## Discussion Log'),
  PLAN_FIELDS.filter(field => !planBlock.includes(`**${field}:**`)).join(', '));
report.check('PF2 the Plan is revisable until the first ticket, then changes are log entries; regressing cycle plans use the same fields',
  /## Plan`[^\n]*until the first ticket[^\n]*`Plan revision`/.test(discussing) && /Cycle \{n\} plan`[^\n]*same fields/.test(discussing));
report.check('PF3 creating a discussion ends by asking for the Plan and the user\'s confirmation before tickets',
  /Step 5[\s\S]*?Plan[\s\S]*?confirm[\s\S]*?\/ticketing/.test(discussing.slice(discussing.indexOf('### Step 5'), discussing.indexOf('## Update Mode'))));
report.check('PF4 ticketing stops when the parent discussion has no filled Plan (or cycle plan) and user confirmation',
  /Step 1[\s\S]*?(STOP|stop)[^\n]*Plan/.test(ticketing.slice(ticketing.indexOf('### Step 1'), ticketing.indexOf('### Step 2'))) && !/should hold the Analysis/.test(ticketing));
// Headings only: the step text also names these sections in backticks.
const heading = name => template.search(new RegExp(`\\n## ${name}\\n`));
report.check('PF5 the ticket template carries Implementation Details (after Scope) and an Intent Fidelity result section (before Final Verification)',
  heading('Scope') > 0 && heading('Scope') < heading('Implementation Details') && heading('Implementation Details') < heading('Acceptance Criteria')
  && heading('Verification Results') < heading('Intent Fidelity') && heading('Intent Fidelity') < heading('Final Verification')
  && /\n## Intent Fidelity\n\(placeholder/.test(template));
report.check('PF6 the ticket template says how to fill Intent Fidelity and blocks an unapproved departure',
  /\| Discussion item \(IA-n \/ Plan decision\) \| Result \| Deviation \(none\/partial\/departed\) \| Evidence \| Reason \/ user approval \|/.test(template)
  && /departed[^\n]*without[^\n]*approval[^\n]*not[^\n]*verified/i.test(template));
report.check('PF7 regressing compares each cycle\'s result with the discussion and carries deviations into the next cycle',
  /Intent Fidelity/.test(cycleVerification) && /next cycle/i.test(cycleVerification.slice(cycleVerification.indexOf('Intent Fidelity')))
  && /Intent Fidelity/.test(regressing) && /deviation/i.test(regressing.slice(regressing.indexOf('#### Step 4d'), regressing.indexOf('### Step 5'))));
report.check('PF8 verifying run mode groups results by the discussion\'s IA items and names items with no evidence',
  /IA-n[^\n]*\|[^\n]*evidence/i.test(verifying) && /no evidence/i.test(verifying));
report.check('PF9 no skill on either host tells the model to build first and record later',
  [discussing, ticketing, regressing, read('skills/hotfix/SKILL.md'), read('skills/planning/SKILL.md'),
    ...['discussing', 'ticketing', 'planning', 'hotfix', 'regressing'].map(codex), read('scripts/init.js')]
    .every(text => !/record after doing|directly-performed|do the work directly and record it|After applying and verifying the change, create/i.test(text)));
report.check('PF10 Codex discussing takes the Plan (--how) and Codex ticketing requires --details',
  /--how=/.test(codex('discussing')) && /--details=/.test(codex('ticketing')) && /Intent Fidelity/.test(codex('ticketing')));

report.finish();
