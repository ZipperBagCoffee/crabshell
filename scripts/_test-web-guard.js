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

function makeTempProject(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webguard-test-'));
  if (config) {
    const memDir = path.join(dir, '.crabshell', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify(config));
  }
  return dir;
}

function makeUserConfig(mcpServers) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webguard-cfg-')), 'claude.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: mcpServers || {} }));
  return file;
}

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
