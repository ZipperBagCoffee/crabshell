'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

function resolveCodexInvocation(args, explicitBin) {
  const candidate = explicitBin || process.env.CODEX_BIN;
  if (candidate) {
    return candidate.toLowerCase().endsWith('.js')
      ? { command: process.execPath, args: [candidate, ...args] }
      : { command: candidate, args };
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    const npmEntry = path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (fs.existsSync(npmEntry)) return { command: process.execPath, args: [npmEntry, ...args] };
  }
  return { command: 'codex', args };
}

function runCodex(args, options = {}) {
  const invocation = resolveCodexInvocation(args, options.codexBin);
  return spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeout || 10000,
    windowsHide: true,
  });
}

class CodexAppServer {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.env = options.env || process.env;
    this.codexBin = options.codexBin;
    this.timeout = options.timeout || 15000;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.child = null;
  }

  async start() {
    const invocation = resolveCodexInvocation(['app-server', '--stdio'], this.codexBin);
    this.child = spawn(invocation.command, invocation.args, {
      cwd: this.cwd,
      env: this.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => {
      this.stderr = (this.stderr + chunk).slice(-16000);
    });

    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on('line', line => this.handleLine(line));
    this.child.on('error', error => this.rejectAll(error));
    this.child.on('exit', (code, signal) => {
      if (this.pending.size > 0) {
        this.rejectAll(new Error(`Codex app-server exited before responding (code=${code}, signal=${signal}). ${this.stderr.trim()}`));
      }
    });

    await this.request('initialize', {
      clientInfo: { name: 'crabshell-doctor', title: 'Crabshell Doctor', version: '1' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify('initialized');
    return this;
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined || !this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
    else pending.resolve(message.result);
  }

  request(method, params = {}) {
    if (!this.child || !this.child.stdin.writable) return Promise.reject(new Error('Codex app-server is not running.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeout}ms. ${this.stderr.trim()}`));
      }, this.timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  notify(method, params) {
    if (!this.child || !this.child.stdin.writable) return;
    const message = params === undefined ? { method } : { method, params };
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    if (!this.child) return;
    if (this.child.stdin.writable) this.child.stdin.end();
    this.child.kill();
    this.child = null;
  }
}

module.exports = { CodexAppServer, resolveCodexInvocation, runCodex };
