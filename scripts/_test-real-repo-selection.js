'use strict';
// R14, moved out of _test-changed-runner.js (D143_T017): in this repository, a change to
// scripts/counter.js selects fewer than all checks but every test that names counter.js
// (a static lower bound of "loads counter.js"). It reads the whole working tree and the
// real records, so it is declared `slow` in the manifest: it runs at release and with
// --slow, not in routine --changed runs. The edit and the dry run happen in a copy of the
// working tree; the repository's files and Crabshell state are never touched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const CRAB = '.crab' + 'shell';
const realMap = path.join(REPO, CRAB, 'verification', 'test-map.json');
const finish = (ok, message) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`); process.exit(ok ? 0 : 1); };

if (!fs.existsSync(realMap)) {
  console.log('NOTE: not evaluated — this repository has no load map yet (a full declared run creates it).');
  process.exit(0);
}
const realSchema = (() => { try { return JSON.parse(fs.readFileSync(realMap, 'utf8')).schema; } catch { return null; } })();
if (realSchema !== 3) {
  // The map was written by an older runner; every check runs once and the next full run
  // writes a map this check can use.
  console.log('NOTE: not evaluated — this repository\'s load map is from an older runner.');
  process.exit(0);
}

// The copy: files git lists (tracked and untracked, not ignored), the whole scripts folder
// so its listing matches, and the runner's own files.
const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-real-repo-'));
process.on('exit', () => { try { fs.rmSync(copy, { recursive: true, force: true }); } catch (_) {} });
const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
if (listed.status !== 0) {
  console.log(`NOTE: not evaluated — git could not list the working tree (${String(listed.stderr || listed.error || '').trim()}).`);
  process.exit(0);
}
const verificationFiles = fs.readdirSync(path.join(REPO, CRAB, 'verification'), { withFileTypes: true })
  .filter(item => item.isFile()).map(item => `${CRAB}/verification/${item.name}`);
for (const rel of [...listed.stdout.split('\0').filter(Boolean), ...verificationFiles]) {
  const from = path.join(REPO, rel);
  if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
  fs.mkdirSync(path.dirname(path.join(copy, rel)), { recursive: true });
  fs.copyFileSync(from, path.join(copy, rel));
}
for (const folder of ['scripts', `${CRAB}/verification/runner`]) fs.cpSync(path.join(REPO, folder), path.join(copy, folder), { recursive: true });

fs.appendFileSync(path.join(copy, 'scripts', 'counter.js'), '\n');
const env = { ...process.env, PROJECT_ROOT: copy };
delete env.CRABSHELL_VERIFY_RUNNING;
const result = spawnSync(process.execPath, [path.join(copy, CRAB, 'verification', 'run-verify.js'), '--changed', '--dry-run'], { cwd: copy, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
let plan = {};
try { plan = JSON.parse(result.stdout); } catch {}

const tests = fs.readdirSync(path.join(copy, 'scripts')).filter(f => /^_test-.*\.js$/.test(f));
// Names counter.js as a module or a path (not the English word in a title).
const loadsCounter = /require\(\s*['"][^'"]*\bcounter(?:\.js)?['"]\s*\)|['"`](?:[^'"`\s]*\/)?counter\.js['"`]/;
const naming = tests.filter(f => loadsCounter.test(fs.readFileSync(path.join(copy, 'scripts', f), 'utf8')));
// A discovered check's id ends with its file; an explicit entry runs its first argument.
const manifest = JSON.parse(fs.readFileSync(path.join(copy, CRAB, 'verification', 'manifest.json'), 'utf8'));
const explicitFile = new Map((manifest.entries || []).filter(entry => entry.command && Array.isArray(entry.command.args))
  .map(entry => [entry.id, entry.command.args.find(arg => !arg.startsWith('-')) || '']));
const fileOf = id => path.basename(id.includes(':') ? id.split(':').slice(1).join(':') : explicitFile.get(id) || id);
const selectedFiles = new Set((plan.selected || []).map(fileOf));
// Slow checks (this one included) are left to --slow and release runs by design.
const slowFiles = new Set((plan.slowSkipped || []).map(fileOf));
// Naming counter.js is a lower bound only where the runner knows nothing better: a test
// whose complete traced record shows it never read scripts/counter.js (one that writes its
// own counter.js in a fixture folder) is rightly not selected.
const records = (() => { try { return JSON.parse(fs.readFileSync(path.join(copy, CRAB, 'verification', 'test-map.json'), 'utf8')).entries || {}; } catch { return {}; } })();
const tracedWithoutCounter = file => Object.entries(records).some(([id, record]) => id.endsWith(`:scripts/${file}`)
  && record.kind === 'traced' && Array.isArray(record.files) && !record.files.includes('scripts/counter.js'));
const missing = naming.filter(f => !selectedFiles.has(f) && !slowFiles.has(f) && !tracedWithoutCounter(f));

finish(plan.full === false && Array.isArray(plan.selected) && plan.selected.length < (plan.total || Infinity) && missing.length === 0,
  `R14 counter.js change: fewer than all checks (selected=${plan.selected && plan.selected.length} total=${plan.total}), and every test naming counter.js included${missing.length ? ` — missing ${missing.join(',')}` : ''}`);
