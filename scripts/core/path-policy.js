'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizePath } = require('../transcript-utils');
const { analyzeBashCommand } = require('./shell-writes');

const WINDOWS = process.platform === 'win32';
// Windows folders ignore case, so ".CRABSHELL" is the same folder there.
const MEMORY_PATH_PATTERN = WINDOWS ? /\.crabshell(?:[/\\]|$)/i : /\.crabshell(?:[/\\]|$)/;
const MEMORY_PATH_SEGMENT = '.crabshell/';

function resolveDotsInPath(normalizedPath) {
  const parts = normalizedPath.split('/');
  const resolved = [];
  for (const part of parts) {
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      }
    } else if (part !== '.') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function hasShellVariable(value) {
  return /^\$|\/\$|^~\/|^~$|\$\{|\$\(|`/.test(value);
}

function resolveShellVariables(normalizedPath, projectDir) {
  let resolved = normalizedPath;
  const home = normalizePath(os.homedir());
  resolved = resolved.replace(/^~(?=\/|$)/, home);

  const knownVars = {
    CLAUDE_PROJECT_DIR: projectDir,
    PROJECT_DIR: projectDir,
    HOME: home,
    USERPROFILE: home,
  };

  for (const [varName, value] of Object.entries(knownVars)) {
    resolved = resolved.split('${' + varName + '}').join(value);
    resolved = resolved.replace(new RegExp('\\$' + varName + '(?=/|$)', 'g'), value);
  }

  return resolved;
}

function hasUnresolvedVariables(value) {
  return /\$[A-Za-z_]|\$\{|\$\(|`/.test(value);
}

// Windows paths are case-insensitive ("c:/users" and "C:/Users" are one folder).
function startsWithPath(value, prefix) {
  return WINDOWS ? value.toLowerCase().startsWith(prefix.toLowerCase()) : value.startsWith(prefix);
}

// Forward slashes, single separators ("C:\\\\x" in code is one folder), a trailing
// slash after a bare ".crabshell", and Git Bash forms (/c/Users, /tmp) on Windows.
function canonicalPath(value) {
  let result = normalizePath(value).replace(/(?!^)\/{2,}/g, '/');
  if (/\.crabshell$/i.test(result)) result += '/';
  if (WINDOWS) {
    const drive = /^\/([A-Za-z])(\/|$)/.exec(result);
    if (drive) result = drive[1].toUpperCase() + ':/' + result.slice(drive[0].length);
    else if (/^\/tmp(\/|$)/.test(result)) result = normalizePath(os.tmpdir()).replace(/\/+$/, '') + result.slice(4);
  }
  return result;
}

function checkPath(filePath, projectDir) {
  const normalized = canonicalPath(filePath);
  const normalizedProject = normalizePath(projectDir);

  if (!MEMORY_PATH_PATTERN.test(normalized)) {
    return { targets: false, valid: true };
  }

  let pathToValidate = normalized;
  if (hasShellVariable(normalized)) {
    const resolved = resolveShellVariables(normalized, normalizedProject);
    if (hasUnresolvedVariables(resolved)) {
      // valid:false keeps the old answer for direct callers; evaluatePathPolicy
      // treats an unresolved path as undecidable and does not block on it.
      return { targets: true, valid: false, unresolved: true };
    }
    pathToValidate = resolved;
  }

  const resolvedPath = resolveDotsInPath(canonicalPath(pathToValidate));
  const resolvedProject = resolveDotsInPath(normalizedProject);
  const expectedPrefix = resolvedProject.replace(/\/+$/, '') + '/' + MEMORY_PATH_SEGMENT;
  if (startsWithPath(resolvedPath, expectedPrefix)) {
    return { targets: true, valid: true };
  }
  // Scratch copies and test fixtures live under the OS temp folder.
  const tempRoot = resolveDotsInPath(normalizePath(os.tmpdir())).replace(/\/+$/, '') + '/';
  if (startsWithPath(resolvedPath, tempRoot)) {
    return { targets: true, valid: true, temporary: true };
  }

  // A relative path that stays below the working folder is this project's (the
  // hook sees one command; a folder change in an earlier command is invisible).
  if (!/^(?:[A-Za-z]:\/|\/|~)/.test(resolvedPath) && !/^\.\.(\/|$)/.test(resolvedPath)) {
    return { targets: true, valid: true };
  }

  return { targets: true, valid: false };
}

function extractMemoryPathsFromCommand(command) {
  const paths = [];
  let match;
  const quotedRegex = /(["'])((?:(?!\1).)*)\1/g;
  while ((match = quotedRegex.exec(command)) !== null) {
    const content = match[2];
    const pathMatch = content.match(/(?:[A-Za-z]:[/\\]|[/\\~$.])[^"']*?\.crabshell[/\\]?[^"']*/);
    if (pathMatch) paths.push(pathMatch[0]);
  }

  const stripped = command.replace(/(["'])(?:(?!\1).)*\1/g, ' ');
  const unquotedRegex = /([^\s"']*\.crabshell[/\\][^\s"']*)/g;
  while ((match = unquotedRegex.exec(stripped)) !== null) paths.push(match[1]);

  const unquotedSimple = /([^\s"']*\.crabshell)\b/g;
  while ((match = unquotedSimple.exec(stripped)) !== null) {
    if (!paths.some(candidate => candidate.startsWith(match[1]))) paths.push(match[1] + '/');
  }
  return paths;
}

function deny(reason, diagnostic) {
  return { reason, diagnostic };
}

function advise(targetPath, projectDir, diagnostic) {
  return {
    advisory: `[CRABSHELL] "${targetPath}" is another project's Crabshell folder, not this project's (${normalizePath(projectDir)}/.crabshell/). Reading it is allowed; do not treat it as this project's memory or documents.`,
    diagnostic,
  };
}

function evaluatePathPolicy(hookData, projectDir) {
  if (!hookData || !hookData.tool_name || !hookData.tool_input) return null;
  const toolName = hookData.tool_name;
  const input = hookData.tool_input;
  const normalizedProject = normalizePath(projectDir);

  // Reading another project's .crabshell is harmless; the model is only told.
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
    const filePath = input.file_path || input.path || '';
    if (!filePath) return null;
    const result = checkPath(filePath, projectDir);
    if (!result.targets || result.valid || result.unresolved) return null;
    const normalizedFile = normalizePath(filePath);
    if (isPluginGlobalConfig(normalizedFile)) return null;
    return advise(normalizedFile, projectDir, `[PATH_GUARD] ${toolName} of another project's .crabshell: ${normalizedFile}`);
  }

  // Bash: block only when another project's .crabshell path is a write target.
  if (toolName === 'Bash') {
    const command = input.command || '';
    if (!command) return null;
    let advisory = null;
    for (const candidate of analyzeBashCommand(command)) {
      const result = checkPath(candidate.path, projectDir);
      if (!result.targets || result.valid || result.unresolved) continue;
      const normalizedMemoryPath = normalizePath(candidate.path);
      if (candidate.write) {
        return deny(
          `Wrong .crabshell/ path in Bash command. The command writes "${normalizedMemoryPath}" but the project root is "${normalizedProject}". Use "${normalizedProject}/.crabshell/" instead.`,
          `[PATH_GUARD] Blocked Bash write to another project's .crabshell: ${normalizedMemoryPath}`
        );
      }
      if (!advisory && !isPluginGlobalConfig(normalizedMemoryPath)) {
        advisory = advise(normalizedMemoryPath, projectDir, `[PATH_GUARD] Bash reads another project's .crabshell: ${normalizedMemoryPath}`);
      }
    }
    return advisory;
  }

  const filePath = normalizePath(input.file_path || '');
  if (toolName === 'Edit' && filePath.endsWith('memory/logbook.md')) {
    return deny(
      'logbook.md is append-only. Use Write tool to append content, not Edit. Edit modifies existing content which violates the append-only constraint.',
      `[PATH_GUARD] Blocked Edit on logbook.md: ${filePath}`
    );
  }

  if (toolName === 'Write' && filePath.endsWith('memory/logbook.md')) {
    const newLineCount = (input.content || '').split(/\r?\n/).length;
    const nativePath = filePath.replace(/\//g, path.sep);
    if (fs.existsSync(nativePath)) {
      try {
        const existingLineCount = fs.readFileSync(nativePath, 'utf8').split(/\r?\n/).length;
        if (newLineCount < existingLineCount) {
          return deny(
            `logbook.md shrink detected: existing ${existingLineCount} lines → new ${newLineCount} lines. logbook.md is append-only — content must not be removed. Add new content without removing existing entries.`,
            `[PATH_GUARD] Blocked Write shrink on logbook.md: ${existingLineCount} → ${newLineCount} lines`
          );
        }
      } catch {
        return null;
      }
    }
  }

  if ((toolName === 'Write' || toolName === 'Edit') && (filePath.endsWith('memory/skill-active.json')
      || /memory\/session-state\/[^/]+\/skill-active\.json$/.test(filePath))) {
    return deny(
      'skill-active.json is managed by the skill-tracker hook. Direct Write/Edit is not allowed.',
      `[PATH_GUARD] Blocked ${toolName} on skill-active.json`
    );
  }

  return null;
}

// The plugin's own user-level settings file (~/.crabshell/config.json).
function isPluginGlobalConfig(normalizedPath) {
  const config = normalizePath(os.homedir()) + '/.crabshell/config.json';
  return normalizedPath.length === config.length && startsWithPath(normalizedPath, config);
}

module.exports = {
  analyzeBashCommand, // re-exported from core/shell-writes
  checkPath,
  evaluatePathPolicy,
  extractMemoryPathsFromCommand,
  hasShellVariable,
  hasUnresolvedVariables,
  resolveDotsInPath,
  resolveShellVariables,
};
