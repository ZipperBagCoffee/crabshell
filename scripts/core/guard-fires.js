'use strict';

// D178: one line per guard block or notice that a hook actually sent, so a model change can
// be audited against what each guard did on each model (scripts/guard-record.js reads it).
// Callers write it after the hook's output, and every error is swallowed here: recording
// can never drop or delay a block.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getStorageRoot, readJsonOrDefault } = require('../utils');
const { lastAssistantModel } = require('../transcript-utils');

const FILE_NAME = 'guard-fires.jsonl';
// Project-changeable in .crabshell/memory/config.json under "guardFires".
const DEFAULTS = Object.freeze({ maxBytes: 524288, reasonWords: 6, tailBytes: 65536 });
const KIND_BY_CHANNEL = Object.freeze({ reason: 'block', context: 'notice', systemMessage: 'notice' });

function memoryDir(projectDir) {
  return path.join(getStorageRoot(projectDir), 'memory');
}

function firesFile(projectDir) {
  return path.join(memoryDir(projectDir), 'logs', FILE_NAME);
}

function settings(projectDir) {
  const config = readJsonOrDefault(path.join(memoryDir(projectDir), 'config.json'), {}) || {};
  const own = config && typeof config.guardFires === 'object' && config.guardFires ? config.guardFires : {};
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (Number.isFinite(own[key]) && own[key] > 0) result[key] = Math.floor(own[key]);
  }
  return result;
}

// An absolute path names a home folder or a project; it is masked in the kept words.
const ABSOLUTE_PATH = /^[("'`]*(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])/;

// The first words name the guard's message without keeping its full text (paths, commands).
function firstWords(text, count) {
  return String(text).trim().split(/\s+/).slice(0, count)
    .map(word => (ABSOLUTE_PATH.test(word) ? '<path>' : word)).join(' ');
}

// One incident, one key: the same block for the same tool call (tool_use_id) or, at Stop, the
// same prompt (prompt_id) — a Stop re-run after the best-answer question repeats it — and the
// same block found again in the transcript by scripts/guard-record.js --backfill.
function fireKey(sessionId, event, scope, text) {
  return crypto.createHash('sha1').update([sessionId || '', event || '', scope || '', String(text)].join('\x00')).digest('hex').slice(0, 16);
}

function modelOf(payload, tailBytes) {
  const given = payload.model;
  if (typeof given === 'string' && given) return given;
  if (given && typeof given === 'object' && typeof given.id === 'string' && given.id) return given.id;
  return lastAssistantModel(payload.transcript_path, tailBytes);
}

// One previous file is kept; the file never grows past maxBytes plus one write.
function rotate(file, maxBytes) {
  try {
    if (fs.statSync(file).size >= maxBytes) fs.renameSync(file, file + '.1');
  } catch {} // No file yet, or the rename failed: append to what is there.
}

// fired: [{ guard, channel: 'reason'|'context'|'systemMessage', text }] — only what the hook
// actually sent. Returns how many lines were written (0 on any failure).
function recordFires(projectDir, { host, event, fired, payload } = {}) {
  try {
    if (!projectDir || !Array.isArray(fired) || fired.length === 0) return 0;
    const input = payload && typeof payload === 'object' ? payload : {};
    const valid = fired.filter(item => item && typeof item.guard === 'string' && item.guard
      && KIND_BY_CHANNEL[item.channel] && item.text);
    if (valid.length === 0) return 0;
    const config = settings(projectDir);
    const model = modelOf(input, config.tailBytes);
    const at = new Date().toISOString();
    const lines = valid.map(item => JSON.stringify({
      at,
      host: host || null,
      event: event || null,
      tool: input.tool_name || null,
      guard: item.guard,
      kind: KIND_BY_CHANNEL[item.channel],
      sessionId: input.session_id || null,
      model,
      key: fireKey(input.session_id, event, input.tool_use_id || input.prompt_id, item.text),
      words: firstWords(item.text, config.reasonWords),
    }));
    const file = firesFile(projectDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotate(file, config.maxBytes);
    fs.appendFileSync(file, lines.join('\n') + '\n');
    return lines.length;
  } catch {
    return 0;
  }
}

module.exports = { DEFAULTS, FILE_NAME, firesFile, fireKey, firstWords, recordFires, settings };
