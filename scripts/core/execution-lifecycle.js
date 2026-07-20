'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureMemoryStructure } = require('../init');
const {
  acquireIndexLock,
  getStorageRoot,
  readJsonOrDefault,
  releaseIndexLock,
  writeJson,
} = require('../utils');
const {
  DELTA_TEMP_FILE,
  INDEX_FILE,
  REGRESSING_STATE_FILE,
  SKILL_ACTIVE_FILE,
} = require('../constants');

const MEMORY_MD_WARNING = `## Crabshell Plugin
- This MEMORY.md = Claude Code built-in auto memory (200-line limit, auto-loaded in system prompt)
- .crabshell/memory/logbook.md = Crabshell plugin memory (25K token rotation, loaded via hooks)
- These are SEPARATE systems. Do NOT apply 200-line limit to plugin logbook.md
- Do NOT confuse rotation/archival rules between them`;

function resolvePluginDataDir(host, explicitDir) {
  if (explicitDir) return path.resolve(explicitDir);
  if (host === 'claude' && process.env.CLAUDE_PLUGIN_DATA) return path.resolve(process.env.CLAUDE_PLUGIN_DATA);
  if (host === 'codex' && process.env.PLUGIN_DATA) return path.resolve(process.env.PLUGIN_DATA);
  return path.join(os.tmpdir(), 'crabshell-plugin-data', host);
}

function lifecycleMarkerPath(projectDir, hookData, options = {}) {
  if (!hookData || typeof hookData.session_id !== 'string' || !hookData.session_id) return null;
  const host = options.host || 'claude';
  const dataDir = resolvePluginDataDir(host, options.pluginDataDir);
  const key = crypto.createHash('sha256')
    .update(`${host}\0${path.resolve(projectDir)}\0${hookData.session_id}`)
    .digest('hex');
  return path.join(dataDir, 'session-lifecycle', `${key}.json`);
}

function ensureClaudeMemoryWarning(projectDir, options = {}) {
  const configRoot = options.claudeConfigDir
    || process.env.CLAUDE_CONFIG_DIR
    || path.join(os.homedir(), '.claude');
  const sanitized = projectDir.replace(/[^a-zA-Z0-9-]/g, '-');
  const memoryPath = path.join(configRoot, 'projects', sanitized, 'memory', 'MEMORY.md');
  let current = '';
  try { current = fs.readFileSync(memoryPath, 'utf8'); } catch {}
  if (current.includes('## Crabshell Plugin')) return { changed: false, memoryPath };
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, MEMORY_MD_WARNING + (current ? `\n\n${current}` : '\n'));
  return { changed: true, memoryPath };
}

function staleRegressingDiagnostic(memoryDir, now = Date.now()) {
  const state = readJsonOrDefault(path.join(memoryDir, REGRESSING_STATE_FILE), null);
  if (!state || state.active !== true || !state.lastUpdatedAt) return null;
  const updatedAt = new Date(state.lastUpdatedAt).getTime();
  if (!Number.isFinite(updatedAt) || now - updatedAt <= 24 * 60 * 60 * 1000) return null;
  return `WARNING: regressing state is stale (last updated: ${state.lastUpdatedAt}). Verify with user before continuing.`;
}

function runExecutionLifecycle(projectDir, hookData = {}, options = {}) {
  const host = options.host || 'claude';
  const markerPath = lifecycleMarkerPath(projectDir, hookData, { host, pluginDataDir: options.pluginDataDir });
  const existingMarker = markerPath ? readJsonOrDefault(markerPath, null) : null;
  if (existingMarker && existingMarker.completed === true) {
    return { ran: false, markerPath, diagnostics: ['execution lifecycle already completed for this host session'] };
  }

  const result = {
    ran: true,
    markerPath,
    memoryEnsured: false,
    staleDeltaRemoved: false,
    staleSkillFlagRemoved: false,
    pressureReset: false,
    claudeMemoryWarningEnsured: false,
    rulesSynchronized: false,
    diagnostics: [],
  };
  const storageRoot = getStorageRoot(projectDir);
  const memoryDir = path.join(storageRoot, 'memory');

  try {
    ensureMemoryStructure(projectDir);
    result.memoryEnsured = true;
  } catch (error) {
    result.diagnostics.push(`memory structure initialization failed: ${error.message}`);
  }

  try {
    const index = readJsonOrDefault(path.join(memoryDir, INDEX_FILE), {});
    const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);
    if (fs.existsSync(deltaPath) && index.deltaReady !== true) {
      fs.unlinkSync(deltaPath);
      result.staleDeltaRemoved = true;
    }
  } catch (error) {
    result.diagnostics.push(`stale delta cleanup failed: ${error.message}`);
  }

  try {
    const skillPath = path.join(memoryDir, SKILL_ACTIVE_FILE);
    if (fs.existsSync(skillPath)) {
      fs.unlinkSync(skillPath);
      result.staleSkillFlagRemoved = true;
    }
  } catch (error) {
    result.diagnostics.push(`stale skill flag cleanup failed: ${error.message}`);
  }

  let locked = false;
  try {
    locked = acquireIndexLock(memoryDir);
    if (!locked) {
      result.diagnostics.push('index lock busy, skipping per-session pressure reset');
    } else {
      const indexPath = path.join(memoryDir, INDEX_FILE);
      const index = readJsonOrDefault(indexPath, {});
      let changed = false;
      if (index.feedbackPressure && index.feedbackPressure.oscillationCount > 0) {
        index.feedbackPressure.oscillationCount = 0;
        changed = true;
      }
      if (index.tooGoodSkepticism && index.tooGoodSkepticism.retryCount > 0) {
        index.tooGoodSkepticism.retryCount = 0;
        changed = true;
      }
      if (changed) writeJson(indexPath, index);
      result.pressureReset = changed;
    }
  } catch (error) {
    result.diagnostics.push(`per-session pressure reset failed: ${error.message}`);
  } finally {
    if (locked) releaseIndexLock(memoryDir);
  }

  const staleDiagnostic = staleRegressingDiagnostic(memoryDir, options.now || Date.now());
  if (staleDiagnostic) result.diagnostics.push(staleDiagnostic);

  if (host === 'claude') {
    try {
      const warning = ensureClaudeMemoryWarning(projectDir, { claudeConfigDir: options.claudeConfigDir });
      result.claudeMemoryWarningEnsured = Boolean(warning.memoryPath);
      result.claudeMemoryPath = warning.memoryPath;
    } catch (error) {
      result.diagnostics.push(`Claude built-in memory warning failed: ${error.message}`);
    }
    if (typeof options.syncRules === 'function') {
      try {
        result.rulesSynchronized = options.syncRules(projectDir) !== false;
        if (!result.rulesSynchronized) result.diagnostics.push('Claude rule synchronization failed');
      } catch (error) {
        result.diagnostics.push(`Claude rule synchronization failed: ${error.message}`);
      }
    }
  }

  const retryRequired = result.diagnostics.some(message => /failed|busy/i.test(message));
  if (markerPath && !retryRequired) {
    try {
      writeJson(markerPath, {
        completed: true,
        host,
        projectDir: path.resolve(projectDir),
        sessionId: hookData.session_id,
        completedAt: new Date(options.now || Date.now()).toISOString(),
      });
    } catch (error) {
      result.diagnostics.push(`session lifecycle marker failed: ${error.message}`);
    }
  }

  return result;
}

module.exports = {
  MEMORY_MD_WARNING,
  ensureClaudeMemoryWarning,
  lifecycleMarkerPath,
  resolvePluginDataDir,
  runExecutionLifecycle,
  staleRegressingDiagnostic,
};
