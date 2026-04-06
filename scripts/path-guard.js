'use strict';

const path = require('path');
const os = require('os');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

// --- Path validation logic ---

const MEMORY_PATH_PATTERN = /\.crabshell[/\\]/;
const MEMORY_PATH_SEGMENT = '.crabshell/';

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
 * Check if a path contains shell variable constructs ($VAR, ${VAR}, ~)
 * or subshell/backtick patterns that need resolution before validation.
 */
function hasShellVariable(p) {
  // $VAR at start or after /, ~ at start, ${VAR}, $(cmd), `cmd`
  return /^\$|\/\$|^\~\/|^\~$|\$\{|\$\(|`/.test(p);
}

/**
 * Resolve known shell variables in a path.
 * $CLAUDE_PROJECT_DIR, $PROJECT_DIR → projectDir
 * $HOME, $USERPROFILE, ~ → os.homedir()
 * ${VAR} brace syntax also supported for the above.
 * Returns the resolved path. Unknown variables are left as-is.
 */
function resolveShellVariables(normalizedPath, projectDir) {
  let resolved = normalizedPath;
  const home = normalizePath(os.homedir());

  // Resolve ~ at start of path
  resolved = resolved.replace(/^~(?=\/|$)/, home);

  // Resolve known env vars (both $VAR and ${VAR} forms)
  const knownVars = {
    'CLAUDE_PROJECT_DIR': projectDir,
    'PROJECT_DIR': projectDir,
    'HOME': home,
    'USERPROFILE': home,
  };

  for (const [varName, value] of Object.entries(knownVars)) {
    // ${VAR} form
    resolved = resolved.split('${' + varName + '}').join(value);
    // $VAR form (only when followed by / or end of string)
    resolved = resolved.replace(new RegExp('\\$' + varName + '(?=/|$)', 'g'), value);
  }

  return resolved;
}

/**
 * Check if a path still contains unresolved shell variables or subshell patterns after resolution.
 */
function hasUnresolvedVariables(p) {
  // $VAR, ${VAR}, $(cmd), `cmd`
  return /\$[A-Za-z_]|\$\{|\$\(|`/.test(p);
}

/**
 * Check if a path targets .crabshell/ and whether it's under the correct project root.
 * Returns { targets: boolean, valid: boolean }
 */
function checkPath(filePath, projectDir) {
  const normalized = normalizePath(filePath);
  const normalizedProject = normalizePath(projectDir);

  if (!MEMORY_PATH_PATTERN.test(normalized)) {
    return { targets: false, valid: true }; // Not a .crabshell/ path — irrelevant
  }

  // Resolve known shell variables before validation
  let pathToValidate = normalized;
  if (hasShellVariable(normalized)) {
    const resolved = resolveShellVariables(normalized, normalizedProject);
    if (hasUnresolvedVariables(resolved)) {
      // Still has unknown vars/subshells AND targets .crabshell/ → block
      return { targets: true, valid: false };
    }
    pathToValidate = resolved;
  }

  // Resolve .. segments before comparison
  const resolvedPath = resolveDotsInPath(pathToValidate);
  const resolvedProject = resolveDotsInPath(normalizedProject);

  // Check if resolved path starts with projectDir/.crabshell/
  const expectedPrefix = resolvedProject.replace(/\/+$/, '') + '/' + MEMORY_PATH_SEGMENT;
  if (resolvedPath.startsWith(expectedPrefix)) {
    return { targets: true, valid: true };
  }

  // Allow relative paths: .crabshell/... or ./.crabshell/...
  if (resolvedPath === '.crabshell/' || resolvedPath.startsWith('.crabshell/') ||
      resolvedPath === './.crabshell/' || resolvedPath.startsWith('./.crabshell/')) {
    return { targets: true, valid: true };
  }

  return { targets: true, valid: false };
}

/**
 * Extract .crabshell/ paths from a Bash command string (IA-3).
 * Returns array of paths that contain .crabshell/.
 */
function extractMemoryPathsFromCommand(command) {
  const paths = [];
  let match;

  // Phase 1: Extract paths from quoted strings (handles spaces in paths)
  // Match the full quoted content, then extract the path portion starting
  // with a path-like prefix (drive letter, /, ., ~, $) through .crabshell/...
  const quotedRegex = /(["'])((?:(?!\1).)*)\1/g;
  while ((match = quotedRegex.exec(command)) !== null) {
    const content = match[2];
    const pathMatch = content.match(/(?:[A-Za-z]:[/\\]|[/\\~$.])[^"']*?\.crabshell[/\\]?[^"']*/);
    if (pathMatch) {
      paths.push(pathMatch[0]);
    }
  }

  // Phase 2: Strip quoted strings, then extract unquoted paths (no spaces)
  const stripped = command.replace(/(["'])(?:(?!\1).)*\1/g, ' ');

  const unquotedRegex = /([^\s"']*\.crabshell[/\\][^\s"']*)/g;
  while ((match = unquotedRegex.exec(stripped)) !== null) {
    paths.push(match[1]);
  }

  // Phase 3: Paths ending at .crabshell (no trailing content)
  const unquotedSimple = /([^\s"']*\.crabshell)\b/g;
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
    if (!result.targets) { process.exit(0); return; } // Not a .crabshell/ path
    if (result.valid) { process.exit(0); return; }    // Correct project root

    // Block — wrong .crabshell/ path
    const output = {
      decision: "block",
      reason: `Wrong .crabshell/ path detected. You are accessing "${normalizePath(filePath)}" but the project root is "${normalizePath(projectDir)}". Use "${normalizePath(projectDir)}/.crabshell/" instead.`
    };
    process.stderr.write(`[PATH_GUARD] Blocked ${toolName}: ${normalizePath(filePath)}\n`);
    console.log(JSON.stringify(output));
    process.exit(2);
    return;
  }

  // --- Bash: scan command string for .crabshell/ paths (IA-3) ---
  if (toolName === 'Bash') {
    const command = input.command || '';
    if (!command) { process.exit(0); return; }

    const memoryPaths = extractMemoryPathsFromCommand(command);
    if (memoryPaths.length === 0) { process.exit(0); return; } // No .crabshell/ in command

    for (const mp of memoryPaths) {
      const result = checkPath(mp, projectDir);
      if (result.targets && !result.valid) {
        const output = {
          decision: "block",
          reason: `Wrong .crabshell/ path in Bash command. Found "${normalizePath(mp)}" but the project root is "${normalizePath(projectDir)}". Use "${normalizePath(projectDir)}/.crabshell/" instead.`
        };
        process.stderr.write(`[PATH_GUARD] Blocked Bash command with wrong path: ${normalizePath(mp)}\n`);
        console.log(JSON.stringify(output));
        process.exit(2);
        return;
      }
    }

    // All paths valid or not targeting .crabshell/
    process.exit(0);
    return;
  }

  // --- Edit on logbook.md: block (append-only via Write) ---
  if (toolName === 'Edit') {
    const filePath = normalizePath(input.file_path || '');
    if (filePath.endsWith('memory/logbook.md')) {
      const output = {
        decision: "block",
        reason: "logbook.md is append-only. Use Write tool to append content, not Edit. Edit modifies existing content which violates the append-only constraint."
      };
      process.stderr.write(`[PATH_GUARD] Blocked Edit on logbook.md: ${filePath}\n`);
      console.log(JSON.stringify(output));
      process.exit(2);
      return;
    }
  }

  // --- Write shrink guard on logbook.md: block if new content has fewer lines ---
  if (toolName === 'Write') {
    const filePath = normalizePath(input.file_path || '');
    if (filePath.endsWith('memory/logbook.md')) {
      const newContent = input.content || '';
      const newLineCount = newContent.split('\n').length;
      const fs = require('fs');
      if (fs.existsSync(filePath.replace(/\//g, path.sep))) {
        try {
          const existing = fs.readFileSync(filePath.replace(/\//g, path.sep), 'utf8');
          const existingLineCount = existing.split('\n').length;
          if (newLineCount < existingLineCount) {
            const output = {
              decision: "block",
              reason: `logbook.md shrink detected: existing ${existingLineCount} lines → new ${newLineCount} lines. logbook.md is append-only — content must not be removed. Add new content without removing existing entries.`
            };
            process.stderr.write(`[PATH_GUARD] Blocked Write shrink on logbook.md: ${existingLineCount} → ${newLineCount} lines\n`);
            console.log(JSON.stringify(output));
            process.exit(2);
            return;
          }
        } catch (e) {
          // fail-open: if we can't read existing file, allow the write
        }
      }
    }
  }

  // --- skill-active.json: block direct model writes ---
  if (toolName === 'Write' || toolName === 'Edit') {
    const fp = normalizePath(input.file_path || '');
    if (fp.endsWith('memory/skill-active.json')) {
      const output = { decision: "block", reason: "skill-active.json is managed by the skill-tracker hook. Direct Write/Edit is not allowed." };
      process.stderr.write(`[PATH_GUARD] Blocked ${toolName} on skill-active.json\n`);
      console.log(JSON.stringify(output));
      process.exit(2);
      return;
    }
  }

  // Other tools — allow
  process.exit(0);
}

if (require.main === module) {
  main().catch(e => {
    console.error(`[PATH GUARD ERROR] ${e.message}`);
    process.exit(0); // fail-open
  });
}

module.exports = {
  checkPath, hasShellVariable, resolveShellVariables, hasUnresolvedVariables,
  resolveDotsInPath, extractMemoryPathsFromCommand
};
