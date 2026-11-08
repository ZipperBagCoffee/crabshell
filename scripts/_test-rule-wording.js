'use strict';
// The rules the model is given (D120 T3; rewritten in D151_T005). Rule sentences are the
// product: a check that pins their words fails on every rewording that keeps the instruction,
// so whoever rewords a rule had to hunt through this file. What is checked here survives a
// rewording:
//   - every line of the per-prompt checklist reaches the model, on a question turn and an
//     execution turn (the lines are taken from the source, not copied);
//   - the order the user set for the principles and the checklist, by line labels only;
//   - retired wording stays out;
//   - Simple Communication stays short (the user found it too long, v21.136.0).
// Whether a reworded rule still says what was approved is read when it is reworded.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');

const report = h.createReporter('rule-wording');
const { RULES } = require('./inject-rules');
const { COMPRESSED_CHECKLIST } = require('./shared-context');
const verifyingSkill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'verifying', 'SKILL.md'), 'utf8');

const lines = text => text.split('\n');
const lineStarting = (text, label) => lines(text).find(line => line.startsWith(label)) || '';
// The labels, in order, that must sit on consecutive lines.
const consecutive = (text, labels) => {
  const all = lines(text);
  const at = all.findIndex(line => line.startsWith(labels[0]));
  return at >= 0 && labels.every((label, offset) => (all[at + offset] || '').startsWith(label));
};

{
  // The checklist reaches the model: run the prompt hook on a temporary project.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-wording-hook-'));
  try {
    fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
    const hookErrors = [];
    const outputs = ['이거 됐나?', '이 버그 고쳐줘'].map((prompt, turn) => {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'inject-rules.js')], { cwd: dir, encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CRABSHELL_BACKGROUND: '', HOOK_DATA: '' },
        input: JSON.stringify({ cwd: dir, session_id: 'wording-test', prompt_id: `turn-${turn}`, hook_event_name: 'UserPromptSubmit', prompt }) });
      if (r.error || r.status !== 0) hookErrors.push(String(r.error || r.stderr || 'exit ' + r.status));
      try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; }
    });
    const checklistLines = lines(COMPRESSED_CHECKLIST).map(line => line.trim()).filter(Boolean);
    const missing = outputs.map(context => checklistLines.filter(line => !context.includes(line)));
    report.check('W1 every line of the per-prompt checklist reaches the model on a question turn and an execution turn, without hook errors',
      checklistLines.length > 3 && hookErrors.length === 0 && missing.every(list => list.length === 0),
      `${checklistLines.length} lines; missing ${missing.map(list => list.length).join('/')}${hookErrors.length ? '; ' + hookErrors.join('; ') : ''}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The order the user set (v21.136.0, v21.138.0, v21.141.0): Common Sense right after Be Logical,
// Take Pride and Depth after it; on the checklist, "Is this your best?" right after common sense
// and the coding line after it (D144, D146, D150).
report.check('W2 the principles run Be Logical, Common Sense, Take Pride, Depth on consecutive lines',
  consecutive(RULES, ['- **Be Logical**:', '- **Common Sense**:', '- **Take Pride**:', '- **Depth**:']));
report.check('W3 the checklist runs common sense, "Is this your best?" and the coding line on consecutive lines',
  consecutive(COMPRESSED_CHECKLIST, ['- Common sense:', '- Is this your best?', '- Code:']));

// Retired wording that must not come back: the P/O/G acronym, the old internet-search line,
// "record after doing" (plan first, D123), a "purpose" test in Common Sense (D124), and the
// verifying skill's full run before every release (D128).
{
  const retired = [
    ['rules', RULES, /P\/O\/G check/], ['checklist', COMPRESSED_CHECKLIST, /\(P\/O\/G\)/],
    ['rules', RULES, /Search internet if unsure/], ['rules', RULES, /record after doing/],
    ['Common Sense', lineStarting(RULES, '- **Common Sense**:'), /purpose/i],
    ['verifying skill', verifyingSkill, /Run the full set before a release/],
  ];
  const back = retired.filter(([, text, pattern]) => pattern.test(text)).map(([where, , pattern]) => `${where}: ${pattern}`);
  report.check('W4 retired wording stays out of the rules, the checklist and the verifying skill', back.length === 0, back.join('; '));
}

{
  const line = lineStarting(RULES, '- **Simple Communication**:');
  report.check('W5 Simple Communication stays short (at most 1,200 characters)', line.length > 0 && line.length <= 1200, String(line.length));
}

// D153: the rules block and the per-prompt checklist were cut to these sizes with every
// condition kept; a later edit that grows them past the budget must cut something else first.
{
  const budgets = [['W6 the rules block', RULES, 10600], ['W7 the per-prompt checklist', COMPRESSED_CHECKLIST, 2700]];
  for (const [name, text, limit] of budgets) {
    report.check(`${name} stays within ${limit.toLocaleString('en-US')} characters`, text.length <= limit, String(text.length));
  }
}

report.finish();
