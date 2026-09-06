'use strict';
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const MAX_TRANSCRIPT_BYTES = 512 * 1024;

function projectContains(projectDir, cwd) {
  try {
    const native = String(cwd).startsWith('file:') ? fileURLToPath(cwd) : cwd;
    const relative = path.relative(path.resolve(projectDir), path.resolve(native));
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
  } catch { return false; }
}

function readCodexCommandResult(payload, projectDir) {
  if (!payload.tool_use_id || !payload.session_id || !payload.transcript_path) return null;
  let fd;
  try {
    fd = fs.openSync(payload.transcript_path, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - MAX_TRANSCRIPT_BYTES);
    const buffer = Buffer.alloc(size - start);
    const read = fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, read).toString('utf8').split(/\r?\n/);
    if (start > 0) lines.shift();
    const matches = [];
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const event = record.payload;
      const item = event?.item;
      if (record.type !== 'event_msg' || event?.type !== 'item_completed'
        || event.thread_id !== payload.session_id
        || (payload.turn_id && event.turn_id !== payload.turn_id)
        || !['CommandExecution', 'commandExecution'].includes(item?.type)
        || item.id !== payload.tool_use_id || !projectContains(projectDir, item.cwd)) continue;
      const actualCwd = String(item.cwd).startsWith('file:') ? fileURLToPath(item.cwd) : item.cwd;
      const expectedCwd = payload.tool_input?.workdir || payload.cwd || projectDir;
      if (path.relative(path.resolve(expectedCwd), path.resolve(actualCwd)) !== '') continue;
      if (!['completed', 'failed', 'interrupted', 'cancelled', 'canceled'].includes(item.status)) continue;
      matches.push({
        exit_code: typeof item.exit_code === 'number' ? item.exit_code : null,
        stdout: item.stdout ?? item.aggregated_output ?? '', stderr: item.stderr || '',
        status: item.status,
        interrupted: ['interrupted', 'cancelled', 'canceled'].includes(item.status),
        startedAtMs: Number.isFinite(event.started_at_ms) ? event.started_at_ms : null,
        completedAtMs: Number.isFinite(event.completed_at_ms) ? event.completed_at_ms : null,
        evidenceSource: 'codex-transcript-item-completed',
      });
    }
    const latest = matches[matches.length - 1];
    if (!latest || matches.some(item => item.exit_code !== latest.exit_code || item.status !== latest.status)) return null;
    return latest;
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

module.exports = { readCodexCommandResult, MAX_TRANSCRIPT_BYTES };
