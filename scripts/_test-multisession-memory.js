'use strict';
// D119 P177_T001: two sessions writing memory in the same project must not duplicate,
// drop, or suppress each other's records. Real hook scripts, temp projects only.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const root = h.makeWorkRoot('multisession-memory');
const report = h.createReporter('multisession-memory');
const BASE = Date.parse('2026-09-20T00:00:00.000Z');

function seedIndex(project, lastMemoryUpdateTs, saveInterval = 1) {
  fs.writeFileSync(h.memoryPath(project, 'config.json'), JSON.stringify({ saveInterval }));
  fs.writeFileSync(h.memoryPath(project, 'memory-index.json'), JSON.stringify({
    version: 1, current: 'logbook.md', rotatedFiles: [], stats: { totalRotations: 0, lastRotation: null }, lastMemoryUpdateTs,
  }, null, 2));
  fs.writeFileSync(h.memoryPath(project, 'logbook.md'), '# logbook\n');
}
const entries = (prefix, from, to, offsetMs = 0) => {
  const list = [];
  for (let i = from; i <= to; i++) list.push(h.assistantLine(`${prefix}-${String(i).padStart(3, '0')} ` + prefix.toLowerCase().repeat(100), new Date(BASE + offsetMs + i * 1000).toISOString()));
  return list;
};
const check = (project, sid, transcript) => h.runHook(root, 'counter.js', ['check'],
  { hook_event_name: 'PostToolUse', session_id: sid, transcript_path: transcript, tool_name: 'Read', tool_input: { file_path: 'x' } }, project);
const duplicates = lines => Object.values(h.markerCounts(lines, 'A')).filter(count => count > 1).length;
const setMtime = (file, ms) => fs.utimesSync(file, new Date(ms), new Date(ms));

// M1 control: one session appending twice produces exactly its entries.
{
  const project = h.makeProject(root, 'm1-single');
  seedIndex(project, '2020-01-01T00:00:00.000Z');
  const tA = path.join(root, 'm1-A.jsonl');
  h.writeTranscript(tA, entries('A', 1, 20)); check(project, A, tA);
  h.writeTranscript(tA, entries('A', 21, 25), true); check(project, A, tA);
  const lines = h.sessionL1Lines(project, A);
  report.check('M1 control: single session L1 has 25 unique entries', lines.length === 25 && duplicates(lines) === 0, `lines=${lines.length} dup=${duplicates(lines)}`);
}

// M2 (I090 E3): another session's read position must not be used for this session.
{
  const project = h.makeProject(root, 'm2-cursor');
  seedIndex(project, '2020-01-01T00:00:00.000Z');
  const tA = path.join(root, 'm2-A.jsonl'), tB = path.join(root, 'm2-B.jsonl');
  h.writeTranscript(tA, entries('A', 1, 20)); check(project, A, tA);
  // The user line makes B's SessionEnd a persisted session (final() runs fully).
  h.writeTranscript(tB, [h.userLine('Implement the B fixture change.', new Date(BASE + 100).toISOString()), ...entries('B', 1, 5, 500)]); check(project, B, tB);
  h.writeTranscript(tA, entries('A', 21, 25), true); check(project, A, tA);
  const after25 = h.sessionL1Lines(project, A);
  report.check('M2 A keeps its own L1 position while B also records (25 lines, no duplicates)', after25.length === 25 && duplicates(after25) === 0, `lines=${after25.length} dup=${duplicates(after25)}`);
  h.writeTranscript(tB, entries('B', 6, 6, 500), true);
  h.runHook(root, 'counter.js', ['final'], { hook_event_name: 'SessionEnd', session_id: B, transcript_path: tB, reason: 'other' }, project);
  h.writeTranscript(tA, entries('A', 26, 30), true); check(project, A, tA);
  const after30 = h.sessionL1Lines(project, A);
  report.check('M2 B ending its session does not reset A (30 lines, no duplicates)', after30.length === 30 && duplicates(after30) === 0, `lines=${after30.length} dup=${duplicates(after30)}`);
}

// M3 (new finding): a newer transcript in another session must not suppress this session's L1 update.
{
  const project = h.makeProject(root, 'm3-mtime');
  seedIndex(project, '2020-01-01T00:00:00.000Z');
  const tA = path.join(root, 'm3-A.jsonl'), tB = path.join(root, 'm3-B.jsonl');
  const now = Date.now();
  h.writeTranscript(tA, entries('A', 1, 10)); setMtime(tA, now - 60000); check(project, A, tA);
  h.writeTranscript(tA, entries('A', 11, 15), true); setMtime(tA, now - 30000);
  h.writeTranscript(tB, entries('B', 1, 3, 500)); setMtime(tB, now); check(project, B, tB);
  check(project, A, tA);
  const lines = h.sessionL1Lines(project, A);
  report.check('M3 A records its new entries even though B wrote a newer transcript (15 lines)', lines.length === 15, `lines=${lines.length}`);
}

// M4 (I090 E4): interleaved sessions both reach the memory queue, each block names its session.
{
  const project = h.makeProject(root, 'm4-delta');
  seedIndex(project, '2026-09-20T00:00:00.000Z');
  const tA = path.join(root, 'm4-A.jsonl'), tB = path.join(root, 'm4-B.jsonl');
  h.writeTranscript(tA, [h.assistantLine('A-001 session A worked on parser', '2026-09-20T10:00:01.000Z'), h.assistantLine('A-003 session A fixed parser test', '2026-09-20T10:00:03.000Z')]);
  h.writeTranscript(tB, [h.assistantLine('B-002 session B changed release config', '2026-09-20T10:00:02.000Z'), h.assistantLine('B-004 session B bumped version', '2026-09-20T10:00:04.000Z')]);
  check(project, A, tA);
  check(project, B, tB);
  const queue = fs.existsSync(h.memoryPath(project, 'delta_temp.txt')) ? fs.readFileSync(h.memoryPath(project, 'delta_temp.txt'), 'utf8') : '';
  const missing = ['A-001', 'A-003', 'B-002', 'B-004'].filter(marker => !queue.includes(marker));
  report.check('M4 interleaved entries from both sessions all reach the memory queue', missing.length === 0, `missing=${missing.join(',')}`);
  report.check('M4 each queued block names its session', queue.includes(`session=${A.slice(0, 8)}`) && queue.includes(`session=${B.slice(0, 8)}`), queue.split('\n').filter(line => line.startsWith('---')).join(' | '));
}

// M5: the save interval counts each session's own tool calls.
{
  const project = h.makeProject(root, 'm5-interval');
  seedIndex(project, '2020-01-01T00:00:00.000Z', 3);
  const tA = path.join(root, 'm5-A.jsonl'), tB = path.join(root, 'm5-B.jsonl');
  h.writeTranscript(tA, entries('A', 1, 5)); h.writeTranscript(tB, entries('B', 1, 5, 500));
  check(project, A, tA); check(project, A, tA); check(project, B, tB); check(project, B, tB);
  const afterFour = { a: h.sessionL1Lines(project, A).length, b: h.sessionL1Lines(project, B).length };
  report.check('M5 no session saves before its own third call (A 2 calls, B 2 calls)', afterFour.a === 0 && afterFour.b === 0, JSON.stringify(afterFour));
  check(project, A, tA);
  const afterFive = { a: h.sessionL1Lines(project, A).length, b: h.sessionL1Lines(project, B).length };
  report.check('M5 A saves on its own third call, B still waits', afterFive.a === 5 && afterFive.b === 0, JSON.stringify(afterFive));
}

// M6 (I090 E9): releasing a lock that another process took over must not delete the new owner's lock.
{
  const project = h.makeProject(root, 'm6-lock');
  const memoryDir = h.memoryPath(project);
  const lock = path.join(memoryDir, '.memory-index.lock');
  const utils = require('./utils');
  const first = utils.acquireIndexLock(memoryDir);
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(lock, old, old);
  const takeover = spawnSync(process.execPath, ['-e',
    `const u=require(${JSON.stringify(path.join(__dirname, 'utils.js'))});process.stdout.write(String(u.acquireIndexLock(${JSON.stringify(memoryDir)})));`],
    { encoding: 'utf8', env: h.hookEnv(project, root), windowsHide: true });
  utils.releaseIndexLock(memoryDir);
  const stillLocked = fs.existsSync(lock);
  report.check('M6 control: first holder acquired, second process took over the stale lock', first === true && takeover.stdout === 'true', `first=${first} takeover=${takeover.stdout} ${takeover.stderr.slice(0, 120)}`);
  report.check('M6 first holder releasing does not delete the second holder\'s lock', stillLocked === true, `lockExists=${stillLocked}`);
  try { fs.unlinkSync(lock); } catch {}
}

// M7: payloads without a session id keep the legacy project-wide save interval.
{
  const project = h.makeProject(root, 'm7-no-session');
  seedIndex(project, '2020-01-01T00:00:00.000Z', 3);
  const tX = path.join(root, 'm7-X.jsonl');
  h.writeTranscript(tX, entries('A', 1, 4));
  const noSession = () => h.runHook(root, 'counter.js', ['check'], { hook_event_name: 'PostToolUse', transcript_path: tX, tool_name: 'Read', tool_input: { file_path: 'x' } }, project);
  noSession(); noSession();
  const sessionsDir = h.memoryPath(project, 'sessions');
  const beforeThird = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl')).length : 0;
  noSession();
  const afterThird = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl')).length : 0;
  report.check('M7 without a session id the third call saves (legacy counter)', beforeThird === 0 && afterThird === 1, `before=${beforeThird} after=${afterThird}`);
}

// M8: a transcript that shrank (rewritten) is read again from the start without failing.
{
  const project = h.makeProject(root, 'm8-truncated');
  seedIndex(project, '2020-01-01T00:00:00.000Z');
  const tA = path.join(root, 'm8-A.jsonl');
  h.writeTranscript(tA, entries('A', 1, 10)); check(project, A, tA);
  h.writeTranscript(tA, entries('A', 11, 12));
  const result = check(project, A, tA);
  const lines = h.sessionL1Lines(project, A);
  report.check('M8 a shrunken transcript is re-read from the start and its new entries recorded', result.status === 0 && lines.some(l => l.includes('A-011')) && lines.some(l => l.includes('A-012')), `exit=${result.status} lines=${lines.length}`);
}

// M9: a last line still being written is picked up once it is complete.
{
  const project = h.makeProject(root, 'm9-partial');
  seedIndex(project, '2020-01-01T00:00:00.000Z');
  const tA = path.join(root, 'm9-A.jsonl');
  const complete = JSON.stringify(h.assistantLine('A-006 finished line ' + 'a'.repeat(50), new Date(BASE + 6000).toISOString()));
  h.writeTranscript(tA, entries('A', 1, 5));
  fs.appendFileSync(tA, complete.slice(0, 40));
  check(project, A, tA);
  fs.appendFileSync(tA, complete.slice(40) + '\n');
  h.writeTranscript(tA, entries('A', 7, 7), true);
  check(project, A, tA);
  const counts = h.markerCounts(h.sessionL1Lines(project, A), 'A');
  report.check('M9 a line completed after a save is recorded exactly once', counts['A-006'] === 1 && counts['A-007'] === 1 && Object.keys(counts).length === 7, JSON.stringify(counts));
}

// M13 (review): a session without its own L1 must not queue another session's entries.
{
  const project = h.makeProject(root, 'm13-foreign-l1');
  seedIndex(project, '2026-09-20T00:00:00.000Z');
  const tA = path.join(root, 'm13-A.jsonl');
  h.writeTranscript(tA, [h.assistantLine('A-001 only session A worked', '2026-09-20T10:00:01.000Z')]);
  check(project, A, tA);
  // A-002 is in A's L1 but not yet extracted (as right after A's final L1 rebuild).
  const sessionsDir = h.memoryPath(project, 'sessions');
  const aL1 = fs.readdirSync(sessionsDir).find(f => f.includes(`_${A.slice(0, 8)}`));
  fs.appendFileSync(path.join(sessionsDir, aL1), '\n' + JSON.stringify({ ts: '2026-09-20T10:00:02.000Z', role: 'assistant', text: 'A-002 not yet extracted' }));
  check(project, B, path.join(root, 'm13-missing-B.jsonl'));
  h.writeTranscript(tA, [h.assistantLine('A-003 later', '2026-09-20T10:00:03.000Z')], true);
  check(project, A, tA);
  const queue = fs.readFileSync(h.memoryPath(project, 'delta_temp.txt'), 'utf8');
  report.check('M13 a session with no L1 of its own does not queue another session\'s entries', queue.split('A-002').length - 1 === 1 && !queue.includes(`session=${B.slice(0, 8)}`), `A-002=${queue.split('A-002').length - 1} ${queue.split('\n').filter(l => l.startsWith('---')).join(' | ')}`);
}

// M14 (review): a session that predates per-session tracking keeps entries older than another session's queue.
{
  const project = h.makeProject(root, 'm14-pre-upgrade');
  // A-001 (10:00:01) was already summarized before the upgrade.
  seedIndex(project, '2026-09-20T10:00:01.500Z');
  const tA = path.join(root, 'm14-A.jsonl'), tB = path.join(root, 'm14-B.jsonl');
  // State as the previous release left it: A's L1 and the project-wide read position.
  h.writeTranscript(tA, [h.assistantLine('A-001 before the upgrade', '2026-09-20T10:00:01.000Z')]);
  const sessionsDir = h.memoryPath(project, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, `2026-09-20_1000_${A.slice(0, 8)}.l1.jsonl`), JSON.stringify({ ts: '2026-09-20T10:00:01.000Z', role: 'assistant', text: 'A-001 before the upgrade' }) + '\n');
  const index = h.readJson(h.memoryPath(project, 'memory-index.json'));
  index.lastL1TranscriptOffset = fs.statSync(tA).size;
  fs.writeFileSync(h.memoryPath(project, 'memory-index.json'), JSON.stringify(index, null, 2));
  h.writeTranscript(tB, [h.assistantLine('B-005 new session after the upgrade', '2026-09-20T10:00:05.000Z')]);
  check(project, B, tB);
  h.writeTranscript(tA, [h.assistantLine('A-002 older than B-005', '2026-09-20T10:00:02.000Z')], true);
  check(project, A, tA);
  const queue = fs.readFileSync(h.memoryPath(project, 'delta_temp.txt'), 'utf8');
  report.check('M14 a pre-upgrade session\'s entry older than another session\'s queue is still queued once', queue.split('A-002').length - 1 === 1 && queue.split('A-001').length - 1 === 0, `A-001=${queue.split('A-001').length - 1} A-002=${queue.split('A-002').length - 1}`);
}

// M15 (review): SessionEnd while the memory lock is busy still records the position; resume adds no duplicates.
{
  const project = h.makeProject(root, 'm15-busy-end');
  seedIndex(project, '2020-01-01T00:00:00.000Z');
  const tA = path.join(root, 'm15-A.jsonl');
  h.writeTranscript(tA, [h.userLine('Implement the A fixture change.', new Date(BASE).toISOString()), ...entries('A', 1, 2)]); check(project, A, tA);
  h.writeTranscript(tA, entries('A', 3, 3), true);
  const utils = require('./utils');
  const held = utils.acquireIndexLock(h.memoryPath(project));
  h.runHook(root, 'counter.js', ['final'], { hook_event_name: 'SessionEnd', session_id: A, transcript_path: tA, reason: 'other' }, project);
  utils.releaseIndexLock(h.memoryPath(project));
  h.writeTranscript(tA, entries('A', 4, 4), true);
  check(project, A, tA);
  const counts = h.markerCounts(h.sessionL1Lines(project, A), 'A');
  report.check('M15 a busy lock at SessionEnd does not cause duplicates when the session resumes', held === true && ['A-001', 'A-002', 'A-003', 'A-004'].every(m => counts[m] === 1), JSON.stringify(counts));
}

// M16 (review): a transcript with nothing to refine does not fail the save.
{
  const project = h.makeProject(root, 'm16-empty-refine');
  seedIndex(project, '2020-01-01T00:00:00.000Z');
  const tA = path.join(root, 'm16-A.jsonl');
  fs.writeFileSync(tA, JSON.stringify({ type: 'summary', summary: 'nothing to refine' }) + '\n');
  check(project, A, tA);
  h.writeTranscript(tA, entries('A', 1, 2), true);
  check(project, A, tA);
  const errorLog = h.memoryPath(project, 'logs', 'error.log');
  const errors = fs.existsSync(errorLog) ? fs.readFileSync(errorLog, 'utf8') : '';
  report.check('M16 an empty refine result is not an error and later entries are recorded', !errors.includes('L1 creation failed') && h.sessionL1Lines(project, A).length === 2, `errors=${errors.slice(0, 120)} lines=${h.sessionL1Lines(project, A).length}`);
}

// M12 (review): a stale lock that cannot be removed ends in a timely skip, not an endless loop.
{
  const project = h.makeProject(root, 'm12-unremovable');
  const memoryDir = h.memoryPath(project);
  const lock = path.join(memoryDir, '.memory-index.lock');
  fs.writeFileSync(lock, '1:stale');
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(lock, old, old);
  const script = `const fs=require('fs');const real=fs.unlinkSync;fs.unlinkSync=p=>{if(String(p).endsWith('.memory-index.lock')){const e=new Error('EPERM');e.code='EPERM';throw e;}return real(p);};`
    + `const u=require(${JSON.stringify(path.join(__dirname, 'utils.js'))});const t=Date.now();const ok=u.acquireIndexLock(${JSON.stringify(memoryDir)});process.stdout.write(JSON.stringify({ok,ms:Date.now()-t}));`;
  const started = Date.now();
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 8000, env: h.hookEnv(project, root), windowsHide: true });
  let result = {};
  try { result = JSON.parse(child.stdout); } catch {}
  report.check('M12 an unremovable stale lock is skipped within the wait, not retried forever', child.status === 0 && result.ok === false && Date.now() - started < 5000, `status=${child.status} out=${child.stdout} ${child.error ? child.error.code : ''}`);
  try { fs.unlinkSync(lock); } catch {}
}

// M10 (I090 E6): eight sessions at once — every session's own count is kept.
(async () => {
  const project = h.makeProject(root, 'm10-concurrent');
  seedIndex(project, '2020-01-01T00:00:00.000Z', 100000);
  const ids = Array.from({ length: 8 }, (_, i) => `${String(i).repeat(8)}-0000-4000-8000-000000000000`);
  await Promise.all(ids.map(sid => h.runHookAsync(root, 'counter.js', ['check'],
    { hook_event_name: 'PostToolUse', session_id: sid, tool_name: 'Read', tool_input: { file_path: 'x' } }, project)));
  const counts = ids.map(sid => (h.readJson(h.memoryPath(project, 'session-state', sid.slice(0, 8), 'counter.json')) || {}).counter);
  report.check('M10 eight concurrent sessions each keep their count (no call skipped)', counts.every(count => count === 1), JSON.stringify(counts));

  // M11 (review): two processes finding the same dead owner's lock — only one may hold it.
  const lockProject = h.makeProject(root, 'm11-steal-race');
  const lockDir = h.memoryPath(lockProject);
  const exited = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(lockDir, '.memory-index.lock'), `${exited.stdout}:dead-owner`);
  const contender = `const u=require(${JSON.stringify(path.join(__dirname, 'utils.js'))});const got=u.acquireIndexLock(${JSON.stringify(lockDir)});`
    + `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,600);process.stdout.write(JSON.stringify({got,still:got&&u.ownsIndexLock(${JSON.stringify(lockDir)})}));if(got)u.releaseIndexLock(${JSON.stringify(lockDir)});`;
  const race = await Promise.all([0, 1].map(() => new Promise(resolve => {
    const child = require('child_process').spawn(process.execPath, ['-e', contender], { windowsHide: true });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve({ got: null }); } });
  })));
  const holders = race.filter(r => r.got && r.still).length;
  report.check('M11 two takeovers of one dead owner\'s lock leave exactly one holder', holders === 1 && race.filter(r => r.got).length === 1, JSON.stringify(race));
  report.finish();
})();
