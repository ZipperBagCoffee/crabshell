'use strict';

// D162: restored from v21.112 (99473cd^, deleted v21.130.0). Agreeing with the person
// without checking anything — "맞아요", "you're right" — ends the turn only after a
// check. Kept from the old guard: the agreement phrases, the zones where a phrase does
// not count (code, quotes) and the execution-output markers that count as evidence. New:
// a tool call earlier in this turn also counts as evidence (core/transcript currentTurn),
// and the Stop check blocks once instead of writing a stderr note no model reads. Not
// restored: the pressure levels, P/O/G tables and oscillation counters, whose systems
// are gone.

if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { currentTurn } = require('./core/transcript');

const SYCOPHANCY_PATTERNS = [
  // Korean
  /맞습니다/,
  /맞아요/,
  /맞네요/,
  /맞는\s*말/,
  /맞는\s*지적/,
  /동의합니다/,
  /좋은\s*지적/,
  /말씀하신\s*대로/,
  /지적하신\s*것처럼/,
  /좋은\s*의견/,
  /말씀이\s*맞/,
  /그\s*점은\s*인정/,
  /맞다\./,
  /맞음\./,
  // English
  /^Correct\./m,
  /^Right\./m,
  /you'?re right/i,
  /you are right/i,
  /that'?s correct/i,
  /that is correct/i,
  /\bi agree\b/i,
  /good point/i,
  /great point/i,
  /absolutely right/i,
  /exactly right/i,
  /as you pointed out/i,
  /as you said/i,
  /fair point/i,
  /i stand corrected/i,
];

// Output that only a run produces: a shell prompt line, a pass/fail count, a result heading.
const BEHAVIORAL_EVIDENCE = [
  /^\$\s+.+$/m,
  /\b(PASS|FAIL|OK|ERROR)\b.*\d/,
  /검증\s*결과/,
];

// Where a phrase is quoted or shown, not said: code, quotes, blockquotes.
function stripProtectedZones(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^(?: {4}|\t).+$/gm, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/^>\s*.+$/gm, ' ')
    .replace(/"[^"\n]{1,80}"/g, ' ')
    .replace(/'[^'\n]{1,80}'/g, ' ')
    .replace(/「[^」\n]{1,80}」/g, ' ');
}

// The agreement phrase the text says outside quotes and code, unless execution output
// appears before it; null otherwise.
function findAgreement(text) {
  const stripped = stripProtectedZones(text);
  for (const pattern of SYCOPHANCY_PATTERNS) {
    const match = pattern.exec(stripped);
    if (!match) continue;
    const before = stripped.slice(0, match.index);
    if (BEHAVIORAL_EVIDENCE.some(marker => marker.test(before))) return null;
    return match[0];
  }
  return null;
}

const toolCalls = items => items.filter(item => item.kind === 'tool').length;

function reasonFor(phrase, action) {
  return `Crabshell sycophancy-guard: you agreed ("${phrase}") without checking anything in this turn. ` +
    `Check the person's claim with a tool first. If the evidence disagrees, keep your position and say why; ` +
    `if it agrees, say what showed it. ${action}`;
}

// Stop: the turn's last answer agrees and no tool ran in this turn. Blocks once; the
// answer that follows a block (stop_hook_active) passes.
function stopReason(payload) {
  if (!payload || payload.stop_hook_active === true) return null;
  const turn = currentTurn(payload.transcript_path);
  if (!turn) return null; // unknown turn: no evidence either way, fail open
  const texts = turn.filter(item => item.kind === 'text');
  const answer = String(payload.last_assistant_message || payload.stop_response || (texts.length ? texts[texts.length - 1].text : '') || '');
  const phrase = findAgreement(answer);
  if (!phrase || toolCalls(turn) > 0) return null;
  return reasonFor(phrase, 'Then answer again from the evidence.');
}

// A file write right after text that agrees, with no tool call earlier in this turn
// (the old guard's PreToolUse check). The write itself is the last item of the turn.
function writeReason(payload) {
  if (!payload) return null;
  const turn = currentTurn(payload.transcript_path);
  if (!turn) return null;
  let end = turn.length;
  if (end && turn[end - 1].kind === 'tool') end--; // the write being decided
  let start = end;
  while (start > 0 && turn[start - 1].kind === 'text') start--;
  const phrase = findAgreement(turn.slice(start, end).map(item => item.text).join('\n'));
  if (!phrase || toolCalls(turn.slice(0, start)) > 0) return null;
  return reasonFor(phrase, 'Then make the change, if the evidence still calls for it.');
}

async function main() {
  const { readStdin } = require('./transcript-utils');
  const payload = await readStdin();
  if (!payload || Object.keys(payload).length === 0) return;
  const reason = payload.tool_name ? writeReason(payload) : stopReason(payload);
  if (!reason) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.exitCode = 2;
}

if (require.main === module) main().catch(() => {});

module.exports = { findAgreement, stopReason, writeReason, stripProtectedZones, SYCOPHANCY_PATTERNS };
