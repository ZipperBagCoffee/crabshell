'use strict';
// D175_T003: before a command that makes files (a manifest declaration with `outputs`) runs,
// PreToolUse says when another worktree of the same repository has changes to that command's
// inputs — uncommitted there, or committed there and not in this worktree — and refuses when
// the manifest says pendingInputs: "refuse". A real temporary repository with a second
// worktree made by `git worktree add`; scripts/core/pending-inputs.js is called directly.
// Nothing outside the temporary folder is written.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

// Count the git processes the decision starts. The modules read spawnSync from
// child_process, so it is wrapped before they are loaded; setup calls the original.
const realSpawnSync = childProcess.spawnSync;
let gitSpawns = 0;
childProcess.spawnSync = function countingSpawnSync(file, ...rest) {
  if (/^git(\.exe)?$/i.test(path.basename(String(file)))) gitSpawns++;
  return realSpawnSync.call(this, file, ...rest);
};

const { STORAGE_ROOT } = require('./constants');
const { pendingInputsDecision } = require('./core/pending-inputs');

let passed = 0;
let total = 0;
function check(name, condition, detail) {
  total++;
  if (condition) { passed++; console.log(`PASS: ${name}`); }
  else console.log(`FAIL: ${name}${detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

const fold = value => (process.platform === 'win32' ? String(value).toLowerCase() : String(value));
const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-pending-inputs-')));
let removed = false;
function removeTemp() {
  if (removed) return;
  removed = true;
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); } catch (_) {}
}
process.on('exit', removeTemp);

const ALDER = path.join(temp, 'alder');
const BIRCH = path.join(temp, 'birch');
const HOOKS = path.join(temp, 'no-hooks');
const CEDAR = path.join(temp, 'cedar');
const PLAIN = path.join(temp, 'plain');

function git(cwd, args) {
  const result = realSpawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.error}`);
  return result.stdout;
}
function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const manifestRel = path.join(STORAGE_ROOT, 'verification', 'manifest.json');
const manifestOf = extra => ({
  schemaVersion: 2,
  entries: [
    { id: 'SB1', type: 'structural', command: { file: 'node', args: ['checks/sable_probe.js'] }, contract: { exitCode: 0 }, inputs: ['assets/marrow/*.dat'] },
    { id: 'GL1', type: 'structural', command: { file: 'node', args: ['checks/gild_golden.js'] }, contract: { exitCode: 0 }, inputs: ['templates/'], outputs: ['goldens/'] },
  ],
  launches: [
    { name: 'quill', command: { file: 'node', args: ['tools/quill_render.js'] }, inputs: ['assets/marrow/*.dat'], outputs: ['out/quill/'] },
  ],
  ...extra,
});
const writeManifest = (root, manifest) => write(root, manifestRel, typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2));

const bash = (command, cwd = ALDER) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const powershell = (command, cwd = ALDER) => ({ tool_name: 'PowerShell', tool_input: { command }, cwd });
const decide = (payload, projectDir = payload.cwd) => pendingInputsDecision(payload, projectDir);
const contextOf = result => (result && typeof result.context === 'string' ? result.context : '');
const reasonOf = result => (result && typeof result.reason === 'string' ? result.reason : '');
const names = (text, file) => fold(text).includes(fold(file));
const spawnsDuring = fn => { const before = gitSpawns; const result = fn(); return { result, spawns: gitSpawns - before }; };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

try {
  // --- The repository: a main worktree whose .crabshell/ git ignores --------------------
  fs.mkdirSync(ALDER, { recursive: true });
  fs.mkdirSync(HOOKS, { recursive: true });
  git(ALDER, ['init', '-q']);
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', HOOKS]]) {
    git(ALDER, ['config', key, value]);
  }
  write(ALDER, '.gitignore', `${STORAGE_ROOT}/\n`);
  write(ALDER, 'tools/quill_render.js', 'process.exit(0);\n');
  write(ALDER, 'checks/sable_probe.js', 'process.exit(0);\n');
  write(ALDER, 'checks/gild_golden.js', 'process.exit(0);\n');
  write(ALDER, 'assets/marrow/one.dat', 'one\n');
  write(ALDER, 'assets/marrow/two.dat', 'two\n');
  write(ALDER, 'templates/gild.tpl', 'tpl\n');
  write(ALDER, 'goldens/gild.png', 'golden\n');
  write(ALDER, 'notes/readme.txt', 'notes\n');
  write(ALDER, 'nest/tools/wren_build.js', 'process.exit(0);\n');
  write(ALDER, 'nest/data/a.csv', 'a\n');
  git(ALDER, ['add', '-A']);
  git(ALDER, ['commit', '-q', '-m', 'base']);
  const base = git(ALDER, ['rev-parse', 'HEAD']).trim();
  writeManifest(ALDER, manifestOf({}));
  // A project in a subfolder with its own manifest (paths in it are read from that folder).
  writeManifest(path.join(ALDER, 'nest'), { schemaVersion: 2, entries: [],
    launches: [{ name: 'wren', command: { file: 'node', args: ['tools/wren_build.js'] }, inputs: ['data/*.csv'], outputs: ['dist/'] }] });
  // A repository without a manifest, and a folder outside git.
  fs.mkdirSync(CEDAR, { recursive: true });
  git(CEDAR, ['init', '-q']);
  write(CEDAR, 'tools/quill_render.js', 'process.exit(0);\n');
  fs.mkdirSync(PLAIN, { recursive: true });

  // The manifest setting: warn or refuse, nothing else.
  const { validateManifestSettings } = require('../skills/verifying/scripts/runner/settings');
  const settingError = manifest => { try { validateManifestSettings(manifest); return null; } catch (error) { return error.message; } };
  check('pendingInputs "warn" and "refuse" are valid settings', settingError({ pendingInputs: 'warn' }) === null && settingError({ pendingInputs: 'refuse' }) === null);
  const badSetting = settingError({ pendingInputs: 'sometimes' });
  check('another pendingInputs value is refused, naming the setting', /pendingInputs must be one of warn, refuse/.test(badSetting || ''), badSetting);

  // AC4: one worktree only.
  check('AC4: with no other worktree there is no decision', decide(bash('node tools/quill_render.js')) === null);

  git(ALDER, ['worktree', 'add', '-q', '-b', 'birch-side', BIRCH]);
  check('setup: the second worktree has no manifest (.crabshell/ is ignored)', !fs.existsSync(path.join(BIRCH, manifestRel)));
  check('a clean second worktree gives no decision', decide(bash('node tools/quill_render.js')) === null);

  // --- AC1: an input changed in the second worktree, not committed -----------------------
  write(BIRCH, 'assets/marrow/one.dat', 'one, edited there\n');
  const warned = decide(bash('node tools/quill_render.js'));
  const warning = contextOf(warned);
  check('AC1: warns, not refuses, by default', Boolean(warning) && !reasonOf(warned), warned);
  check('AC1: the warning starts with [CRABSHELL]', warning.startsWith('[CRABSHELL] '), warning);
  check('AC1: names the other worktree, the file and "uncommitted"',
    names(warning, `Worktree ${BIRCH} has changes to inputs of \`node tools/quill_render.js\` not in this worktree: assets/marrow/one.dat (uncommitted).`), warning);
  check('AC1: says what goes out of date', warning.endsWith(require('./core/pending-inputs').OUT_OF_DATE), warning);
  const piped = contextOf(decide(bash('node tools/quill_render.js 2>&1 | tail -3')));
  check('the command is found inside a pipe with a redirection', names(piped, 'assets/marrow/one.dat (uncommitted)'), piped);
  const viaWorkdir = contextOf(decide({ tool_name: 'exec_command', tool_input: { cmd: 'node tools/quill_render.js', workdir: ALDER }, cwd: temp }, temp));
  check('the run folder comes from tool_input.workdir first', names(viaWorkdir, 'assets/marrow/one.dat (uncommitted)'), viaWorkdir);
  // A cd into the second worktree: that worktree's own edits are not "another worktree's".
  const intoBirch = `cd "${BIRCH}" && node tools/quill_render.js`;
  const cdOwn = decide(bash(intoBirch));
  check('a cd into the second worktree does not report that worktree\'s own edits', cdOwn === null, cdOwn);
  write(ALDER, 'assets/marrow/two.dat', 'two, edited in main\n');
  const cdOther = contextOf(decide(bash(intoBirch)));
  check('a cd into the second worktree reports the main worktree\'s edits, against the second worktree',
    names(cdOther, `Worktree ${ALDER} has changes to inputs of \`${intoBirch}\` not in ${BIRCH}: assets/marrow/two.dat (uncommitted).`), cdOther);
  git(ALDER, ['checkout', '-q', '--', 'assets/marrow/two.dat']);

  writeManifest(ALDER, manifestOf({ pendingInputs: 'refuse' }));
  const refused = decide(bash('node tools/quill_render.js'));
  check('AC1: pendingInputs "refuse" refuses', Boolean(reasonOf(refused)) && !contextOf(refused), refused);
  check('AC1: the refusal names the file and says how to run anyway (Bash syntax)',
    names(reasonOf(refused), 'assets/marrow/one.dat (uncommitted)')
    && reasonOf(refused).endsWith('Finish or drop those changes first, or run it anyway with `CRABSHELL_OVERLAP=1 node tools/quill_render.js`.'), reasonOf(refused));
  const refusedPs = reasonOf(decide(powershell('node tools/quill_render.js')));
  check('AC1: the PowerShell refusal gives PowerShell syntax', refusedPs.includes("`$env:CRABSHELL_OVERLAP='1'; node tools/quill_render.js`"), refusedPs);
  writeManifest(ALDER, manifestOf({}));

  // --- AC4: no outputs, or no declaration: silent, and git is not started ---------------
  const noOutputs = spawnsDuring(() => decide(bash('node checks/sable_probe.js')));
  check('AC4: a check without outputs whose input changed gives no decision', noOutputs.result === null, noOutputs.result);
  check('AC4: ... and starts no git process', noOutputs.spawns === 0, `${noOutputs.spawns} git processes`);
  const undeclared = spawnsDuring(() => decide(bash('node notes/other_script.js assets/marrow/one.dat')));
  check('AC4: an undeclared command gives no decision and starts no git process', undeclared.result === null && undeclared.spawns === 0, undeclared);
  const notShell = spawnsDuring(() => decide({ tool_name: 'Write', tool_input: { file_path: path.join(ALDER, 'x.txt'), content: 'x' }, cwd: ALDER }));
  check('a file write is not judged and starts no git process', notShell.result === null && notShell.spawns === 0, notShell);
  const fromSubfolder = spawnsDuring(() => decide(bash('node other_script.js', path.join(ALDER, 'notes'))));
  check('an undeclared command in a subfolder of the project starts no git process', fromSubfolder.result === null && fromSubfolder.spawns === 0, fromSubfolder);
  const noManifest = spawnsDuring(() => decide(bash('node tools/quill_render.js', CEDAR)));
  check('a repository without a manifest starts no git process', noManifest.result === null && noManifest.spawns === 0, noManifest);
  const notGit = spawnsDuring(() => decide(bash('node tools/quill_render.js', PLAIN)));
  check('a folder outside git starts no git process', notGit.result === null && notGit.spawns === 0, notGit);

  // --- AC6: override, git failure, broken manifest ----------------------------------------
  check('AC6: CRABSHELL_OVERLAP=1 before the command gives no decision', decide(bash('CRABSHELL_OVERLAP=1 node tools/quill_render.js')) === null);
  check("AC6: PowerShell $env:CRABSHELL_OVERLAP='1' gives no decision", decide(powershell("$env:CRABSHELL_OVERLAP='1'; node tools/quill_render.js")) === null);
  const savedPath = process.env.PATH;
  let withoutGit;
  try { process.env.PATH = path.join(temp, 'empty-path'); withoutGit = decide(bash('node tools/quill_render.js')); }
  finally { process.env.PATH = savedPath; }
  check('AC6: git not found gives no decision', withoutGit === null, withoutGit);
  const birchGitFile = path.join(BIRCH, '.git');
  const birchGitText = fs.readFileSync(birchGitFile, 'utf8');
  // Git for Windows hides a worktree's .git file, and a hidden file cannot be opened with 'w'.
  const overwrite = (file, text) => {
    const fd = fs.openSync(file, 'r+');
    try { fs.ftruncateSync(fd, 0); fs.writeSync(fd, text, 0); } finally { fs.closeSync(fd); }
  };
  let brokenWorktree;
  try { overwrite(birchGitFile, `gitdir: ${path.join(temp, 'missing-gitdir')}\n`); brokenWorktree = decide(bash('node tools/quill_render.js')); }
  finally { overwrite(birchGitFile, birchGitText); }
  check('AC6: git failing in the other worktree gives no decision', brokenWorktree === null, brokenWorktree);
  writeManifest(ALDER, '{ "launches": [ broken');
  check('AC6: a broken manifest gives no decision', decide(bash('node tools/quill_render.js')) === null);
  writeManifest(ALDER, { schemaVersion: 2, entries: 'not a list', launches: [null, 7, { name: 'x', command: 'node tools/quill_render.js', outputs: 'out/' }] });
  check('AC6: a manifest of the wrong shapes gives no decision', decide(bash('node tools/quill_render.js')) === null);
  writeManifest(ALDER, manifestOf({}));

  // --- AC7: the other worktree's index is not touched --------------------------------------
  const birchGitDir = git(BIRCH, ['rev-parse', '--absolute-git-dir']).trim();
  const birchIndex = path.join(birchGitDir, 'index');
  // A tracked file whose modification time no longer matches the index: a plain `git status`
  // there refreshes the index and writes it back (taking index.lock to do so).
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(path.join(BIRCH, 'notes', 'readme.txt'), stale, stale);
  const indexBefore = sha(birchIndex);
  const judged = decide(bash('node tools/quill_render.js'));
  check('AC7: the decision ran git in the other worktree', names(contextOf(judged), 'assets/marrow/one.dat (uncommitted)'), judged);
  check('AC7: no index.lock is left in the other worktree\'s git folder', !fs.existsSync(path.join(birchGitDir, 'index.lock')));
  check('AC7: the other worktree\'s index is unchanged (no optional lock was taken)', sha(birchIndex) === indexBefore);
  realSpawnSync('git', ['status', '--porcelain'], { cwd: BIRCH, encoding: 'utf8', windowsHide: true });
  check('AC7 control: a plain git status there does rewrite that index, so the check above can fail', sha(birchIndex) !== indexBefore);

  // --- AC2: committed in the second worktree, not in this one ----------------------------
  git(BIRCH, ['add', '-A']);
  git(BIRCH, ['commit', '-q', '-m', 'edit there']);
  const committed = contextOf(decide(bash('node tools/quill_render.js')));
  check('AC2: a commit there that this worktree lacks is "committed there"',
    names(committed, 'not in this worktree: assets/marrow/one.dat (committed there).'), committed);
  check('AC2: ... and not "uncommitted"', !committed.includes('(uncommitted)'), committed);
  git(BIRCH, ['reset', '-q', '--hard', base]);
  check('a second worktree back at the same commit gives no decision', decide(bash('node tools/quill_render.js')) === null);

  // --- AC3: the script the command runs, though no declared input names it ---------------
  write(BIRCH, 'tools/quill_render.js', 'process.exit(1);\n');
  const script = contextOf(decide(bash('node tools/quill_render.js')));
  check('AC3: a changed script named on the command line is caught', names(script, 'tools/quill_render.js (uncommitted)'), script);
  const fromSub = contextOf(decide(bash('cd tools && node quill_render.js')));
  check('AC3: ... also when a cd first makes the name relative', names(fromSub, 'tools/quill_render.js (uncommitted)'), fromSub);
  write(BIRCH, 'templates/gild.tpl', 'tpl, edited there\n');
  write(BIRCH, 'goldens/gild.png', 'made there\n');
  const golden = contextOf(decide(bash('node checks/gild_golden.js --write goldens/gild.png')));
  check('a check entry with outputs is judged like a launch (folder input)', names(golden, 'templates/gild.tpl (uncommitted)'), golden);
  const goldenFiles = golden.split('not in this worktree: ')[1] || '';
  check('... and a file under its outputs named on the command line is not an input', Boolean(goldenFiles) && !names(goldenFiles, 'goldens/gild.png'), golden);
  git(BIRCH, ['reset', '-q', '--hard', base]);
  git(BIRCH, ['clean', '-q', '-fd']);

  // --- Renames and copies: both paths ----------------------------------------------------
  git(BIRCH, ['mv', 'assets/marrow/one.dat', 'assets/one.moved']);
  const moved = contextOf(decide(bash('node tools/quill_render.js')));
  check('a staged rename there names the input at its old path (status -z rename record)', names(moved, 'assets/marrow/one.dat (uncommitted)'), moved);
  git(BIRCH, ['commit', '-q', '-m', 'move']);
  const movedCommitted = contextOf(decide(bash('node tools/quill_render.js')));
  check('a committed rename there names the input at its old path (diff --no-renames)', names(movedCommitted, 'assets/marrow/one.dat (committed there)'), movedCommitted);
  git(BIRCH, ['reset', '-q', '--hard', base]);

  // --- Many files: at most 10 named ---------------------------------------------------------
  for (let index = 1; index <= 12; index++) write(BIRCH, `assets/marrow/f${String(index).padStart(2, '0')}.dat`, `${index}\n`);
  const many = contextOf(decide(bash('node tools/quill_render.js')));
  const listed = (many.match(/assets\/marrow\/f\d\d\.dat/g) || []).length;
  check('12 changed inputs: 10 are named, then "(2 more)"', listed === 10 && many.includes('(2 more) (uncommitted)'), many);
  git(BIRCH, ['clean', '-q', '-fd']);

  // --- AC5: a worktree without a manifest is judged by the main worktree's ----------------
  write(ALDER, 'assets/marrow/two.dat', 'two, edited in main\n');
  const fromBirch = contextOf(decide(bash('node tools/quill_render.js', BIRCH)));
  check('AC5: from the worktree without a manifest, the main manifest finds the change in main',
    names(fromBirch, `Worktree ${ALDER} has changes to inputs of \`node tools/quill_render.js\` not in this worktree: assets/marrow/two.dat (uncommitted).`), fromBirch);
  check('AC5: ... and does not name its own worktree as the other one', !names(fromBirch, `Worktree ${BIRCH} `), fromBirch);
  git(ALDER, ['checkout', '-q', '--', 'assets/marrow/two.dat']);

  // --- Through the real Claude PreToolUse adapter ------------------------------------------
  write(BIRCH, 'assets/marrow/one.dat', 'one, edited there (adapter)\n');
  const hookData = path.join(temp, 'hook-data');
  const viaHook = realSpawnSync(process.execPath, [path.join(__dirname, 'adapters', 'claude', 'pre-tool-use.js')], {
    cwd: ALDER, encoding: 'utf8', windowsHide: true, timeout: 60000,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'dddddddd-4444-4444-8444-444444444444', tool_use_id: 't-adapter', ...bash('node tools/quill_render.js') }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: ALDER, CLAUDE_PLUGIN_DATA: hookData, CLAUDE_CONFIG_DIR: path.join(hookData, 'config') },
  });
  check('the Claude PreToolUse adapter passes the warning on', /has changes to inputs of `node tools\/quill_render\.js`/.test(viaHook.stdout || '') && viaHook.status === 0,
    `${viaHook.status} ${(viaHook.stdout || '').slice(-300)} ${(viaHook.stderr || '').slice(-200)}`);
  git(BIRCH, ['checkout', '-q', '--', 'assets/marrow/one.dat']);

  // --- A project in a subfolder of the worktree --------------------------------------------
  write(BIRCH, 'nest/data/a.csv', 'a, edited there\n');
  const nested = contextOf(decide(bash('node tools/wren_build.js', path.join(ALDER, 'nest'))));
  check('a project in a subfolder matches its inputs inside that folder (named from the worktree root)', names(nested, 'nest/data/a.csv (uncommitted)'), nested);
  git(BIRCH, ['checkout', '-q', '--', 'nest/data/a.csv']);
} catch (error) {
  check(`the test ran to the end (${String(error && error.message).split('\n')[0]})`, false);
}

removeTemp();
check('the temporary folder is removed', !fs.existsSync(temp), temp);
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
