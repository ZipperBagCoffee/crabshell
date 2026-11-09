'use strict';

const { readStdin } = require('./transcript-utils');

// Keep the host wrapper fail-open during background summarization (same as path-guard).
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getStorageRoot, getProjectDir } = require('./utils');
const { currentTurn } = require('./core/transcript');

// Web search providers, matched as whole words of a server name ("brave-search",
// "mcp-exa"). A bare "search" is not enough: "codebase-search" searches local code.
// The order is the default preference when several are configured (exa first, then
// tavily, D159); the block message tells Claude to follow its instructions instead
// when they rank the tools differently.
const SEARCH_MCP_HINTS = [
  'exa', 'tavily', 'brave', 'serper', 'perplexity', 'jina', 'firecrawl',
  'kagi', 'searxng', 'duckduckgo', 'ddg', 'websearch', 'web-search'
];
const hintPattern = hint => new RegExp('(?:^|[^a-z0-9])' + hint + '(?:[^a-z0-9]|$)');
const SEARCH_MCP_PATTERN = new RegExp('(?:^|[^a-z0-9])(?:' + SEARCH_MCP_HINTS.join('|') + ')(?:[^a-z0-9]|$)');
const HINT_PATTERNS = SEARCH_MCP_HINTS.map(hintPattern);

// A search server's place in the default order: the first hint its name matches.
function searchRank(name) {
  const lower = String(name).toLowerCase();
  const rank = HINT_PATTERNS.findIndex(pattern => pattern.test(lower));
  return rank === -1 ? SEARCH_MCP_HINTS.length : rank;
}

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

// Every search server this project can use, once each, in the default order (ties keep
// the configuration's order).
function findSearchMcps(projectDir, overrides) {
  const userConfigPath = (overrides && overrides.userConfigPath) ||
    process.env.CRABSHELL_WEBGUARD_USER_CONFIG ||
    path.join(os.homedir(), '.claude.json');
  const projectMcpJsonPath = (overrides && overrides.projectMcpJsonPath) ||
    path.join(projectDir, '.mcp.json');
  const names = collectMcpServerNames(userConfigPath, projectMcpJsonPath, projectDir);
  const found = [...new Set(names)].filter(name => SEARCH_MCP_PATTERN.test(String(name).toLowerCase()));
  return found.map((name, index) => ({ name, index, rank: searchRank(name) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(item => item.name);
}

// The search server to use first, or null when none is configured.
function findSearchMcp(projectDir, overrides) {
  return findSearchMcps(projectDir, overrides)[0] || null;
}

// Strip characters that would break the suggested shell commands.
function sanitizeUrl(url) {
  return String(url || '').replace(/["'`\\\r\n\s]/g, '').slice(0, 2000);
}

function webFetchBlockReason(url) {
  const safeUrl = sanitizeUrl(url);
  const target = safeUrl || '<URL>';
  return 'Crabshell web-guard: WebFetch passes the page through a small summarizer model, which can drop or distort details. Read the source text directly, for example: ' +
    `(1) trafilatura -u "${target}" --markdown --links, if installed; ` +
    `(2) curl -fsSL "https://r.jina.ai/${target}" for JS-rendered pages, no key needed; ` +
    `(3) curl -fsSL --compressed "${target}" as the raw HTML fallback. ` +
    'Cite the source URL beside every factual claim.';
}

function webSearchBlockReason(serverNames, untried = serverNames) {
  const use = serverNames.length === 1
    ? `Use the "${serverNames[0]}" MCP search tools instead (raw results with per-result URLs).`
    : `Use the configured MCP search tools instead (raw results with per-result URLs), in this order unless your instructions rank them differently: ${serverNames.map(name => `"${name}"`).join(', then ')}. Move to the next one when a tool is unavailable, hits its rate limit or finds too little.`;
  const lastResort = `Built-in WebSearch is allowed in this turn as the last resort once each of them has been tried (and any other route your instructions name before it); not tried yet: ${untried.map(name => `"${name}"`).join(', ')}.`;
  return `Crabshell web-guard: built-in WebSearch summarizes results via a small model and loses source attribution. ${use} ${lastResort} Treat snippets as pointers, not evidence — fetch important pages before citing them.`;
}

// Whether a tool name belongs to an MCP server: `mcp__<server>__<tool>`, or
// `mcp__plugin_<plugin>_<server>__<tool>` for a plugin's server. The host replaces
// characters a tool name cannot hold with "_".
function serverInToolName(serverName, toolName) {
  const match = /^mcp__(.+?)__/.exec(String(toolName || '').toLowerCase());
  if (!match) return false;
  const server = String(serverName).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return match[1] === server || match[1].endsWith(`_${server}`);
}

// The configured search servers this turn has not called yet (D161). Unknown when the
// transcript cannot be read: then every server counts as untried.
function untriedSearchMcps(serverNames, turn) {
  if (!Array.isArray(turn)) return serverNames;
  const called = turn.filter(item => item.kind === 'tool').map(item => item.name);
  return serverNames.filter(server => !called.some(name => serverInToolName(server, name)));
}

const WEBSEARCH_WARN_CONTEXT = 'Crabshell web-guard notice: built-in WebSearch results pass through a small summarizer model. Use the URLs only as pointers. Read each important source in full before citing it (for example trafilatura -u <url> --markdown, curl -fsSL https://r.jina.ai/<url>, or plain curl). Never cite a search snippet as evidence.';

const WEBSEARCH_LAST_RESORT_CONTEXT = 'Crabshell web-guard notice: every configured search MCP was tried in this turn, so built-in WebSearch runs as the last resort. Say which searches failed or found too little. Its results pass through a small summarizer model: use the URLs only as pointers and fetch each important source directly before citing it (trafilatura -u <url> --markdown, curl -fsSL https://r.jina.ai/<url>, or plain curl).';

const WEBFETCH_WARN_CONTEXT ='Crabshell web-guard notice: WebFetch content passes through a small summarizer model and may drop or distort details. Re-read anything you will cite from the source itself (for example trafilatura -u <url> --markdown, curl -fsSL https://r.jina.ai/<url>, or plain curl) and quote it.';

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
  // leave a user with no search path at all. D161: once this turn has called every
  // configured search MCP, the built-in search runs as the last resort.
  const searchMcps = findSearchMcps(projectDir, overrides);
  if (mode === 'block' && searchMcps.length) {
    const untried = untriedSearchMcps(searchMcps, currentTurn(hookData.transcript_path));
    return untried.length ? { block: webSearchBlockReason(searchMcps, untried) } : { warn: WEBSEARCH_LAST_RESORT_CONTEXT };
  }
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

module.exports = { evaluateWebGuard, findSearchMcp, findSearchMcps, getMode, sanitizeUrl, collectMcpServerNames, serverInToolName, untriedSearchMcps };
