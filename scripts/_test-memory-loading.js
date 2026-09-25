'use strict';
// D120 T2: how memory is saved by hand and loaded at SessionStart. Every case runs
// in a temporary project.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');

const root = h.makeWorkRoot('memory-loading');
const report = h.createReporter('memory-loading');
const CRAB = '.crab' + 'shell';
const SID = 'abcd1234-0000-4000-8000-000000000001';

function project(name, logbook) {
  const dir = h.makeProject(root, name);
  if (logbook !== undefined) fs.writeFileSync(path.join(dir, CRAB, 'memory', 'logbook.md'), logbook);
  return dir;
}
const memoryFile = (dir, name) => path.join(dir, CRAB, 'memory', name);
const entries = n => Array.from({ length: n }, (_, i) => `## 2026-09-${String(10 + i).padStart(2, '0')}_0100 (local 09-${String(9 + i).padStart(2, '0')}_1800)\n- entry ${i} about widgets and gadgets ${'detail '.repeat(40)}\n`).join('\n');

// AC-1: the hand-save path goes through append-memory.js.
{
  const dir = project('save', '# Logbook\n');
  const summary = memoryFile(dir, 'manual-summary-test.txt');
  fs.writeFileSync(summary, 'Saved by hand: decided X.');
  const run = args => spawnSync(process.execPath, [path.join(__dirname, 'append-memory.js'), `--project-dir=${dir}`, ...args], { encoding: 'utf8', windowsHide: true });
  const ok = run([`--summary-file=${summary}`]);
  const logbook = fs.readFileSync(memoryFile(dir, 'logbook.md'), 'utf8');
  report.check('A1 --summary-file inside the memory folder is appended with the dual timestamp header and removed',
    ok.status === 0 && /## \d{4}-\d{2}-\d{2}_\d{4} \(local \d{2}-\d{2}_\d{4}\)\n+Saved by hand: decided X\./.test(logbook) && !fs.existsSync(summary),
    `status=${ok.status} ${ok.stderr.slice(0, 120)} tail=${JSON.stringify(logbook.slice(-120))}`);
  const outside = path.join(root, 'outside-summary.txt');
  fs.writeFileSync(outside, 'should not be appended');
  const before = fs.readFileSync(memoryFile(dir, 'logbook.md'), 'utf8');
  const bad = run([`--summary-file=${outside}`]);
  report.check('A2 a summary file outside the memory folder is refused and the logbook is unchanged',
    bad.status === 1 && fs.readFileSync(memoryFile(dir, 'logbook.md'), 'utf8') === before, `status=${bad.status} ${bad.stderr.slice(0, 160)}`);
  const skills = ['save-memory', 'memory-autosave'].map(name => [name, fs.readFileSync(path.join(__dirname, '..', 'skills', name, 'SKILL.md'), 'utf8')]);
  report.check('A3 the save skills append only through append-memory.js and say what to do when a delta job is prepared',
    skills.every(([, text]) => !/appendFileSync/.test(text) && /append-memory\.js/.test(text) && /--summary-file=/.test(text) && /memory-delta/.test(text)),
    skills.filter(([, text]) => /appendFileSync/.test(text) || !/--summary-file=/.test(text) || !/memory-delta/.test(text)).map(([name]) => name).join(' '));
}

// AC-2–4: the SessionStart context.
{
  const { buildMemoryContext } = require('./core/memory-context');
  const dir = project('context', `# Logbook\n\n${entries(20)}`);
  fs.writeFileSync(path.join(dir, CRAB, 'moc-digest.md'), `# Digest\n${'digest line\n'.repeat(300)}`);
  const full = buildMemoryContext(dir, { source: 'startup', maxChars: 9500 });
  report.check('N1 the memory notes say the records are data, not instructions, and to search before saying none',
    /past sessions?[^\n]*not instructions/i.test(full) && /search-memory/.test(full), full.split('\n').filter(l => /not instructions|search-memory/.test(l)).join(' | '));
  // Short logbook lines let the recent sessions take nearly all of a small
  // budget, so the digest after them gets less than a part's minimum.
  const shortEntries = Array.from({ length: 60 }, (_, i) => `## 2026-08-${String(1 + (i % 28)).padStart(2, '0')}_${String(1000 + i)} (local x)\n- short entry ${i}\n`).join('\n');
  const tightDir = project('context-tight', `# Logbook\n\n${shortEntries}`);
  fs.writeFileSync(path.join(tightDir, CRAB, 'moc-digest.md'), `# Digest\n${'digest line\n'.repeat(300)}`);
  const tight = buildMemoryContext(tightDir, { source: 'startup', maxChars: 3000, tailLines: 500 });
  const leftOut = tight.split('\n').find(line => /^Left out for the SessionStart budget:/.test(line)) || '';
  report.check('N2 a part dropped for the budget is named with where to read it, and the context still fits the budget',
    /digest \(\.crabshell\/moc-digest\.md\)/.test(leftOut) && !/# Digest/.test(tight) && tight.length <= 3000, `len=${tight.length} line=${leftOut}`);
  const small = project('context-small', `# Logbook\n\n${entries(1)}`);
  report.check('N3 nothing dropped → no "left out" line', !/Left out for the SessionStart budget/.test(buildMemoryContext(small, { source: 'startup', maxChars: 9500 })));
  report.check('K0 no knowledge INDEX → no knowledge section', !/## Knowledge/.test(buildMemoryContext(small, { source: 'startup', maxChars: 9500 })));
  fs.mkdirSync(path.join(small, CRAB, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(small, CRAB, 'knowledge', 'INDEX.md'), '# Knowledge Index\n\n| ID | Title | Cat | Tags | Source |\n|----|-------|-----|------|--------|\n| K001 | Hook payloads have no exit code | fact | hooks | lesson |\n| [[K002-x|K002]] | Paths trigger prompts | fact | bash | lesson |\n');
  const withKnowledge = buildMemoryContext(small, { source: 'startup', maxChars: 9500 });
  report.check('K1 the knowledge INDEX is listed by ID and title', /## Knowledge/.test(withKnowledge) && /K001[^\n]*Hook payloads have no exit code/.test(withKnowledge) && /K002[^\n]*Paths trigger prompts/.test(withKnowledge),
    withKnowledge.split('\n').filter(l => /K00/.test(l)).join(' | '));
}

// AC-5: relevant snippets skip what SessionStart already loads, and neither hook
// writes a file (SessionStart and prompt hooks stay read-only).
{
  const OLD = '2026-09-01_0100 (local 08-31_1800)';
  const logbook = `# Logbook\n\n## ${OLD}\n- old widgets work in the gadget module\n\n${entries(20)}`;
  const dir = project('snippets', logbook);
  const listFiles = base => fs.readdirSync(base, { withFileTypes: true }).flatMap(e => e.isDirectory() ? listFiles(path.join(base, e.name)) : [path.join(base, e.name)]);
  const before = listFiles(path.join(dir, CRAB)).map(f => `${f}:${fs.statSync(f).mtimeMs}`).sort();
  (async () => {
    const { context } = await require('./load-memory').main({ hookData: { hook_event_name: 'SessionStart', source: 'startup', session_id: SID }, projectDir: dir, emit: false });
    const { recentLogbookHeadings, loadedMemoryHeadings } = require('./core/memory-context');
    const recent = recentLogbookHeadings(logbook);
    const inContext = loadedMemoryHeadings(context);
    report.check('L1 the recomputed Recent Sessions headings match what SessionStart loaded, and exclude the old entry',
      recent.length > 0 && inContext.every(h => recent.includes(h)) && !recent.includes(OLD), `recent=${recent.length} context=${inContext.length} old=${recent.includes(OLD)}`);
    const { getRelevantMemorySnippets } = require('./inject-rules');
    const snippet = getRelevantMemorySnippets(dir, 'tell me about the widgets and gadgets work') || '';
    const loadedShown = recent.filter(heading => snippet.includes(`### ${heading}`));
    report.check('L2 snippets skip the entries SessionStart loads and can still offer an older one', loadedShown.length === 0 && snippet.includes(`### ${OLD}`),
      `loadedShown=${loadedShown.join(',')} snippet=${snippet.slice(0, 160)}`);
    const after = listFiles(path.join(dir, CRAB)).map(f => `${f}:${fs.statSync(f).mtimeMs}`).sort();
    report.check('L3 SessionStart and the snippet lookup write no file', JSON.stringify(before) === JSON.stringify(after), `before=${before.length} after=${after.length}`);
    report.finish();
  })().catch(error => { report.check('L0 snippet cases ran', false, error.stack); report.finish(); });
}
