/**
 * memory-index.json format specification
 * Location: .crabshell/memory/memory-index.json
 *
 * {
 *   "version": 1,
 *   "current": "memory.md",
 *   "rotatedFiles": [
 *     {
 *       "file": "memory_YYYYMMDD_HHMMSS.md",
 *       "rotatedAt": "2026-01-13T12:34:56.789Z",
 *       "tokens": 1234,
 *       "bytes": 5678,
 *       "summary": "memory_YYYYMMDD_HHMMSS.summary.json",
 *       "summaryGenerated": false,
 *       "dateRange": { "start": "ISO", "end": "ISO" }
 *     }
 *   ],
 *   "stats": { "totalRotations": 0, "lastRotation": null },
 *   "counter": 0
 * }
 */
const fs = require('fs');
const path = require('path');
const { STORAGE_ROOT, MEMORY_DIR, SESSIONS_DIR, LOGS_DIR, LESSONS_DIR, WORKFLOW_DIR, DISCUSSION_DIR, PLAN_DIR, TICKET_DIR, INVESTIGATION_DIR, INDEX_FILE, MEMORY_FILE } = require('./constants');
const { writeJson } = require('./utils');


/**
 * Recursively copy a directory from src to dest.
 */
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Migrate from legacy .claude/ storage to .crabshell/.
 * Only runs if .claude/memory/ exists AND .crabshell/memory/ does NOT.
 */
function migrateFromLegacy(projectDir) {
  try {
    const legacyMemory = path.join(projectDir, '.claude', 'memory');
    const newMemory = path.join(projectDir, STORAGE_ROOT, 'memory');

    // Only migrate if legacy exists and new does not
    if (!fs.existsSync(legacyMemory) || fs.existsSync(newMemory)) return;

    console.error(`[CRABSHELL] Migrating from .claude/ to ${STORAGE_ROOT}/...`);

    // Copy memory/
    copyDirRecursive(legacyMemory, newMemory);
    console.error(`[CRABSHELL] Copied .claude/memory/ -> ${STORAGE_ROOT}/memory/`);

    // Copy lessons/ if exists
    const legacyLessons = path.join(projectDir, '.claude', 'lessons');
    if (fs.existsSync(legacyLessons)) {
      const newLessons = path.join(projectDir, STORAGE_ROOT, 'lessons');
      copyDirRecursive(legacyLessons, newLessons);
      console.error(`[CRABSHELL] Copied .claude/lessons/ -> ${STORAGE_ROOT}/lessons/`);
    }

    // Copy verification/ if exists
    const legacyVerification = path.join(projectDir, '.claude', 'verification');
    if (fs.existsSync(legacyVerification)) {
      const newVerification = path.join(projectDir, STORAGE_ROOT, 'verification');
      copyDirRecursive(legacyVerification, newVerification);
      console.error(`[CRABSHELL] Copied .claude/verification/ -> ${STORAGE_ROOT}/verification/`);
    }

    console.error(`[CRABSHELL] Migration complete.`);
  } catch (e) {
    console.error(`[CRABSHELL] Migration error: ${e.message}`);
  }
}

/**
 * Ensure .crabshell/ is in .gitignore.
 */
function ensureGitignore(projectDir) {
  try {
    const gitignorePath = path.join(projectDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      if (!content.includes('.crabshell/')) {
        fs.appendFileSync(gitignorePath, '\n.crabshell/\n');
      }
    }
  } catch (e) {
    // Silently fail
  }
}

/**
 * Ensure .crabshell/README.md exists.
 */
function ensureCrabshellReadme(storageRoot) {
  try {
    const readmePath = path.join(storageRoot, 'README.md');
    // Always rewrite to keep content up-to-date
    fs.mkdirSync(storageRoot, { recursive: true });
    fs.writeFileSync(readmePath, `# .crabshell/
This directory is managed by the **crabshell** plugin. Do not edit files here manually.

## What is Crabshell?
Claude Code plugin with three pillars:
1. **Session memory** — Auto-saves context across sessions (delta extraction, Haiku summarization, token-based rotation)
2. **Behavioral correction** — Injects verification-first rules and interference pattern detection every prompt. Guard hooks block sycophancy, overcorrection, and shortcuts at runtime
3. **Structured workflows** — D/P/T/I document system with skills for planning, investigating, and iterative improvement

## Available Skills
- \`/crabshell:save-memory\` — Manual memory save
- \`/crabshell:load-memory\` — Load full memory context
- \`/crabshell:search-memory\` — Search past sessions
- \`/crabshell:clear-memory\` — Archive old memory files
- \`/crabshell:setup-project\` — Generate project.md concept
- \`/crabshell:discussing\` — Create/update discussion documents
- \`/crabshell:planning\` — Create/update plan documents
- \`/crabshell:ticketing\` — Create/update ticket documents
- \`/crabshell:investigating\` — Multi-agent investigation
- \`/crabshell:regressing\` — Iterative optimization cycles
- \`/crabshell:light-workflow\` — One-shot agent orchestration
- \`/crabshell:verifying\` — Verification tool management
- \`/crabshell:lessons\` — Project-specific lessons

## Folder Structure
\`\`\`
.crabshell/
├── project.md          # Project concept (injected every prompt)
├── README.md           # This file
├── memory/             # Session memory (memory.md, index, sessions, delta)
├── lessons/            # Project-specific lessons
├── verification/       # Verification manifest and tools
├── discussion/         # D-documents (decisions, dialogues)
├── plan/               # P-documents (implementation plans)
├── ticket/             # T-documents (executable work units)
└── investigation/      # I-documents (multi-agent investigations)
\`\`\`

## Auto-managed
- Memory saves automatically (no manual action needed)
- Rules injected into CLAUDE.md on every prompt
- Guard hooks run on PreToolUse/Stop events
- .crabshell/ is gitignored
`);
  } catch (e) {
    // Silently fail
  }
}

function ensureMemoryStructure(projectDir) {
  const storageRoot = path.join(projectDir, STORAGE_ROOT);

  // Run legacy migration before creating structure
  migrateFromLegacy(projectDir);

  // Memory-related directories
  const memoryDirs = [MEMORY_DIR, SESSIONS_DIR, LOGS_DIR];

  for (const dir of memoryDirs) {
    const fullPath = path.join(storageRoot, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Lessons directory (local project-specific storage)
  const lessonsDir = path.join(storageRoot, LESSONS_DIR);
  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  // D/P/T/I document directories
  const docTypeDirs = [DISCUSSION_DIR, PLAN_DIR, TICKET_DIR, INVESTIGATION_DIR];
  for (const dir of docTypeDirs) {
    const fullPath = path.join(storageRoot, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Legacy: rename old workflow.md to .bak (now delivered via skill)
  const legacyWorkflow = path.join(storageRoot, WORKFLOW_DIR, 'workflow.md');
  if (fs.existsSync(legacyWorkflow)) {
    const bakPath = legacyWorkflow + '.bak';
    if (!fs.existsSync(bakPath)) {
      fs.renameSync(legacyWorkflow, bakPath);
    }
  }

  // Ensure .gitignore includes .crabshell/
  ensureGitignore(projectDir);

  // Ensure README.md
  ensureCrabshellReadme(storageRoot);

  // Memory index setup
  const indexPath = path.join(storageRoot, MEMORY_DIR, INDEX_FILE);

  // Create new or migrate old index structure
  const defaults = { version: 1, current: MEMORY_FILE, rotatedFiles: [], stats: { totalRotations: 0, lastRotation: null }, counter: 0 };

  if (fs.existsSync(indexPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      // Preserve ALL existing fields, only add missing defaults
      const index = {
        ...defaults,
        ...existing,
        // Ensure critical fields have correct types
        rotatedFiles: Array.isArray(existing.rotatedFiles) ? existing.rotatedFiles : [],
        stats: existing.stats || defaults.stats,
      };
      writeJson(indexPath, index);
    } catch (e) {
      // Parse error - do NOT overwrite with defaults (file may be temporarily corrupted by race condition)
      // Leave existing file intact; readIndexSafe() will handle parse errors gracefully
    }
  } else {
    fs.writeFileSync(indexPath, JSON.stringify(defaults, null, 2));
  }
}

module.exports = { ensureMemoryStructure, migrateFromLegacy };
