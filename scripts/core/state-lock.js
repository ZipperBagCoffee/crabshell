'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function withStateLock(stateFile, action) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const lock = stateFile + '.lock';
  const token = crypto.randomUUID();
  const begin = Date.now();
  while (true) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); }
          catch (probe) { if (probe.code === 'ESRCH') { fs.unlinkSync(lock); continue; } }
        }
      } catch {}
      if (Date.now() - begin >= 1000) throw new Error('Verification state is busy; no result was recorded.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return action(); }
  finally {
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock); } catch {}
  }
}

module.exports = { withStateLock };
