'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceRunner = path.join(repoRoot, 'skills', 'verifying', 'scripts', 'run-verify.js');
const generatedRunner = path.join(repoRoot, '.crabshell', 'verification', 'run-verify.js');
const jsonMode = process.argv.includes('--json');
const checks = [];

function check(name, condition, evidence) {
  checks.push({ name, passed: !!condition, evidence: evidence || '' });
  if (!jsonMode) console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${evidence ? ` — ${evidence}` : ''}`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function entry(id, commandCode, contract, type = 'behavioral') {
  return {
    id,
    ia: id,
    type,
    command: { file: 'node', args: ['-e', commandCode] },
    contract,
    timeout: 5000
  };
}

function parseResults(stdout) {
  const marker = '\nVerification Results:';
  const end = stdout.indexOf(marker);
  if (end < 0) throw new Error(`runner summary missing: ${stdout}`);
  return JSON.parse(stdout.slice(0, end).trim());
}

function runManifest(root, entries) {
  const verificationDir = path.join(root, '.crabshell', 'verification');
  fs.mkdirSync(verificationDir, { recursive: true });
  fs.copyFileSync(sourceRunner, path.join(verificationDir, 'run-verify.js'));
  writeJson(path.join(verificationDir, 'manifest.json'), { schemaVersion: 2, entries });
  const env = { ...process.env, PROJECT_ROOT: root };
  delete env.CRABSHELL_VERIFY_RUNNING;
  const result = spawnSync(process.execPath, [path.join(verificationDir, 'run-verify.js')], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true
  });
  return { ...result, results: parseResults(result.stdout || '') };
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell runner spaces-'));
try {
  writeJson(path.join(fixtureRoot, 'reference.json'), { release_channel: 'amber' });
  writeJson(path.join(fixtureRoot, 'observed.json'), { release_channel: 'unset', value: 'wrong' });
  fs.writeFileSync(path.join(fixtureRoot, 'user-owned.txt'), 'preserve-me', 'utf8');

  const positive = runManifest(fixtureRoot, [entry(
    'POSITIVE',
    'const fs=require("fs");const v=JSON.parse(fs.readFileSync("reference.json","utf8"));fs.writeFileSync("observed.json",JSON.stringify(v));',
    {
      exitCode: 0,
      assertions: [{ kind: 'jsonMatches', actual: { path: 'observed.json', pointer: '/release_channel' }, expected: { path: 'reference.json', pointer: '/release_channel' } }],
      forbiddenChanges: ['user-owned.txt']
    }
  )]);
  check('1 spaced temp checkout positive control passes', positive.status === 0 && positive.results[0].status === 'PASS', fixtureRoot);

  writeJson(path.join(fixtureRoot, 'observed.json'), { value: 'wrong' });
  const passOnly = runManifest(fixtureRoot, [entry(
    'PASS_ONLY',
    'console.log("PASS: everything is fine")',
    { exitCode: 0, assertions: [{ kind: 'jsonEquals', path: 'observed.json', pointer: '/value', equals: 'expected' }], forbiddenChanges: [] }
  )]);
  check('2 PASS-only wrong behavior fails', passOnly.status === 1 && passOnly.results[0].status === 'FAIL' && /expected/.test(passOnly.results[0].error));

  const wrongOrder = runManifest(fixtureRoot, [entry(
    'WRONG_ORDER',
    'require("fs").writeFileSync("trace.json",JSON.stringify({sequence:["verify","implement"]}))',
    { exitCode: 0, assertions: [{ kind: 'jsonEquals', path: 'trace.json', pointer: '/sequence', equals: ['implement', 'verify'] }], forbiddenChanges: [] }
  )]);
  check('3 wrong-order mutation fails', wrongOrder.status === 1 && /sequence/.test(wrongOrder.results[0].error));

  writeJson(path.join(fixtureRoot, 'reference.json'), { release_channel: 'violet' });
  const hardcoded = runManifest(fixtureRoot, [entry(
    'HARDCODED',
    'require("fs").writeFileSync("observed.json",JSON.stringify({release_channel:"amber"}))',
    {
      exitCode: 0,
      assertions: [{ kind: 'jsonMatches', actual: { path: 'observed.json', pointer: '/release_channel' }, expected: { path: 'reference.json', pointer: '/release_channel' } }],
      forbiddenChanges: []
    }
  )]);
  check('4 authoritative-source perturbation rejects hardcoding', hardcoded.status === 1 && /violet/.test(hardcoded.results[0].error));

  fs.writeFileSync(path.join(fixtureRoot, 'user-owned.txt'), 'preserve-me', 'utf8');
  const sideEffect = runManifest(fixtureRoot, [entry(
    'SIDE_EFFECT',
    'require("fs").writeFileSync("user-owned.txt","mutated");require("fs").writeFileSync("observed.json",JSON.stringify({ok:true}))',
    { exitCode: 0, assertions: [{ kind: 'jsonEquals', path: 'observed.json', pointer: '/ok', equals: true }], forbiddenChanges: ['user-owned.txt'] }
  )]);
  check('5 forbidden-side-effect mutation fails', sideEffect.status === 1 && sideEffect.results[0].observation.changedForbidden.includes('user-owned.txt'));

  const absolute = runManifest(fixtureRoot, [{
    id: 'ABSOLUTE', ia: 'absolute', type: 'structural',
    command: { file: 'C:/Program Files/nodejs/node.exe', args: ['-e', 'process.exit(0)'] },
    contract: { exitCode: 0, assertions: [], forbiddenChanges: [] }
  }]);
  check('6 absolute command path is rejected', absolute.status === 1 && /portable|absolute/.test(absolute.results[0].error));

  const missingContract = runManifest(fixtureRoot, [entry(
    'EMPTY_BEHAVIOR',
    'process.exit(0)',
    { exitCode: 0, assertions: [], forbiddenChanges: [] }
  )]);
  check('7 behavioral label without observations fails', missingContract.status === 1 && /requires an assertion/.test(missingContract.results[0].error));

  const structural = runManifest(fixtureRoot, [entry(
    'STRUCTURAL',
    'process.exit(0)',
    { exitCode: 0, assertions: [], forbiddenChanges: [] },
    'structural'
  )]);
  check('8 structural exit contract remains supported', structural.status === 0 && structural.results[0].status === 'PASS');

  check('9 tracked source and generated runner are byte-identical', fs.readFileSync(sourceRunner).equals(fs.readFileSync(generatedRunner)));
  const activeManifest = fs.readFileSync(path.join(repoRoot, '.crabshell', 'verification', 'manifest.json'), 'utf8');
  const skill = fs.readFileSync(path.join(repoRoot, 'skills', 'verifying', 'SKILL.md'), 'utf8');
  const runnerSource = fs.readFileSync(sourceRunner, 'utf8');
  check('10 active sources contain no substring-pass or machine path',
    !runnerSource.includes('output.includes(entry.expected)')
      && !skill.includes('output.includes(entry.expected)')
      && !/C:\/Users|C:\/Program Files/i.test(activeManifest));
} finally {
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedFixture = path.resolve(fixtureRoot);
  if (resolvedFixture.startsWith(tempRoot + path.sep) && path.basename(resolvedFixture).startsWith('crabshell runner spaces-')) {
    fs.rmSync(resolvedFixture, { recursive: true, force: true });
  }
}

const passed = checks.every(item => item.passed);
if (jsonMode) process.stdout.write(JSON.stringify({ passed, checks }));
else console.log(`\n${checks.filter(item => item.passed).length} passed, ${checks.filter(item => !item.passed).length} failed`);
process.exit(passed ? 0 : 1);
