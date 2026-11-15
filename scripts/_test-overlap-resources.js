'use strict';
// D175_T002: declared resources and timing work.
// Part 1 (runner/resources.js, settings): who holds a resource's lock file — a live pid, a
// pid that died, a pid another process took over, a file still being written, a file no
// one can read — the process list shape, and manifest validation of resources, launches
// and `uses`. Part 2 (hook and runner) follows in the same file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const resources = require('../skills/verifying/scripts/runner/resources');
const { validateManifestSettings } = require('../skills/verifying/scripts/runner/settings');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-resources-'));
// The process list and git run from the temporary folder, so this test reads nothing of the
// repository it lives in (the runner would otherwise count every project file as its input).
const home = process.cwd();
process.chdir(base);
process.on('exit', () => { try { process.chdir(home); fs.rmSync(base, { recursive: true, force: true }); } catch (_) {} });
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const throwsWith = (fn, pattern) => { try { fn(); return false; } catch (error) { return pattern.test(error.message); } };
const deadPid = () => {
  for (let pid = 4194000; pid < 4194300; pid++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return pid; }
  }
  return 4194303;
};

async function main() {
  const tree = path.join(base, 'tree');
  fs.mkdirSync(path.join(tree, 'locks'), { recursive: true });
  const resource = { name: 'kiln', ...resources.DEFAULTS, lockFile: 'locks/kiln.lock' };
  const lock = path.join(tree, 'locks', 'kiln.lock');

  check('no lock file: nothing holds it', resources.lockHolder(tree, resource) === null);

  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true, stdio: 'ignore' });
  const ended = new Promise(resolve => holder.on('exit', resolve));
  fs.writeFileSync(lock, JSON.stringify({ label: 'kiln-firing', pid: holder.pid, started_at: new Date().toISOString() }));
  const held = resources.lockHolder(tree, resource);
  check('a live pid in the lock holds it', held && held.pid === holder.pid && held.label === 'kiln-firing', JSON.stringify(held));

  const list = resources.processList();
  check('the process list reads this machine', Array.isArray(list) && list.some(item => item.pid === process.pid), String(list && list.length));
  const me = list && list.find(item => item.pid === process.pid);
  check('a listed process has its arguments and start time', Boolean(me) && me.argv.length > 0 && Number.isFinite(me.startedAt), JSON.stringify(me));
  check('the holder is still holding by the process list', resources.stillHolding(held, list));
  check('a pid taken over by a later process is not holding',
    resources.stillHolding({ ...held, startedAt: Date.now() - 3600 * 1000 }, [{ pid: holder.pid, startedAt: Date.now() }]) === false);
  check('this process descends from its parent in the list', list ? resources.ancestorsOf(list, process.pid).has(process.ppid) : false);

  fs.writeFileSync(lock, JSON.stringify({ label: 'kiln-firing', pid: deadPid() }));
  check('a dead pid in the lock holds nothing', resources.lockHolder(tree, resource) === null);

  fs.writeFileSync(lock, JSON.stringify({ owner: holder.pid, started_at: new Date().toISOString() }));
  check('pidKey names where the pid is', (resources.lockHolder(tree, { ...resource, pidKey: 'owner' }) || {}).pid === holder.pid);

  fs.writeFileSync(lock, '');
  check('a fresh lock without an owner is held (still being written)', (resources.lockHolder(tree, resource) || {}).pid === null);
  const old = new Date(Date.now() - 120 * 1000);
  fs.utimesSync(lock, old, old);
  check('an old lock without an owner is abandoned', resources.lockHolder(tree, resource) === null);
  check('staleAfterSeconds decides how old is abandoned', (resources.lockHolder(tree, { ...resource, staleAfterSeconds: 600 }) || {}).pid === null);

  holder.kill();
  await ended;

  check('a Windows command line splits like a program reads it',
    JSON.stringify(resources.windowsArgv(String.raw`"C:\Program Files\kiln.exe" -a "b c" d\\"e f"`)) === JSON.stringify(['C:\\Program Files\\kiln.exe', '-a', 'b c', 'd\\e f']));
  const posix = resources.parsePosix('  4242     1 Sat Nov 14 18:47:00 2026 /usr/bin/kiln --fire now\n');
  check('a ps line parses into pid, parent, start and arguments', posix.length === 1 && posix[0].pid === 4242 && posix[0].ppid === 1
    && posix[0].name === 'kiln' && posix[0].argv.join(' ') === '/usr/bin/kiln --fire now' && Number.isFinite(posix[0].startedAt), JSON.stringify(posix));
  const windows = resources.parseWindows(JSON.stringify([{ ProcessId: 77, ParentProcessId: 4, Name: 'kiln.exe', CommandLine: null, CreationDate: '/Date(1700000000000)/' }]));
  check('a process whose command line cannot be read keeps its name', windows[0].unknownArgs === true && windows[0].argv[0] === 'kiln.exe' && windows[0].startedAt === 1700000000000);

  // Manifest validation.
  const ok = { resources: { kiln: { lockFile: 'locks/kiln.lock', scope: 'repo', onHeld: 'warn' } },
    launches: [{ name: 'fire', command: { file: 'node', args: ['tools/fire.js'] }, uses: ['kiln'], heavy: true }],
    entries: [{ id: 'K1', uses: ['kiln'] }], timingCompetitors: ['blowtorch*'], resourceWaitSeconds: 5 };
  check('a valid declaration passes', !throwsWith(() => validateManifestSettings(ok), /./));
  check('uses of an undeclared resource is named', throwsWith(() => validateManifestSettings({ ...ok, entries: [{ id: 'K1', uses: ['oven'] }] }), /K1: uses oven/));
  check('a launch using an undeclared resource is named', throwsWith(() => validateManifestSettings({ ...ok, launches: [{ ...ok.launches[0], uses: ['oven'] }] }), /uses oven/));
  check('a scope typo is named', throwsWith(() => validateManifestSettings({ ...ok, resources: { kiln: { scope: 'repository' } } }), /scope must be one of worktree, repo/));
  check('an absolute lockFile is refused', throwsWith(() => validateManifestSettings({ ...ok, resources: { kiln: { lockFile: process.platform === 'win32' ? 'C:\\kiln.lock' : '/kiln.lock' } } }), /repo-relative/));
  check('a launch without a command is named', throwsWith(() => validateManifestSettings({ ...ok, launches: [{ name: 'fire' }] }), /needs a name and a command/));

  await hookPart();

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
}

// Part 2: the PreToolUse judgment (scripts/core/resource-guard.js) in a real repository with a
// second worktree whose .crabshell/ git ignores, with real processes holding and measuring.
async function hookPart() {
  const { execFileSync } = require('child_process');
  const guard = require('./core/resource-guard');
  const main = path.join(base, 'main');
  const second = path.join(base, 'second');
  const gitIn = (dir, ...args) => execFileSync('git', args, { cwd: dir, windowsHide: true, stdio: 'pipe' });
  fs.mkdirSync(path.join(main, 'tools'), { recursive: true });
  for (const name of ['fire', 'gauge', 'churn']) fs.writeFileSync(path.join(main, 'tools', `${name}.js`), 'setTimeout(() => {}, 60000);\n');
  fs.writeFileSync(path.join(main, '.gitignore'), '.crabshell/\nlocks/\n');
  gitIn(main, 'init', '-q');
  gitIn(main, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '.');
  gitIn(main, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'base');
  gitIn(main, 'worktree', 'add', '-q', second);
  const manifest = {
    schemaVersion: 2,
    resources: { kiln: { lockFile: 'locks/kiln.lock' } },
    launches: [
      { name: 'fire', command: { file: 'node', args: ['tools/fire.js'] }, uses: ['kiln'] },
      { name: 'gauge', command: { file: 'node', args: ['tools/gauge.js'] }, timing: true },
      { name: 'churn', command: { file: 'node', args: ['tools/churn.js'] }, heavy: true },
    ],
    timingCompetitors: ['blowtorch*'],
    entries: [],
  };
  const manifestFile = path.join(main, '.crabshell', 'verification', 'manifest.json');
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const setManifest = value => fs.writeFileSync(manifestFile, JSON.stringify(value, null, 2));
  setManifest(manifest);
  const payload = (command, cwd, tool = 'Bash') => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd });
  const live = (args = ['-e', 'setTimeout(() => {}, 60000)'], options = {}) => {
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: 'ignore', ...options });
    return { child, ended: new Promise(resolve => child.on('exit', resolve)) };
  };
  const stop = async proc => { proc.child.kill(); await proc.ended; };
  const writeRun = (worktree, pid, running) => {
    const dir = path.join(worktree, '.crabshell', 'verification', require('../skills/verifying/scripts/runner/run-record').DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify({ schema: 1, pid, startedAt: new Date().toISOString(), selected: running.map(item => item.id), running, done: [] }));
  };
  const reasonOf = decision => (decision && decision.reason) || '';

  // 1. A runner run's check that uses the resource holds it (no lock-writing tool needed).
  const run = live();
  writeRun(main, run.child.pid, [{ id: 'KQ', uses: ['kiln'] }]);
  const byRun = guard.resourceDecision(payload('node tools/fire.js --hot', main), main);
  check('a runner check using the resource refuses a launch that uses it', /uses `kiln`, held by runner pid \d+, which is running check KQ/.test(reasonOf(byRun)), JSON.stringify(byRun));
  check('the refusal offers a pid-named override', new RegExp(`CRABSHELL_OVERLAP=pid:${run.child.pid} node tools/fire\\.js`).test(reasonOf(byRun)), reasonOf(byRun));
  check('that override lets it run', guard.resourceDecision(payload(`CRABSHELL_OVERLAP=pid:${run.child.pid} node tools/fire.js --hot`, main), main) === null);
  await stop(run);
  check('after the run ends the launch is allowed', guard.resourceDecision(payload('node tools/fire.js --hot', main), main) === null);

  // 2. The resource's lock file names a live process.
  const kilnHolder = live();
  fs.mkdirSync(path.join(main, 'locks'), { recursive: true });
  fs.writeFileSync(path.join(main, 'locks', 'kiln.lock'), JSON.stringify({ label: 'kiln-firing', pid: kilnHolder.child.pid, started_at: new Date().toISOString() }));
  const byLock = guard.resourceDecision(payload('node tools/fire.js', main), main);
  check('a live lock holder refuses the launch and is named', /held by pid \d+ \(kiln-firing, since .+\) via `.*kiln\.lock`/.test(reasonOf(byLock)), JSON.stringify(byLock));
  const hookData = path.join(base, 'hook-data');
  const viaHook = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'adapters', 'claude', 'pre-tool-use.js')], {
    cwd: main, encoding: 'utf8', windowsHide: true, timeout: 60000,
    input: JSON.stringify({ session_id: 'eeeeeeee-5555-4555-8555-555555555555', tool_use_id: 't-adapter', ...payload('node tools/fire.js', main) }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: main, CLAUDE_PLUGIN_DATA: hookData, CLAUDE_CONFIG_DIR: path.join(hookData, 'config') },
  });
  check('the Claude PreToolUse adapter refuses it too', /"permissionDecision":"deny"/.test(viaHook.stdout || '') && /uses `kiln`/.test(viaHook.stdout || ''), `${viaHook.status} ${(viaHook.stdout || '').slice(-300)}`);
  const psForm = guard.resourceDecision(payload('& node tools/fire.js | Out-Null', main, 'PowerShell'), main);
  check('the PowerShell form is refused with PowerShell syntax', reasonOf(psForm).includes("$env:CRABSHELL_OVERLAP='pid:"), reasonOf(psForm));
  setManifest({ ...manifest, resources: { kiln: { lockFile: 'locks/kiln.lock', onHeld: 'warn' } } });
  const warned = guard.resourceDecision(payload('node tools/fire.js', main), main);
  check('onHeld warn gives one line instead', Boolean(warned && warned.context && !warned.reason) && /will wait for that holder/.test(warned.context), JSON.stringify(warned));
  setManifest(manifest);

  // The same launch from the second worktree (no manifest there): its own lock decides.
  check('a worktree without a manifest uses the main one, and its own lock is free',
    guard.resourceDecision(payload('node tools/fire.js', second), second) === null);
  fs.mkdirSync(path.join(second, 'locks'), { recursive: true });
  fs.writeFileSync(path.join(second, 'locks', 'kiln.lock'), JSON.stringify({ pid: kilnHolder.child.pid }));
  check('its own lock held refuses there', /uses `kiln`/.test(reasonOf(guard.resourceDecision(payload('node tools/fire.js', second), second))));
  fs.rmSync(path.join(second, 'locks'), { recursive: true, force: true });
  await stop(kilnHolder);
  check('after the lock holder ends the launch is allowed', guard.resourceDecision(payload('node tools/fire.js', main), main) === null);

  // 3. A time measurement beside heavy work.
  const otherRun = live();
  writeRun(second, otherRun.child.pid, [{ id: 'KR' }]);
  const byOtherRun = guard.resourceDecision(payload('node tools/gauge.js', main), main);
  check('a runner run in another worktree refuses a time measurement', /measures time, and these are running: pid \d+ \(runner run in .*second\)/.test(reasonOf(byOtherRun)), JSON.stringify(byOtherRun));
  await stop(otherRun);
  const churn = live(['tools/churn.js'], { cwd: main });
  const byHeavy = guard.resourceDecision(payload('node tools/gauge.js', main), main);
  check('a declared heavy command running refuses it, named by pid', new RegExp(`pid ${churn.child.pid} .*declared heavy command churn`).test(reasonOf(byHeavy)), JSON.stringify(byHeavy));
  const torch = live(['-e', 'setTimeout(() => {}, 60000)'], { argv0: 'blowtorch-sim' });
  await pause(300);
  const both = guard.resourceDecision(payload('node tools/gauge.js', main), main);
  check('a timing competitor running anywhere refuses it too', new RegExp(`pid ${torch.child.pid} .*timing competitor \`blowtorch\\*\``).test(reasonOf(both)), reasonOf(both));
  const onlyTorch = guard.resourceDecision(payload(`CRABSHELL_OVERLAP=pid:${torch.child.pid} node tools/gauge.js`, main), main);
  check('skipping one pid keeps the others refused', new RegExp(`pid ${churn.child.pid}`).test(reasonOf(onlyTorch)) && !new RegExp(`pid ${torch.child.pid} `).test(reasonOf(onlyTorch)), reasonOf(onlyTorch));
  { const value = guard.resourceDecision(payload(`CRABSHELL_OVERLAP=pid:${torch.child.pid},${churn.child.pid} node tools/gauge.js`, main), main); check('skipping both lets it run', value === null, JSON.stringify(value)); }
  await stop(torch);

  // Reverse: heavy work while a declared measurement runs.
  await stop(churn);
  const gauge = live(['tools/gauge.js'], { cwd: main });
  const reverse = guard.resourceDecision(payload('node tools/churn.js', main), main);
  check('heavy work is refused while a declared measurement runs', new RegExp(`pid ${gauge.child.pid} .*is measuring time`).test(reasonOf(reverse)), JSON.stringify(reverse));
  await stop(gauge);
  check('with nothing running both are allowed', guard.resourceDecision(payload('node tools/churn.js', main), main) === null
    && guard.resourceDecision(payload('node tools/gauge.js', main), main) === null);

  // No declaration: no git, no process list. A process list that fails: one line, no refusal.
  const resourcesModule = require('../skills/verifying/scripts/runner/resources');
  const saved = { processList: resourcesModule.processList, worktrees: resourcesModule.worktrees };
  let calls = 0;
  resourcesModule.processList = () => { calls++; return null; };
  resourcesModule.worktrees = dir => { calls++; return saved.worktrees(dir); };
  const plain = path.join(base, 'plain');
  fs.mkdirSync(path.join(plain, '.crabshell', 'verification'), { recursive: true });
  fs.writeFileSync(path.join(plain, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ schemaVersion: 2, entries: [{ id: 'P1', type: 'structural', command: { file: 'node', args: ['tools/fire.js'] } }] }));
  check('a project with no such declaration decides nothing', guard.resourceDecision(payload('node tools/fire.js', plain), plain) === null);
  check('and runs no git and no process list for it', calls === 0, String(calls));
  const failedList = guard.resourceDecision(payload('node tools/gauge.js', main), main);
  check('a process list that fails gives one line and no refusal', Boolean(failedList && failedList.context && !failedList.reason) && /Could not list processes/.test(failedList.context), JSON.stringify(failedList));
  Object.assign(resourcesModule, saved);
  check('CRABSHELL_OVERLAP=1 decides nothing', guard.resourceDecision(payload('CRABSHELL_OVERLAP=1 node tools/gauge.js', main), main) === null);
  check('a broken manifest decides nothing', (() => { fs.writeFileSync(manifestFile, '{ broken'); const value = guard.resourceDecision(payload('node tools/fire.js', main), main); setManifest(manifest); return value === null; })());
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

main().catch(error => { console.log(`FAIL: test crashed -- ${error.stack}`); process.exit(1); });
