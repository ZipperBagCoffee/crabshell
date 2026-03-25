'use strict';

const path = require('path');
const fs = require('fs');
const { SKILL_ACTIVE_FILE, VERIFYING_CALLED_FILE } = require('./constants');

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

// Skills that legitimately create/modify docs/ files
const DOCS_SKILLS = [
  'discussing', 'planning', 'ticketing', 'investigating',
  'regressing', 'light-workflow', 'verifying'
];

// Default TTL: 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Detect if hookData represents a docs-relevant Skill call.
 * Handles both "planning" and "memory-keeper:planning" formats.
 * Returns normalized skill name or null.
 */
function detectDocsSkillCall(hookData) {
  if (!hookData || hookData.tool_name !== 'Skill') return null;
  const input = hookData.tool_input;
  if (!input || typeof input !== 'object') return null;
  const skill = input.skill;
  if (typeof skill !== 'string') return null;

  // Handle both "planning" and "memory-keeper:planning"
  const skillName = skill.includes(':') ? skill.split(':').pop() : skill;
  if (DOCS_SKILLS.includes(skillName)) return skillName;
  return null;
}

/**
 * Detect if a Skill call is specifically "/verifying run" (not "create").
 * Returns true if args contain "run".
 */
function isVerifyingRun(hookData) {
  if (!hookData || hookData.tool_name !== 'Skill') return false;
  const input = hookData.tool_input;
  if (!input || typeof input !== 'object') return false;
  const skill = input.skill;
  if (typeof skill !== 'string') return false;

  const skillName = skill.includes(':') ? skill.split(':').pop() : skill;
  if (skillName !== 'verifying') return false;

  const args = input.args;
  if (typeof args !== 'string') return false;
  // "run" must appear as a word (not substring of e.g. "runtime")
  return /\brun\b/i.test(args);
}

/**
 * Set the verifying-called flag file.
 */
function setVerifyingCalled(projectDir) {
  const memoryDir = path.join(projectDir, '.claude', 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  const flagPath = path.join(memoryDir, VERIFYING_CALLED_FILE);
  const data = {
    calledAt: new Date().toISOString(),
    mode: 'run',
    ttl: DEFAULT_TTL_MS
  };

  fs.writeFileSync(flagPath, JSON.stringify(data, null, 2));
}

/**
 * Set the skill-active flag file.
 */
function setSkillActive(projectDir, skillName) {
  const memoryDir = path.join(projectDir, '.claude', 'memory');
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

  // Additionally track /verifying run calls for verify-guard
  if (isVerifyingRun(hookData)) {
    setVerifyingCalled(projectDir);
    process.stderr.write(`[SKILL_TRACKER] Activated: ${detectedSkill} (verifying-called flag set)\n`);
  } else {
    process.stderr.write(`[SKILL_TRACKER] Activated: ${detectedSkill}\n`);
  }
  process.exit(0);
}

main().catch(e => {
  console.error(`[SKILL TRACKER ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
