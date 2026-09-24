'use strict';

// Static analysis of one shell command: which .crabshell paths it names and whether
// each would be written. It reads the command the way bash does (quotes, escapes,
// comments, heredocs, redirects, pipelines, command substitution) and follows code
// handed to interpreters (node -e, python heredocs, bash -c, cmd /c). A path built
// from a variable set in an earlier command cannot be known here; it is returned
// as written text and the caller decides what an unresolved path means.

const path = require('path');

const WINDOWS = process.platform === 'win32';
// A .crabshell path segment (Windows folders ignore case), and a looser test for
// "this text mentions the folder at all".
const CRABSHELL = WINDOWS ? /\.crabshell(?:[/\\]|$)/i : /\.crabshell(?:[/\\]|$)/;
const MENTIONS = WINDOWS ? /\.crabshell/i : /\.crabshell/;
const MAX_COMMAND_LENGTH = 1024 * 1024;
const MAX_DEPTH = 3;

// Commands whose path operands are all changed (created, removed, moved, modified).
const WRITING_VERBS = new Set([
  'rm', 'rmdir', 'unlink', 'shred', 'mv', 'mkdir', 'touch', 'tee', 'truncate', 'chmod', 'chown', 'chgrp',
  'curl', 'wget', 'aria2c',
  'del', 'erase', 'rd', 'md', 'ren', 'move',
  'set-content', 'add-content', 'out-file', 'new-item', 'remove-item', 'clear-content', 'move-item', 'rename-item',
]);
// Commands that read their sources and write the last operand (or the -t folder).
const DESTINATION_VERBS = new Set(['cp', 'rsync', 'install', 'ln', 'scp', 'copy', 'xcopy', 'robocopy', 'copy-item']);
const IN_PLACE_VERBS = new Set(['sed', 'perl']);
const COMMAND_PREFIXES = new Set(['sudo', 'env', 'command', 'builtin', 'nohup', 'time', 'exec', 'xargs', 'nice', 'stdbuf',
  'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'perl', 'ruby', 'deno', 'bun', 'php']);

// --- parsing ---------------------------------------------------------------

// Index of the ")" closing the "$(" whose "(" is at src[open].
function substitutionEnd(src, open) {
  let depth = 1, quote = null;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') i++;
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return src.length;
}

// Returns pipelines: arrays of segments { words: [{ text, redirect: 'out'|'in'|null }],
// heredocs: [text], substitutions: [text] }. Segments in one pipeline are joined by "|".
function parseShell(command) {
  const src = String(command);
  const pipelines = [];
  let pipeline = [];
  let segment = null;
  let word = '', started = false, quote = null, redirect = null, digitsOnly = true;
  const pendingHeredocs = [];
  const newSegment = () => ({ words: [], heredocs: [], substitutions: [] });
  segment = newSegment();
  const endWord = () => {
    if (started) {
      segment.words.push({ text: word, redirect });
      redirect = null;
    }
    word = ''; started = false; digitsOnly = true;
  };
  const endSegment = () => {
    endWord();
    if (segment.words.length || segment.heredocs.length || segment.substitutions.length) pipeline.push(segment);
    segment = newSegment();
    redirect = null;
  };
  const endPipeline = () => {
    endSegment();
    if (pipeline.length) pipelines.push(pipeline);
    pipeline = [];
  };
  const addChar = char => { word += char; started = true; if (!/\d/.test(char)) digitsOnly = false; };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote === "'") {
      if (c === "'") quote = null; else addChar(c);
      continue;
    }
    if (c === '$' && src[i + 1] === '(' && src[i + 2] !== '(') {
      const end = substitutionEnd(src, i + 1);
      segment.substitutions.push(src.slice(i + 2, end));
      addChar(src.slice(i, end + 1));
      digitsOnly = false;
      i = end;
      continue;
    }
    if (c === '`') {
      let end = i + 1;
      while (end < src.length && src[end] !== '`') end += src[end] === '\\' ? 2 : 1;
      segment.substitutions.push(src.slice(i + 1, end));
      addChar(src.slice(i, end + 1));
      i = end;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && '$`"\\\n'.includes(src[i + 1] || '')) { i++; if (src[i] !== '\n') addChar(src[i]); }
      else addChar(c);
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; digitsOnly = false; continue; }
    if (c === '\\') {
      i++;
      if (src[i] === '\r' && src[i + 1] === '\n') i++;
      else if (i < src.length && src[i] !== '\n') addChar(src[i]);
      continue;
    }
    if (c === '#' && !started) { while (i + 1 < src.length && src[i + 1] !== '\n') i++; continue; }
    if (c === '<' && src[i + 1] === '<') {
      endWord();
      if (src[i + 2] === '<') {
        // Here-string: the next word is input data (code for an interpreter).
        let j = i + 3;
        while (src[j] === ' ' || src[j] === '\t') j++;
        const rest = parseHereString(src, j);
        segment.heredocs.push(rest.text);
        i = rest.end;
        continue;
      }
      const opener = /^<<(-?)[ \t]*\\?(['"]?)([A-Za-z_][\w.-]*)\2/.exec(src.slice(i, i + 200));
      if (opener) { pendingHeredocs.push({ delimiter: opener[3], segment }); i += opener[0].length - 1; }
      else i++;
      continue;
    }
    if (c === '\n') {
      endPipeline();
      while (pendingHeredocs.length) {
        const heredoc = pendingHeredocs.shift();
        const body = [];
        while (i + 1 < src.length) {
          let lineEnd = src.indexOf('\n', i + 1);
          if (lineEnd < 0) lineEnd = src.length;
          const line = src.slice(i + 1, lineEnd).replace(/\r$/, '');
          i = lineEnd;
          if (line.trim() === heredoc.delimiter) break;
          body.push(line);
        }
        heredoc.segment.heredocs.push(body.join('\n'));
      }
      continue;
    }
    if (c === '>' || (c === '<' && src[i + 1] !== '<') || (c === '&' && src[i + 1] === '>')) {
      // "2>file": a word of digits right before the operator is a file descriptor.
      if (started && digitsOnly) { word = ''; started = false; }
      endWord();
      if (c === '&') i++;
      const input = c === '<';
      if (src[i + 1] === '>' || src[i + 1] === '|') i++;
      if (!input && src[i + 1] === '&') {
        i++;
        // ">&2" duplicates a descriptor; ">& file" redirects to a file.
        if (/[\d-]/.test(src[i + 1] || '')) { while (/[\d-]/.test(src[i + 1] || '')) i++; continue; }
      }
      redirect = input ? 'in' : 'out';
      continue;
    }
    if (c === '|') {
      endSegment();
      if (src[i + 1] === '|') { i++; endPipeline(); }
      else if (src[i + 1] === '&') i++;
      continue;
    }
    if (c === ';' || c === '&' || c === '(' || c === ')') {
      endPipeline();
      if ((c === '&' || c === ';') && src[i + 1] === c) i++;
      continue;
    }
    if (/\s/.test(c)) { endWord(); continue; }
    addChar(c);
  }
  endPipeline();
  return pipelines;
}

// The data word after "<<<", quoted or not; returns its text and last index.
function parseHereString(src, start) {
  const open = src[start];
  if (open === '"' || open === "'") {
    let end = start + 1, text = '';
    while (end < src.length && src[end] !== open) {
      if (open === '"' && src[end] === '\\' && end + 1 < src.length) end++;
      text += src[end++];
    }
    return { text, end };
  }
  let end = start;
  while (end < src.length && !/[\s;|&]/.test(src[end])) end++;
  return { text: src.slice(start, end), end: end - 1 };
}

// --- words and paths -------------------------------------------------------

function commandName(text) {
  return path.basename(String(text).replace(/\\/g, '/')).replace(/\.exe$/i, '').toLowerCase();
}

// A word naming a filesystem path that contains .crabshell (globs allowed), not prose,
// a regex, or a fragment to be joined to an unknown prefix.
function isPathToken(text) {
  if (!CRABSHELL.test(text) || /[\r\n^|()]/.test(text) || /^\\\./.test(text)) return false;
  if (/^[/\\]+\.crabshell/i.test(text)) return false;
  return /^(?:[A-Za-z]:[/\\]|[/\\~$]|\.{1,2}[/\\]|\.crabshell)/i.test(text) || /^[\w.@+-]+[/\\]/.test(text);
}

// Split "key=value" and "--option=value" words; the value is the path.
function wordValue(text) {
  const match = /^(--?[\w-]+|[A-Za-z_]\w*)=(.+)$/.exec(text);
  return match ? { key: match[1].replace(/^-+/, ''), value: match[2] } : { key: null, value: text };
}

// Replace $NAME / ${NAME} with values assigned earlier in the same command.
function expand(text, vars) {
  let results = [text];
  for (const [name, values] of vars) {
    const pattern = new RegExp(`\\$(?:${name}\\b|\\{${name}\\})`, 'g');
    if (!pattern.test(text)) continue;
    results = results.flatMap(item => values.map(value => item.replace(pattern, () => value)));
    if (results.length > 64) break;
  }
  return results;
}

// --- per-command rules -----------------------------------------------------

function describe(segment) {
  const plain = segment.words.filter(w => !w.redirect);
  let index = 0, viaXargs = false;
  while (plain[index]) {
    const text = plain[index].text;
    if (/^[A-Za-z_]\w*=/.test(text)) { index++; continue; }
    if (COMMAND_PREFIXES.has(text)) {
      if (text === 'xargs') viaXargs = true;
      index++;
      while (plain[index] && /^-/.test(plain[index].text)) index++;
      continue;
    }
    break;
  }
  const verbWord = plain[index] || null;
  return {
    plain,
    verbWord,
    leading: new Set(plain.slice(0, index + 1)),
    verb: verbWord ? commandName(verbWord.text) : '',
    args: plain.slice(index + 1),
    viaXargs,
  };
}

// Words that are sed/perl scripts, not files.
function scriptWords(verb, args) {
  const scripts = new Set();
  if (!IN_PLACE_VERBS.has(verb)) return scripts;
  let explicit = false;
  args.forEach((w, i) => {
    if (/^(?:-[a-zA-Z]*[eE]|--expression)$/.test(w.text) && args[i + 1]) { scripts.add(args[i + 1]); explicit = true; }
  });
  if (!explicit && verb === 'sed') {
    const first = args.find(w => !w.text.startsWith('-'));
    if (first) scripts.add(first);
  }
  return scripts;
}

function destinationWord(verb, args) {
  if (!DESTINATION_VERBS.has(verb)) return null;
  const target = args.findIndex(w => /^(?:-t|--target-directory|-destination)$/i.test(w.text));
  if (target >= 0) return args[target + 1] || null;
  const attached = args.find(w => /^--target-directory=/.test(w.text));
  if (attached) return attached;
  const operands = args.filter(w => !w.text.startsWith('-'));
  return operands.length > 1 ? operands[operands.length - 1] : null;
}

function segmentWrites(info) {
  const { verb, args } = info;
  if (WRITING_VERBS.has(verb)) return () => true;
  if (IN_PLACE_VERBS.has(verb) && args.some(w => /^-[a-zA-Z]*i|^--in-place/.test(w.text))) return () => true;
  if (verb === 'tar' && args.some((w, i) => /^--(?:extract|create|append|update|get|delete)$/.test(w.text)
      || ((w.text.startsWith('-') || i === 0) && /^-?[a-zA-Z]{1,8}$/.test(w.text) && /[xcru]/.test(w.text)))) return () => true;
  if (verb === 'find') {
    const execIndex = args.findIndex(w => /^-(?:exec|execdir|ok|okdir)$/.test(w.text));
    const deletes = args.some(w => w.text === '-delete')
      || (execIndex >= 0 && args[execIndex + 1] && WRITING_VERBS.has(commandName(args[execIndex + 1].text)));
    return () => deletes;
  }
  const destination = destinationWord(verb, args);
  return (word, key) => word === destination || (verb === 'dd' && key === 'of');
}

// --- code handed to interpreters -------------------------------------------

const CODE_LITERAL = /([rRbBuUfF]{0,2})(['"`])((?:\\[^\r\n]|(?!\2)[^\\\r\n])*)\2/g;
const WRITE_CALL_BEFORE = /\b(?:writeFile|appendFile|createWriteStream|unlink|rmdir|rm|mkdir|mkdtemp|truncate|utimes|chmod|chown|symlink|link|rename|move|remove|removedirs|makedirs|rmtree|touch|write_text|write_bytes)(?:Sync)?\s*\(\s*$/;
const DESTINATION_CALL_BEFORE = /\b(?:copyFile|cp|copy|copy2|copyfile|copytree|rename|move|symlink|link)(?:Sync)?\s*\([^()]{0,300},\s*$/;
const OPEN_BEFORE = /\bopen(?:Sync)?\s*\(\s*$/;
const OPEN_MODE_AFTER = /^\s*,\s*(?:(?:mode|flags)\s*=\s*)?(['"`])(?=[rbtwax+]{1,4}\1)[rbt]*[wax+]/;
const PATH_BEFORE = /\b(?:Path|PurePath)\s*\(\s*$/;
const PATH_WRITE_AFTER = /^\s*\)\s*\.\s*(?:write_text|write_bytes|unlink|mkdir|rmdir|touch|rename|replace|symlink_to|chmod)\b/;
const RUNS_COMMANDS = /\b(?:execSync|execFileSync|execFile|exec|spawnSync|spawn|fork|system|popen|Popen|subprocess|check_call|check_output)\b/;

function analyzeCode(code, depth, vars) {
  if (!MENTIONS.test(code)) return [];
  const literals = [];
  let match;
  CODE_LITERAL.lastIndex = 0;
  while ((match = CODE_LITERAL.exec(code)) !== null) {
    literals.push({ prefix: match[1].toLowerCase(), raw: match[3], start: match.index, end: match.index + match[0].length });
  }
  const runsWritingCommand = RUNS_COMMANDS.test(code)
    && literals.some(l => WRITING_VERBS.has(commandName(l.raw.trim().split(/\s+/)[0] || '')));
  const found = [];
  for (const literal of literals) {
    if (!CRABSHELL.test(literal.raw)) continue;
    const value = literal.prefix.includes('r') ? literal.raw : literal.raw.replace(/\\(.)/g, '$1');
    if (literal.prefix.includes('f') && /\{/.test(value)) continue;
    const before = code.slice(Math.max(0, literal.start - 320), literal.start);
    const after = code.slice(literal.end, literal.end + 80);
    // Joined to something unknown ("dir + '/.crabshell/x'"): cannot be judged.
    if (/\+\s*$/.test(before) || /^\s*\+/.test(after)) continue;
    if (/\s/.test(value.trim()) && /^\s*[\w.-]+(?:\s|$)/.test(value) && !isPathToken(value.trim())) {
      if (depth < MAX_DEPTH) found.push(...analyzeBashCommand(value, depth + 1, vars));
      continue;
    }
    if (!isPathToken(value)) continue;
    const write = runsWritingCommand
      || WRITE_CALL_BEFORE.test(before)
      || DESTINATION_CALL_BEFORE.test(before)
      || (OPEN_BEFORE.test(before) && OPEN_MODE_AFTER.test(after))
      || (PATH_BEFORE.test(before) && PATH_WRITE_AFTER.test(after));
    found.push({ path: value, write });
  }
  return found;
}

// cmd.exe and PowerShell strings: backslashes are literal, quotes group words.
function analyzeWindowsCommand(text) {
  const found = [];
  for (const statement of String(text).split(/[;&|\n]+/)) {
    const words = [];
    const pattern = /"([^"]*)"|'([^']*)'|(>{1,2})\s*|([^\s"']+)/g;
    let match, redirectNext = false;
    while ((match = pattern.exec(statement)) !== null) {
      if (match[3]) { redirectNext = true; continue; }
      words.push({ text: match[1] ?? match[2] ?? match[4], redirect: redirectNext ? 'out' : null });
      redirectNext = false;
    }
    const info = describe({ words });
    const writes = segmentWrites(info);
    for (const w of words) {
      if (info.leading.has(w) || !isPathToken(w.text)) continue;
      found.push({ path: w.text, write: w.redirect === 'out' || writes(w, null) });
    }
  }
  return found;
}

// --- entry point -----------------------------------------------------------

// Returns [{ path, write }] for every .crabshell path the command names.
function analyzeBashCommand(command, depth = 0, vars = new Map()) {
  if (typeof command !== 'string' || !command || command.length > MAX_COMMAND_LENGTH || !MENTIONS.test(command)) return [];
  const found = [];
  for (const pipeline of parseShell(command)) {
    const infos = pipeline.map(describe);
    // "... | xargs rm": paths listed upstream are the ones removed.
    const xargsWriter = infos.findIndex(info => info.viaXargs && WRITING_VERBS.has(info.verb));
    pipeline.forEach((segment, index) => {
      const info = infos[index];
      if (!info.verbWord && info.plain.length) {
        for (const w of info.plain) {
          const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(w.text);
          if (assignment) vars.set(assignment[1], [assignment[2]]);
        }
      }
      if (info.verb === 'export') {
        for (const w of info.args) {
          const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(w.text);
          if (assignment) vars.set(assignment[1], [assignment[2]]);
        }
      }
      if (info.verb === 'for' && info.args[1] && info.args[1].text === 'in') {
        vars.set(info.args[0].text, info.args.slice(2).map(w => w.text));
        return;
      }
      const writes = segmentWrites(info);
      const scripts = scriptWords(info.verb, info.args);
      const upstreamWrite = xargsWriter > index;
      const isShell = SHELLS.has(info.verb), isPowerShell = POWERSHELLS.has(info.verb), isCmd = info.verb === 'cmd';
      const isInterpreter = INTERPRETERS.has(info.verb);
      for (const w of segment.words) {
        if (info.leading.has(w) || scripts.has(w) || (!MENTIONS.test(w.text) && !w.text.includes('$'))) continue;
        if (isCmd || isPowerShell) { if (!w.redirect) found.push(...analyzeWindowsCommand(w.text)); continue; }
        // An interpreter argument with spaces or statements is code, not a file name.
        if ((isShell || isInterpreter) && !w.redirect && /[\s;]/.test(w.text.trim())) {
          if (depth < MAX_DEPTH) found.push(...(isShell ? analyzeBashCommand(w.text, depth + 1, vars) : analyzeCode(w.text, depth + 1, vars)));
          continue;
        }
        const { key, value } = wordValue(w.text);
        for (const text of expand(value, vars)) {
          if (isPathToken(text)) {
            found.push({ path: text, write: w.redirect === 'out' || (w.redirect !== 'in' && (writes(w, key) || upstreamWrite)) });
          } else if (isInterpreter && !w.redirect && depth < MAX_DEPTH && MENTIONS.test(text)) {
            found.push(...analyzeCode(text, depth + 1, vars));
          }
        }
      }
      // Heredoc bodies are code for the interpreter that reads them, here or downstream.
      const reader = infos.slice(index).find(item => SHELLS.has(item.verb) || INTERPRETERS.has(item.verb)
        || POWERSHELLS.has(item.verb));
      for (const body of segment.heredocs) {
        if (!reader || depth >= MAX_DEPTH) continue;
        if (SHELLS.has(reader.verb)) found.push(...analyzeBashCommand(body, depth + 1, vars));
        else if (POWERSHELLS.has(reader.verb)) found.push(...analyzeWindowsCommand(body));
        else found.push(...analyzeCode(body, depth + 1, vars));
      }
      for (const inner of segment.substitutions) {
        if (depth < MAX_DEPTH) found.push(...analyzeBashCommand(inner, depth + 1, vars));
      }
    });
  }
  return found;
}

module.exports = { analyzeBashCommand, isPathToken, parseShell };
