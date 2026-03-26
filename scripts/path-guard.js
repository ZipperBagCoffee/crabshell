'use strict';

const path = require('path');

// --- Shared infrastructure (same pattern as regressing-guard.js) ---

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

// --- Path validation logic ---

const MEMORY_PATH_PATTERN = /\.claude[/\\]memory[/\\](?!keeper)/;
const MEMORY_PATH_SEGMENT = '.claude/memory/';

/**
 * Normalize a path: backslash → forward slash.
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Resolve '..' and '.' segments in a normalized (forward-slash) path.
 * Does NOT use path.resolve() to avoid prepending cwd for relative paths.
 */
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

/**
 * Check if a path contains unresolvable shell constructs ($VAR, ~, etc.)
 * that make static analysis impossible.
 */
function hasShellVariable(p) {
  return /^\$|\/\$|^\~\/|^\~$/.test(p);
}

/**
 * Check if a path targets .claude/memory/ and whether it's under the correct project root.
 * Returns { targets: boolean, valid: boolean }
 */
function checkPath(filePath, projectDir) {
  const normalized = normalizePath(filePath);
  const normalizedProject = normalizePath(projectDir);

  if (!MEMORY_PATH_PATTERN.test(normalized)) {
    return { targets: false, valid: true }; // Not a .claude/memory/ path — irrelevant
  }

  // Allow paths with unresolvable shell variables ($HOME, ~, $CLAUDE_PROJECT_DIR, etc.)
  // These can't be validated at hook time — fail-open to avoid false positives
  if (hasShellVariable(normalized)) {
    return { targets: true, valid: true };
  }

  // Resolve .. segments before comparison
  const resolvedPath = resolveDotsInPath(normalized);
  const resolvedProject = resolveDotsInPath(normalizedProject);

  // Check if resolved path starts with projectDir/.claude/memory/
  const expectedPrefix = resolvedProject.replace(/\/+$/, '') + '/' + MEMORY_PATH_SEGMENT;
  if (resolvedPath.startsWith(expectedPrefix)) {
    return { targets: true, valid: true };
  }

  // Allow relative paths: .claude/memory/... or ./.claude/memory/...
  if (resolvedPath === '.claude/memory/' || resolvedPath.startsWith('.claude/memory/') ||
      resolvedPath === './.claude/memory/' || resolvedPath.startsWith('./.claude/memory/')) {
    return { targets: true, valid: true };
  }

  return { targets: true, valid: false };
}

/**
 * Extract .claude/memory/ paths from a Bash command string (IA-3).
 * Returns array of paths that contain .claude/memory/.
 */
function extractMemoryPathsFromCommand(command) {
  const paths = [];
  let match;

  // Phase 1: Extract paths from quoted strings (handles spaces in paths)
  // Match the full quoted content, then extract the path portion starting
  // with a path-like prefix (drive letter, /, ., ~, $) through .claude/memory/...
  const quotedRegex = /(["'])((?:(?!\1).)*)\1/g;
  while ((match = quotedRegex.exec(command)) !== null) {
    const content = match[2];
    const pathMatch = content.match(/(?:[A-Za-z]:[/\\]|[/\\~$.])[^"']*?\.claude[/\\]memory[/\\]?[^"']*/);
    if (pathMatch) {
      paths.push(pathMatch[0]);
    }
  }

  // Phase 2: Strip quoted strings, then extract unquoted paths (no spaces)
  const stripped = command.replace(/(["'])(?:(?!\1).)*\1/g, ' ');

  const unquotedRegex = /([^\s"']*\.claude[/\\]memory[/\\][^\s"']*)/g;
  while ((match = unquotedRegex.exec(stripped)) !== null) {
    paths.push(match[1]);
  }

  // Phase 3: Paths ending at .claude/memory (no trailing content)
  const unquotedSimple = /([^\s"']*\.claude[/\\]memory)\b/g;
  while ((match = unquotedSimple.exec(stripped)) !== null) {
    if (!paths.some(p => p.startsWith(match[1]))) {
      paths.push(match[1] + '/');
    }
  }

  return paths;
}

// --- Main ---

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const projectDir = getProjectDir();

  // --- Read, Grep, Glob: check file_path or path ---
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
    const filePath = input.file_path || input.path || '';
    if (!filePath) { process.exit(0); return; }

    const result = checkPath(filePath, projectDir);
    if (!result.targets) { process.exit(0); return; } // Not a .claude/memory/ path
    if (result.valid) { process.exit(0); return; }    // Correct project root

    // Block — wrong .claude/memory/ path
    const output = {
      decision: "block",
      reason: `Wrong .claude/memory/ path detected. You are accessing "${normalizePath(filePath)}" but the project root is "${normalizePath(projectDir)}". Use "${normalizePath(projectDir)}/.claude/memory/" instead.`
    };
    process.stderr.write(`[PATH_GUARD] Blocked ${toolName}: ${normalizePath(filePath)}\n`);
    console.log(JSON.stringify(output));
    process.exit(2);
    return;
  }

  // --- Bash: scan command string for .claude/memory/ paths (IA-3) ---
  if (toolName === 'Bash') {
    const command = input.command || '';
    if (!command) { process.exit(0); return; }

    const memoryPaths = extractMemoryPathsFromCommand(command);
    if (memoryPaths.length === 0) { process.exit(0); return; } // No .claude/memory/ in command

    for (const mp of memoryPaths) {
      const result = checkPath(mp, projectDir);
      if (result.targets && !result.valid) {
        const output = {
          decision: "block",
          reason: `Wrong .claude/memory/ path in Bash command. Found "${normalizePath(mp)}" but the project root is "${normalizePath(projectDir)}". Use "${normalizePath(projectDir)}/.claude/memory/" instead.`
        };
        process.stderr.write(`[PATH_GUARD] Blocked Bash command with wrong path: ${normalizePath(mp)}\n`);
        console.log(JSON.stringify(output));
        process.exit(2);
        return;
      }
    }

    // All paths valid or not targeting .claude/memory/
    process.exit(0);
    return;
  }

  // Other tools — allow
  process.exit(0);
}

main().catch(e => {
  console.error(`[PATH GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
