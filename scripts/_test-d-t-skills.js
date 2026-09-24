'use strict';
// D119 P183: the document workflow is D (a discussion that carries the plan) -> T.
// Skill documents are instructions, not code, so these checks are structural: they
// pin the instructions each host's skills give (new regressing cycles plan inside
// the discussion and create D-parent tickets; new P and H documents are not
// created; existing P and H documents can still be updated).
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');
const { syncRulesToClaudeMd } = require('./inject-rules');

const ROOT = path.resolve(__dirname, '..');
const report = h.createReporter('d-t-skills');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

{
  const claude = read('skills/regressing/SKILL.md');
  const codex = read('codex-skills/regressing/SKILL.md');
  report.check('RG1 Claude regressing: no /planning step; the cycle plan is a discussion log entry; tickets are /ticketing D###',
    !/Invoke `\/planning`/.test(claude) && /\/discussing D\{?/.test(claude) && /\/ticketing D/.test(claude));
  report.check('RG2 Codex regressing: no plan document command; tickets take --parent',
    !/codex-docs\.js" plan /.test(codex) && /ticket "[^"]*"[^\n]*--parent=/.test(codex));
}
{
  const claude = read('skills/ticketing/SKILL.md');
  const codex = read('codex-skills/ticketing/SKILL.md');
  report.check('TK1 Claude ticketing: a discussion may be the parent, and a discussion parent is not concluded by the cascade',
    /\/ticketing D\d{3}/.test(claude) && /discussion parent[^.\n]*(never|not) conclude/i.test(claude));
  report.check('TK2 Codex ticketing: --parent with a discussion ID', /--parent=/.test(codex) && /D\d{3}_T\d{3}/.test(codex));
}
{
  const claude = read('skills/planning/SKILL.md');
  const codex = read('codex-skills/planning/SKILL.md');
  report.check('PL1 Claude planning: new plans go into the discussion; updating an existing P### stays', /new plans?[^.\n]*discussion/i.test(claude) && /\/planning P\d{3}/.test(claude));
  report.check('PL2 Codex planning: new plans go into the discussion', /discussion/i.test(codex) && !/codex-docs\.js" plan /.test(codex));
}
{
  const claude = read('skills/hotfix/SKILL.md');
  const codex = read('codex-skills/hotfix/SKILL.md');
  report.check('HF1 Claude hotfix: new one-pass work is a discussion with one ticket; updating an existing H### stays', /one ticket/i.test(claude) && /\/hotfix H\d{3}/.test(claude));
  report.check('HF2 Codex hotfix: new one-pass work is a discussion with one ticket', /one ticket/i.test(codex) && !/codex-docs\.js" hotfix /.test(codex));
}
{
  const claude = read('skills/discussing/SKILL.md');
  report.check('DS1 Claude discussing: cycle plans and discussion-parent tickets are part of the discussion', /cycle plan/i.test(claude) && /D\{?NNN\}?_T/.test(claude));
}
{
  const dir = h.makeProject(h.makeWorkRoot('d-t-skills'), 'rules');
  syncRulesToClaudeMd(dir);
  const rules = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  report.check('RU1 rules: one-pass work is a discussion with one ticket, not a hotfix document', /one-pass work[^\n]*one ticket/i.test(rules) && !/hotfix for direct one-pass work/.test(rules));
  report.check('RU2 rules: documents are D (with the plan) -> T; existing P and H stay readable', /D \(Discussion[^\n]*plan[^\n]*\)\s*→\s*T/.test(rules) && /existing P and H/i.test(rules));
}

report.finish();
