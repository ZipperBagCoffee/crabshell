'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const HOOKS_PATH = path.join(ROOT, 'hooks', 'hooks.json');
const REGRESSING_GUARD = path.join(__dirname, 'regressing-loop-guard.js');
const INJECT_RULES = path.join(__dirname, 'inject-rules.js');

let passed = 0;
let failed = 0;
const sandboxes = [];
const JSON_MODE = process.argv.includes('--json');

function test(name, condition, detail = '') {
  if (condition) {
    if (!JSON_MODE) console.log('PASS: ' + name);
    passed++;
  } else {
    if (!JSON_MODE) console.log('FAIL: ' + name + (detail ? ' -- ' + detail : ''));
    failed++;
  }
}

function makeSandbox(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  sandboxes.push(dir);
  return dir;
}

function runRegressingGuard(waCount) {
  const sandbox = makeSandbox('crabshell-count-retirement-');
  const memoryDir = path.join(sandbox, '.crabshell', 'memory');
  fs.writeFileSync(path.join(memoryDir, 'regressing-state.json'), JSON.stringify({
    active: true,
    cycle: 3,
    totalCycles: 10,
    phase: 'execution',
    planId: 'P157',
    ticketIds: ['P157_T002']
  }), 'utf8');
  fs.writeFileSync(path.join(memoryDir, 'wa-count.json'), JSON.stringify({ waCount }), 'utf8');

  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox });
  delete env.CRABSHELL_BACKGROUND;
  const result = spawnSync(NODE, [REGRESSING_GUARD], {
    input: JSON.stringify({ stop_hook_active: false }),
    encoding: 'utf8',
    env
  });
  let output = null;
  try { output = JSON.parse(result.stdout || '{}'); } catch (_) {}
  return { status: result.status, output, stderr: result.stderr };
}

function runInjectRules(state) {
  const sandbox = makeSandbox('crabshell-verifier-retirement-');
  if (state) {
    fs.writeFileSync(
      path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json'),
      JSON.stringify(state),
      'utf8'
    );
  }
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox });
  delete env.CRABSHELL_BACKGROUND;
  const result = spawnSync(NODE, [INJECT_RULES], {
    input: JSON.stringify({ prompt: 'continue the implementation' }),
    encoding: 'utf8',
    env
  });
  let output = null;
  try { output = JSON.parse(result.stdout || '{}'); } catch (_) {}
  const context = output && output.hookSpecificOutput
    ? output.hookSpecificOutput.additionalContext || ''
    : '';
  return { status: result.status, context, stderr: result.stderr };
}

const hooks = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf8')).hooks;
const hookText = JSON.stringify(hooks);
const stopText = JSON.stringify(hooks.Stop || []);

test(
  'active hooks omit WA-count, role-collapse, and behavior-verifier commands',
  !hookText.includes('wa-count-pretool.js')
    && !hookText.includes('role-collapse-guard.js')
    && !hookText.includes('behavior-verifier.js')
);

const continuationOwners = (stopText.match(/regressing-loop-guard\.js/g) || []).length;
test(
  'regressing-loop-guard is the single workflow-continuation Stop owner',
  continuationOwners === 1,
  'owners=' + continuationOwners
);

const countZero = runRegressingGuard(0);
const countOne = runRegressingGuard(1);
const sameDecision = countZero.status === 2
  && countOne.status === 2
  && countZero.output
  && countOne.output
  && countZero.output.decision === 'block'
  && countOne.output.decision === 'block'
  && countZero.output.reason === countOne.output.reason;
test(
  'regressing continuation is invariant across waCount=0 and waCount=1',
  sameDecision,
  JSON.stringify({ zero: countZero, one: countOne })
);

const guardSource = fs.readFileSync(REGRESSING_GUARD, 'utf8');
const mainStart = guardSource.indexOf('async function main()');
const mainEnd = guardSource.indexOf('if (require.main === module)');
const guardMain = guardSource.slice(mainStart, mainEnd);
test(
  'active regressing main path does not read count or background-agent state',
  !/getWaCount|getBackgroundAgentPending|WA_COUNT_FILE/.test(guardMain)
);

const pending = runInjectRules({
  status: 'pending',
  launchedAt: new Date().toISOString(),
  dispatchOverdue: true,
  missedCount: 3,
  ringBuffer: [{ ts: new Date().toISOString(), u: false, v: false, l: false, s: false, reason: 'must not surface' }]
});
const completed = runInjectRules({
  status: 'completed',
  consumed: false,
  verdicts: {
    understanding: { pass: false, reason: 'must not surface' },
    verification: { pass: false, reason: 'must not surface' },
    logic: { pass: false, reason: 'must not surface' },
    scope: { pass: false, reason: 'must not surface' }
  },
  ringBuffer: [{ ts: new Date().toISOString(), u: false, v: true, l: false, s: true, reason: 'must not surface' }]
});
const legacyMarkers = [
  '## Prior Verifier FAIL',
  '## Watcher Recent Verdicts',
  'Behavior Verifier) Dispatch Required',
  '## Behavior Correction Required',
  'behavior-verifier-prompt.md'
];
const noLegacyMarkers = result => result.status === 0
  && result.context.includes('## Rules Quick-Check')
  && legacyMarkers.every(marker => !result.context.includes(marker));
test(
  'pending verifier state produces no legacy dispatch or ring-buffer surface',
  noLegacyMarkers(pending),
  'status=' + pending.status + ' contextLength=' + pending.context.length
);
test(
  'completed verifier state produces no legacy correction or watcher surface',
  noLegacyMarkers(completed),
  'status=' + completed.status + ' contextLength=' + completed.context.length
);

const injectSource = fs.readFileSync(INJECT_RULES, 'utf8');
test(
  'legacy verifier consumer code and runtime files are absent',
  !/behavior-verifier|BEHAVIOR_VERIFIER|Prior Verifier|Watcher Recent Verdicts|Behavior Correction/.test(injectSource)
    && !fs.existsSync(path.join(__dirname, 'behavior-verifier.js'))
    && !fs.existsSync(path.join(__dirname, 'wa-count-pretool.js'))
    && !fs.existsSync(path.join(__dirname, 'role-collapse-guard.js'))
);

const ruleFiles = [
  path.join(ROOT, 'skills', 'planning', 'SKILL.md'),
  path.join(ROOT, 'skills', 'ticketing', 'SKILL.md'),
  path.join(ROOT, 'skills', 'regressing', 'SKILL.md')
];
const rules = ruleFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
const fixedRitual = /RA Count Rule|WA Count Rule|MUST launch 2\+ Work Agents|MUST each be launched as separate Task tool|Single-WA is the EXCEPTION|Each role is a separate Task tool invocation/;
test(
  'planning, ticketing, and regressing rules contain no fixed-count or mandatory-pair gate',
  !fixedRitual.test(rules)
    && rules.includes('Parent-owned orchestration')
    && rules.includes('parent owns implementation')
    && rules.includes('parent owns plan analysis')
);

const counterSource = fs.readFileSync(path.join(__dirname, 'counter.js'), 'utf8');
const loadMemorySource = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
test(
  'active counter/load-memory paths do not maintain retired verifier/WA-count state',
  !/\bresetWaCount\s*\(\s*\)\s*;/.test(counterSource)
    && !/verifierCounter/.test(counterSource)
    && !/WA_COUNT_FILE|wa-count\.json/.test(loadMemorySource)
);

test(
  'post-compact and native install bridge remain configured',
  hookText.includes('post-compact.js')
    && fs.existsSync(path.join(ROOT, 'scripts', 'install-codex.js'))
);

for (const sandbox of sandboxes) {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}
}

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({ passed: failed === 0, passedCount: passed, failedCount: failed }));
} else {
  console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
}
process.exit(failed === 0 ? 0 : 1);
