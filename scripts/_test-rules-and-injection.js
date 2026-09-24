'use strict';
// D119 P180: the rules the plugin writes into CLAUDE.md carry one advisor line and
// the unified wording for the three rules that contradicted the user's global rules;
// the per-prompt injection no longer repeats the project description, which
// SessionStart (and SubagentStart for workers) already load.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');
const { syncRulesToClaudeMd } = require('./inject-rules');
const { convert } = require('./claude-to-agents');
const { COMPRESSED_CHECKLIST } = require('./shared-context');
const { FIRST_TURN_RULES } = require('./core/first-turn-context');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const root = h.makeWorkRoot('rules-and-injection');
const report = h.createReporter('rules-and-injection');
const MARKER = 'Fixture concept: widget pipeline for rules-and-injection';

const ADVISOR = /When an advisor tool is available[^\n]*before committing to an approach[^\n]*before declaring done[^\n]*not every turn/;
const WORDING = {
  'humor is one line that adds no length': /one (light )?(banter )?line[^.\n]*(adds no length|never adds length)/i,
  'short, but never drop a required fact': /short, but never drop a required fact/i,
  'at most 4 bullets, tables only on request': /max 4 per group[^.\n]*tables only when the user asks/i,
};
const count = (text, re) => (text.match(new RegExp(re.source, 'g')) || []).length;
function wordingGaps(text) {
  const gaps = Object.entries(WORDING).filter(([, re]) => !re.test(text)).map(([name]) => name);
  if (/Accuracy outranks brevity/.test(text)) gaps.push('old "Accuracy outranks brevity" still present');
  return gaps;
}

// 1. Rules written into CLAUDE.md, and the Codex AGENTS.md conversion of that file.
const rulesProject = h.makeProject(root, 'rules');
syncRulesToClaudeMd(rulesProject);
const claudeMd = fs.readFileSync(path.join(rulesProject, 'CLAUDE.md'), 'utf8');
const agentsMd = convert(claudeMd);
report.check('R1 synced CLAUDE.md rules carry exactly one advisor line (before an approach, before done, not every turn)',
  count(claudeMd, ADVISOR) === 1, `matches=${count(claudeMd, ADVISOR)}`);
report.check('R2 the per-prompt checklist and turn contract do not mention the advisor',
  !/advisor/i.test(COMPRESSED_CHECKLIST) && !/advisor/i.test(FIRST_TURN_RULES));
report.check('R3 synced CLAUDE.md rules use the unified wording for the three contradicting rules',
  wordingGaps(claudeMd).length === 0, wordingGaps(claudeMd).join(' | '));
report.check('R4 the AGENTS.md conversion keeps the advisor line and the unified wording',
  count(agentsMd, ADVISOR) === 1 && wordingGaps(agentsMd).length === 0, wordingGaps(agentsMd).join(' | '));

// 2. Where the project description is injected.
const project = h.makeProject(root, 'injection');
fs.writeFileSync(path.join(project, '.crabshell', 'project.md'), `# Widget\n${MARKER}\n\n## Constraints\n- keep fixtures small\n`);
const prompt = { hook_event_name: 'UserPromptSubmit', session_id: A, cwd: project, prompt: 'Fix the failing test in src/app.js and commit' };
for (const script of ['inject-rules.js', 'adapters/codex/user-prompt-submit.js']) {
  const out = h.runHook(root, script, [], prompt, project, { CRABSHELL_BACKGROUND: '0' });
  report.check(`R5 ${script} per-prompt context omits the project description`,
    out.status === 0 && /Crabshell Turn Contract/.test(out.stdout) && !/## Project Concept/.test(out.stdout) && !out.stdout.includes(MARKER),
    `status=${out.status} concept=${/## Project Concept/.test(out.stdout)} marker=${out.stdout.includes(MARKER)}`);
  report.check(`R6 control: ${script} still anchors the project root and carries the quick-check`,
    /Project Root Anchor/.test(out.stdout) && /Rules Quick-Check/.test(out.stdout));
  report.check(`R7 ${script} per-prompt context does not nag about the advisor`, !/advisor/i.test(out.stdout));
}
{
  const out = h.runHook(root, 'load-memory.js', [], { hook_event_name: 'SessionStart', session_id: A, cwd: project, source: 'startup' }, project);
  report.check('R8 control: SessionStart loads the same project description as the project overview',
    /## Project Overview/.test(out.stdout) && out.stdout.includes(MARKER), `status=${out.status}`);
}
{
  const out = h.runHook(root, 'subagent-context.js', [], { hook_event_name: 'SubagentStart', session_id: A, cwd: project, agent_id: 'w1', agent_type: 'general-purpose' }, project);
  report.check('R9 control: SubagentStart still gives workers the project concept',
    /## Project Concept/.test(out.stdout) && out.stdout.includes(MARKER), `status=${out.status}`);
}

report.finish();
