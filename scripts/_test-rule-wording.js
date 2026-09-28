'use strict';
// D120 T3 (from I091): rule wording the model is given. The phrases checked here
// are the contract of each rule, not incidental prose.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const report = h.createReporter('rule-wording');
const { RULES } = require('./inject-rules');
const { ORCHESTRATION_DEFAULTS, COMPRESSED_CHECKLIST } = require('./shared-context');
const regressing = fs.readFileSync(path.join(__dirname, '..', 'skills', 'regressing', 'SKILL.md'), 'utf8');

report.check('W1 the chat report is plain words in the fixed format, the check named in full (no acronym in that sentence)',
  /prediction.observation.gap check; in chat, say the result in plain words as "M of N passed" plus the failed items/.test(RULES) && !/Every task ends with a P\/O\/G check/.test(RULES));
report.check('W2 a permission denial or policy block is reported, not routed around; a user-named alternative is allowed',
  /permission denial or policy block is not a failure to route around/i.test(RULES) && /alternative the user named/i.test(RULES));
report.check('W3 facts about the current state are looked up even when familiar; stable knowledge is not',
  /current state of the world/i.test(RULES) && /even when (it|they) feels? familiar/i.test(RULES) && !/Search internet if unsure/.test(RULES));
report.check('W4 no whole-file rewrite from filtered or truncated tool output',
  /Never rewrite a whole file from filtered or truncated tool output/.test(RULES));
report.check('W5 the closing verdict names the next action only when there is one (rules and per-prompt checklist)',
  /plus the user's next action if there is one/.test(RULES) && /plus the user's next action if there is one/.test(COMPRESSED_CHECKLIST));
report.check('W6 banter: one line at the end, never inside factual sentences, lists or documents',
  /Mix in one light banter line[^.]*adds no length/.test(RULES) && /at the end of the reply/.test(RULES) && /outside factual sentences, lists and documents/.test(RULES));
report.check('W7 the turn contract says to name the chosen option in one line', /name the choice in one line/.test(ORCHESTRATION_DEFAULTS));
report.check('W8 the per-prompt checklist keeps the report format without the P/O/G acronym',
  /"M of N passed" plus the failed items/.test(COMPRESSED_CHECKLIST) && !/\(P\/O\/G\)/.test(COMPRESSED_CHECKLIST));
// v21.134.0: a cause for a removed feature was once given from a nearby CHANGELOG
// line instead of the commit that changed it; the user asked for this rule.
report.check('W10 git is the record: missing git or repository is set up after confirming; history is checked and the commit cited before saying why; untracked files are backed up',
  /\*\*Git is the record of changes:\*\* if git is not installed or the project is not a git repository, set it up — install git or run `git init` — after confirming with the user/.test(RULES)
  && /before saying what changed, when, or why[^.]*check the git history first: find the commit that changed that text \(`git log -S`/.test(RULES)
  && /Files git does not track[^.]*`<file>\.bak`/.test(RULES) && !/Non-git files →/.test(RULES) && !/say so — its history/.test(RULES));
// v21.135.0 (D123): plan in the discussion before building, not "record after doing";
// the per-prompt checklist says it, because RULES in CLAUDE.md alone did not get it done.
report.check('W11 rules: work that changes files is planned in a discussion first, the user confirms, tickets carry the specifics, the result is compared',
  !/record after doing/.test(RULES) && /work that changes files starts in a discussion: its Plan settles how[^.]*the user confirms it; each ticket carries that plan's specifics[^.]*compare the result with the discussion's Intent Anchor and Plan/.test(RULES));
report.check('W12 the per-prompt checklist names the discussing and ticketing skills before the change and the comparison after it',
  /Work that changes files starts in a discussion: its Plan \(discussing skill\)[^\n]*user confirms it, then its ticket \(ticketing skill\), then the change; before calling it done, compare the result with the discussion\./.test(COMPRESSED_CHECKLIST));
// v21.136.0 (D124): every step followed a rule and the result still looked weird to the
// user; the check is the user's own question, asked before doing and before handing over.
// The user rejected a "purpose" test (any result can be argued to fit a purpose).
{
  const lines = RULES.split('\n');
  const at = lines.findIndex(line => line.startsWith('- **Common Sense**:'));
  const rule = at >= 0 ? lines[at] : '';
  report.check('W14 rules: Common Sense follows Be Logical, asks whether the result would look weird to the user before doing and before handing over, no "purpose" test',
    at > 0 && lines[at - 1].startsWith('- **Be Logical**:')
    && ['would anything here look weird to them', 'before doing it', 'before handing it over', 'open the actual result', 'do not explain it away', 'never excuses']
      .every(phrase => rule.includes(phrase))
    && !/purpose/i.test(rule), rule.slice(0, 120));
}
report.check('W15 the per-prompt checklist carries the common-sense line',
  /- Common sense: before doing the work and before handing it over[^\n]*look weird to them, fix it first/.test(COMPRESSED_CHECKLIST));
// v21.136.0: the user found Simple Communication too long ("이거 좀 긴거같은데"); it was cut
// from 1,567 to 1,128 characters with every rule kept. The cap keeps it from growing back.
{
  const line = RULES.split('\n').find(l => l.startsWith('- **Simple Communication**:')) || '';
  report.check('W17 Simple Communication stays short (at most 1,200 characters)', line.length > 0 && line.length <= 1200, String(line.length));
}
// The user: "검증할때 항상 상식을 물어야할듯" — a weird result fails verification even when every check passes.
report.check('W16 every verification asks the common-sense question; a weird result fails even when checks pass (rules and per-prompt checklist)',
  /### VERIFICATION\n[^\n]*Every verification also asks the Common Sense question about the actual result: would anything look weird to the user\? If so, it fails, even when every check passes\./.test(RULES)
  && /^- Verification = [^\n]*always ask whether the actual result would look weird to the user — if so, it fails even when every check passes/m.test(COMPRESSED_CHECKLIST));
{
  // The line reaches the model: run the prompt hook on a temp project, question and execution turns.
  const os = require('os');
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-wording-hook-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  const outputs = ['이거 됐나?', '이 버그 고쳐줘'].map(prompt => {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'inject-rules.js')], { cwd: dir, encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CRABSHELL_BACKGROUND: '', HOOK_DATA: '' },
      input: JSON.stringify({ cwd: dir, session_id: 'wording-test', hook_event_name: 'UserPromptSubmit', prompt }) });
    try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; }
  });
  report.check('W13 the prompt hook output carries the plan-first and common-sense lines on a question turn and an execution turn',
    outputs.every(context => context.includes('Work that changes files starts in a discussion') && context.includes('- Common sense:')),
    outputs.map(o => o.length).join(','));
}
const rule5 = (regressing.match(/^5\. \*\*[^\n]*/m) || [''])[0];
report.check('W9 regressing Rule 5: a limitation that changes the result is reported at once, work continues',
  /changes what the user will get/.test(rule5) && /one line/.test(rule5) && /keep working/.test(rule5), rule5.slice(0, 200));

report.finish();
