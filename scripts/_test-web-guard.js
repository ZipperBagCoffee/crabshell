// web-guard.js test suite
// Tests: subprocess block/warn/off behavior for WebFetch and WebSearch,
// conditional WebSearch blocking (search MCP present vs absent), fail-open,
// and unit-level exports (sanitizeUrl, findSearchMcp, evaluateWebGuard).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const scriptPath = path.join(__dirname, 'web-guard.js');
const nodePath = process.execPath;

let passed = 0;
let failed = 0;

// Every temp folder this test creates is removed when the process exits, pass or fail.
const tempDirs = [];
function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of tempDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
});

function makeTempProject(config) {
  const dir = makeTempDir('webguard-test-');
  if (config) {
    const memDir = path.join(dir, '.crabshell', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify(config));
  }
  return dir;
}

function makeUserConfig(mcpServers) {
  const file = path.join(makeTempDir('webguard-cfg-'), 'claude.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: mcpServers || {} }));
  return file;
}

// D171: web-guard also reads the enabled plugins' servers from Claude Code's configuration
// folder; every check here gets an empty one, so this machine's plugins do not count.
process.env.CLAUDE_CONFIG_DIR = makeTempDir('webguard-claude-');

const EMPTY_USER_CONFIG = makeUserConfig({});
const TAVILY_USER_CONFIG = makeUserConfig({ tavily: { type: 'http', url: 'https://mcp.tavily.com/mcp' } });

// expect: 'block' | 'allow-warn' | 'allow-silent'
function runTest(name, hookData, expect, opts) {
  const options = opts || {};
  const projectDir = options.projectDir || makeTempProject(null);
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: projectDir,
    CRABSHELL_WEBGUARD_USER_CONFIG: options.userConfig || EMPTY_USER_CONFIG
  };
  delete env.CRABSHELL_BACKGROUND;
  try {
    const stdout = execSync(`"${nodePath}" "${scriptPath}"`, {
      input: JSON.stringify(hookData),
      env,
      timeout: 5000,
      encoding: 'utf8'
    });
    if (expect === 'block') {
      console.log(`FAIL: ${name} — expected block but exited 0. stdout: ${stdout}`);
      failed++;
    } else if (expect === 'allow-warn') {
      if (stdout.includes('additionalContext')) {
        console.log(`PASS: ${name} — allowed with warning`);
        passed++;
      } else {
        console.log(`FAIL: ${name} — expected warning context, got: ${stdout || '(empty)'}`);
        failed++;
      }
    } else {
      if (stdout.trim() === '') {
        console.log(`PASS: ${name} — allowed silently`);
        passed++;
      } else {
        console.log(`FAIL: ${name} — expected silent allow, got: ${stdout}`);
        failed++;
      }
    }
  } catch (e) {
    if (e.status === 2 && expect === 'block') {
      console.log(`PASS: ${name} — blocked (exit 2)`);
      passed++;
    } else {
      console.log(`FAIL: ${name} — unexpected exit ${e.status}. stdout: ${e.stdout}`);
      failed++;
    }
  }
}

// 1. WebFetch is blocked by default (fallbacks are universally available)
runTest('WebFetch blocked by default',
  { tool_name: 'WebFetch', tool_input: { url: 'https://example.com/page' } }, 'block');

// 2. WebFetch block message contains the ready-to-run fallback commands
(function () {
  try {
    execSync(`"${nodePath}" "${scriptPath}"`, {
      input: JSON.stringify({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com/a' } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: makeTempProject(null), CRABSHELL_WEBGUARD_USER_CONFIG: EMPTY_USER_CONFIG },
      timeout: 5000, encoding: 'utf8'
    });
    console.log('FAIL: WebFetch block message — expected exit 2');
    failed++;
  } catch (e) {
    const out = String(e.stdout || '');
    if (out.includes('r.jina.ai/https://example.com/a') && out.includes('trafilatura') && out.includes('curl')) {
      console.log('PASS: WebFetch block message carries URL-substituted fallback ladder');
      passed++;
    } else {
      console.log(`FAIL: WebFetch block message missing fallbacks: ${out}`);
      failed++;
    }
  }
})();

// 3. WebSearch with NO search MCP configured -> allowed with warning (fallback preserved)
runTest('WebSearch allowed+warned when no search MCP exists',
  { tool_name: 'WebSearch', tool_input: { query: 'anything' } }, 'allow-warn',
  { userConfig: EMPTY_USER_CONFIG });

// 4. WebSearch WITH a search MCP configured -> blocked with redirect to that MCP
(function () {
  try {
    execSync(`"${nodePath}" "${scriptPath}"`, {
      input: JSON.stringify({ tool_name: 'WebSearch', tool_input: { query: 'anything' } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: makeTempProject(null), CRABSHELL_WEBGUARD_USER_CONFIG: TAVILY_USER_CONFIG },
      timeout: 5000, encoding: 'utf8'
    });
    console.log('FAIL: WebSearch with tavily configured — expected block');
    failed++;
  } catch (e) {
    const out = String(e.stdout || '');
    if (e.status === 2 && out.includes('tavily')) {
      console.log('PASS: WebSearch blocked and redirected to configured tavily MCP');
      passed++;
    } else {
      console.log(`FAIL: WebSearch block missing MCP redirect (exit ${e.status}): ${out}`);
      failed++;
    }
  }
})();

// 5. Mode 'warn' downgrades WebFetch block to warning
runTest('webGuard=warn downgrades WebFetch to warning',
  { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }, 'allow-warn',
  { projectDir: makeTempProject({ webGuard: 'warn' }) });

// 6. Mode 'off' silences the guard entirely
runTest('webGuard=off allows WebFetch silently',
  { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }, 'allow-silent',
  { projectDir: makeTempProject({ webGuard: 'off' }) });

// 7. Mode 'off' silences WebSearch too, even with search MCP present
runTest('webGuard=off allows WebSearch silently despite tavily',
  { tool_name: 'WebSearch', tool_input: { query: 'q' } }, 'allow-silent',
  { projectDir: makeTempProject({ webGuard: 'off' }), userConfig: TAVILY_USER_CONFIG });

// 8. Unrelated tools pass silently
runTest('Bash passes through silently',
  { tool_name: 'Bash', tool_input: { command: 'ls' } }, 'allow-silent');

// 9. Fail-open: empty/garbage stdin exits 0
runTest('Empty hook data fails open', {}, 'allow-silent');

// 10. Fail-open: unreadable user config -> WebSearch degrades to warn, never crashes
runTest('Missing user config file degrades WebSearch to warn',
  { tool_name: 'WebSearch', tool_input: { query: 'q' } }, 'allow-warn',
  { userConfig: path.join(os.tmpdir(), 'nonexistent-claude.json') });

// 11. CRABSHELL_BACKGROUND=1 bypasses the guard
(function () {
  try {
    const stdout = execSync(`"${nodePath}" "${scriptPath}"`, {
      input: JSON.stringify({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: makeTempProject(null), CRABSHELL_BACKGROUND: '1' },
      timeout: 5000, encoding: 'utf8'
    });
    if (stdout.trim() === '') {
      console.log('PASS: CRABSHELL_BACKGROUND=1 bypasses guard');
      passed++;
    } else {
      console.log(`FAIL: background bypass produced output: ${stdout}`);
      failed++;
    }
  } catch (e) {
    console.log(`FAIL: background bypass exited ${e.status}`);
    failed++;
  }
})();

// Unit tests on exports
const guard = require('./web-guard.js');

(function () {
  const dirty = guard.sanitizeUrl('https://a.com/"x"; rm -rf `y` \n z');
  if (!dirty.includes('"') && !dirty.includes('`') && !dirty.includes(' ') && !dirty.includes('\n')) {
    console.log('PASS: sanitizeUrl strips shell-breaking characters');
    passed++;
  } else {
    console.log(`FAIL: sanitizeUrl left dangerous characters: ${dirty}`);
    failed++;
  }
})();

(function () {
  const found = guard.findSearchMcp('C:/nonexistent-project', { userConfigPath: TAVILY_USER_CONFIG, projectMcpJsonPath: 'C:/nonexistent-project/.mcp.json' });
  const notFound = guard.findSearchMcp('C:/nonexistent-project', { userConfigPath: EMPTY_USER_CONFIG, projectMcpJsonPath: 'C:/nonexistent-project/.mcp.json' });
  if (found === 'tavily' && notFound === null) {
    console.log('PASS: findSearchMcp detects tavily and returns null when absent');
    passed++;
  } else {
    console.log(`FAIL: findSearchMcp found=${found} notFound=${notFound}`);
    failed++;
  }
})();

(function () {
  // D159: several configured search servers are all named, in the default order (exa
  // before tavily) whatever order the configuration lists them in; a server that only
  // searches local code is not one of them.
  const project = 'C:/nonexistent-project';
  const noProjectFile = { projectMcpJsonPath: 'C:/nonexistent-project/.mcp.json' };
  const both = makeUserConfig({ tavily: { type: 'http', url: 'https://mcp.tavily.com/mcp' }, exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' } });
  const local = makeUserConfig({ 'codebase-search': { command: 'x' }, tavily: { type: 'http', url: 'https://mcp.tavily.com/mcp' } });
  const order = guard.findSearchMcps(project, { userConfigPath: both, ...noProjectFile });
  const reason = (guard.evaluateWebGuard({ tool_name: 'WebSearch', tool_input: { query: 'q' } }, project,
    { mode: 'block', userConfigPath: both, ...noProjectFile }) || {}).block || '';
  const onlySearch = guard.findSearchMcps(project, { userConfigPath: local, ...noProjectFile });
  if (order.join() === 'exa,tavily' && reason.indexOf('"exa"') !== -1 && reason.indexOf('"exa"') < reason.indexOf('"tavily"')
    && onlySearch.join() === 'tavily') {
    console.log('PASS: every configured search server is named, exa before tavily; local code search is not one');
    passed++;
  } else {
    console.log(`FAIL: order=${order} onlySearch=${onlySearch} reason=${reason}`);
    failed++;
  }
})();

(function () {
  // D169: a project's `searchTools` list in .crabshell/memory/config.json replaces the
  // built-in search server names and their order; without it the built-in list applies.
  // A server that only searches local code counts in neither case.
  const servers = makeUserConfig({
    'mycorp-search': { type: 'http', url: 'https://search.mycorp.example/mcp' },
    exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' },
    tavily: { type: 'http', url: 'https://mcp.tavily.com/mcp' },
    'codebase-search': { command: 'x' },
  });
  const configured = makeTempProject({ searchTools: ['mycorp-search', 'tavily'] });
  const plain = makeTempProject(null);
  const listed = guard.findSearchMcps(configured, { userConfigPath: servers, projectMcpJsonPath: path.join(configured, '.mcp.json') });
  const builtIn = guard.findSearchMcps(plain, { userConfigPath: servers, projectMcpJsonPath: path.join(plain, '.mcp.json') });
  if (listed.join() === 'mycorp-search,tavily' && builtIn.join() === 'exa,tavily') {
    console.log('PASS: searchTools in config.json replaces the built-in search server list and order');
    passed++;
  } else {
    console.log(`FAIL: searchTools listed=${listed} builtIn=${builtIn}`);
    failed++;
  }
})();

(function () {
  // D161: once this turn has called every configured search MCP, WebSearch runs as the
  // last resort; a call made before the person's last prompt does not count.
  const project = 'C:/nonexistent-project';
  const options = { mode: 'block', projectMcpJsonPath: 'C:/nonexistent-project/.mcp.json',
    userConfigPath: makeUserConfig({ tavily: { type: 'http', url: 'https://mcp.tavily.com/mcp' }, exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' } }) };
  const prompt = text => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
  const call = name => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: name, name, input: {} }] } });
  const result = name => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: name, content: 'nothing' }] } });
  const transcript = entries => {
    const file = path.join(makeTempDir('webguard-turn-'), 'session.jsonl');
    fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    return file;
  };
  const search = file => guard.evaluateWebGuard({ tool_name: 'WebSearch', tool_input: { query: 'q' }, transcript_path: file }, project, options) || {};
  const both = search(transcript([prompt('find it'), call('mcp__exa__web_search_exa'), result('mcp__exa__web_search_exa'),
    call('mcp__tavily__tavily_search'), result('mcp__tavily__tavily_search')]));
  const one = search(transcript([prompt('find it'), call('mcp__exa__web_search_exa'), result('mcp__exa__web_search_exa')]));
  const earlier = search(transcript([prompt('first'), call('mcp__exa__web_search_exa'), call('mcp__tavily__tavily_search'), prompt('second')]));
  if (!both.block && /last resort/.test(both.warn || '')
    && one.block && /not tried yet: "tavily"\./.test(one.block) && earlier.block) {
    console.log('PASS: WebSearch runs as the last resort only after every configured search MCP was called in this turn');
    passed++;
  } else {
    console.log(`FAIL: both=${JSON.stringify(both)} one=${JSON.stringify(one)} earlier=${JSON.stringify(earlier)}`);
    failed++;
  }
})();

(function () {
  // D171: the enabled plugins' MCP servers count, read as Claude Code reads them (the plugin's
  // .mcp.json, then plugin.json `mcpServers` on top: servers, a file, or a list of both), named
  // plugin:<plugin>:<server>, after the user's own servers. A server is tried only by its own
  // tools, so the user's `exa` and the plugin's `plugin:exa:exa` stay apart. Servers Claude Code
  // does not start do not count: disabled plugins, another project's install, servers switched
  // off for the project, a plugin server repeating a user server, every plugin server under
  // CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS; nor do broken plugin files.
  const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  const claude = makeTempDir('webguard-plugins-');
  const pluginRoot = name => path.join(claude, 'plugins', 'cache', 'market', name, '1.0.0');
  const installs = {};
  const install = (name, files, extra = {}) => {
    for (const [rel, value] of Object.entries(files)) writeJson(path.join(pluginRoot(name), rel), value);
    installs[`${name}@market`] = [{ scope: 'user', installPath: pluginRoot(name), ...extra }];
  };
  const manifest = (name, mcpServers) => ({ '.claude-plugin/plugin.json': mcpServers === undefined ? { name } : { name, mcpServers } });
  install('exa', manifest('exa', { exa: { type: 'http', url: 'https://mcp.exa.ai/mcp?client=claude-code-plugin' } }));
  install('pathsearch', { ...manifest('pathsearch', './servers.json'), 'servers.json': { mcpServers: { tavily: { type: 'http', url: 'https://mcp.tavily.com/mcp' } } } });
  install('rootfile', { ...manifest('rootfile'), '.mcp.json': { mcpServers: { 'brave-search': { command: 'b' } } } });
  install('both', { ...manifest('both', { firecrawl: { command: 'f' } }), '.mcp.json': { perplexity: { command: 'p' } } });
  install('mixed', { ...manifest('mixed', ['./a.json', { searxng: { command: 's' } }]), 'a.json': { ddg: { command: 'd' } } });
  install('dupe', manifest('dupe', { duckduckgo: { type: 'http', url: 'https://mcp.exa.ai/mcp' } }));
  install('offuser', manifest('offuser', { serper: { command: 'x' } }));
  install('offproject', manifest('offproject', { kagi: { command: 'x' } }));
  install('elsewhere', manifest('elsewhere', { jina: { command: 'x' } }), { scope: 'project', projectPath: 'C:/another-project' });
  writeJson(path.join(claude, 'plugins', 'installed_plugins.json'), { version: 2, plugins: installs });
  const on = ['exa', 'pathsearch', 'rootfile', 'both', 'mixed', 'dupe', 'offuser', 'offproject', 'elsewhere'];
  writeJson(path.join(claude, 'settings.json'), { enabledPlugins: { ...Object.fromEntries(on.map(name => [`${name}@market`, true])), 'offuser@market': false } });
  const project = makeTempProject(null);
  writeJson(path.join(project, '.claude', 'settings.local.json'), { enabledPlugins: { 'offproject@market': false } });
  const userConfig = path.join(makeTempDir('webguard-cfg-'), 'claude.json');
  writeJson(userConfig, { mcpServers: { exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' } },
    projects: { [project]: { disabledMcpServers: ['plugin:pathsearch:tavily'] } } });
  const options = { claudeDir: claude, projectMcpJsonPath: path.join(project, '.mcp.json'), userConfigPath: userConfig };
  const found = guard.findSearchMcps(project, options);
  const expected = 'exa,plugin:exa:exa,plugin:rootfile:brave-search,plugin:both:perplexity,plugin:both:firecrawl,plugin:mixed:searxng,plugin:mixed:ddg';
  // untriedSearchMcps reads the turn as currentTurn gives it: one { kind, name } per tool call.
  const turn = names => names.map(name => ({ kind: 'tool', name }));
  const afterPlugin = guard.untriedSearchMcps(['exa', 'plugin:exa:exa'], turn(['mcp__plugin_exa_exa__web_search_exa']));
  const afterUser = guard.untriedSearchMcps(['exa', 'plugin:exa:exa'], turn(['mcp__exa__web_search_exa']));
  // A searchTools entry that is exactly a server's name places it apart from the word match.
  const placed = makeTempProject({ searchTools: ['exa', 'brave', 'plugin:exa:exa'] });
  const placedOrder = guard.findSearchMcps(placed, { ...options, projectMcpJsonPath: path.join(placed, '.mcp.json') });
  process.env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS = '1';
  const skipped = guard.findSearchMcps(project, options);
  delete process.env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS;
  // With a configuration folder and no explicit user config, .claude.json is read from it.
  writeJson(path.join(claude, '.claude.json'), { mcpServers: { tavily: { type: 'http', url: 'https://mcp.tavily.com/mcp' } } });
  const fromFolder = guard.findSearchMcps(project, { claudeDir: claude, projectMcpJsonPath: path.join(project, '.mcp.json') });
  writeJson(path.join(claude, 'plugins', 'installed_plugins.json'), '{ broken');
  let broken = null;
  try { broken = guard.findSearchMcps(project, options); } catch (error) { broken = error.message; }
  const envFile = process.env.CRABSHELL_WEBGUARD_USER_CONFIG;
  if (found.join() === expected && afterPlugin.join() === 'exa' && afterUser.join() === 'plugin:exa:exa'
    && placedOrder.join() === 'exa,plugin:rootfile:brave-search,plugin:exa:exa' && skipped.join() === 'exa'
    && (envFile !== undefined || (fromFolder.includes('tavily') && !fromFolder.includes('exa'))) && Array.isArray(broken) && broken.join() === 'exa') {
    console.log('PASS: enabled plugins\' search servers count as Claude Code loads them, after the user\'s, each tried by its own tools; servers Claude Code does not start and broken plugin files do not');
    passed++;
  } else {
    console.log(`FAIL: found=${found} afterPlugin=${afterPlugin} afterUser=${afterUser} placed=${placedOrder} skipped=${skipped} fromFolder=${fromFolder} broken=${broken}`);
    failed++;
  }
})();

(function () {
  const res = guard.evaluateWebGuard(
    { tool_name: 'WebSearch', tool_input: { query: 'q' } },
    'C:/nonexistent-project',
    { mode: 'block', userConfigPath: EMPTY_USER_CONFIG, projectMcpJsonPath: 'C:/nonexistent-project/.mcp.json' }
  );
  if (res && res.warn && !res.block) {
    console.log('PASS: evaluateWebGuard degrades WebSearch to warn without search MCP');
    passed++;
  } else {
    console.log(`FAIL: evaluateWebGuard unexpected result: ${JSON.stringify(res)}`);
    failed++;
  }
})();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
