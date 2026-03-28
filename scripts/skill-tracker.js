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

// Skills that legitimately create/modify .crabshell/ D/P/T/I files
const DOCS_SKILLS = [
  'discussing', 'planning', 'ticketing', 'investigating',
  'regressing', 'light-workflow', 'verifying'
];

// Default TTL: 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Detect if hookData represents a docs-relevant Skill call.
 * Handles both "planning" and "crabshell:planning" formats.
 * Returns normalized skill name or null.
 */
function detectDocsSkillCall(hookData) {
  if (!hookData || hookData.tool_name !== 'Skill') return null;
  const input = hookData.tool_input;
  if (!input || typeof input !== 'object') return null;
  const skill = input.skill;
  if (typeof skill !== 'string') return null;

  // Handle both "planning" and "crabshell:planning"
  const skillName = skill.includes(':') ? skill.split(':').pop() : skill;
  if (DOCS_SKILLS.includes(skillName)) return skillName;
  return null;
}

/**
 * Set the skill-active flag file.
 */
function setSkillActive(projectDir, skillName) {
  const { STORAGE_ROOT } = require('./constants');
  const memoryDir = path.join(projectDir, STORAGE_ROOT, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  const flagPath = path.join(memoryDir, SKILL_ACTIVE_FILE);
  const data = {
    skill: skillName,
    activatedAt: new Date().toISOString(),
    ttl: DEFAULT_TTL_MS
  };

  fs.writeFileSync(flagPath, JSON.stringify(data, null, 2));
}

async function main() {
  const hookData = await readStdin();
  if (!hookData) { process.exit(0); return; }

  // Only process Skill tool calls
  const detectedSkill = detectDocsSkillCall(hookData);
  if (!detectedSkill) { process.exit(0); return; }

  const projectDir = getProjectDir();
  setSkillActive(projectDir, detectedSkill);

  process.stderr.write(`[SKILL_TRACKER] Activated: ${detectedSkill}\n`);
  process.exit(0);
}

main().catch(e => {
  console.error(`[SKILL TRACKER ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
