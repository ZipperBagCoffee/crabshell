'use strict';
/**
 * Prototype measurement scaffolding for behavior-verifier sub-agent (D102 IA-3).
 *
 * Usage:
 *   node scripts/_prototype-measure.js --model sonnet [--samples N] [--out path]
 *   node scripts/_prototype-measure.js --model haiku  [--samples N] [--out path]
 *
 * Writes results to .crabshell/investigation/I063-behavior-verifier-prototype-measurement.md
 * (default) or to --out <path>. Each row records: parse rate, consistency score,
 * false-positive rate (clarification turns), token cost, latency.
 *
 * Dispatch path: this script does NOT actually call the API. It builds the
 * dispatch payload (prompt + transcript) and prints a manifest the user (or a
 * future Task-tool invocation) will execute. This is intentional: the live
 * measurement requires the user's Claude Code session to dispatch the
 * sub-agent (no independent API key per project policy).
 *
 * The script structure supports N≥10 sample measurement once the user runs
 * the dispatch loop (manual or via a forthcoming Task-tool driver).
 *
 * Ticket: P132_T003 AC-1 + AC-2.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { model: null, samples: 10, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') { out.model = argv[++i]; continue; }
    if (a === '--samples') { out.samples = parseInt(argv[++i], 10); continue; }
    if (a === '--out') { out.out = argv[++i]; continue; }
  }
  return out;
}

// Synthetic transcript fixtures (substantive turns + clarification turns)
const FIXTURES = [
  { name: 'verified_no_evidence', text: 'The fix is verified and the tests pass. Ready to commit.', expectFails: { verification: false, logic: false } },
  { name: 'verified_with_bash', text: 'I ran the test command and it returned: 64 passed, 0 failed. The change is verified.', expectFails: {} },
  { name: 'plain_explanation', text: 'The function uses a binary search over the sorted array, returning the index of the first match.', expectFails: {} },
  { name: 'agreement_no_evidence', text: 'You are absolutely right, that is correct. The implementation works.', expectFails: { verification: false } },
  { name: 'verbose_jargon', text: 'Per the established orthogonal taxonomical conventions and the canonical idiomatic patterns prevalent across the broader ecosystem, the architectural decomposition manifests as ...', expectFails: { simple: false } },
  { name: 'clarification_only', text: 'Which file did you want me to inspect? Source under scripts/ or the test under scripts/_test-?', expectFails: {}, isClarification: true },
  { name: 'pog_table_with_evidence', text: '| Item | Prediction | Observation | Gap |\n|---|---|---|---|\n| build | succeeds | exit 0, 0 errors | none |' , expectFails: {} },
  { name: 'pog_all_none', text: '| Item | P | O | Gap |\n|---|---|---|---|\n| a | x | x | none |\n| b | y | y | none |\n| c | z | z | none |', expectFails: { verification: false } },
  { name: 'mid_action_jump', text: 'I will go ahead and write the file now.', expectFails: { understanding: false } },
  { name: 'concise_correct', text: 'Read line 42; the variable is undefined because it shadows the outer scope. Fix: rename in the inner block.', expectFails: {} },
];

function buildDispatchPayload(prompt, fixture) {
  return {
    subagent_type: 'general-purpose',
    run_in_background: false, // measurement run uses foreground for latency capture
    prompt: prompt + '\n\n## Assistant Response Under Evaluation\n\n' + fixture.text,
    expected: fixture.expectFails,
    fixtureName: fixture.name
  };
}

function loadVerifierPrompt() {
  const p = path.join(__dirname, '..', 'prompts', 'behavior-verifier-prompt.md');
  return fs.readFileSync(p, 'utf8');
}

function emitManifest(args) {
  const verifierPrompt = loadVerifierPrompt();
  const fixtures = FIXTURES.slice(0, Math.min(args.samples, FIXTURES.length));
  const manifest = {
    model: args.model,
    samples: fixtures.length,
    timestamp: new Date().toISOString(),
    note: 'Dispatch each payload via Task tool (subagent_type: general-purpose, model: ' + args.model + '). For each result, parse <VERIFIER_JSON>...</VERIFIER_JSON>. Record: parse_success (bool), verdict_match_expected (bool), token_in/out, latency_ms.',
    payloads: fixtures.map(function(f){ return buildDispatchPayload(verifierPrompt, f); })
  };
  return manifest;
}

function fmtTable(rows) {
  // simple markdown table
  const header = '| metric | value |';
  const sep = '|---|---|';
  const body = rows.map(function(r){ return '| ' + r[0] + ' | ' + r[1] + ' |'; }).join('\n');
  return [header, sep, body].join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.model) {
    console.error('usage: node scripts/_prototype-measure.js --model <sonnet|haiku> [--samples N] [--out path]');
    process.exit(2);
  }

  const manifest = emitManifest(args);

  // Default output: investigation note (when run from the project root).
  const defaultOut = path.join(__dirname, '..', '.crabshell', 'investigation', 'I063-behavior-verifier-prototype-measurement.md');
  const outPath = args.out ? path.resolve(args.out) : defaultOut;

  // The script outputs the manifest to stdout in JSON form so the dispatcher
  // (user or another script) can drive the actual sub-agent calls.
  console.log(JSON.stringify(manifest, null, 2));

  // Side-effect: emit a placeholder section that the dispatcher fills in with
  // measured values (does NOT overwrite an existing investigation file).
  if (!fs.existsSync(outPath)) {
    const placeholder = '<!-- placeholder generated by _prototype-measure.js — replace with measured values -->\n\n' +
      'model: ' + args.model + '\nsamples: ' + manifest.samples + '\ngenerated: ' + manifest.timestamp + '\n\n' +
      fmtTable([
        ['parse_rate', 'TBD'],
        ['verdict_consistency', 'TBD'],
        ['fp_rate_clarification', 'TBD'],
        ['token_in_avg', 'TBD'],
        ['token_out_avg', 'TBD'],
        ['latency_p50_ms', 'TBD']
      ]);
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, placeholder, 'utf8');
    } catch (e) { /* ignore — stdout is the primary output */ }
  }
}

if (require.main === module) {
  main();
}

module.exports = { FIXTURES, buildDispatchPayload, loadVerifierPrompt, emitManifest };
