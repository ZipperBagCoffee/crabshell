'use strict';
// fail-before (opt-in, --fail-before): a changed test must fail on the source it was
// written against.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { toPosix, entryTestFile } = require('./manifest');
const { hashBuffer } = require('./fingerprint');
const { insideRoot } = require('./trace');
const { exemptPath, EXEMPT_FILE } = require('./store');
const { covers, withoutRunnerFiles, gitVisibleFiles } = require('./select');
const { runEntry } = require('./execute');
const { pathOf } = require('./used-report');

// HEAD written into fresh folders through a temporary index, so the repository, its
// index and the working tree are never touched.
function headCheckout(projectRoot, workDir) {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(workDir, 'index') };
  const git = args => spawnSync('git', args, { cwd: projectRoot, env, encoding: 'utf8', windowsHide: true });
  const read = git(['read-tree', 'HEAD']);
  if (read.status !== 0) return { error: `cannot read HEAD: ${(read.stderr || (read.error && read.error.message) || '').trim()}` };
  const prefix = git(['rev-parse', '--show-prefix']);
  const inside = prefix.status === 0 ? prefix.stdout.trim() : '';
  let count = 0;
  return {
    extract() {
      const dir = path.join(workDir, `head-${++count}`);
      const result = git(['checkout-index', '--all', '--force', `--prefix=${toPosix(dir)}/`]);
      if (result.status !== 0) throw new Error(`git checkout-index failed: ${(result.stderr || '').trim()}`);
      return path.join(dir, inside);
    }
  };
}

function failureSummary(result) {
  return String(result.error || '').split('; stderr:')[0].slice(0, 200);
}

// A changed test that passes now and reads a changed file that is not a test (source,
// or a document the test checks) also runs on HEAD, where it must fail: a test that
// passes on the old source too does not check this change. The HEAD version of the
// test runs there first and must pass, so a failure on HEAD is the change's doing and
// not the copy's.
function failBeforeTargets({ entries, records, changedFiles, expanded, projectRoot, manifestPath, layout }) {
  const changed = new Set(withoutRunnerFiles(changedFiles, projectRoot, manifestPath, layout));
  const testFiles = new Set(expanded.map(entry => entryTestFile(entry, projectRoot)).filter(Boolean));
  const targets = [];
  for (const entry of entries) {
    const test = entryTestFile(entry, projectRoot);
    if (!test || !changed.has(test)) continue;
    // An item a check reported stands for its file here.
    const files = [...new Set(((records[entry.id] || {}).files || []).map(pathOf))];
    const sources = [...changed].filter(file => !testFiles.has(file) && files.some(recorded => covers(recorded, file)));
    if (sources.length > 0) targets.push({ entry, test, files, sources });
  }
  return targets;
}

function failBeforeExemptions(manifestPath) {
  try { return JSON.parse(fs.readFileSync(exemptPath(manifestPath), 'utf8')) || {}; } catch (_) { return {}; }
}

function matchingExemption(exemption, hash) {
  return exemption && exemption.sha256 === hash && typeof exemption.reason === 'string' && exemption.reason.trim();
}

function failBeforeChecks({ entries, results, records, changedFiles, expanded, projectRoot, manifestPath, layout }) {
  const passed = new Set(results.filter(result => result.status === 'PASS').map(result => result.id));
  const targets = failBeforeTargets({ entries: entries.filter(entry => passed.has(entry.id)), records,
    changedFiles, expanded, projectRoot, manifestPath, layout });
  if (targets.length === 0) return [];
  const exemptions = failBeforeExemptions(manifestPath);
  const exemptRelative = insideRoot(projectRoot, exemptPath(manifestPath)) || EXEMPT_FILE;
  const visible = gitVisibleFiles(projectRoot);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-fail-before-'));
  const out = [];
  try {
    const head = headCheckout(projectRoot, workDir);
    for (const { entry, test, files, sources } of targets) {
      const started = process.hrtime.bigint();
      const report = (status, text) => out.push({
        id: `FAIL_BEFORE:${entry.id}`, type: 'fail-before', status, test, sources,
        durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
        ...(status === 'FAIL' ? { error: text } : { message: text }),
        failureClass: status === 'FAIL' ? 'fail-before' : null
      });
      try {
        const hash = hashBuffer(fs.readFileSync(path.join(projectRoot, test)));
        const exemption = exemptions[test];
        if (matchingExemption(exemption, hash)) {
          report('PASS', `exempt: ${exemption.reason.trim()}`);
          continue;
        }
        if (head.error) { report('manual', `${head.error}, so it cannot be compared with HEAD`); continue; }
        // Files git ignores that the test reads (runtime state, a generated manifest)
        // are not in HEAD, so they are copied as they are now. New files are part of
        // the change and stay out.
        const prepare = () => {
          const root = head.extract();
          for (const file of files) {
            if (file.endsWith('/') || !visible || visible.has(file)) continue;
            const from = path.join(projectRoot, file);
            if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.copyFileSync(from, path.join(root, file));
          }
          return root;
        };
        let root = prepare();
        let baseline = null;
        if (fs.existsSync(path.join(root, test))) {
          baseline = runEntry(entry, { projectRoot: root });
          if (baseline.status !== 'PASS') {
            report('manual', `the HEAD version of ${test} already fails on HEAD, so a failure there says nothing about this change: ${failureSummary(baseline)}`);
            continue;
          }
          root = prepare();
        }
        fs.mkdirSync(path.dirname(path.join(root, test)), { recursive: true });
        fs.copyFileSync(path.join(projectRoot, test), path.join(root, test));
        const attempt = runEntry(entry, { projectRoot: root });
        const stale = exemption ? ` (the exemption in ${exemptRelative} is for other content of this test)` : '';
        if (attempt.status === 'PASS') {
          report('FAIL', `passes on HEAD too, so it does not catch the change to ${sources.join(', ')}${stale}. If the change keeps behavior on purpose, record in ${exemptRelative}: {"${test}": {"sha256": "${hash}", "reason": "<why>"}}`);
        } else if (!baseline && ['missing-file', 'env-incompatible'].includes(attempt.failureClass)) {
          report('manual', `new test that cannot run on HEAD (${attempt.failureClass}), so whether it catches the change is unknown: ${failureSummary(attempt)}`);
        } else {
          report('PASS', `fails on HEAD${baseline ? ' (where its HEAD version passes)' : ''} and passes now, so it catches the change: ${failureSummary(attempt)}`);
        }
      } catch (error) {
        report('manual', `could not run on HEAD: ${error.message}`);
      }
    }
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
  return out;
}

module.exports = { headCheckout, failureSummary, failBeforeTargets, failBeforeExemptions, matchingExemption, failBeforeChecks };
