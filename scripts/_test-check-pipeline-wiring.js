// _test-check-pipeline-wiring.js — Integration tests for check-pipeline-wiring.js
// Focus: subprocess behavior, portable contracts, and mutation sensitivity
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const probePath = path.join(__dirname, '..', 'skills', 'verifying', 'scripts', 'check-pipeline-wiring.js');
const DELTA_TOKEN = '[' + 'CRABSHELL_DELTA]';
const CHANGED_TOKEN = '[' + 'CRABSHELL_CHANGED]';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function createFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
  ensureDir(path.join(root, 'hooks'));
  ensureDir(path.join(root, 'scripts'));
  ensureDir(path.join(root, 'skills', 'x'));
  ensureDir(path.join(root, 'agents'));

  writeJson(path.join(root, 'hooks', 'hooks.json'), {
    hooks: {
      PostToolUse: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/counter.js" check'
            }
          ]
        }
      ]
    }
  });
  fs.writeFileSync(path.join(root, 'scripts', 'counter.js'),
    "'use strict';\nconsole.log('" + DELTA_TOKEN + "');\n");
  fs.writeFileSync(path.join(root, 'skills', 'x', 'SKILL.md'),
    '---\nname: x\ndescription: Fixture skill\n---\n\n' +
    '## Trigger Condition\n\nConsume `' + DELTA_TOKEN + '` and call `x-agent`.\n');
  fs.writeFileSync(path.join(root, 'agents', 'x-agent.md'),
    '---\nname: x-agent\ndescription: Fixture agent\ntools: Read\n---\n\n## Task\n\nRead the fixture.\n');
  return root;
}

function runProbe(args) {
  const result = spawnSync(process.execPath,
    ['--preserve-symlinks', '--preserve-symlinks-main', probePath, ...args],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main' }
    });
  let json = null;
  if (result.stdout && result.stdout.trim()) {
    try { json = JSON.parse(result.stdout.trim()); } catch (e) {}
  }
  return { ...result, json };
}

function discover(root) {
  const result = runProbe(['discover', '--project-root', root]);
  assertEqual(result.status, 0, 'discover exit');
  assert(result.json, 'discover must print JSON');
  return result.json;
}

function writeContract(root, contract) {
  const contractPath = path.join(root, 'wiring-contract.json');
  writeJson(contractPath, contract);
  return contractPath;
}

test('DISCOVER: fixture hook, trigger, and agent hops are found', function() {
  const root = createFixture('pipeline-discover');
  try {
    const candidate = discover(root);
    assert(candidate.hooks.length > 0, 'expected hook candidates');
    assert(candidate.triggers.length > 0, 'expected trigger candidates');
    assert(candidate.agents.length > 0, 'expected agent candidates');
    assert(candidate.hooks.some(hook => hook.id === 'posttooluse:counter:check'), 'missing hook id');
    assert(candidate.triggers.some(trigger => trigger.id === 'trigger:crabshell_delta'), 'missing trigger id');
    assert(candidate.agents.some(agent => agent.id === 'agent:x-agent'), 'missing agent id');
  } finally {
    cleanupDir(root);
  }
});

test('CHECK: matching fixture contract passes', function() {
  const root = createFixture('pipeline-match');
  try {
    const contractPath = writeContract(root, discover(root));
    const result = runProbe(['check', '--project-root', root, '--contract', contractPath]);
    assertEqual(result.status, 0, 'check exit');
    assert(result.json && result.json.passed === true, 'matching contract must pass');
    assert(result.json.checked > 0, 'matching contract must check hops');
  } finally {
    cleanupDir(root);
  }
});

test('MUTATION: deleted hook entry fails without changing original hooks file', function() {
  const root = createFixture('pipeline-hook-mutation');
  try {
    const originalPath = path.join(root, 'hooks', 'hooks.json');
    const originalBytes = fs.readFileSync(originalPath);
    const contractPath = writeContract(root, discover(root));
    const mutatedPath = path.join(root, 'mutated-hooks.json');
    const mutated = JSON.parse(originalBytes.toString('utf8'));
    mutated.hooks.PostToolUse = [];
    writeJson(mutatedPath, mutated);

    const result = runProbe([
      'check', '--project-root', root, '--contract', contractPath,
      '--hooks', mutatedPath, '--hop', 'posttooluse:counter:check'
    ]);
    assertEqual(result.status, 1, 'mutated hook exit');
    assert(result.json && result.json.passed === false, 'mutated hook must fail');
    assert(result.json.failures.some(failure =>
      failure.hop === 'posttooluse:counter:check' && failure.reason === 'hook-entry-missing'),
    'missing hook-entry-missing failure');
    assert(fs.readFileSync(originalPath).equals(originalBytes), 'original hooks.json changed');
  } finally {
    cleanupDir(root);
  }
});

test('MUTATION: producer-only trigger rename fails', function() {
  const root = createFixture('pipeline-trigger-mutation');
  try {
    const contractPath = writeContract(root, discover(root));
    const scriptPath = path.join(root, 'scripts', 'counter.js');
    const content = fs.readFileSync(scriptPath, 'utf8');
    fs.writeFileSync(scriptPath, content.replace(DELTA_TOKEN, CHANGED_TOKEN));
    const result = runProbe([
      'check', '--project-root', root, '--contract', contractPath,
      '--hop', 'trigger:crabshell_delta'
    ]);
    assertEqual(result.status, 1, 'trigger mutation exit');
    assert(result.json.failures.some(failure => failure.reason === 'producer-token-missing'),
      'missing producer-token-missing failure');
  } finally {
    cleanupDir(root);
  }
});

test('MUTATION: agent frontmatter name mismatch fails', function() {
  const root = createFixture('pipeline-agent-mutation');
  try {
    const contractPath = writeContract(root, discover(root));
    const agentPath = path.join(root, 'agents', 'x-agent.md');
    const content = fs.readFileSync(agentPath, 'utf8');
    fs.writeFileSync(agentPath, content.replace('name: x-agent', 'name: different-agent'));
    const result = runProbe([
      'check', '--project-root', root, '--contract', contractPath,
      '--hop', 'agent:x-agent'
    ]);
    assertEqual(result.status, 1, 'agent mutation exit');
    assert(result.json.failures.some(failure => failure.reason === 'agent-name-mismatch'),
      'missing agent-name-mismatch failure');
  } finally {
    cleanupDir(root);
  }
});

test('COMPLETENESS: unlisted hook fails', function() {
  const root = createFixture('pipeline-completeness');
  try {
    const contractPath = writeContract(root, discover(root));
    const hooksPath = path.join(root, 'hooks', 'hooks.json');
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    hooks.hooks.SessionEnd = [
      {
        hooks: [
          { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/extra.js" final' }
        ]
      }
    ];
    writeJson(hooksPath, hooks);
    fs.writeFileSync(path.join(root, 'scripts', 'extra.js'), "'use strict';\n");

    const result = runProbe([
      'check', '--project-root', root, '--contract', contractPath, '--completeness'
    ]);
    assertEqual(result.status, 1, 'completeness exit');
    assert(result.json.failures.some(failure => failure.reason === 'unclassified-hook'),
      'missing unclassified-hook failure');
  } finally {
    cleanupDir(root);
  }
});

test('CHECK: unknown hop returns hop-not-in-contract', function() {
  const root = createFixture('pipeline-unknown-hop');
  try {
    const contractPath = writeContract(root, discover(root));
    const result = runProbe([
      'check', '--project-root', root, '--contract', contractPath, '--hop', 'missing:hop'
    ]);
    assertEqual(result.status, 1, 'unknown hop exit');
    assert(result.json && result.json.passed === false, 'unknown hop must fail');
    assert(result.json.failures.some(failure => failure.reason === 'hop-not-in-contract'),
      'missing hop-not-in-contract failure');
  } finally {
    cleanupDir(root);
  }
});

test('CONTRACT: malformed JSON returns usage error', function() {
  const root = createFixture('pipeline-malformed-contract');
  try {
    const contractPath = path.join(root, 'malformed.json');
    fs.writeFileSync(contractPath, '{');
    const result = runProbe(['check', '--project-root', root, '--contract', contractPath]);
    assertEqual(result.status, 2, 'malformed contract exit');
    assert(result.json && result.json.passed === false, 'malformed contract must report passed false');
    assert(typeof result.json.error === 'string' && result.json.error.length > 0, 'malformed contract needs error');
  } finally {
    cleanupDir(root);
  }
});

test('CONTRACT: absolute path inside contract is rejected', function() {
  const root = createFixture('pipeline-absolute-contract');
  try {
    const contract = discover(root);
    contract.hooks[0].script = path.join(root, 'scripts', 'counter.js');
    const contractPath = writeContract(root, contract);
    const result = runProbe(['check', '--project-root', root, '--contract', contractPath]);
    assertEqual(result.status, 2, 'absolute contract path exit');
    assert(result.json && result.json.passed === false, 'absolute contract path must report passed false');
    assert(result.json.error.includes('repo-relative'), 'absolute path error must mention repo-relative');
  } finally {
    cleanupDir(root);
  }
});

console.log('\n========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('Total: ' + (passed + failed) + ' tests');
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
