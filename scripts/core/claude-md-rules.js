'use strict';

// The plugin-managed rules block at the top of a project's CLAUDE.md: the text
// between MARKER_START and MARKER_END follows the rules the running plugin
// ships; everything below MARKER_END belongs to the user and is never touched.

const fs = require('fs');
const path = require('path');

const MARKER_START = '## CRITICAL RULES (Core Principles Alignment)';
const MARKER_END = '---Add your project-specific rules below this line---';

function removeLegacySection(content, sectionHeader) {
  const start = content.indexOf(sectionHeader);
  if (start === -1) return content;

  const afterHeader = content.slice(start + sectionHeader.length);
  const nextSection = afterHeader.search(/\n## /);
  const end = nextSection === -1 ? content.length : start + sectionHeader.length + nextSection;

  return content.slice(0, start).trimEnd() + (nextSection === -1 ? '' : content.slice(end));
}

// The plugin name a folder declares in .claude-plugin/plugin.json, or null.
function readPluginName(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof manifest.name === 'string' && manifest.name ? manifest.name : null;
  } catch {
    return null;
  }
}

// Same folder, whatever the spelling: Windows paths arrive as both "c:\" and "C:\".
function samePath(a, b) {
  const normalize = value => {
    let resolved = path.resolve(value);
    try { resolved = fs.realpathSync.native(resolved); } catch {}
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

// True when projectDir is a source checkout of the running plugin and the
// running copy lives elsewhere (an installed copy). That checkout's own rules
// are the newer ones during a release, so an installed copy must not rewrite them.
function isOwnSourceCheckout(projectDir, pluginRoot) {
  if (!projectDir || !pluginRoot) return false;
  if (samePath(projectDir, pluginRoot)) return false;
  const projectName = readPluginName(projectDir);
  return projectName !== null && projectName === readPluginName(pluginRoot);
}

// Brings CLAUDE.md's managed block in line with `rules`. Writes only when the
// content would change. `updateOnly` restricts the write to replacing an
// existing block between both markers (no file creation, no prepending).
// Returns { written, skipped, error }; never throws.
function syncRulesToClaudeMd(projectDir, options = {}) {
  const result = { written: false, skipped: null, error: null };
  try {
    if (typeof options.rules !== 'string' || !options.rules.trim()) throw new Error('rules text missing');
    if (isOwnSourceCheckout(projectDir, options.pluginRoot)) {
      result.skipped = 'own-source-checkout';
      return result;
    }
    const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
    const rulesBlock = options.rules.trim() + '\n\n' + MARKER_END;

    if (!fs.existsSync(claudeMdPath)) {
      if (options.updateOnly) {
        result.skipped = 'no-claude-md';
        return result;
      }
      fs.writeFileSync(claudeMdPath, rulesBlock + '\n');
      result.written = true;
      return result;
    }

    const content = fs.readFileSync(claudeMdPath, 'utf8');
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);
    let next;
    if (startIdx !== -1 && endIdx !== -1) {
      next = content.slice(0, startIdx) + rulesBlock + content.slice(endIdx + MARKER_END.length);
    } else if (options.updateOnly) {
      result.skipped = 'no-markers';
      return result;
    } else {
      // Legacy migration: remove old sections, prepend the rules block.
      let remaining = removeLegacySection(content, '## Memory Keeper Plugin Rules');
      remaining = removeLegacySection(remaining, '## CRITICAL RULES').trim();
      next = remaining && remaining !== '# Project Notes'
        ? rulesBlock + '\n\n' + remaining + '\n'
        : rulesBlock + '\n';
    }
    if (next !== content) {
      fs.writeFileSync(claudeMdPath, next);
      result.written = true;
    }
  } catch (error) {
    result.error = error.message;
  }
  return result;
}

module.exports = {
  MARKER_START,
  MARKER_END,
  removeLegacySection,
  readPluginName,
  isOwnSourceCheckout,
  syncRulesToClaudeMd,
};
