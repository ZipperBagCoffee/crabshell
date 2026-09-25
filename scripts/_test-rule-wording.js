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
const rule5 = (regressing.match(/^5\. \*\*[^\n]*/m) || [''])[0];
report.check('W9 regressing Rule 5: a limitation that changes the result is reported at once, work continues',
  /changes what the user will get/.test(rule5) && /one line/.test(rule5) && /keep working/.test(rule5), rule5.slice(0, 200));

report.finish();
