'use strict';
// D120 T1: after compaction Claude Code re-attaches only the first 5,000 tokens of
// each invoked skill (combined 25,000; https://code.claude.com/docs/en/skills.md,
// "carries invoked skills forward within a token budget"). A skill body stays under
// 16,000 bytes so its rules and core steps survive that cut; long templates live
// in the skill's references/ folder. The docs guard tells the model how to reload
// a skill for an existing document.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const report = h.createReporter('compaction-skills');
const ROOT = path.resolve(__dirname, '..');
const MAX_SKILL_BYTES = 16000;

function skillFiles(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir)
    .map(name => path.join(skillsDir, name, 'SKILL.md'))
    .filter(file => fs.existsSync(file));
}
const oversized = files => files.filter(file => fs.statSync(file).size > MAX_SKILL_BYTES);

{
  const files = skillFiles(path.join(ROOT, 'skills'));
  const over = oversized(files);
  report.check('S1 every skills/*/SKILL.md is at most 16,000 bytes', files.length > 0 && over.length === 0,
    `discovered=${files.length} over=${over.map(f => `${path.relative(ROOT, f)}:${fs.statSync(f).size}`).join(' ')}`);
}
{
  const root = h.makeWorkRoot('compaction-skills');
  fs.mkdirSync(path.join(root, 'skills', 'big'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'big', 'SKILL.md'), 'x'.repeat(MAX_SKILL_BYTES + 1));
  report.check('S2 boundary: a 16,001-byte skill is reported', oversized(skillFiles(path.join(root, 'skills'))).length === 1);
}
{
  // A body that points at references/<file> must point at a file that exists.
  const missing = [];
  for (const file of skillFiles(path.join(ROOT, 'skills'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/references\/([\w.-]+\.md)/g)) {
      if (!fs.existsSync(path.join(path.dirname(file), 'references', match[1]))) missing.push(`${path.relative(ROOT, file)} -> ${match[1]}`);
    }
  }
  report.check('S3 every references/ file a skill points at exists', missing.length === 0, missing.join(' | '));
}
{
  const { evaluateDocsGuard } = require('./docs-guard');
  const dir = h.makeProject(h.makeWorkRoot('compaction-docs-guard'), 'guard');
  const target = (rel) => path.join(dir, '.crab' + 'shell', rel).replace(/\\/g, '/');
  for (const rel of ['discussion/D123-topic.md', 'ticket/D123_T004-work.md', 'discussion/notes.md']) {
    fs.mkdirSync(path.dirname(target(rel)), { recursive: true });
    fs.writeFileSync(target(rel), '# doc\n');
  }
  const created = evaluateDocsGuard({ tool_name: 'Write', session_id: 's1', tool_input: { file_path: target('discussion/D124-new.md'), content: '# new\n' } }, dir);
  report.check('G0 a new document (file not there yet) gets the skill name without an update hint', /skill="discussing"/.test((created && created.reason) || '') && !/args="/.test((created && created.reason) || ''), ((created && created.reason) || '').slice(0, 200));
  const existing = evaluateDocsGuard({ tool_name: 'Edit', session_id: 's1', tool_input: { file_path: target('discussion/D123-topic.md'), old_string: 'a', new_string: 'b' } }, dir);
  const reason = (existing && existing.reason) || '';
  report.check('G1 blocking an existing document names the skill and its ID for an update call',
    /skill="discussing"/.test(reason) && /args="D123"/.test(reason) && /reloads/i.test(reason), reason.slice(0, 300));
  const ticket = evaluateDocsGuard({ tool_name: 'Edit', session_id: 's1', tool_input: { file_path: target('ticket/D123_T004-work.md'), old_string: 'a', new_string: 'b' } }, dir);
  report.check('G2 a ticket path gives the ticket ID', /skill="ticketing"/.test(ticket.reason || '') && /args="D123_T004"/.test(ticket.reason || ''), (ticket.reason || '').slice(0, 200));
  const plain = evaluateDocsGuard({ tool_name: 'Edit', session_id: 's1', tool_input: { file_path: target('discussion/notes.md'), old_string: 'a', new_string: 'b' } }, dir);
  const plainReason = (plain && plain.reason) || '';
  report.check('G3 a file name without a document ID still names the skill, without an args hint', /skill="discussing"/.test(plainReason) && !/args="/.test(plainReason), plainReason.slice(0, 200));
}

report.finish();
