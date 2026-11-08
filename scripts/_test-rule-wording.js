'use strict';
// D120 T3 (from I091): rule wording the model is given. Each check pins the instruction of a
// rule — its key phrases and position — not whole sentences, so a concise rewrite that keeps
// the instruction passes (D146: the user had the rules rewritten concisely, nothing dropped).
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const report = h.createReporter('rule-wording');
const { RULES } = require('./inject-rules');
const { ORCHESTRATION_DEFAULTS, COMPRESSED_CHECKLIST } = require('./shared-context');
const regressing = fs.readFileSync(path.join(__dirname, '..', 'skills', 'regressing', 'SKILL.md'), 'utf8');

const section = name => (RULES.split(`### ${name}`)[1] || '').split('\n###')[0];
const lines = text => text.split('\n');
const lineOf = (text, prefix) => lines(text).find(line => line.startsWith(prefix)) || '';
const indexOf = (text, prefix) => lines(text).findIndex(line => line.startsWith(prefix));
const has = (text, phrases) => phrases.every(phrase => text.includes(phrase));
const verification = section('VERIFICATION');
const working = section('WORKING RULES');
const additional = section('ADDITIONAL RULES');
const checklistVerification = lineOf(COMPRESSED_CHECKLIST, '- Verification:');

report.check('W1 every task ends with the prediction/observation/gap check, reported in chat as "M of N passed" plus the failed items, without the P/O/G acronym',
  /Predict → execute → compare and record the gap; every task ends with this check, and in chat you say "M of N passed" plus the failed items, in plain words/.test(verification)
  && !/P\/O\/G check/.test(RULES));
report.check('W2 a permission denial or policy block is reported and the path stopped, never routed around; a user-named alternative is allowed',
  has(working, ['permission denial or policy block is reported and that path stopped, never routed around', 'alternative the user named']));
report.check('W3 current-world facts are looked up even when familiar; stable knowledge is not',
  has(additional, ['Look up current-world facts', 'even when they feel familiar', 'stable knowledge needs no lookup']) && !/Search internet if unsure/.test(RULES));
report.check('W4 no whole-file rewrite from filtered or truncated tool output',
  working.includes('Never rewrite a whole file from filtered or truncated tool output'));
report.check('W5 the closing verdict names the next action only when there is one (rules and per-prompt checklist)',
  RULES.includes("plus the user's next action if there is one") && COMPRESSED_CHECKLIST.includes("plus the user's next action if there is one"));
report.check('W6 banter: one line after the verdict, no added length, never inside factual sentences, lists or documents',
  /One light banter line \(깐족 유머\) after the verdict: no added length, outside factual sentences, lists and documents, never at the user's expense/.test(RULES));
report.check('W7 the turn contract says to name the chosen option in one line', /name the choice in one line/.test(ORCHESTRATION_DEFAULTS));
report.check('W8 the per-prompt checklist keeps the report format without the P/O/G acronym',
  checklistVerification.includes('"M of N passed" plus the failed items') && !/\(P\/O\/G\)/.test(COMPRESSED_CHECKLIST));
// v21.134.0: a cause for a removed feature was once given from a nearby CHANGELOG line.
{
  const git = lineOf(additional, '- **Git is the record of changes:**');
  report.check('W10 git is the record: missing git or repository is set up after the user confirms; the commit is found and cited before saying why; untracked files are backed up',
    has(git, ['no git or no repository → set it up (install git or `git init`) after the user confirms', 'See what changed with `git status` and `git diff`',
      'before saying what changed, when or why', 'find and cite the commit that changed that text (`git log -S`', 'Files git does not track → overwrite one backup (`<file>.bak`)']),
    git.slice(0, 120));
}
// v21.135.0 (D123): plan in the discussion before building, in the rules and the per-prompt checklist.
{
  const workflow = lineOf(additional, '- **Workflows:**');
  const checklist = lineOf(COMPRESSED_CHECKLIST, '- Work that changes files:');
  report.check('W11 rules: work that changes files is planned in a discussion the user confirms, tickets carry the plan, the result is compared',
    !/record after doing/.test(RULES) && has(workflow, ['work that changes files → a discussion whose Plan', 'the user confirms', 'tickets, each carrying its part of that plan',
      "compare the result with the discussion's Intent Anchor and Plan and record any deviation before calling it done"]), workflow.slice(0, 120));
  report.check('W12 the per-prompt checklist names the discussing and ticketing skills before the change and the comparison after it',
    has(checklist, ['discussion Plan (discussing skill) the user confirms', 'ticket (ticketing skill)', 'change', 'compare the result with the discussion']), checklist.slice(0, 120));
  // v21.146.0 (D135): small changes skip documents; check once after the batch and reuse unchanged passes.
  report.check('W26 Workflows keeps the delegation sentence and ends with the small-change exception',
    has(workflow, ['Delegate and review by actual risk, not role pairs or counts.', 'A small change (a few lines in one or two files, changing no hook, guard or gate behavior or the code they run; version-bump files do not count toward the two) skips both: say it in one line, make it, run the changed-file check once, give the reason in the commit message.']),
    workflow.slice(-160));
  report.check('W28 the checklist workflow line carries the small-change lane',
    checklist.endsWith('A small change (a few lines in one or two files, no hook/guard/gate code) skips both — run the changed-file check once.'), checklist.slice(-120));
}
report.check('W27 verification checks once after the last edit, reuses unchanged passes and reads the saved results, before the diff-only rule',
  indexOf(verification, '- Check once after the last edit of a batch; never re-run a check that passed on unchanged inputs (`run-verify.js` reuses such passes) — read the `Full results:` file of your run instead.') >= 0
  && indexOf(verification, '- Check once') + 1 === indexOf(verification, '- Verify the diff only:'));
// v21.136.0 (D124): the check is the user's own question, before doing and before handing over; no "purpose" test.
{
  const at = indexOf(RULES, '- **Common Sense**:');
  const rule = at >= 0 ? lines(RULES)[at] : '';
  report.check('W14 rules: Common Sense follows Be Logical, asks before doing and before handing over whether the result would look weird, no "purpose" test',
    at > 0 && lines(RULES)[at - 1].startsWith('- **Be Logical**:')
    && has(rule, ['of what you are about to do', 'actual result before handing it over', 'looked at whole, not recalled', 'would anything here look weird to the person who will use or read it',
      'do not explain it away', 'No rule flags or excuses it']) && !/purpose/i.test(rule), rule.slice(0, 120));
}
report.check('W15 the per-prompt checklist carries the common-sense line',
  /- Common sense: before doing the work and before handing it over[^\n]*look weird to them, fix it first — no rule excuses a weird result/.test(COMPRESSED_CHECKLIST));
// D144 / D146: asked every turn right after common sense — "Is this your best?", then the coding line.
// D150: the user — 「대답하기전에 이 대답이 최선인가? 이 대답은 간단명료한가를 계속 물어보게 만들어라」.
{
  const at = indexOf(COMPRESSED_CHECKLIST, '- Is this your best?');
  const best = at >= 0 ? lines(COMPRESSED_CHECKLIST)[at] : '';
  report.check('W35 the per-prompt checklist asks "Is this your best? Is it simple and clear?" before every answer and hand-over, right after the common-sense line',
    at > 0 && lines(COMPRESSED_CHECKLIST)[at - 1].startsWith('- Common sense:')
      && has(best, ['Is it simple and clear', 'only what the reader needs', 'before every answer', 'fix it before sending']), String(at));
  const code = indexOf(COMPRESSED_CHECKLIST, '- Code:');
  const line = code >= 0 ? lines(COMPRESSED_CHECKLIST)[code] : '';
  report.check('W36 the per-prompt checklist carries the coding line (hardcoding defined, parameters allowed, general mechanism, modular, structure first) right after the best question',
    code === at + 1 && has(line, ['no value, name, path or assumption fixed to specific cases', 'a project-changeable parameter with a default is fine',
      'build the general mechanism', 'split by responsibility', 'check the structure before adding a special case']), line.slice(0, 120));
  const rule = lineOf(working, '- **Code:**');
  report.check('W38 the rules carry the same coding rule',
    has(rule, ['no hardcoding — no value, name, path or assumption fixed to specific cases', 'a project-changeable parameter with a default is not hardcoding',
      'build the general mechanism', 'Split code by responsibility', 'check whether the structure is the cause']), rule.slice(0, 120));
}
// D146: the user — 「관련 스킬있으면 스킬쫌 쓰라는 말도 넣어라」.
report.check('W37 skills: open and follow the skills that cover a task, open one when unsure, reopen for each new deliverable (rules and per-prompt checklist)',
  has(lineOf(working, '- **Skills:**'), ['open the installed skills that cover it and follow them', 'when unsure whether one applies, open it', 'Open them again for each new deliverable'])
  && has(lineOf(COMPRESSED_CHECKLIST, '- Skills:'), ['open the installed skills that cover it and follow them', 'open them again for each new deliverable']));
// v21.144.0 (D133): corrections spread to the whole work; an untried result is not "done".
report.check('W24 a correction is a defect type found everywhere, and an untried result is not reported as done (rules and per-prompt checklist)',
  has(lineOf(working, '- When criticized:'), ['treat the correction as a defect type', 'find it everywhere in the work', 'places found, fixed and still left'])
  && lineOf(working, '- Nobody has used or read the result').includes('"own checks passed, not tried by a person", not "done"')
  && /^- A correction is a defect type:[^\n]*own checks passed, not tried by a person[^\n]*structuring skill/m.test(COMPRESSED_CHECKLIST));
// v21.145.0 (D134): load-bearing claims are tested against evidence that would prove them wrong.
{
  const line = lineOf(RULES, '- **Anti-Deception**:');
  report.check('W25 Anti-Deception: audit claims against tool results, then seek evidence against each load-bearing claim before any answer goes out',
    has(line, ['audit each claim against a tool result from this session', 'Before any answer goes out, seek evidence against each claim it depends on, not only evidence for it']), line.slice(-160));
}
// v21.136.0: the user found Simple Communication too long; the cap keeps it from growing back.
{
  const line = lineOf(RULES, '- **Simple Communication**:');
  report.check('W17 Simple Communication stays short (at most 1,200 characters)', line.length > 0 && line.length <= 1200, String(line.length));
}
// "검증할때 항상 상식을 물어야할듯" — a weird result fails verification even when every check passes.
report.check('W16 every verification asks the common-sense question; a weird result fails even when checks pass (rules and per-prompt checklist)',
  verification.includes('Every verification also asks the Common Sense question: a result that would look weird to the user fails even when every check passes.')
  && checklistVerification.includes('always ask whether the result would look weird to the user — if so, it fails even when every check passes'));
// v21.137.0 (D125): temporary files deleted safely once the test is done; the confirm-before-delete rules exempt them.
{
  const rule = lineOf(working, '- **Temporary files:**');
  report.check('W18 temporary files: deleted when the step ends without asking, safely; anything else stays unless explained and confirmed; both confirm-before-delete rules exempt them',
    has(rule, ['deleted when that step ends, before handover, without asking', 'files the user asked for or will need are not temporary', 'Note each path at creation',
      'by exact path, never by wildcard', 'folders recursively only if you created them', 'Anything else (existed before, or not sure you created it) stays',
      'state what it does and why deletion is safe, and get confirmation', 'tell the user what you left'])
    && lineOf(RULES, '- **Human Oversight**:').includes('deleting anything that is not your own temporary file (see Temporary files)')
    && COMPRESSED_CHECKLIST.includes('deleting files other than your own temporary files (delete those once the test is done)'), rule.slice(0, 120));
}
// v21.138.0 (D126) / v21.141.0 (D130): Take Pride right after Common Sense, Depth right after Take Pride.
{
  const at = indexOf(RULES, '- **Common Sense**:');
  const pride = lines(RULES)[at + 1] || '';
  report.check('W19 rules: Take Pride is the principle right after Common Sense',
    pride.startsWith('- **Take Pride**:') && has(pride, ['a quality you would put your name on', 'Before handing it over', 'proud', 'it is not finished — improve it first']), pride.slice(0, 120));
  const depth = '- **Depth**: when a task calls for expertise, use the methods and tools a top practitioner would use, starting from the rawest material available; changing vocabulary is not changing method.';
  report.check('W22 rules: Depth, word for word as the user approved it, is the principle right after Take Pride',
    lines(RULES)[at + 2] === depth, (lines(RULES)[at + 2] || '').slice(0, 120));
  report.check('W23 verification: self-judgment is not verification, right after the match-the-method sentence',
    verification.includes('say the check was static. Your own reading of your work is not verification; evidence is a tool result or a check outside your judgment.'));
}
// v21.139.0 (D128): changed files' checks routinely, the full suite on request, ask before a needed full run.
report.check('W20 verify the diff only: routine updates run the changed files\' checks, the full suite only on request, and a needed full run is asked about first (rules and checklist)',
  has(lineOf(verification, '- Verify the diff only:'), ["routine updates run the changed files' checks (`node .crabshell/verification/run-verify.js --changed`", "the full suite only on the user's request",
    'a full run that seems needed (including a selector falling back to every check', '→ ask the user first'])
  && has(checklistVerification, ["Only the changed files' checks, once after the last edit", 'never re-run a pass on unchanged inputs', 'the full suite only when the user asks — ask before one you think is needed']),
  checklistVerification.slice(0, 120));
{
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'verifying', 'SKILL.md'), 'utf8');
  report.check('W21 the verifying skill makes --changed the default and no longer says to run the full set before a release',
    !/Run the full set before a release/.test(skill) && /Routine updates run `--changed`/.test(skill) && /ask the user first/.test(skill));
}
// v21.147.0 (D136): no status-only idling while delegated work runs; a repeated correction is fixed as a type.
report.check('W30 working rules: waiting is not work',
  has(lineOf(working, '- Waiting is not work:'), ["do the confirmed plan's or ticket's steps that do not need its result", 'run no check on files still being written',
    'Status-only replies only when no such step exists, naming what you checked', 'supervision prompts you write (cron, heartbeat, loop) say the same']));
report.check('W31 the correction rule reopens the earlier fix and fixes the type when the same type comes back',
  lineOf(working, '- When criticized:').includes('when the same type comes back, reopen the earlier fix (git log -S, memory logbook) and fix the type, not the instance.'));
// v21.151.0 (D140): rows and columns right after the no-whole-file-rewrite line; ask to commit right after git.
{
  const at = indexOf(working, '- **Rows and columns:**');
  report.check('W32 working rules: rows and columns, measured on the rendered result, right after the no-whole-file-rewrite line',
    at > 0 && lines(working)[at - 1].startsWith('- Never rewrite a whole file')
    && has(lines(working)[at], ['items of one kind share start edge, width, height and spacing', 'measured on the rendered result', 'one Korean character = two', 'never by deleting content']));
  const gitAt = indexOf(additional, '- **Git is the record of changes:**');
  const commits = lines(additional)[gitAt + 1] || '';
  report.check('W33 additional rules: ask to commit verified changes, right after the git line',
    commits.startsWith('- **Commits:**') && has(commits, ['ask the user to commit them', 'in one line what the commit would contain', 'never leave them uncommitted silently']), commits.slice(0, 120));
}
// v21.152.0 (D141): a memory budget before code runs, right after the temporary-files line.
{
  const at = indexOf(working, '- **Memory:**');
  report.check('W34 working rules: memory budget, right after the temporary-files line',
    at > 0 && lines(working)[at - 1].startsWith('- **Temporary files:**')
    && has(lines(working)[at], ['compute its peak from the largest input', 'nothing that grows per step', 'one reused buffer', 'a hard cap', 'Long runs log their peak and stop above budget', 'read the kernel log and the process list']));
}
{
  // The lines reach the model: run the prompt hook on a temp project, question and execution turns.
  const os = require('os');
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-wording-hook-'));
  try {
    fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
    const hookErrors = [];
    const outputs = ['이거 됐나?', '이 버그 고쳐줘'].map(prompt => {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'inject-rules.js')], { cwd: dir, encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CRABSHELL_BACKGROUND: '', HOOK_DATA: '' },
        input: JSON.stringify({ cwd: dir, session_id: 'wording-test', hook_event_name: 'UserPromptSubmit', prompt }) });
      if (r.error || r.status !== 0) hookErrors.push(String(r.error || r.stderr || 'exit ' + r.status));
      try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; }
    });
    report.check('W13 the prompt hook output carries the plan-first, common-sense, skills and coding lines on a question turn and an execution turn',
      outputs.every(context => ['- Work that changes files:', '- Common sense:', '- Skills:', '- Code:'].every(line => context.includes(line))),
      outputs.map(o => o.length).join(','));
    report.check('W29 the prompt hook output carries the small-change and check-once clauses on both turns without hook errors',
      hookErrors.length === 0 && outputs.every(context =>
        context.includes('A small change (a few lines in one or two files, no hook/guard/gate code) skips both — run the changed-file check once.')
        && context.includes("Only the changed files' checks, once after the last edit; never re-run a pass on unchanged inputs")),
      outputs.map(o => o.length).join(',') + (hookErrors.length ? '; ' + hookErrors.join('; ') : ''));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const rule5 = (regressing.match(/^5\. \*\*[^\n]*/m) || [''])[0];
report.check('W9 regressing Rule 5: a limitation that changes the result is reported at once, work continues',
  /changes what the user will get/.test(rule5) && /one line/.test(rule5) && /keep working/.test(rule5), rule5.slice(0, 200));

report.finish();
