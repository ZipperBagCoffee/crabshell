'use strict';
// D119 P177_T001: SessionStart context must stay under the host's 10,000-character
// inline limit (larger output is moved to a file with only a 2,000-character preview),
// keep the newest memory, and show only the current session's recovery record.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const C = 'cccccccc-3333-4333-8333-333333333333';
const HOST_INLINE_LIMIT = 10000;
const root = h.makeWorkRoot('session-start-budget');
const report = h.createReporter('session-start-budget');

function contextOf(result) {
  try { return JSON.parse(result.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; }
}
function seedProject(name, sessions, digestChars) {
  const project = h.makeProject(root, name);
  fs.writeFileSync(path.join(project, '.crabshell', 'project.md'), 'Fixture project for the SessionStart budget test.\n');
  const blocks = [];
  for (let i = 1; i <= sessions; i++) {
    const marker = i === sessions ? 'LATEST-MEMORY-MARKER' : `session-${i}`;
    blocks.push(`## 2026-09-${String((i % 28) + 1).padStart(2, '0')}_0000 (local 09-01_0000)\n- ${marker}: ` + 'recorded work detail '.repeat(30));
  }
  fs.writeFileSync(h.memoryPath(project, 'logbook.md'), blocks.join('\n\n') + '\n');
  if (digestChars) fs.writeFileSync(path.join(project, '.crabshell', 'moc-digest.md'), '## Document Digest\n' + 'D100 fixture digest line\n'.repeat(Math.ceil(digestChars / 25)));
  return project;
}
const claudeStart = (project, sid, source) => h.runHook(root, 'load-memory.js', [], { hook_event_name: 'SessionStart', session_id: sid, source, cwd: project }, project);
const codexStart = (project, sid) => h.runHook(root, 'adapters/codex/session-start.js', [], { hook_event_name: 'SessionStart', session_id: sid, source: 'startup', cwd: project }, project);

{
  const project = seedProject('b1-large', 60, 5000);
  const bPrompt = 'Implement the B fixture change. B-RECOVERY-MARKER ' + 'with a long request body '.repeat(40);
  const tB = path.join(root, 'b1-B.jsonl');
  h.writeTranscript(tB, [h.userLine(bPrompt, new Date().toISOString())]);
  h.runHook(root, 'inject-rules.js', [], { hook_event_name: 'UserPromptSubmit', session_id: B, prompt: bPrompt, transcript_path: tB, cwd: project }, project);

  const other = contextOf(claudeStart(project, C, 'startup'));
  report.check('B1 Claude SessionStart stays under the 10,000-character inline limit', other.length > 0 && other.length < HOST_INLINE_LIMIT, `length=${other.length}`);
  report.check('B1 the newest memory entry survives the budget', other.includes('LATEST-MEMORY-MARKER'));
  report.check('B1 another session\'s recovery record is not shown', !other.includes('B-RECOVERY-MARKER'));

  const codex = contextOf(codexStart(project, C));
  report.check('B2 Codex SessionStart stays under the 10,000-character inline limit', codex.length > 0 && codex.length < HOST_INLINE_LIMIT, `length=${codex.length}`);
  report.check('B2 Codex keeps the newest memory entry', codex.includes('LATEST-MEMORY-MARKER'));

  const own = contextOf(claudeStart(project, B, 'resume'));
  report.check('B3 the resuming session still sees its own recovery record', own.includes('Last Work Record') && own.includes('B-RECOVERY-MARKER'), `length=${own.length}`);
  report.check('B3 the resumed context also stays under the inline limit', own.length < HOST_INLINE_LIMIT, `length=${own.length}`);
}
{
  const project = seedProject('b4-small', 3, 800);
  const context = contextOf(claudeStart(project, C, 'startup'));
  report.check('B4 control: a small project keeps every section, including the document digest', context.includes('LATEST-MEMORY-MARKER') && context.includes('Document Digest'), `length=${context.length}`);
}

{
  const project = seedProject('b5-one-huge-entry', 2, 0);
  fs.appendFileSync(h.memoryPath(project, 'logbook.md'), '\n## 2026-09-30_0000 (local 09-29_1700)\n- ' + 'huge entry body '.repeat(1250) + 'END-OF-HUGE-ENTRY\n');
  const context = contextOf(claudeStart(project, C, 'startup'));
  report.check('B5 a single entry longer than the budget still fits and keeps its end', context.length < HOST_INLINE_LIMIT && context.includes('END-OF-HUGE-ENTRY'), `length=${context.length}`);
}

report.finish();
