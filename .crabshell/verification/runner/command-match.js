'use strict';
// Which of a project's declared commands a shell command line runs, for decisions that
// block or wait (D175): the overlap guard and the runner's checks on other runs. Unlike the
// completion-evidence matcher (scripts/core/command-observation.js checkInvocation), it
// reads every command of a composed line (pipes, `;`, `&&`, PowerShell statements),
// because a command that runs at all can overlap, whatever exit status the line reports.
// It lives in the runner folder because the runner is copied into other projects, where
// the plugin's scripts/ folder is not available; it needs nothing but Node itself.
// Every function returns an empty or false result on bad input and never throws.

const os = require('os');
const path = require('path');

// A program's name as the shell finds it: its file name, without an extension the
// system runs by itself (PATHEXT, where the system has one), case-folded where file
// names ignore case. The plugin's hooks keep the same rule (scripts/core/command-observation.js):
// they must work without this folder; _test-command-match.js checks the two agree.
function programName(token) {
  if (token === null || token === undefined) return '';
  try {
    let name = path.basename(String(token).replace(/\\/g, '/'));
    const extension = path.extname(name).toLowerCase();
    const runnable = String(process.env.PATHEXT || '').split(';').map(item => item.trim().toLowerCase()).filter(Boolean);
    if (extension && runnable.includes(extension)) name = name.slice(0, -extension.length);
    return process.platform === 'win32' ? name.toLowerCase() : name;
  } catch (_) { return ''; }
}

// Git Bash spells C:\x as /c/x.
function hostPath(dir) {
  return process.platform === 'win32' && /^\/[a-z](?:\/|$)/i.test(dir) ? `${dir[1]}:${dir.slice(2) || '/'}` : dir;
}

// --- Reading a command line ---------------------------------------------------------
// One pass over the text, shared by POSIX shells and PowerShell as far as it decides which
// words a command runs with. It yields words ({ value, quotedAt }: quotedAt is where the
// first quoted part starts in value, -1 when nothing was quoted) and operators ({ op }:
// 'sep' ends a command, 'open'/'close' a parenthesized group, 'amp' a lone `&`,
// 'redirect' a redirection, with operand true when the next word is its file).
// A backslash is literal (a Windows path keeps its separators) except before a line end
// (continuation), a space, a tab or a quote; a backtick before a line end is a
// PowerShell continuation.

const REDIRECT = /^(?:>>?\|?|<>?)(?:&(?:\d+|-))?/;
const SPECIAL = new Set(["'", '"', '\\', '`', '\n', '#', '$', '@', '<', '>', '&', '|', ';', '(', ')']);

function lineEnd(text, at) {
  if (text[at] === '\n') return 1;
  return text[at] === '\r' && text[at + 1] === '\n' ? 2 : 0;
}

function closing(text, start, quote) {
  const end = text.indexOf(quote, start);
  return end < 0 ? text.length : end;
}

// `$(…)` from just after its `(`: the index after the matching `)`.
function substitutionEnd(text, start) {
  let depth = 1;
  let at = start;
  while (at < text.length) {
    const char = text[at];
    if (char === "'") at = closing(text, at + 1, "'") + 1;
    else if (char === '"') at = doubleQuoted(text, at + 1).end;
    else {
      if (char === '(') depth++;
      else if (char === ')' && --depth === 0) return at + 1;
      at++;
    }
  }
  return text.length;
}

// A double-quoted string from just after its opening quote: its value and the index after
// the closing quote. `\"` and `` `" `` stand for a quote; a `$(…)` inside is kept whole.
function doubleQuoted(text, start) {
  let value = '';
  let at = start;
  while (at < text.length && text[at] !== '"') {
    if ((text[at] === '\\' || text[at] === '`') && text[at + 1] === '"') { value += '"'; at += 2; }
    else if (text[at] === '$' && text[at + 1] === '(') { const end = substitutionEnd(text, at + 2); value += text.slice(at, end); at = end; }
    else { value += text[at]; at++; }
  }
  return { value, end: at + 1 };
}

// A heredoc operator (`<<WORD`, `<<-WORD`, `<<'WORD'`) from just after `<<`: its body,
// which starts after the next line end, is skipped there.
function heredocStart(text, start, heredocs) {
  let at = start;
  const tabs = text[at] === '-';
  if (tabs) at++;
  while (text[at] === ' ' || text[at] === '\t') at++;
  let delimiter = '';
  while (at < text.length && !/[\s;&|<>()]/.test(text[at])) {
    const char = text[at];
    if (char === "'" || char === '"') { const end = closing(text, at + 1, char); delimiter += text.slice(at + 1, end); at = end + 1; }
    else if (char === '\\') { delimiter += text[at + 1] || ''; at += 2; }
    else { delimiter += char; at++; }
  }
  if (delimiter) heredocs.push({ delimiter, tabs });
  return at;
}

function skipHeredocBodies(text, start, heredocs) {
  let at = start;
  while (heredocs.length) {
    const { delimiter, tabs } = heredocs.shift();
    while (at < text.length) {
      const end = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at);
      let line = text.slice(at, end).replace(/\r$/, '');
      if (tabs) line = line.replace(/^\t+/, '');
      at = end + 1;
      if (line === delimiter) break;
    }
  }
  return Math.min(at, text.length);
}

function lex(text) {
  const items = [];
  const heredocs = [];
  let word = null;
  let at = 0;
  const append = (chars, quoted) => {
    if (!word) word = { value: '', quotedAt: -1 };
    if (quoted && word.quotedAt < 0) word.quotedAt = word.value.length;
    word.value += chars;
  };
  const flush = () => { if (word) items.push(word); word = null; };
  const operator = (op, operand = false) => { flush(); items.push({ op, operand }); };
  while (at < text.length) {
    const char = text[at];
    const next = text[at + 1];
    if (char === "'") { const end = closing(text, at + 1, "'"); append(text.slice(at + 1, end), true); at = end + 1; }
    else if (char === '"') { const quoted = doubleQuoted(text, at + 1); append(quoted.value, true); at = quoted.end; }
    else if ((char === '\\' || char === '`') && lineEnd(text, at + 1)) at += 1 + lineEnd(text, at + 1);
    else if (char === '\\' && /[ \t'"]/.test(next || '')) { append(next, true); at += 2; }
    else if (char === '\n') { operator('sep'); at = skipHeredocBodies(text, at + 1, heredocs); }
    else if (/\s/.test(char)) { flush(); at++; }
    else if (char === '#' && !word) at = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at);
    else if (char === '$' && next === '(') { const end = substitutionEnd(text, at + 2); append(text.slice(at, end), false); at = end; }
    else if (char === '@' && (next === "'" || next === '"') && !word && lineEnd(text, at + 2)) {
      // A PowerShell here-string: @' or @" at a line end, closed by '@ or "@ at a line start.
      const bodyStart = at + 2 + lineEnd(text, at + 2);
      const close = text.indexOf(`\n${next}@`, bodyStart - 1);
      append(close < bodyStart ? '' : text.slice(bodyStart, close).replace(/\r$/, ''), true);
      at = close < 0 ? text.length : close + 3;
    }
    else if (text.startsWith('<<<', at)) { operator('redirect', true); at += 3; }
    else if (text.startsWith('<<', at)) { operator('redirect'); at = heredocStart(text, at + 2, heredocs); }
    else if (char === '>' || char === '<') {
      // A word of digits or `*` right before it names the stream (2>, *>), not an argument.
      if (word && word.quotedAt < 0 && /^(?:\d+|\*)$/.test(word.value)) word = null;
      const match = REDIRECT.exec(text.slice(at));
      operator('redirect', !match[0].includes('&'));
      at += match[0].length;
    }
    else if (char === '&' && next === '>') { const match = /^&>>?/.exec(text.slice(at)); operator('redirect', true); at += match[0].length; }
    else if ((char === '&' && next === '&') || (char === '|' && (next === '|' || next === '&'))) { operator('sep'); at += 2; }
    else if (char === '&') { operator('amp'); at++; }
    else if (char === '|' || char === ';') { operator('sep'); at++; }
    else if (char === '(' || char === ')') { operator(char === '(' ? 'open' : 'close'); at++; }
    else {
      let end = at + 1;
      while (end < text.length && !SPECIAL.has(text[end]) && !/\s/.test(text[end])) end++;
      append(text.slice(at, end), false);
      at = end;
    }
  }
  flush();
  return items;
}

// The commands of a line, in order: { words } for each command (redirections and their
// files removed), { open } / { close } around a parenthesized group. A lone `&` that starts
// a command is PowerShell's call operator and is dropped; anywhere else it ends a command
// (POSIX background).
function commands(items) {
  const list = [];
  let words = [];
  let skipOperand = false;
  const end = () => { if (words.length) list.push({ words }); words = []; skipOperand = false; };
  for (const item of items) {
    if (!item.op) {
      if (skipOperand) skipOperand = false;
      else words.push(item);
    } else if (item.op === 'redirect') skipOperand = item.operand;
    else if (item.op === 'amp' && !words.length) continue;
    else {
      end();
      if (item.op === 'open' || item.op === 'close') list.push({ [item.op]: true });
    }
  }
  end();
  return list;
}

// The words of the first command of a text, as plain strings.
function wordsOf(text) {
  const first = commands(lex(text)).find(command => command.words);
  return first ? first.words.map(word => word.value) : [];
}

// --- One command ----------------------------------------------------------------------

// `NAME=value` with the name unquoted: [name, value], or null.
function assignment(word) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(word.value);
  return match && (word.quotedAt < 0 || word.quotedAt >= match[0].length) ? [match[1], word.value.slice(match[0].length)] : null;
}

function withoutAssignments(words, env) {
  let start = 0;
  while (start < words.length) {
    const pair = assignment(words[start]);
    if (!pair) break;
    env[pair[0]] = pair[1];
    start++;
  }
  return words.slice(start);
}

// A statement that sets the environment of the commands after it, not a command: PowerShell
// `$env:NAME = value` (spaced or not) and POSIX `export NAME=value`. Applied to env.
function environmentStatement(words, env) {
  const first = words[0];
  if (first.quotedAt < 0 && first.value === 'export') {
    for (const word of words.slice(1)) {
      const pair = assignment(word);
      if (pair) env[pair[0]] = pair[1];
    }
    return true;
  }
  const head = /^\$env:([A-Za-z_][A-Za-z0-9_]*)/i.exec(first.value);
  if (!head || (first.quotedAt >= 0 && first.quotedAt < head[0].length)) return false;
  const pieces = [first.value.slice(head[0].length), ...words.slice(1).map(word => word.value)].filter(Boolean);
  if (!pieces.length || !pieces[0].startsWith('=')) return false;
  pieces[0] = pieces[0].slice(1);
  env[head[1]] = pieces.filter(Boolean).join(' ');
  return true;
}

// Shell built-ins that change the folder later commands run in (POSIX, cmd and PowerShell
// names and aliases), compared without case.
const CHANGE_DIRECTORY = new Set(['cd', 'chdir', 'set-location', 'sl']);
const PUSH_DIRECTORY = new Set(['pushd', 'push-location']);
const POP_DIRECTORY = new Set(['popd', 'pop-location']);

function resolveDirectory(base, target) {
  let dir = hostPath(target.replace(/\\/g, '/'));
  if (dir === '~' || dir.startsWith('~/')) dir = path.join(os.homedir(), dir.slice(1));
  return typeof base === 'string' && base ? path.resolve(base, dir) : path.resolve(dir);
}

function moveTo(state, dir) {
  state.previous = state.cwd;
  state.cwd = dir;
}

// True when values is a folder change (applied to state). Its target is the last operand
// that is not a flag (`Set-Location -Path sub`, `cd /d D:\x`); `cd -` goes back; with no
// target the folder stays as it was (PowerShell 5.1; a POSIX `cd` alone would go home).
function changeDirectory(values, state) {
  const name = values[0].toLowerCase();
  if (POP_DIRECTORY.has(name)) {
    if (state.stack.length) moveTo(state, state.stack.pop());
    return true;
  }
  const push = PUSH_DIRECTORY.has(name);
  if (!push && !CHANGE_DIRECTORY.has(name)) return false;
  const operands = values.slice(1);
  const back = operands.length === 1 && operands[0] === '-';
  const target = back ? state.previous : operands.filter(operand => !operand.startsWith('-')).pop();
  if (typeof target !== 'string' || !target) return true;
  if (push) state.stack.push(state.cwd);
  moveTo(state, back ? target : resolveDirectory(state.cwd, target));
  return true;
}

// The declared wrappers (each a token list, or a command string) as token lists.
function wrapperTokens(wrappers) {
  return (Array.isArray(wrappers) ? wrappers : [])
    .map(item => (Array.isArray(item) ? item : typeof item === 'string' ? wordsOf(item) : []))
    .filter(tokens => tokens.length > 0 && tokens.every(token => typeof token === 'string') && programName(tokens[0]));
}

// The words after a leading declared wrapper, or null when none leads.
function withoutWrapper(words, wrappers) {
  const values = words.map(word => word.value);
  const wrapper = wrappers.find(item => item.length < values.length
    && item.every((token, index) => (index === 0 ? programName(token) === programName(values[0]) : token === values[index])));
  return wrapper ? words.slice(wrapper.length) : null;
}

function segmentOf(words, state, wrappers) {
  if (environmentStatement(words, state.env)) return null;
  const own = {};
  let rest = withoutAssignments(words, own);
  if (!rest.length || changeDirectory(rest.map(word => word.value), state)) return null;
  for (let unwrapped = withoutWrapper(rest, wrappers); unwrapped; unwrapped = withoutWrapper(rest, wrappers)) {
    rest = withoutAssignments(unwrapped, own);
  }
  if (!rest.length) return null;
  return { tokens: rest.map(word => word.value), cwd: state.cwd, env: { ...state.env, ...own } };
}

// Every command a shell line runs: [{ tokens, cwd, env }]. tokens are unquoted, without
// redirections, leading environment assignments, PowerShell's `&` or declared wrappers;
// cwd follows the folder changes before it (which are not returned themselves; a
// parenthesized group's change ends with the group); env holds the command's own
// assignments over those set by earlier `$env:` / `export` statements.
function shellSegments(commandText, cwd, options) {
  try {
    if (typeof commandText !== 'string') return [];
    const wrappers = wrapperTokens(options && options.wrappers);
    const state = { cwd, previous: cwd, stack: [], env: {} };
    const groups = [];
    const segments = [];
    for (const command of commands(lex(commandText))) {
      if (command.open) groups.push({ cwd: state.cwd, previous: state.previous, stack: [...state.stack], env: { ...state.env } });
      else if (command.close) Object.assign(state, groups.pop() || {});
      else {
        const segment = segmentOf(command.words, state, wrappers);
        if (segment) segments.push(segment);
      }
    }
    return segments;
  } catch (_) { return []; }
}

// --- Matching a declared command ------------------------------------------------------

// A declared command as tokens: manifest shape { file, args }, a token list or a string.
function declaredTokens(declared) {
  const tokens = Array.isArray(declared) ? declared
    : typeof declared === 'string' ? wordsOf(declared)
      : declared && typeof declared === 'object' && typeof declared.file === 'string'
        ? [declared.file, ...(Array.isArray(declared.args) ? declared.args : [])] : [];
  return tokens.every(token => typeof token === 'string') ? tokens : [];
}

function globPattern(glob) {
  const source = Array.from(glob, char => (char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '');
}

// Whether a program token runs the declared file: the same program name, or the declared
// name read as a glob (`*`, `?`).
function programMatches(file, token) {
  const wanted = programName(file);
  const found = programName(token);
  if (!wanted || !found) return false;
  if (wanted === found) return true;
  try { return /[*?]/.test(wanted) && globPattern(wanted).test(found); } catch (_) { return false; }
}

// A token that names a file: it holds a path separator or ends in an extension (a dot and
// a name with a letter, so 1.5 is not one), and is neither a flag nor a URL.
function isPathLike(token) {
  return !token.startsWith('-') && !token.includes('://')
    && (/[\\/]/.test(token) || /\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(token));
}

// Where one side's relative tokens start (cwd) and what its paths are compared from (root).
function sideOf(dir, rootOf) {
  const cwd = typeof dir === 'string' && dir ? dir : null;
  let root = null;
  if (cwd && typeof rootOf === 'function') {
    try { root = rootOf(cwd); } catch (_) {}
  }
  return { cwd, root: typeof root === 'string' && root ? root : cwd };
}

// A path-like token as a POSIX path relative to its side's root (absolute when outside it),
// case-folded where file names ignore case; any other token as it is.
function canonicalToken(token, side) {
  if (!isPathLike(token)) return token;
  const file = hostPath(token.replace(/\\/g, '/'));
  const absolute = path.isAbsolute(file) ? path.resolve(file) : side.cwd ? path.resolve(side.cwd, file) : null;
  let result = path.posix.normalize(file);
  if (absolute) {
    const relative = side.root ? path.relative(path.resolve(side.root), absolute) : '';
    const inside = Boolean(side.root) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
    result = inside ? relative || '.' : absolute;
  }
  result = result.replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

// Whether every wanted token appears in tokens, in the same order, others allowed between.
function inOrder(wanted, tokens) {
  let at = 0;
  return wanted.every(token => {
    while (at < tokens.length && tokens[at] !== token) at++;
    return at++ < tokens.length;
  });
}

// Whether a segment (from shellSegments) runs the declared command: the program matches,
// the declared tokens that are not flags appear in the same order among the segment's
// arguments, and every whenArgs token is among them. Path-like tokens are compared
// relative to rootOf(cwd) of each side: declaredCwd (the folder the declared command runs
// in; default the segment's root) and the segment's cwd, so two worktrees match by the
// same relative path.
// Whether two sides run in the same place: the same folder within their roots when the caller
// knows the roots (two worktrees of one project), else the same folder. An unknown folder
// matches any.
function samePlace(a, b, rootsKnown) {
  if (!a.cwd || !b.cwd) return true;
  const fold = value => (process.platform === 'win32' ? value.toLowerCase() : value);
  const place = side => fold(path.relative(path.resolve(side.root || side.cwd), path.resolve(side.cwd)).replace(/\\/g, '/'));
  return rootsKnown ? place(a) === place(b) : fold(path.resolve(a.cwd)) === fold(path.resolve(b.cwd));
}

function matchesCommand(declared, segment, options) {
  try {
    const { declaredCwd, rootOf = dir => dir, whenArgs = [] } = options || {};
    const wanted = declaredTokens(declared);
    const tokens = segment && Array.isArray(segment.tokens) && segment.tokens.every(token => typeof token === 'string') ? segment.tokens : [];
    if (!wanted.length || !tokens.length || !Array.isArray(whenArgs) || !programMatches(wanted[0], tokens[0])) return false;
    const here = sideOf(segment.cwd, rootOf);
    const there = sideOf(declaredCwd === undefined || declaredCwd === null ? here.root : declaredCwd, rootOf);
    // A declaration that names no path (`npm test`) is anchored to its folder: the same
    // words run in another folder are another command.
    if (!wanted.slice(1).some(isPathLike) && !samePlace(here, there, typeof (options || {}).rootOf === 'function')) return false;
    const args = tokens.slice(1).map(token => canonicalToken(token, here));
    // Flags are ignored when the declaration names something else to run; a declaration of
    // flags only (`node --test`) is known by its flags, or every run of the program would match.
    const named = wanted.slice(1).filter(token => !token.startsWith('-'));
    const required = (named.length ? named : wanted.slice(1)).map(token => canonicalToken(token, there));
    return inOrder(required, args)
      && whenArgs.every(token => typeof token === 'string' && args.includes(canonicalToken(token, there)));
  } catch (_) { return false; }
}

module.exports = { programName, programMatches, shellSegments, matchesCommand };
