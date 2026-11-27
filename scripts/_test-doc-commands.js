'use strict';
// D187_T005: Check that every `node <script> --flag` command documented across
// skills, references, commands, README.md, and USER-MANUAL.md uses options the
// target script actually accepts. Uses the script's exported parser when it
// rejects unknown flags; otherwise checks the script's own source statically.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PARSER_EXPORT_NAMES = ['parseArgs', 'parseCli', 'parseFlags', 'parseOptions'];
const UNKNOWN_PROBE_FLAG = '--__doc_cmd_unknown_probe__';
const SHELL_SEPARATORS = new Set(['&&', '||', ';', '|', '>', '>>', '2>&1', '&>', '<']);
const WORD_PLACEHOLDERS = new Set(['PATH', 'DIR', 'FILE', 'STRING', 'NUM', 'COUNT', 'QUERY', '...', '\u2026']);

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkDir(dir, visitor) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, visitor);
    else if (entry.isFile()) visitor(full, dir, entry.name);
  }
}

function collectDocFiles(repoRoot) {
  const files = [];

  walkDir(path.join(repoRoot, 'skills'), (full, dir, name) => {
    if (name === 'SKILL.md') files.push(full);
    else if (path.basename(dir) === 'references' && name.endsWith('.md')) files.push(full);
  });

  for (const topDoc of ['USER-MANUAL.md', 'README.md']) {
    const full = path.join(repoRoot, topDoc);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) files.push(full);
  }

  const commandsDir = path.join(repoRoot, 'commands');
  if (fs.existsSync(commandsDir)) {
    for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(path.join(commandsDir, entry.name));
      }
    }
  }

  return files.sort((a, b) => toPosix(path.relative(repoRoot, a)).localeCompare(toPosix(path.relative(repoRoot, b))));
}

function discoverSkillScripts(repoRoot) {
  const byName = new Map();
  const skillsDir = path.join(repoRoot, 'skills');
  if (!fs.existsSync(skillsDir)) return byName;

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const scriptsDir = path.join(skillsDir, entry.name, 'scripts');
    if (!fs.existsSync(scriptsDir) || !fs.statSync(scriptsDir).isDirectory()) continue;
    for (const file of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.js')) continue;
      const full = path.join(scriptsDir, file.name);
      if (!byName.has(file.name)) byName.set(file.name, []);
      byName.get(file.name).push(full);
    }
  }
  return byName;
}

function stripShellComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && quote !== "'" && i + 1 < line.length) {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitShellWords(text) {
  const words = [];
  let current = '';
  let hasWord = false;
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < text.length && (text[i + 1] === '"' || text[i + 1] === '\\')) {
        current += text[++i];
      } else if (ch === '"') {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasWord) {
        words.push(current);
        current = '';
        hasWord = false;
      }
      continue;
    }
    current += ch;
    hasWord = true;
  }

  if (quote) return null;
  if (hasWord) words.push(current);
  return words;
}

function isNodeExecutable(token) {
  if (!token) return false;
  if (/^(?:node(?:\.exe)?|\{NODE_PATH\}|\$\{?NODE_PATH\}?|<node>)$/i.test(token)) return true;
  const base = toPosix(token).split('/').pop();
  return /^node(?:\.exe)?$/i.test(base);
}

function isScriptPathToken(token) {
  if (!token || token.startsWith('-')) return false;
  if (/[*;|]/.test(token)) return false;
  const norm = toPosix(token);
  if (!norm.includes('/') || !norm.toLowerCase().endsWith('.js')) return false;
  const base = path.posix.basename(norm);
  return !/[<>{}]/.test(base);
}

function isPlaceholderToken(token) {
  if (!token) return false;
  if (/^<[^>]+>$/.test(token)) return true;
  if (/^\{[^}]+\}$/.test(token)) return true;
  if (/^[A-Z]$/.test(token)) return true;
  return WORD_PLACEHOLDERS.has(token);
}

function isNumericPlaceholder(token) {
  return /^[NM]$/.test(token) || /^[<{](?:n|m|num|count)[>}]$/i.test(token);
}

function parseNodeCommand(candidate) {
  const words = splitShellWords(candidate);
  if (!words || words.length < 2) return null;

  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index++;
  if (index + 1 >= words.length) return null;
  if (!isNodeExecutable(words[index])) return null;

  const scriptToken = words[index + 1];
  if (!isScriptPathToken(scriptToken)) return null;

  const rawArgs = [];
  for (let j = index + 2; j < words.length; j++) {
    if (SHELL_SEPARATORS.has(words[j])) break;
    rawArgs.push(words[j]);
  }
  return { scriptToken, rawArgs };
}

function extractFlagsAndArgv(rawArgs) {
  // Usage brackets mark optional parts and may span tokens ("[--dry-run]", "[--model <m>]"):
  // the bracket that opens before an option and the one that closes its group are dropped.
  let openGroups = 0;
  const unwrapped = rawArgs.map(token => {
    let text = token;
    if (/^\[-/.test(text)) { text = text.slice(1); openGroups++; }
    if (openGroups > 0 && text.endsWith(']')) { text = text.slice(0, -1); openGroups--; }
    return text;
  });

  const flags = [];
  const seenFlags = new Set();
  const argv = [];
  let stopFlags = false;

  for (let i = 0; i < unwrapped.length; i++) {
    const token = unwrapped[i];
    if (!stopFlags && token === '--') {
      stopFlags = true;
      argv.push(token);
      continue;
    }

    if (!stopFlags && token.startsWith('--') && token.length > 2) {
      const eq = token.indexOf('=');
      const rawFlag = eq === -1 ? token : token.slice(0, eq);
      if (/[<>{}]/.test(rawFlag)) continue;
      if (!seenFlags.has(rawFlag)) {
        seenFlags.add(rawFlag);
        flags.push({ raw: rawFlag, name: rawFlag.slice(2), short: false });
      }
      if (eq !== -1) {
        const value = token.slice(eq + 1);
        const normalized = isPlaceholderToken(value) || /<[^>]+>|\{[^}]+\}/.test(value)
          ? (isNumericPlaceholder(value) ? '1' : 'placeholder')
          : value;
        argv.push(`${rawFlag}=${normalized}`);
      } else {
        argv.push(rawFlag);
        if (i + 1 < unwrapped.length && isPlaceholderToken(unwrapped[i + 1])) {
          argv.push('1');
          i++;
        }
      }
      continue;
    }

    if (!stopFlags && /^-[A-Za-z]$/.test(token)) {
      if (!seenFlags.has(token)) {
        seenFlags.add(token);
        flags.push({ raw: token, name: token.slice(1), short: true });
      }
      argv.push(token);
      if (i + 1 < unwrapped.length && isPlaceholderToken(unwrapped[i + 1])) {
        argv.push('1');
        i++;
      }
      continue;
    }

    if (isPlaceholderToken(token)) continue;
    argv.push(token);
  }

  return { flags, argv };
}

function extractCommandsFromMarkdown(text, docRel) {
  const commands = [];
  const lines = String(text).split(/\r?\n/);
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let fenceLang = '';

  const record = (parsed, lineNumber) => {
    if (!parsed) return;
    const { flags, argv } = extractFlagsAndArgv(parsed.rawArgs);
    if (flags.length === 0) return;
    commands.push({
      doc: docRel,
      line: lineNumber,
      scriptToken: parsed.scriptToken,
      flags,
      argv,
    });
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const lineNumber = idx + 1;
    const fenceMatch = rawLine.match(/^\s*(`{3,}|~{3,})\s*(\S*)/);

    if (!inFence && fenceMatch) {
      inFence = true;
      fenceChar = fenceMatch[1][0];
      fenceLen = fenceMatch[1].length;
      fenceLang = (fenceMatch[2] || '').toLowerCase();
      continue;
    }
    if (inFence && new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`).test(rawLine)) {
      inFence = false;
      fenceChar = '';
      fenceLen = 0;
      fenceLang = '';
      continue;
    }

    if (inFence && fenceLang === 'json') {
      const stringRe = /"((?:[^"\\]|\\.)*)"/g;
      let match;
      while ((match = stringRe.exec(rawLine)) !== null) {
        const unescaped = match[1].replace(/\\(["\\])/g, '$1');
        record(parseNodeCommand(unescaped), lineNumber);
      }
      continue;
    }

    if (inFence && /^(?:bash|sh|shell|zsh|powershell|ps1|cmd)$/.test(fenceLang)) {
      record(parseNodeCommand(stripShellComment(rawLine)), lineNumber);
      continue;
    }

    // Outside shell/json fences (prose, or unlabeled/markdown/text fences):
    // scan inline backtick spans first so trailing prose is never read as args.
    const spanRe = /`([^`]+)`/g;
    let foundInSpan = false;
    let match;
    while ((match = spanRe.exec(rawLine)) !== null) {
      const parsed = parseNodeCommand(stripShellComment(match[1]));
      if (parsed) {
        foundInSpan = true;
        record(parsed, lineNumber);
      }
    }
    if (!foundInSpan) {
      const cleaned = stripShellComment(rawLine).replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
      record(parseNodeCommand(cleaned), lineNumber);
    }
  }

  return commands;
}

function resolveScriptPath(scriptToken, repoRoot, skillScriptsByName) {
  const norm = toPosix(scriptToken).replace(/^\.\//, '');
  const rootResolved = path.resolve(repoRoot);
  const rootPrefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;

  const tryInsideRepo = relPath => {
    const full = path.resolve(repoRoot, relPath);
    if (!full.startsWith(rootPrefix)) return null;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    return null;
  };

  // 1. Direct repo-relative path (skip gitignored .crabshell/ copies so checks always hit tracked source).
  const isLocalStoragePath = /(?:^|\/)\.crabshell\//.test(norm);
  if (!isLocalStoragePath) {
    const direct = tryInsideRepo(norm);
    if (direct) return { found: true, fullPath: direct, relPath: toPosix(path.relative(repoRoot, direct)) };

    // 2. Placeholder or prefixed scripts path: {SCRIPTS_PATH}/x.js or <...>/scripts/x.js.
    const scriptsTail = norm.match(/(?:^|\/)(?:\{SCRIPTS_PATH\}|\$\{?SCRIPTS_PATH\}?|scripts)\/(.+\.js)$/i);
    if (scriptsTail) {
      const inScripts = tryInsideRepo(path.join('scripts', scriptsTail[1]));
      if (inScripts) return { found: true, fullPath: inScripts, relPath: toPosix(path.relative(repoRoot, inScripts)) };
    }
  }

  // 3. Copied skill script path (e.g. .crabshell/verification/run-verify.js -> skills/verifying/scripts/run-verify.js).
  const baseName = path.posix.basename(norm);
  const skillMatches = skillScriptsByName.get(baseName) || [];
  if (skillMatches.length === 1) {
    const full = skillMatches[0];
    return { found: true, fullPath: full, relPath: toPosix(path.relative(repoRoot, full)) };
  }

  return { found: false, relPath: norm };
}

function loadExportedParser(scriptPath, source, cache) {
  if (cache.has(scriptPath)) return cache.get(scriptPath);

  const hasExports = /\bmodule\.exports\b|\bexports\./.test(source);
  const hasMainGuard = /\brequire\.main\s*[!=]==?\s*module\b/.test(source);
  const mayExportParser = PARSER_EXPORT_NAMES.some(name => source.includes(name))
    || /\bmodule\.exports\s*=\s*require\(/.test(source);

  if (!hasExports || !hasMainGuard || !mayExportParser) {
    cache.set(scriptPath, null);
    return null;
  }

  const savedBg = process.env.CRABSHELL_BACKGROUND;
  if (savedBg === '1') delete process.env.CRABSHELL_BACKGROUND;
  try {
    const mod = require(scriptPath);
    if (mod && typeof mod === 'object') {
      for (const name of PARSER_EXPORT_NAMES) {
        if (typeof mod[name] === 'function') {
          const entry = { name, fn: mod[name] };
          cache.set(scriptPath, entry);
          return entry;
        }
      }
    }
  } catch (_) {
    // Fall back to static check when a module cannot be loaded in isolation.
  } finally {
    if (savedBg !== undefined) process.env.CRABSHELL_BACKGROUND = savedBg;
  }

  cache.set(scriptPath, null);
  return null;
}

function invokeParser(fn, argv) {
  const realExit = process.exit;
  const exitTag = Symbol('parser-exit');
  process.exit = code => {
    const err = new Error(`process.exit(${code})`);
    err[exitTag] = code;
    throw err;
  };
  try {
    const result = fn(argv.slice());
    if (result && typeof result === 'object') {
      if (result.error) return { rejected: true, reason: String(result.error) };
      if (result.ok === false) return { rejected: true, reason: String(result.message || 'parser returned ok:false') };
    }
    return { rejected: false, result };
  } catch (error) {
    if (error && Object.prototype.hasOwnProperty.call(error, exitTag)) {
      const code = error[exitTag];
      return code === 0 ? { rejected: false } : { rejected: true, reason: `exited with code ${code}` };
    }
    return { rejected: true, reason: error && error.message ? error.message : String(error) };
  } finally {
    process.exit = realExit;
  }
}

function flagInSource(source, flag) {
  const escaped = escapeRegex(flag.name);
  if (flag.short) {
    return new RegExp(`['"\`]-${escaped}(?![A-Za-z0-9_-])['"\`]`).test(source);
  }
  if (new RegExp(`(?<![A-Za-z0-9_-])--${escaped}(?![A-Za-z0-9_-])`).test(source)) return true;
  if (new RegExp(`['"\`]${escaped}['"\`]`).test(source)) return true;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(flag.name)) {
    if (new RegExp(`\\b(?:args|parsed|argv|opts|options|flags)\\.${escaped}(?![A-Za-z0-9_$])`).test(source)) {
      return true;
    }
  }
  return false;
}

function checkCommand(cmd, repoRoot, skillScriptsByName, parserCache) {
  const resolved = resolveScriptPath(cmd.scriptToken, repoRoot, skillScriptsByName);
  const allFlagText = cmd.flags.map(f => f.raw).join(' ');

  if (!resolved.found) {
    return {
      ok: false,
      mode: 'static',
      script: resolved.relPath,
      flagsText: allFlagText,
      reason: `script file not found (${cmd.scriptToken})`,
    };
  }

  const source = fs.readFileSync(resolved.fullPath, 'utf8');
  const parser = loadExportedParser(resolved.fullPath, source, parserCache);

  if (parser) {
    // Only trust an exported parser when it rejects an unknown probe flag.
    const probe = invokeParser(parser.fn, [...cmd.argv, UNKNOWN_PROBE_FLAG]);
    if (probe.rejected) {
      const actual = invokeParser(parser.fn, cmd.argv);
      if (actual.rejected) {
        return {
          ok: false,
          mode: 'parser',
          script: resolved.relPath,
          flagsText: allFlagText,
          reason: `${parser.name}: ${actual.reason}`,
        };
      }
      return {
        ok: true,
        mode: 'parser',
        script: resolved.relPath,
        flagsText: allFlagText,
      };
    }
  }

  // Static fallback: search the script's own source only (never required modules).
  const missing = cmd.flags.filter(flag => !flagInSource(source, flag));
  if (missing.length > 0) {
    return {
      ok: false,
      mode: 'static',
      script: resolved.relPath,
      flagsText: missing.map(f => f.raw).join(' '),
      reason: `option not found in ${resolved.relPath}`,
    };
  }

  return {
    ok: true,
    mode: 'static',
    script: resolved.relPath,
    flagsText: allFlagText,
  };
}

function runControls(repoRoot, skillScriptsByName, parserCache) {
  const cases = [
    {
      label: 'control (parser)',
      expectedMode: 'parser',
      line: 'node .crabshell/verification/run-verify.js --nonexistent-control-flag',
    },
    {
      label: 'control (static)',
      expectedMode: 'static',
      line: '"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory --nonexistent-control-flag --project-dir="{PROJECT_DIR}"',
    },
  ];

  const results = [];
  for (const item of cases) {
    const extracted = extractCommandsFromMarkdown(item.line, `<${item.label}>`);
    if (extracted.length !== 1) {
      results.push({
        ok: false,
        message: `${item.label}: expected 1 extracted command, got ${extracted.length}`,
      });
      continue;
    }
    const outcome = checkCommand(extracted[0], repoRoot, skillScriptsByName, parserCache);
    if (outcome.ok) {
      results.push({
        ok: false,
        message: `${item.label}: ${extracted[0].doc}:${extracted[0].line} ${outcome.script} ${outcome.flagsText} was not rejected`,
      });
    } else if (outcome.mode !== item.expectedMode) {
      results.push({
        ok: false,
        message: `${item.label}: expected mode ${item.expectedMode}, got ${outcome.mode}`,
      });
    } else {
      results.push({
        ok: true,
        message: `${item.label}: ${extracted[0].doc}:${extracted[0].line} ${outcome.script} ${outcome.flagsText} rejected (${outcome.reason})`,
      });
    }
  }
  return results;
}

function main() {
  const docFiles = collectDocFiles(REPO);
  const skillScriptsByName = discoverSkillScripts(REPO);
  const parserCache = new Map();

  let passed = 0;
  let failed = 0;
  const commands = [];

  for (const file of docFiles) {
    const rel = toPosix(path.relative(REPO, file));
    const text = fs.readFileSync(file, 'utf8');
    commands.push(...extractCommandsFromMarkdown(text, rel));
  }

  if (commands.length === 0) {
    failed++;
    console.log('FAIL: discovery: no documented node commands with options were found');
  }

  for (const cmd of commands) {
    const outcome = checkCommand(cmd, REPO, skillScriptsByName, parserCache);
    const tag = outcome.mode === 'static' ? ' (static)' : '';
    if (outcome.ok) {
      passed++;
      // No line number in a PASS name: it is the check's identity, and a doc edit that only
      // shifts lines must not read as a check that disappeared. FAIL lines carry the line.
      console.log(`PASS: ${cmd.doc} ${outcome.script} ${outcome.flagsText}${tag}`);
    } else {
      failed++;
      console.log(`FAIL: ${cmd.doc}:${cmd.line} ${outcome.script} ${outcome.flagsText}${tag}: ${outcome.reason}`);
    }
  }

  for (const control of runControls(REPO, skillScriptsByName, parserCache)) {
    if (control.ok) {
      passed++;
      console.log(`PASS: ${control.message}`);
    } else {
      failed++;
      console.log(`FAIL: ${control.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  collectDocFiles,
  discoverSkillScripts,
  stripShellComment,
  splitShellWords,
  parseNodeCommand,
  extractFlagsAndArgv,
  extractCommandsFromMarkdown,
  resolveScriptPath,
  loadExportedParser,
  invokeParser,
  flagInSource,
  checkCommand,
  runControls,
};
