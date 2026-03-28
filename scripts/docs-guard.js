'use strict';

const path = require('path');
const fs = require('fs');
const { SKILL_ACTIVE_FILE } = require('./constants');

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

// Protected .crabshell/ subdirectories (D/P/T/I documents)
const PROTECTED_DOCS_PATTERN = /\.crabshell\/(discussion|plan|ticket|investigation)\//;

// Skills that legitimately create/modify .crabshell/ D/P/T/I files
const LEGITIMATE_SKILLS = [
  'discussing', 'planning', 'ticketing', 'investigating',
  'regressing', 'light-workflow', 'verifying'
];

// TTL for skill-active flag (5 minutes)
const SKILL_ACTIVE_TTL_MS = 5 * 60 * 1000;

/**
 * Check if a skill-active flag is valid (exists, not expired).
 * Returns the skill name if valid, null otherwise.
 */
function getActiveSkill(projectDir) {
  const { STORAGE_ROOT } = require('./constants');
  const flagPath = path.join(projectDir, STORAGE_ROOT, 'memory', SKILL_ACTIVE_FILE);
  try {
    if (!fs.existsSync(flagPath)) return null;
    const data = JSON.parse(fs.readFileSync(flagPath, 'utf8'));
    if (!data || !data.skill || !data.activatedAt) return null;

    // Check TTL
    const ttl = data.ttl || SKILL_ACTIVE_TTL_MS;
    const elapsed = Date.now() - new Date(data.activatedAt).getTime();
    if (elapsed > ttl) {
      // Expired — clean up
      try { fs.unlinkSync(flagPath); } catch {}
      return null;
    }

    // Check if it's a legitimate skill
    if (!LEGITIMATE_SKILLS.includes(data.skill)) return null;

    return data.skill;
  } catch {
    return null;
  }
}

/**
 * Normalize a file path for consistent matching.
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) { process.exit(0); return; }

  // Only guard protected .crabshell/ D/P/T/I paths
  if (!PROTECTED_DOCS_PATTERN.test(filePath)) { process.exit(0); return; }

  const projectDir = getProjectDir();

  // Check if a legitimate skill is active
  const activeSkill = getActiveSkill(projectDir);
  if (activeSkill) {
    // Skill is active — allow the write
    process.exit(0);
    return;
  }

  // No active skill — block the write
  const docType = filePath.match(PROTECTED_DOCS_PATTERN);
  const category = docType ? docType[1] : 'docs';

  const skillMap = {
    discussion: 'discussing',
    plan: 'planning',
    ticket: 'ticketing',
    investigation: 'investigating'
  };
  const suggestedSkill = skillMap[category] || 'the appropriate document skill';

  const output = {
    decision: "block",
    reason: `Direct write to .crabshell/${category}/ blocked. You MUST invoke the Skill tool first (skill="${suggestedSkill}") before writing ${category} documents. This prevents post-compaction skill bypass where documents are created from memory without proper skill workflow.`
  };

  process.stderr.write(`[DOCS_GUARD] Blocked ${toolName} to ${filePath} — no active skill\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

main().catch(e => {
  console.error(`[DOCS GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
