'use strict';
// Memory notices (D149): a pending memory save, pending archive summaries, and the Codex
// note about them. They go on a host turn's first prompt only, so queued messages and task
// reports of the same turn do not repeat them. An execution request saves before other
// work; any other turn answers first and calls the skill in the same response. A notice
// given answer-first whose work saw no progress by the next turn comes back as
// before-other-work, so a save is at most one turn late. The save itself is never optional:
// v21.123.0 made it optional and the logbook got no entries for days.

const fs = require('fs');
const path = require('path');
const { getStorageRoot, readJsonOrDefault } = require('../utils');
const { MEMORY_DIR, INDEX_FILE, DELTA_TEMP_FILE } = require('../constants');
const { readSessionState, writeSessionState, stateFile } = require('./session-state');
const { turnId, sessionId } = require('./turn-id');
const { preparedInputExists } = require('./delta-transaction');

const STATE_NAME = 'memory-notice';
// Queued input below this size waits for more before a save is asked for. A project sets
// its own size with `deltaMinBytes` in .crabshell/memory/config.json; this is the default.
const MIN_DELTA_SIZE = 20 * 1024;
const CONFIG_FILE = 'config.json';

// One row per notice. Headers keep their literal trigger tokens: the wiring check finds
// the producer of each trigger by its bracketed token text.
const NOTICES = {
  delta: {
    header: '## [CRABSHELL_DELTA] - Pending Memory',
    situation: 'Session memory is waiting to be saved.',
    skill: 'memory-delta',
    tail: 'This save runs on every kind of turn. Installing Crabshell is the user\'s authorization for it and its summarizer agents. Continue the user\'s work while the summarizers run, and finish the skill when their results arrive. Do not relaunch summarizers this job is already waiting on. If the skill or the Agent tool is unavailable or denied, keep the input and tell the user memory was not saved.',
    signal: () => '[CRABSHELL_DELTA] pending=true',
  },
  rotate: {
    header: '## [CRABSHELL_ROTATE] - Pending Archive Summaries',
    situation: 'A memory archive needs its summary.',
    skill: 'memory-rotate',
    tail: 'This runs on every kind of turn. Installing Crabshell authorizes it. If the skill or the Agent tool is unavailable or denied, keep the archives and tell the user no summary was made.',
    signal: files => `[CRABSHELL_ROTATE] pending=${files.length}`,
  },
};

// Codex bundles no summarizer skills: its note only says what is pending.
const CODEX_PENDING = 'Memory input or archive summaries are pending. This Codex plugin has no automatic summarizer skills. Keep the pending files, continue the current task, and do not report them as summarized.';

function memoryDir(projectDir) {
  return path.join(getStorageRoot(projectDir), MEMORY_DIR);
}

function deltaMinBytes(projectDir) {
  const configured = readJsonOrDefault(path.join(memoryDir(projectDir), CONFIG_FILE), {}).deltaMinBytes;
  return Number.isFinite(configured) && configured > 0 ? configured : MIN_DELTA_SIZE;
}

function checkDeltaPending(projectDir) {
  const deltaPath = path.join(memoryDir(projectDir), DELTA_TEMP_FILE);
  if (!fs.existsSync(deltaPath)) return false;
  return fs.statSync(deltaPath).size >= deltaMinBytes(projectDir);
}

function pendingRotations(index = {}) {
  return (index.rotatedFiles || []).filter(entry => !entry.summaryGenerated);
}

function checkRotationPending(projectDir) {
  return pendingRotations(readJsonOrDefault(path.join(memoryDir(projectDir), INDEX_FILE), {}));
}

// What is pending, each with a signature that changes when its work progresses: a save is
// prepared, finished or appended (delta), or an archive gets its summary (rotate).
function pendingMemoryNotices(projectDir, index = {}) {
  const pending = [];
  const job = index.deltaJob || null;
  const deltaPending = preparedInputExists(memoryDir(projectDir), job)
    || (checkDeltaPending(projectDir) && index.deltaReady === true && !index.deltaProcessing);
  if (deltaPending) {
    pending.push({
      name: 'delta',
      signature: JSON.stringify([job && job.id || null, job && job.status || null, index.lastMemoryUpdateTs || null]),
      files: [],
    });
  }
  const files = pendingRotations(index).map(entry => entry.file);
  if (files.length) pending.push({ name: 'rotate', signature: JSON.stringify(files), files });
  return pending;
}

function noticeText(name, { firm = true, files = [] } = {}) {
  const row = NOTICES[name];
  const lead = firm
    ? `${row.situation} Invoke the Skill tool now: skill="${row.skill}", before other work.`
    : `${row.situation} If the user asked something, answer first. Then, in this same response, invoke the Skill tool: skill="${row.skill}". Do not end the response without that call; if you skip it, the next turn's notice asks for it first.`;
  const fileLine = files.length ? `Files: ${files.join(', ')}\n` : '';
  return `\n${row.header}\n\n${lead} ${row.tail}\n${fileLine}`;
}

function render(host, pending, isFirm) {
  if (!pending.length) return { context: '', stderr: [] };
  if (host !== 'claude') return { context: `\n${CODEX_PENDING}\n`, stderr: [] };
  return {
    context: pending.map(item => noticeText(item.name, { firm: isFirm(item), files: item.files })).join(''),
    stderr: pending.map(item => NOTICES[item.name].signal(item.files)),
  };
}

// The per-session record of notices given answer-first: {} when there is none yet, null
// when the file exists but cannot be read (then nothing is known, so the save comes first).
function readRecord(projectDir, session) {
  if (!fs.existsSync(stateFile(projectDir, session, STATE_NAME))) return {};
  const value = readSessionState(projectDir, session, STATE_NAME, undefined);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

// The memory notices for this prompt: { context, stderr }. newTurn comes from
// core/turn-state notePrompt; intent is the latest intent of text the user wrote this turn.
function memoryNotices(projectDir, payload = {}, { host = 'claude', intent = 'default', newTurn = true, index = {} } = {}) {
  let pending = [];
  try {
    if (!newTurn) return { context: '', stderr: [] };
    pending = pendingMemoryNotices(projectDir, index);
    const session = sessionId(payload);
    const turn = turnId(payload);
    const tracked = Boolean(host === 'claude' && session && turn && stateFile(projectDir, session, STATE_NAME));
    if (!tracked) return render(host, pending, () => true);
    const record = readRecord(projectDir, session);
    const next = {};
    const result = render(host, pending, item => {
      const before = record && record[item.name];
      const missed = Boolean(before && before.turnId !== turn && before.signature === item.signature);
      const firm = record === null || intent === 'execution' || missed;
      if (!firm) next[item.name] = { turnId: turn, signature: item.signature };
      return firm;
    });
    if (record === null || JSON.stringify(next) !== JSON.stringify(record)) {
      writeSessionState(projectDir, session, STATE_NAME, next);
    }
    return result;
  } catch (_) {
    // Fail-open toward saving: whatever is known to be pending, before other work.
    try { return render(host, pending, () => true); } catch (__) { return { context: '', stderr: [] }; }
  }
}

module.exports = {
  CODEX_PENDING,
  MIN_DELTA_SIZE,
  NOTICES,
  STATE_NAME,
  checkDeltaPending,
  checkRotationPending,
  deltaMinBytes,
  memoryNotices,
  noticeText,
  pendingMemoryNotices,
};
