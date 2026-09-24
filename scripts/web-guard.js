'use strict';

const { readStdin } = require('./transcript-utils');

// Keep the host wrapper fail-open during background summarization (same as path-guard).
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getStorageRoot, getProjectDir } = require('./utils');

// Web search providers, matched as whole words of a server name ("brave-search",
// "mcp-exa"). A bare "search" is not enough: "codebase-search" searches local code.
const SEARCH_MCP_HINTS = [
  'tavily', 'brave', 'exa', 'serper', 'perplexity', 'jina', 'firecrawl',
  'kagi', 'searxng', 'duckduckgo', 'ddg', 'websearch', 'web-search'
];
const SEARCH_MCP_PATTERN = new RegExp('(?:^|[^a-z0-9])(?:' + SEARCH_MCP_HINTS.join('|') + ')(?:[^a-z0-9]|$)');

// Modes: 'block' (default) | 'warn' | 'off'
function getMode(projectDir) {
  try {
    const configPath = path.join(getStorageRoot(projectDir), 'memory', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config && typeof config.webGuard === 'string') {
      const mode = config.webGuard.toLowerCase();
      if (mode === 'warn' || mode === 'off' || mode === 'block') return mode;
    }
  } catch { /* no config or unreadable -> default */ }
  return 'block';
}

// Claude Code keys ~/.claude.json projects by absolute path; compare slash- and
// (on Windows) case-insensitively.
function sameProjectPath(a, b) {
  const clean = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? clean(a).toLowerCase() === clean(b).toLowerCase() : clean(a) === clean(b);
}

// Servers this project can use: user-wide, this project's entry in the user config,
// and the project .mcp.json. Other projects' servers are not available here.
function collectMcpServerNames(userConfigPath, projectMcpJsonPath, projectDir) {
  const names = [];
  try {
    const raw = fs.readFileSync(userConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.mcpServers) names.push(...Object.keys(parsed.mcpServers));
    if (parsed && parsed.projects) {
      for (const [key, proj] of Object.entries(parsed.projects)) {
        if (proj && proj.mcpServers && sameProjectPath(key, projectDir)) names.push(...Object.keys(proj.mcpServers));
      }
    }
  } catch { /* unreadable user config -> ignore */ }
  try {
    const raw = fs.readFileSync(projectMcpJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.mcpServers) names.push(...Object.keys(parsed.mcpServers));
  } catch { /* no project .mcp.json -> ignore */ }
  return names;
}

function findSearchMcp(projectDir, overrides) {
  const userConfigPath = (overrides && overrides.userConfigPath) ||
    process.env.CRABSHELL_WEBGUARD_USER_CONFIG ||
    path.join(os.homedir(), '.claude.json');
  const projectMcpJsonPath = (overrides && overrides.projectMcpJsonPath) ||
    path.join(projectDir, '.mcp.json');
  const names = collectMcpServerNames(userConfigPath, projectMcpJsonPath, projectDir);
  for (const name of names) {
    if (SEARCH_MCP_PATTERN.test(String(name).toLowerCase())) return name;
  }
  return null;
}

// Strip characters that would break the suggested shell commands.
function sanitizeUrl(url) {
  return String(url || '').replace(/["'`\\\r\n\s]/g, '').slice(0, 2000);
}

function webFetchBlockReason(url) {
  const safeUrl = sanitizeUrl(url);
  const target = safeUrl || '<URL>';
  return 'Crabshell web-guard: WebFetch pipes the page through a small summarizer model before the main model sees it (lossy by design; hallucination risk). Read the source directly instead, in this order: ' +
    `(1) trafilatura -u "${target}" --markdown --links (if installed); ` +
    `(2) curl -fsSL "https://r.jina.ai/${target}" (JS-rendered pages, no key needed); ` +
    `(3) curl -fsSL --compressed "${target}" (raw HTML fallback). ` +
    'Cite the source URL beside every factual claim.';
}

function webSearchBlockReason(serverName) {
  return `Crabshell web-guard: built-in WebSearch summarizes results via a small model and loses source attribution. Use the "${serverName}" MCP search tools instead (raw results with per-result URLs). Treat snippets as pointers, not evidence — fetch important pages before citing them.`;
}

const WEBSEARCH_WARN_CONTEXT = 'Crabshell web-guard notice: built-in WebSearch results pass through a small summarizer model. Use the returned URLs only as pointers — fetch each important source directly (trafilatura -u <url> --markdown, or curl -fsSL https://r.jina.ai/<url>, or plain curl) before citing it. Never cite a search snippet as evidence.';

const WEBFETCH_WARN_CONTEXT = 'Crabshell web-guard notice: WebFetch content passes through a small summarizer model and may drop or distort details. Re-fetch anything you intend to cite (trafilatura -u <url> --markdown, or curl -fsSL https://r.jina.ai/<url>, or plain curl) and quote from the raw text.';

// Returns null (allow silently), { warn: <context string> }, or { block: <reason string> }.
function evaluateWebGuard(hookData, projectDir, overrides) {
  const toolName = hookData && hookData.tool_name;
  if (toolName !== 'WebFetch' && toolName !== 'WebSearch') return null;

  const mode = (overrides && overrides.mode) || getMode(projectDir);
  if (mode === 'off') return null;

  if (toolName === 'WebFetch') {
    const url = hookData.tool_input && hookData.tool_input.url;
    if (mode === 'warn') return { warn: WEBFETCH_WARN_CONTEXT };
    return { block: webFetchBlockReason(url) };
  }

  // WebSearch: block only when a configured search MCP alternative exists.
  // Machines without one keep the built-in search (degraded to warn) — never
  // leave a user with no search path at all.
  const searchMcp = findSearchMcp(projectDir, overrides);
  if (mode === 'block' && searchMcp) return { block: webSearchBlockReason(searchMcp) };
  return { warn: WEBSEARCH_WARN_CONTEXT };
}

async function main() {
  const hookData = await readStdin();
  const result = evaluateWebGuard(hookData, getProjectDir());
  if (!result) return;
  if (result.block) {
    console.log(JSON.stringify({ decision: 'block', reason: result.block }));
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: result.warn
    }
  }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[WEB GUARD ERROR] ${error.message}`);
    process.exitCode = 0;
  });
}

module.exports = { evaluateWebGuard, findSearchMcp, getMode, sanitizeUrl, collectMcpServerNames };
