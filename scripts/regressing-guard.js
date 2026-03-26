'use strict';

const path = require('path');
const fs = require('fs');

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

function readStdin(timeoutMs = 500) {
  // hook-runner.js v2 stores parsed stdin in HOOK_DATA env var
  if (process.env.HOOK_DATA) {
    try { return Promise.resolve(JSON.parse(process.env.HOOK_DATA)); }
    catch { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; resolve(result); } };
    const timer = setTimeout(() => {
      done(data.trim() ? (() => { try { return JSON.parse(data.trim()); } catch { return {}; } })() : {});
    }, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      if (data.trim()) { try { done(JSON.parse(data.trim())); } catch { done({}); } }
      else { done({}); }
    });
    process.stdin.on('error', () => { clearTimeout(timer); done({}); });
    process.stdin.resume();
  });
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const filePath = (input.file_path || input.path || '').replace(/\\/g, '/');
  const isPlanDoc = /docs\/plan\/P\d{3}/.test(filePath);
  const isTicketDoc = /docs\/ticket\/P\d{3}_T\d{3}/.test(filePath);
  if (!isPlanDoc && !isTicketDoc) { process.exit(0); return; }

  const projectDir = getProjectDir();
  const statePath = path.join(projectDir, '.claude', 'memory', 'regressing-state.json');

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    process.exit(0); return; // No state file = no regressing active
  }

  if (!state || state.active !== true) { process.exit(0); return; }

  const { phase } = state;

  if (phase === 'planning' && isPlanDoc) {
    const output = {
      decision: "block",
      reason: 'Regressing phase "planning" requires /planning skill invocation first. Use Skill tool with skill="memory-keeper:planning" instead of writing the plan document directly.'
    };
    console.log(JSON.stringify(output));
    process.exit(2);
  }

  if (phase === 'ticketing' && isTicketDoc) {
    const output = {
      decision: "block",
      reason: 'Regressing phase "ticketing" requires /ticketing skill invocation first. Use Skill tool with skill="memory-keeper:ticketing" instead of writing the ticket document directly.'
    };
    console.log(JSON.stringify(output));
    process.exit(2);
  }

  process.exit(0);
}

main().catch(e => {
  console.error(`[REGRESSING GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
