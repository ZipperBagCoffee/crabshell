'use strict';

// D178: the guard record. Why each guard exists, what it is predicted to catch, its known
// misses and the user's keep decisions are hand-written in .crabshell/guard-record.json
// (tracked). What each guard did on each model is counted here: from the live fire log
// (core/guard-fires, one per project) and from blocks found in Claude session transcripts
// (--backfill). A development tool; no hook runs it.
//
//   node scripts/guard-record.js --backfill   scan the transcripts (parallel, streaming)
//   node scripts/guard-record.js --summary    per guard: reason, keep, predictions, fires per model
//   node scripts/guard-record.js --check      wired guards missing from the record (exit 1)
// Options: --project-dir <dir>, --transcripts <dir>, --workers <n>.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { fireKey, firstWords, settings, firesFile } = require('./core/guard-fires');
const { getStorageRoot, readJsonOrDefault, writeJson } = require('./utils');

const RECORD_NAME = 'guard-record.json';
const WORK_DIR = ['memory', 'guard-fires'];
const NAMED = /^Crabshell ([a-z][a-z0-9-]*):/;
const HOOK_ERROR = /^(PreToolUse|PostToolUse|PostToolUseFailure):([A-Za-z0-9_.-]+) hook error: ([\s\S]*)$/;

function parseArgs(argv) {
  const args = { mode: null, projectDir: null, transcripts: null, workers: null, scan: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--backfill' || arg === '--summary' || arg === '--check') args.mode = arg.slice(2);
    else if (arg === '--scan') args.scan = true;
    else if (arg === '--project-dir') args.projectDir = argv[++i];
    else if (arg === '--transcripts') args.transcripts = argv[++i];
    else if (arg === '--workers') args.workers = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.projectDir = path.resolve(args.projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  args.transcripts = path.resolve(args.transcripts || (process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects') : path.join(os.homedir(), '.claude', 'projects')));
  if (!Number.isInteger(args.workers) || args.workers < 1) args.workers = Math.max(1, os.cpus().length);
  return args;
}

const recordPath = projectDir => path.join(getStorageRoot(projectDir), RECORD_NAME);
const workPath = (projectDir, name) => path.join(getStorageRoot(projectDir), ...WORK_DIR, name);

const readJson = (file, fallback) => readJsonOrDefault(file, fallback) || fallback;

// Each line on its own: a broken line is skipped, the others kept.
function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { items.push(JSON.parse(line)); } catch {}
  }
  return items;
}

// ---- transcripts --------------------------------------------------------------------

function listTranscripts(root) {
  const files = [];
  const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
  for (const project of dirs(root).filter(entry => entry.isDirectory())) {
    const projectPath = path.join(root, project.name);
    for (const entry of dirs(projectPath)) {
      const full = path.join(projectPath, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
      else if (entry.isDirectory()) {
        for (const sub of dirs(path.join(full, 'subagents'))) {
          if (sub.isFile() && sub.name.endsWith('.jsonl')) files.push(path.join(full, 'subagents', sub.name));
        }
      }
    }
  }
  return files;
}

function toolResultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) return block.content.filter(part => part && part.type === 'text').map(part => part.text).join('\n');
  return '';
}

// The blocks a hook sent in one transcript entry: a Stop block is a hook_blocking_error
// attachment; a PreToolUse deny is a tool result that starts "PreToolUse:<tool> hook error: ".
function blocksIn(entry) {
  const found = [];
  if (entry.type === 'attachment' && entry.attachment && entry.attachment.type === 'hook_blocking_error') {
    const raw = entry.attachment.blockingError;
    const text = typeof raw === 'string' ? raw : raw && raw.blockingError;
    found.push(typeof text === 'string' && text
      ? { event: entry.attachment.hookEvent || entry.attachment.hookName || null, tool: null, text }
      : { unknown: true });
  }
  if (entry.type === 'user' && entry.message && Array.isArray(entry.message.content)) {
    for (const block of entry.message.content) {
      if (!block || block.type !== 'tool_result') continue;
      const match = HOOK_ERROR.exec(toolResultText(block));
      if (match) found.push({ event: match[1], tool: match[2], text: match[3], scope: block.tool_use_id || null });
    }
  }
  return found;
}

const WANTED = ['"type":"assistant"', 'hook_blocking_error', ' hook error: '];

// One transcript, streamed: each block with the model that was answering and what the model
// did next (its next message's tool calls, or text only).
async function scanFile(file, reasonWords) {
  const result = { fires: [], cwd: null, broken: 0, unknown: 0 };
  let model = null;
  let promptId = null;
  let waiting = [];
  let current = null;
  const finish = () => {
    if (!current) return;
    const next = current.tools.length ? current.tools.join(',') : current.text ? 'text-only' : 'none';
    for (const fire of current.fires) fire.next = next;
    current = null;
  };
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    // The prompt a Stop block belongs to: the latest promptId on any line (read without parsing).
    const at = line.indexOf('"promptId":"');
    if (at >= 0) promptId = line.slice(at + 12, line.indexOf('"', at + 12));
    if (result.cwd && !WANTED.some(marker => line.includes(marker))) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { result.broken++; continue; }
    if (!result.cwd && typeof entry.cwd === 'string') result.cwd = entry.cwd;
    if (entry.type === 'assistant' && entry.message) {
      const named = entry.message.model;
      if (typeof named === 'string' && named && named !== '<synthetic>') model = named;
      const id = entry.message.id || entry.uuid || null;
      if (current && current.id !== id) finish();
      if (!current && waiting.length) { current = { id, tools: [], text: false, fires: waiting }; waiting = []; }
      if (current) {
        for (const block of entry.message.content || []) {
          if (block && block.type === 'tool_use') current.tools.push(block.name);
          else if (block && block.type === 'text' && String(block.text || '').trim()) current.text = true;
        }
      }
      continue;
    }
    for (const block of blocksIn(entry)) {
      if (block.unknown) { result.unknown++; continue; }
      const match = NAMED.exec(block.text);
      const fire = { at: entry.timestamp || null, event: block.event, tool: block.tool, guard: match ? match[1] : null,
        words: firstWords(block.text, reasonWords), key: fireKey(entry.sessionId, block.event, block.scope || promptId, block.text),
        model, next: null, backfilled: true };
      result.fires.push(fire);
      waiting.push(fire);
    }
  }
  finish();
  for (const fire of waiting) fire.next = 'none';
  return result;
}

// Worker: file list on stdin, one JSON line per result on stdout.
async function scanWorker(reasonWords) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let peak = process.memoryUsage().rss;
  for (const file of JSON.parse(input || '[]')) {
    try {
      const result = await scanFile(file, reasonWords);
      process.stdout.write(JSON.stringify({ file, ...result }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ file, error: error.message }) + '\n');
    }
    peak = Math.max(peak, process.memoryUsage().rss);
  }
  process.stdout.write(JSON.stringify({ peakRss: peak }) + '\n');
}

// Files spread over the workers by size, largest first, so they finish together.
function spread(files, workers) {
  const sized = files.map(file => { try { return [file, fs.statSync(file).size]; } catch { return [file, 0]; } })
    .sort((a, b) => b[1] - a[1]);
  const buckets = Array.from({ length: Math.min(workers, Math.max(1, sized.length)) }, () => ({ files: [], bytes: 0 }));
  for (const [file, size] of sized) {
    const lightest = buckets.reduce((low, bucket) => (bucket.bytes < low.bytes ? bucket : low));
    lightest.files.push(file);
    lightest.bytes += size;
  }
  return buckets.filter(bucket => bucket.files.length);
}

function runWorker(files, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [__filename, '--scan', '--project-dir', args.projectDir],
      { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    const results = [];
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => { try { results.push(JSON.parse(line)); } catch {} });
    child.on('close', () => resolve(results));
    child.stdin.end(JSON.stringify(files));
  });
}

async function backfill(args) {
  const started = Date.now();
  const files = listTranscripts(args.transcripts);
  const outputs = (await Promise.all(spread(files, args.workers).map(bucket => runWorker(bucket.files, args)))).flat();
  const fires = [];
  const cwds = new Set();
  let broken = 0, unknown = 0, failed = 0, peakRss = process.memoryUsage().rss;
  for (const output of outputs) {
    if (output.peakRss) { peakRss = Math.max(peakRss, output.peakRss); continue; }
    if (output.error) { failed++; continue; }
    fires.push(...output.fires);
    broken += output.broken;
    unknown += output.unknown;
    if (output.cwd) cwds.add(output.cwd);
  }
  fires.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const dir = path.join(getStorageRoot(args.projectDir), ...WORK_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const lines = fires.map(fire => JSON.stringify(fire)).join('\n') + (fires.length ? '\n' : '');
  fs.writeFileSync(path.join(dir, 'backfill.jsonl'), lines);
  // Where live fire logs exist; local only (paths name projects).
  const liveLogs = [...cwds].filter(cwd => fs.existsSync(firesFile(cwd))).sort();
  writeJson(path.join(dir, 'projects.json'), { liveLogs });
  process.stderr.write(`backfill: ${files.length} transcripts, ${fires.length} blocks, ${broken} broken lines, `
    + `${unknown} blocks without text, ${failed} unreadable files, peak memory ${Math.round(peakRss / 1048576)} MB, `
    + `${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  return { files: files.length, fires: fires.length, broken, unknown, failed };
}

// ---- wired guards -------------------------------------------------------------------

// Names the hooks can write into the fire log: every check of the dispatchers, the Stop
// checks and the controller's own names, and each other script hooks.json runs.
function wiredNames() {
  const names = new Set();
  const dispatchers = [];
  const addChecks = (modulePath, keys) => {
    const loaded = require(modulePath);
    dispatchers.push(require.resolve(modulePath));
    for (const key of keys) for (const check of loaded[key] || []) if (check && check.name) names.add(check.name);
  };
  addChecks('./adapters/claude/pre-tool-use', ['CHECKS']);
  addChecks('./adapters/claude/post-tool-use', ['POST_CHECKS', 'FAILURE_CHECKS']);
  addChecks('./adapters/claude/post-tool-batch', ['CHECKS']);
  addChecks('./adapters/claude/prompt-expansion', ['CHECKS']);
  addChecks('./adapters/codex/pre-tool-use', ['CHECKS']);
  const controller = require('./completion-controller');
  for (const name of [...controller.STOP_CHECK_NAMES, ...controller.RECORDED_NAMES]) names.add(name);
  const hooks = readJson(path.join(__dirname, '..', 'hooks', 'hooks.json'), {});
  for (const groups of Object.values(hooks.hooks || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        const match = /scripts\/([\w./-]+?\.js)/.exec(String(hook.command || ''));
        if (!match) continue;
        const script = path.join(__dirname, match[1]);
        if (!dispatchers.includes(script)) names.add(path.basename(script, '.js'));
      }
    }
  }
  return [...names].sort();
}

function check(args) {
  const record = readJson(recordPath(args.projectDir), { guards: [] });
  const recorded = new Set((record.guards || []).map(guard => guard.guard));
  const missing = wiredNames().filter(name => !recorded.has(name));
  for (const name of missing) process.stdout.write(`not in the record: ${name}\n`);
  if (!missing.length) process.stdout.write('every wired guard is in the record\n');
  return missing.length ? 1 : 0;
}

// ---- summary ------------------------------------------------------------------------

function guardFor(fire, prefixes) {
  if (fire.guard) return fire.guard;
  const hit = prefixes.find(item => item && item.prefix && String(fire.words || '').startsWith(item.prefix));
  return hit ? hit.guard : null;
}

function collectFires(args) {
  const prefixes = (readJson(workPath(args.projectDir, 'groups.json'), {}).prefixes) || [];
  const liveLogs = new Set([args.projectDir, ...((readJson(workPath(args.projectDir, 'projects.json'), {}).liveLogs) || [])]);
  const live = [...liveLogs].flatMap(dir => [...readJsonl(firesFile(dir) + '.1'), ...readJsonl(firesFile(dir))]);
  const backfilled = readJsonl(workPath(args.projectDir, 'backfill.jsonl'));
  const nextByKey = new Map(backfilled.map(fire => [fire.key, fire.next]));
  const liveKeys = new Set(live.map(fire => fire.key));
  const fires = [
    ...live.map(fire => ({ ...fire, backfilled: false, next: fire.kind === 'block' ? (nextByKey.get(fire.key) || null) : null })),
    ...backfilled.filter(fire => !liveKeys.has(fire.key)).map(fire => ({ ...fire, kind: 'block', guard: guardFor(fire, prefixes) })),
  ];
  return fires;
}

const day = at => String(at || '').slice(0, 10) || '?';

function modelLines(fires, reviewedByKey) {
  const lines = [];
  const byModel = new Map();
  for (const fire of fires) {
    const model = fire.model || 'unknown model';
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(fire);
  }
  for (const [model, list] of [...byModel.entries()].sort()) {
    const seen = new Set();
    let repeats = 0;
    for (const fire of list) { if (seen.has(fire.key)) repeats++; else seen.add(fire.key); }
    const firsts = list.filter((fire, index) => list.findIndex(other => other.key === fire.key) === index);
    const liveBlocks = firsts.filter(fire => fire.kind === 'block' && !fire.backfilled).length;
    const oldBlocks = firsts.filter(fire => fire.kind === 'block' && fire.backfilled).length;
    const notices = firsts.filter(fire => fire.kind === 'notice').length;
    const dates = list.map(fire => day(fire.at)).sort();
    lines.push(`  ${model}: ${liveBlocks} live, ${oldBlocks} backfilled blocks; ${notices} notices; ${repeats} repeats (${dates[0]} to ${dates[dates.length - 1]})`);
    const blocks = firsts.filter(fire => fire.kind === 'block');
    if (blocks.length) {
      const next = { tools: 0, text: 0, unknown: 0 };
      for (const fire of blocks) {
        if (!fire.next || fire.next === 'none') next.unknown++;
        else if (fire.next === 'text-only') next.text++;
        else next.tools++;
      }
      lines.push(`    after a block: ${next.tools} called a tool, ${next.text} answered in text only, ${next.unknown} not captured`);
      const verdicts = blocks.map(fire => reviewedByKey.get(fire.key)).filter(Boolean);
      const tally = verdict => verdicts.filter(item => item === verdict).length;
      lines.push(`    reviewed ${verdicts.length} of ${blocks.length}: ${tally('caught')} caught, ${tally('false-alarm')} false alarm, ${tally('unclear')} unclear`);
    }
  }
  return lines;
}

function summary(args) {
  const record = readJson(recordPath(args.projectDir), { guards: [] });
  const reviewedByKey = new Map(readJsonl(workPath(args.projectDir, 'reviewed.jsonl')).map(item => [item.key, item.verdict]));
  const fires = collectFires(args);
  const byGuard = new Map();
  for (const fire of fires) {
    const name = fire.guard || null;
    if (!byGuard.has(name)) byGuard.set(name, []);
    byGuard.get(name).push(fire);
  }
  const out = [];
  for (const guard of record.guards || []) {
    const reasons = guard.why || [];
    const why = reasons[0];
    const later = reasons.length > 1 ? ` (+${reasons.length - 1} later)` : '';
    out.push(`${guard.guard} — ${why ? `${why.text} (${why.version}, ${why.ref})${later}` : 'no reason recorded'}`);
    if (guard.keep) out.push(`  keep: ${guard.keep.words} (${guard.keep.date})`);
    for (const item of guard.predicts || []) out.push(`  predicts: ${item.case}`);
    const own = byGuard.get(guard.guard) || [];
    byGuard.delete(guard.guard);
    if (guard.kind === 'injector') out.push('  injects every time; not a fire');
    else if (own.length) out.push(...modelLines(own, reviewedByKey));
    else out.push('  no fires recorded');
    for (const miss of guard.misses || []) out.push(`  missed: ${miss.date} ${miss.text}`);
    for (const item of guard.history || []) out.push(`  history: ${item.version} ${item.change} (${item.ref})`);
    out.push('');
  }
  for (const [name, list] of byGuard) {
    if (name === null) continue;
    out.push(`${name} — not in the record`, ...modelLines(list, reviewedByKey), '');
  }
  const unnamed = byGuard.get(null) || [];
  if (unnamed.length) {
    out.push('Blocks not matched to a guard (add a prefix to .crabshell/memory/guard-fires/groups.json):');
    const groups = new Map();
    for (const fire of unnamed) groups.set(fire.words, (groups.get(fire.words) || 0) + 1);
    for (const [words, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) out.push(`  ${count}  ${words}`);
  }
  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.scan) return scanWorker(settings(args.projectDir).reasonWords);
  if (args.mode === 'backfill') { await backfill(args); return 0; }
  if (args.mode === 'summary') return summary(args);
  if (args.mode === 'check') return check(args);
  process.stderr.write('Usage: node scripts/guard-record.js --backfill | --summary | --check [--project-dir <dir>] [--transcripts <dir>] [--workers <n>]\n');
  return 2;
}

if (require.main === module) {
  main().then(code => { if (typeof code === 'number') process.exitCode = code; })
    .catch(error => { process.stderr.write(`guard-record: ${error.message}\n`); process.exitCode = 2; });
}

module.exports = { blocksIn, listTranscripts, main, scanFile, wiredNames };
