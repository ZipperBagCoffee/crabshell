// Auto-generated verification runner
// Run: node .claude/verification/run-verify.js [entry-id]
// Run all: node .claude/verification/run-verify.js

const manifest = require('./manifest.json');
const { execSync } = require('child_process');
const path = require('path');
const { classify, shouldWarn } = require('./verify-classify');

const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const parsed = {
    targetId: null,
    flat: process.env.CRABSHELL_VERIFY_FLAT === '1',
    error: null
  };

  for (const arg of argv) {
    if (arg === '--flat' || arg === '-f') {
      parsed.flat = true;
    } else if (arg.startsWith('-')) {
      parsed.error = `Unknown flag: ${arg}`;
      break;
    } else if (!parsed.targetId) {
      parsed.targetId = arg;
    } else {
      parsed.error = `Unexpected extra argument: ${arg}`;
      break;
    }
  }

  return parsed;
}

function runEntry(entry) {
  if (entry.type === 'manual') {
    console.log(`[MANUAL] ${entry.id}: ${entry.ia}`);
    console.log(`  Action: ${entry.command}`);
    console.log(`  Expected: ${entry.expected}`);
    return { id: entry.id, status: 'manual', message: 'Requires human verification', failureClass: null };
  }
  try {
    const output = execSync(entry.command, {
      timeout: entry.timeout || 30000,
      encoding: 'utf8',
      cwd: projectRoot,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, CRABSHELL_VERIFY_RUNNING: '1' }
    }).trim();
    const pass = output.includes(entry.expected) || entry.expected === 'exit-0';
    const r = { id: entry.id, status: pass ? 'PASS' : 'FAIL', output, expected: entry.expected, failureClass: null };
    if (r.status === 'FAIL') r.failureClass = classify(null, r.output);
    return r;
  } catch (e) {
    const errMsg = e.stderr ? e.stderr.trim() : e.message;
    const r = { id: entry.id, status: 'FAIL', error: errMsg, expected: entry.expected, failureClass: null };
    r.failureClass = classify(r.error, e.stdout || '');
    return r;
  }
}

function selectEntries(targetId) {
  return targetId
    ? manifest.entries.filter(e => e.id === targetId)
    : manifest.entries.filter(e => e.type !== 'manual');
}

function failRunner(id, error, expected) {
  const result = { id, status: 'FAIL', error, expected, failureClass: classify(error, '') };
  console.log(JSON.stringify([result], null, 2));
  console.log('\nVerification Results: PASS: 0 / FAIL: 1 / Total: 1');
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    failRunner('RUNNER_ARGS', args.error, 'valid run-verify arguments');
    return;
  }

  if (process.env.CRABSHELL_VERIFY_RUNNING === '1' && !args.targetId) {
    failRunner(
      'RUNNER_RECURSION',
      'Nested full-manifest verification is blocked. Pass an explicit entry id for nested runner checks.',
      'explicit entry id'
    );
    return;
  }

  const entries = selectEntries(args.targetId);
  const results = entries.map(runEntry);
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;

  // JSON array output MUST come before any other lines (verify-guard regex /\[[\s\S]*\]/ must match)
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nVerification Results: PASS: ${passCount} / FAIL: ${failCount} / Total: ${results.length}`);

  // Category grouping (suppressed in flat mode)
  if (!args.flat) {
    const categories = ['env-incompatible', 'missing-file', 'data-drift', 'assertion-fail', 'unknown'];
    const fails = results.filter(r => r.status === 'FAIL');
    const counts = {};
    for (const cat of categories) counts[cat] = 0;
    for (const f of fails) { if (f.failureClass && counts[f.failureClass] !== undefined) counts[f.failureClass]++; }
    const hasAnyCat = Object.values(counts).some(n => n > 0);
    if (hasAnyCat) {
      console.log('\nFailure Categories:');
      for (const cat of categories) {
        if (counts[cat] > 0) console.log(`  ${cat}: ${counts[cat]}`);
      }
    }
  }

  // Unknown-ratio warning to stderr (AC4)
  const w = shouldWarn(results);
  if (w.warn) console.error(`[VERIFY] WARN: ${w.unknownCount}/${w.failCount} (${w.ratio}%) failures unclassified; classifier rules may need update`);

  process.exit(failCount > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, selectEntries, runEntry };
