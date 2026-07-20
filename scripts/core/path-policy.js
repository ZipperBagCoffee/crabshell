'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizePath } = require('../transcript-utils');

const MEMORY_PATH_PATTERN = /\.crabshell[/\\]/;
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

function checkPath(filePath, projectDir) {
  const normalized = normalizePath(filePath);
  const normalizedProject = normalizePath(projectDir);

  if (!MEMORY_PATH_PATTERN.test(normalized)) {
    return { targets: false, valid: true };
  }

  let pathToValidate = normalized;
  if (hasShellVariable(normalized)) {
    const resolved = resolveShellVariables(normalized, normalizedProject);
    if (hasUnresolvedVariables(resolved)) {
      return { targets: true, valid: false };
    }
    pathToValidate = resolved;
  }

  const resolvedPath = resolveDotsInPath(pathToValidate);
  const resolvedProject = resolveDotsInPath(normalizedProject);
  const expectedPrefix = resolvedProject.replace(/\/+$/, '') + '/' + MEMORY_PATH_SEGMENT;
  if (resolvedPath.startsWith(expectedPrefix)) {
    return { targets: true, valid: true };
  }

  if (resolvedPath === '.crabshell/' || resolvedPath.startsWith('.crabshell/') ||
      resolvedPath === './.crabshell/' || resolvedPath.startsWith('./.crabshell/')) {
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

function evaluatePathPolicy(hookData, projectDir) {
  if (!hookData || !hookData.tool_name || !hookData.tool_input) return null;
  const toolName = hookData.tool_name;
  const input = hookData.tool_input;
  const normalizedProject = normalizePath(projectDir);

  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
    const filePath = input.file_path || input.path || '';
    if (!filePath) return null;
    const result = checkPath(filePath, projectDir);
    if (!result.targets || result.valid) return null;
    const normalizedFile = normalizePath(filePath);
    return deny(
      `Wrong .crabshell/ path detected. You are accessing "${normalizedFile}" but the project root is "${normalizedProject}". Use "${normalizedProject}/.crabshell/" instead.`,
      `[PATH_GUARD] Blocked ${toolName}: ${normalizedFile}`
    );
  }

  if (toolName === 'Bash') {
    const command = input.command || '';
    if (!command) return null;
    for (const memoryPath of extractMemoryPathsFromCommand(command)) {
      const result = checkPath(memoryPath, projectDir);
      if (result.targets && !result.valid) {
        const normalizedMemoryPath = normalizePath(memoryPath);
        return deny(
          `Wrong .crabshell/ path in Bash command. Found "${normalizedMemoryPath}" but the project root is "${normalizedProject}". Use "${normalizedProject}/.crabshell/" instead.`,
          `[PATH_GUARD] Blocked Bash command with wrong path: ${normalizedMemoryPath}`
        );
      }
    }
    return null;
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

  if ((toolName === 'Write' || toolName === 'Edit') && filePath.endsWith('memory/skill-active.json')) {
    return deny(
      'skill-active.json is managed by the skill-tracker hook. Direct Write/Edit is not allowed.',
      `[PATH_GUARD] Blocked ${toolName} on skill-active.json`
    );
  }

  return null;
}

module.exports = {
  checkPath,
  evaluatePathPolicy,
  extractMemoryPathsFromCommand,
  hasShellVariable,
  hasUnresolvedVariables,
  resolveDotsInPath,
  resolveShellVariables,
};
