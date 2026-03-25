'use strict';

const path = require('path');

// --- Shared infrastructure (same pattern as regressing-guard.js) ---

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

function readStdin(timeoutMs = 500) {
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

const MEMORY_PATH_PATTERN = /\.claude[/\\]memory[/\\]/;
const MEMORY_PATH_SEGMENT = '.claude/memory/';

/**
 * Normalize a path: backslash → forward slash, resolve to absolute.
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
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

  // Check if path starts with projectDir/.claude/memory/
  const expectedPrefix = normalizedProject.replace(/\/+$/, '') + '/' + MEMORY_PATH_SEGMENT;
  // Also allow relative .claude/memory/ (starts with .claude/memory/ without preceding directory)
  if (normalized.startsWith(expectedPrefix)) {
    return { targets: true, valid: true };
  }

  // Allow relative paths: .claude/memory/... or ./.claude/memory/...
  if (normalized === '.claude/memory/' || normalized.startsWith('.claude/memory/') ||
      normalized === './.claude/memory/' || normalized.startsWith('./.claude/memory/')) {
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
  // Match quoted and unquoted path-like strings containing .claude/memory/
  // Pattern: optional prefix chars, then something/.claude/memory/something
  const regex = /(?:["']?)([^\s"']*\.claude[/\\]memory[/\\][^\s"']*)/g;
  let match;
  while ((match = regex.exec(command)) !== null) {
    paths.push(match[1]);
  }
  // Also check for paths where .claude/memory/ appears without trailing content
  const simpleRegex = /(?:["']?)([^\s"']*\.claude[/\\]memory)\b/g;
  while ((match = simpleRegex.exec(command)) !== null) {
    // Avoid duplicates
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
