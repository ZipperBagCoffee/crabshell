/**
 * memory-index.json format specification
 * Location: .claude/memory/memory-index.json
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
const { MEMORY_DIR, SESSIONS_DIR, LOGS_DIR, LESSONS_DIR, WORKFLOW_DIR, INDEX_FILE, MEMORY_FILE } = require('./constants');

/**
 * Get the plugin's template directory
 * Templates are stored in the plugin's templates/ folder
 */
function getPluginTemplatesDir() {
  // scripts/ is one level down from plugin root
  return path.join(__dirname, '..', 'templates');
}

/**
 * Copy a template file if the destination doesn't exist
 */
function copyTemplateIfMissing(templateName, destPath) {
  if (fs.existsSync(destPath)) return false;

  const templatesDir = getPluginTemplatesDir();
  const templatePath = path.join(templatesDir, templateName);

  if (fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, destPath);
    return true;
  }
  return false;
}

function ensureMemoryStructure(projectDir) {
  // Memory-related directories
  const memoryDirs = [MEMORY_DIR, SESSIONS_DIR, LOGS_DIR];

  for (const dir of memoryDirs) {
    const fullPath = path.join(projectDir, '.claude', dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Workflow and Lessons directories
  const workflowDir = path.join(projectDir, '.claude', WORKFLOW_DIR);
  const lessonsDir = path.join(projectDir, '.claude', LESSONS_DIR);

  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });
  }
  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  // Copy template files if they don't exist
  copyTemplateIfMissing('workflow.md', path.join(workflowDir, 'workflow.md'));
  copyTemplateIfMissing('lessons-README.md', path.join(lessonsDir, 'README.md'));

  // Memory index setup
  const indexPath = path.join(projectDir, '.claude', MEMORY_DIR, INDEX_FILE);

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
      const tempPath = indexPath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(index, null, 2));
      fs.renameSync(tempPath, indexPath);
    } catch (e) {
      // Parse error - do NOT overwrite with defaults (file may be temporarily corrupted by race condition)
      // Leave existing file intact; readIndexSafe() will handle parse errors gracefully
    }
  } else {
    fs.writeFileSync(indexPath, JSON.stringify(defaults, null, 2));
  }
}

module.exports = { ensureMemoryStructure };
