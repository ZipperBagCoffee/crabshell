'use strict';
// D119 cycle 8: one reader for INDEX.md rows. The skills write the ID cell as
// [[slug|ID]] (unescaped pipe) and Obsidian tables escape other links as
// [[slug\|ID]]; a plain split('|') cuts both apart, which silently turned off the
// checks that read the ID or status of a row. Rows below are copied from this
// repository's INDEX files.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const root = h.makeWorkRoot('index-rows');
const report = h.createReporter('index-rows');
const CRAB = '.crab' + 'shell';
const fwd = p => p.replace(/\\/g, '/');

const ROWS = {
  discussion: '| [[D119-crabshell-rework-after-i090|D119]] | Crabshell 재정비 — I090 결과 반영 (regressing, cap 10) | open | 2026-09-24 | [[I090-crabshell-full-reaudit-multisession-hooks-restrictions-verification-docs\\|I090]], [[D117-crabshell-reliability-and-dual-host-improvement-scope\\|D117]] |',
  plan: '| [[P183-d119-cycle-7-retire-code-d-t-docs-no-new-h|P183]] | D119 cycle 7 — 은퇴 코드 삭제 + 문서 체계 D(플랜 포함)-T 전환(CC-11) + H 신규 중단 | done | 2026-09-24 | [[D119-crabshell-rework-after-i090|D119]] | P183_T001, P183_T002, P183_T003, P183_T004, P183_T005 |',
  planBare: '| P047 | Cache sync + version bump + commit c3 | done | 2026-03-25 |[[D029-ra-pairing-coherence-overcorrection|D029]]|P047_T001|',
  ticket: '| [[P183_T005-docs-release-v21-130-0|P183_T005]] | T5 — 독립 검토 반영·문서·릴리스 v21.130.0 | verified | 2026-09-24 | [[P183-d119-cycle-7-retire-code-d-t-docs-no-new-h|P183]] |',
  investigation: '| [[I090-crabshell-full-reaudit-multisession-hooks-restrictions-verification-docs|I090]] | Crabshell 전체 재점검 — 멀티세션 메모리·훅 과다·과잉 제한·변경분 검증·하드코딩·모듈화·문서체계 D(P)-T | concluded | 2026-09-23 | |',
  hotfix: '| [[H025-release-21.123.0-native-failure-and-memory-recovery|H025]] | release 21.123.0 native failure and memory recovery | done | 2026-09-05 |',
  escapedId: '| [[D050-topic\\|D050]] | Escaped ID cell | open | 2026-01-01 | |',
  plainLink: '| [[D051-topic]] | Link without alias | open | 2026-01-01 | |',
};

// AC-1: the shared reader.
let parseIndexRow = null;
try { ({ parseIndexRow } = require('./core/index-rows')); } catch {}
report.check('R0 scripts/core/index-rows.js exports parseIndexRow', typeof parseIndexRow === 'function');
const parse = line => (parseIndexRow ? parseIndexRow(line) : null);
const expected = {
  discussion: ['D119', 'open', 5], plan: ['P183', 'done', 6], planBare: ['P047', 'done', 6], ticket: ['P183_T005', 'verified', 5],
  investigation: ['I090', 'concluded', 5], hotfix: ['H025', 'done', 4], escapedId: ['D050', 'open', 5], plainLink: ['D051', 'open', 5],
};
for (const [name, [id, status, count]] of Object.entries(expected)) {
  const row = parse(ROWS[name]);
  report.check(`R1 ${name}: bare ID, status and cell count`, Boolean(row) && row.id === id && row.status === status && row.cells.length === count, JSON.stringify(row).slice(0, 200));
}
{
  const row = parse(ROWS.discussion);
  report.check('R2 an escaped pipe inside a Related link stays in its cell (unescaped)', Boolean(row) && /\[\[I090-[^\]]*\|I090\]\], \[\[D117-[^\]]*\|D117\]\]/.test(row.cells[4]), row && row.cells[4]);
  const header = '| ID | Title | Status | Created | Related |';
  const separator = '|----|-------|--------|---------|---------|';
  report.check('R3 header, separator, prose and empty input are not rows', [header, separator, 'Some text', '', null].every(line => parse(line) === null));
}

// AC-2: consumers read real rows.
function project(name) {
  const dir = h.makeProject(root, name);
  for (const folder of ['discussion', 'plan', 'ticket', 'investigation', 'hotfix']) fs.mkdirSync(path.join(dir, CRAB, folder), { recursive: true });
  return dir;
}
const write = (dir, rel, body) => fs.writeFileSync(path.join(dir, CRAB, rel), body);
const TICKET_HEADER = '# Ticket Index\n\n| ID | Title | Status | Created | Plan |\n|----|-------|--------|---------|------|\n';
const TEMPLATE_TICKET = '---\nstatus: in-progress\n---\n# D001_T001\n\n## Execution Results\n(placeholder — parent writes implementation evidence here)\n\n## Verification Results\n(placeholder — parent writes direct P/O/G evidence)\n\n## Final Verification\n(placeholder — parent writes the final evaluation here)\n### Correctness\n### Coherence\n\n## Log\n\n---\n### [2026-09-24 09:00] Created\nplan\n';
const FILLED_EXEC = TEMPLATE_TICKET.replace('(placeholder — parent writes implementation evidence here)', '- changed scripts/a.js');
const FILLED_ALL = FILLED_EXEC.replace('(placeholder — parent writes direct P/O/G evidence)', '| AC-1 | behavioral | ... |').replace('(placeholder — parent writes the final evaluation here)', 'AC-1 passed.');
{
  const { evaluateLogGuard } = require('./log-guard');
  const dir = project('log-guard');
  const indexFile = fwd(path.join(dir, CRAB, 'ticket', 'INDEX.md'));
  const row = status => `| [[D001_T001-work|D001_T001]] | Work | ${status} | 2026-09-24 | [[D001-topic|D001]] |`;
  write(dir, 'ticket/INDEX.md', TICKET_HEADER + row('in-progress') + '\n');
  const move = (from, to) => evaluateLogGuard({ tool_name: 'Edit', tool_input: { file_path: indexFile, old_string: row(from), new_string: row(to) } }, dir);
  write(dir, 'ticket/D001_T001-work.md', TEMPLATE_TICKET);
  const blocked = move('in-progress', 'verified');
  report.check('C1 log-guard blocks verifying a wikilink ticket row whose result sections are template text', Boolean(blocked && blocked.reason && /Execution Results/.test(blocked.reason)), JSON.stringify(blocked).slice(0, 200));
  write(dir, 'ticket/D001_T001-work.md', FILLED_EXEC);
  const done = move('in-progress', 'done');
  const verified = move('done', 'verified');
  report.check('C1b done needs Execution Results only; verified needs every section', !(done && done.reason) && Boolean(verified && verified.reason && /Final Verification/.test(verified.reason)), JSON.stringify({ done, verified }).slice(0, 200));
  write(dir, 'ticket/D001_T001-work.md', FILLED_ALL);
  const ok = move('done', 'verified');
  report.check('C1c a filled ticket with only a short Created log entry is verified (no log-length rule)', !(ok && ok.reason), JSON.stringify(ok).slice(0, 200));
}
{
  const { findDocumentFile } = require('./log-guard');
  const dir = project('shared-prefix');
  write(dir, 'discussion/D115-gpt-merge-draft.md', '# draft\n');
  write(dir, 'discussion/D115-verification-method.md', '# D115\n');
  const file = findDocumentFile(dir, 'discussion', 'D115', 'D115-verification-method');
  report.check('C1d with two files sharing an ID prefix, the row link target is the document read', Boolean(file) && path.basename(file) === 'D115-verification-method.md', String(file));
}
{
  const { checkTicketStatuses } = require('./inject-rules');
  const dir = project('ticket-status');
  fs.writeFileSync(path.join(dir, CRAB, 'memory', 'regressing-state.json'), JSON.stringify({ active: true, discussion: 'D001', cycle: 1, totalCycles: 10, phase: 'execution', ticketIds: ['D001_T001'], lastUpdatedAt: new Date().toISOString() }));
  write(dir, 'ticket/INDEX.md', TICKET_HEADER + '| [[D001_T001-work|D001_T001]] | Work | todo | 2026-09-24 | [[D001-topic|D001]] |\n');
  const warning = checkTicketStatuses(dir);
  report.check('C2 the prompt reminder names a todo ticket listed as a wikilink row', typeof warning === 'string' && /D001_T001 \(todo\)/.test(warning), String(warning).slice(0, 160));
}
{
  const dir = project('lint');
  write(dir, 'discussion/D001-topic.md', '---\ntype: discussion\nid: D001\nstatus: open\n---\n# D001\n');
  write(dir, 'discussion/INDEX.md', '# Discussion Index\n\n| ID | Title | Status | Created | Related |\n|----|-------|--------|---------|---------|\n| [[D001-topic|D001]] | After I088 review | open | 2026-09-24 | [[I050-x\\|I050]], P010 |\n| [[D002-gone|D002]] | Row whose file is missing | open | 2026-09-24 | |\n');
  const { spawnSync } = require('child_process');
  spawnSync(process.execPath, [path.join(__dirname, 'lint-obsidian.js')], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8', windowsHide: true });
  const reportFile = path.join(dir, CRAB, 'lint-report.md');
  const text = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8') : '';
  const ghosts = (text.match(/INDEX ghost: "([^"]+)"/g) || []).map(m => m.match(/"([^"]+)"/)[1]);
  report.check('C3 lint reports a ghost only for an ID-column row without a file (not IDs in titles or Related)', ghosts.length === 1 && ghosts[0] === 'D002', `ghosts=${ghosts.join(',') || '<none>'} report=${Boolean(text)}`);
}
{
  const { lookupIndexEntry } = require('./migrate-obsidian');
  const dir = project('migrate');
  const indexPath = path.join(dir, CRAB, 'plan', 'INDEX.md');
  write(dir, 'plan/INDEX.md', '| ID | Title | Status | Created | Related | Tickets |\n|---|---|---|---|---|---|\n' + ROWS.plan + '\n');
  const entry = lookupIndexEntry(indexPath, 'P183');
  report.check('C4 migrate-obsidian finds the status and date of a migrated (wikilink) row', entry.status === 'done' && entry.created === '2026-09-24', JSON.stringify(entry));
}
{
  const { getActiveDocs } = require('./core/compaction-context');
  const dir = project('compaction');
  write(dir, 'discussion/INDEX.md', '| ID | Title | Status | Created | Related |\n|---|---|---|---|---|\n' + ROWS.discussion + '\n');
  const docs = getActiveDocs(dir);
  report.check('C5 compaction lists active documents by bare ID', docs.length === 1 && docs[0].id === 'D119' && docs[0].status === 'open', JSON.stringify(docs).slice(0, 200));
}

// AC-3: unfinished result sections, current template and the old one.
{
  const { validatePendingSections } = require('./log-guard');
  const current = '## Execution Results\n(placeholder — parent writes implementation evidence here)\n\n## Verification Results\ndone\n\n## Final Verification\n(placeholder — parent writes the final evaluation here)\n### Correctness\n';
  const r1 = validatePendingSections(current, 'D001_T001');
  report.check('P1 the current template placeholder blocks a terminal transition and names each section', r1.valid === false && /Execution Results/.test(r1.reason) && /Final Verification/.test(r1.reason) && !/Verification Results/.test(r1.reason), r1.reason);
  const old = '## Execution Results (Work Agent)\n(pending)\n';
  report.check('P2 the old (pending) form is still caught', validatePendingSections(old, 'P001_T001').valid === false);
  const filled = '## Execution Results\n- changed x\n\n## Verification Results\n| a | b |\n\n## Final Verification\n### Correctness\nok\n';
  report.check('P3 a filled ticket passes', validatePendingSections(filled, 'D001_T001').valid === true);
  report.check('P4 a discussion is not checked', validatePendingSections(current, 'D001').valid === true);
}

// AC-5: the check that read state.prevPlanId (never written) is gone.
{
  const guard = require('./log-guard');
  const source = fs.readFileSync(path.join(__dirname, 'log-guard.js'), 'utf8');
  report.check('X1 log-guard no longer carries the previous-cycle check', !('checkRegressingCycleGuard' in guard) && !/prevPlanId/.test(source) && !('PLAN_DOC_PATTERN' in guard));
}

report.finish();
