'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { CodexAppServer, runCodex } = require('./core/codex-app-server');
const { validateCodexHookConfig } = require('./adapters/codex/hook-contract');
const { codexAppState, deriveSupportState } = require('./core/support-state');

function parseArgs(argv) {
  const options = {
    json: false,
    writeProbe: true,
    projectDir: process.cwd(),
    pluginRoot: path.resolve(__dirname, '..'),
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    codexBin: process.env.CODEX_BIN || null,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || null,
    claudeBin: process.env.CLAUDE_BIN || null,
  };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--no-write-probe') options.writeProbe = false;
    else if (arg.startsWith('--project-dir=')) options.projectDir = arg.slice('--project-dir='.length);
    else if (arg.startsWith('--plugin-root=')) options.pluginRoot = arg.slice('--plugin-root='.length);
    else if (arg.startsWith('--codex-home=')) options.codexHome = arg.slice('--codex-home='.length);
    else if (arg.startsWith('--codex-bin=')) options.codexBin = arg.slice('--codex-bin='.length);
    else if (arg.startsWith('--claude-config-dir=')) options.claudeConfigDir = arg.slice('--claude-config-dir='.length);
    else if (arg.startsWith('--claude-bin=')) options.claudeBin = arg.slice('--claude-bin='.length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.projectDir = path.resolve(options.projectDir);
  options.pluginRoot = path.resolve(options.pluginRoot);
  options.codexHome = path.resolve(options.codexHome);
  if (options.claudeConfigDir) options.claudeConfigDir = path.resolve(options.claudeConfigDir);
  return options;
}

function check(id, status, summary, details = {}) {
  return { id, status, summary, details };
}

function parseFeatures(text) {
  const features = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+(true|false)$/);
    if (match) features[match[1]] = { stage: match[2], enabled: match[3] === 'true' };
  }
  return features;
}

function readManifest(projectDir) {
  const manifestPath = path.join(projectDir, '.codex-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.hooks !== './hooks/codex-hooks.json') {
    throw new Error(`Expected explicit Codex hooks path, found ${JSON.stringify(manifest.hooks)}.`);
  }
  const hooksPath = path.resolve(projectDir, manifest.hooks);
  validateCodexHookConfig(JSON.parse(fs.readFileSync(hooksPath, 'utf8')));
  return { manifest, manifestPath };
}

function flattenPlugins(response) {
  const rows = [];
  for (const marketplace of response.marketplaces || []) {
    for (const plugin of marketplace.plugins || []) rows.push({ marketplace, plugin });
  }
  return rows;
}

function selectPlugin(response, projectDir) {
  const normalizedProject = path.resolve(projectDir).toLowerCase();
  const candidates = flattenPlugins(response).filter(row => row.plugin.name === 'crabshell');
  const exactLocal = row => row.plugin.source && row.plugin.source.type === 'local' &&
    path.resolve(row.plugin.source.path).toLowerCase() === normalizedProject;
  return candidates.find(row => row.plugin.installed && exactLocal(row)) ||
    candidates.find(row => row.plugin.installed && row.marketplace.name === 'crabshell-repo') ||
    candidates.find(row => row.plugin.installed) || candidates.find(exactLocal) || candidates[0] || null;
}

function findInstalledCache(codexHome, pluginRow) {
  if (!pluginRow || !pluginRow.plugin.installed) return null;
  const cacheRoot = path.join(codexHome, 'plugins', 'cache', pluginRow.marketplace.name, pluginRow.plugin.name);
  if (!fs.existsSync(cacheRoot)) return null;
  const versions = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(cacheRoot, entry.name))
    .filter(candidate => fs.existsSync(path.join(candidate, '.codex-plugin', 'plugin.json')));
  const preferred = pluginRow.plugin.localVersion || pluginRow.plugin.version;
  if (preferred) {
    const match = versions.find(candidate => path.basename(candidate) === preferred);
    if (match) return match;
  }
  return versions.length === 1 ? versions[0] : null;
}

function expectedSkillNames(projectDir) {
  const root = path.join(projectDir, 'codex-skills');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

function probePluginData(dataPath) {
  fs.mkdirSync(dataPath, { recursive: true });
  const probe = path.join(dataPath, `.crabshell-doctor-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(probe, 'crabshell doctor write probe\n', { flag: 'wx' });
  const observed = fs.readFileSync(probe, 'utf8');
  fs.unlinkSync(probe);
  if (observed !== 'crabshell doctor write probe\n') throw new Error('Write probe read-back did not match.');
}

function probeHook(pluginRoot, projectDir = pluginRoot) {
  const adapter = path.join(pluginRoot, 'scripts', 'adapters', 'codex', 'pre-tool-use.js');
  const payload = {
    session_id: 'doctor-probe',
    transcript_path: null,
    cwd: projectDir,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: `cat "${path.join(path.dirname(projectDir), 'wrong-project', '.crabshell', 'memory', 'logbook.md')}"` },
    tool_use_id: 'doctor-tool',
    model: 'doctor',
    turn_id: 'doctor-turn',
  };
  const result = spawnSync(process.execPath, [adapter], {
    cwd: projectDir,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Adapter exited ${result.status}: ${result.stderr}`);
  const output = JSON.parse(result.stdout.trim());
  if (output.hookSpecificOutput?.permissionDecision !== 'deny') {
    throw new Error(`Expected native deny output, received ${result.stdout.trim() || '<empty>'}.`);
  }
  return output.hookSpecificOutput.permissionDecisionReason;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function installationDrift(sourceRoot, installedRoot, host) {
  if (!sourceRoot || !installedRoot || path.resolve(sourceRoot) === path.resolve(installedRoot)) return [];
  const manifestName = host === 'codex' ? '.codex-plugin' : '.claude-plugin';
  const hookName = host === 'codex' ? 'codex-hooks.json' : 'hooks.json';
  const pairs = [
    [path.join(sourceRoot, manifestName, 'plugin.json'), path.join(installedRoot, manifestName, 'plugin.json'), 'manifest'],
    [path.join(sourceRoot, 'hooks', hookName), path.join(installedRoot, 'hooks', hookName), 'hook-source'],
  ];
  const reasons = [];
  for (const [source, installed, label] of pairs) {
    if (!fs.existsSync(source) || !fs.existsSync(installed)) {
      reasons.push(`${label}-missing`);
    } else if (sha256(source) !== sha256(installed)) {
      reasons.push(`${label}-differs`);
    }
  }
  return reasons;
}

function runClaude(args, options) {
  const command = options.claudeBin || (process.platform === 'win32' ? 'claude.exe' : 'claude');
  const env = { ...process.env };
  if (options.claudeConfigDir) env.CLAUDE_CONFIG_DIR = options.claudeConfigDir;
  return spawnSync(command, args, {
    cwd: options.projectDir,
    env,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
}

function probeClaudeHooks(installedRoot, projectDir) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  const probes = [
    {
      script: path.join(installedRoot, 'scripts', 'load-memory.js'),
      payload: { hook_event_name: 'SessionStart', source: 'startup', cwd: projectDir, session_id: 'doctor-claude' },
      validate: output => output.hookSpecificOutput?.hookEventName === 'SessionStart',
    },
    {
      script: path.join(installedRoot, 'scripts', 'inject-rules.js'),
      payload: { hook_event_name: 'UserPromptSubmit', prompt: 'What does Crabshell do?', cwd: projectDir, session_id: 'doctor-claude' },
      validate: output => output.hookSpecificOutput?.hookEventName === 'UserPromptSubmit' &&
        /Crabshell Turn Contract/.test(output.hookSpecificOutput.additionalContext || ''),
    },
  ];
  for (const probe of probes) {
    const result = spawnSync(process.execPath, [probe.script], {
      cwd: projectDir,
      env,
      input: JSON.stringify(probe.payload),
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error(`${path.basename(probe.script)} exited ${result.status}: ${result.stderr}`);
    const output = JSON.parse(result.stdout.trim());
    if (!probe.validate(output)) throw new Error(`${path.basename(probe.script)} returned an invalid native hook contract.`);
  }
  return ['SessionStart', 'UserPromptSubmit'];
}

function probeClaudeSupport(options) {
  const version = runClaude(['--version'], options);
  const supported = version.status === 0;
  let plugins = [];
  let listError = null;
  if (supported) {
    const listed = runClaude(['plugin', 'list', '--json'], options);
    if (listed.status === 0) {
      try { plugins = JSON.parse(listed.stdout); } catch (error) { listError = error.message; }
    } else {
      listError = listed.stderr || listed.error?.message || 'plugin list failed';
    }
  }
  const plugin = plugins.find(item => String(item.id || '').startsWith('crabshell@')) || null;
  const installedRoot = plugin?.installPath && fs.existsSync(plugin.installPath) ? plugin.installPath : null;
  const activated = Boolean(plugin?.enabled && installedRoot && fs.existsSync(path.join(installedRoot, 'hooks', 'hooks.json')));
  let observedEvents = [];
  let probeError = null;
  if (activated) {
    try { observedEvents = probeClaudeHooks(installedRoot, options.projectDir); }
    catch (error) { probeError = error.message; }
  }
  const driftReasons = installedRoot ? installationDrift(options.pluginRoot, installedRoot, 'claude') : [];
  return deriveSupportState({
    supported,
    installed: Boolean(plugin && installedRoot),
    activated,
    trusted: activated,
    trustRequired: false,
    behaviorVerified: observedEvents.length === 2,
    degradedReasons: [listError && `plugin-list:${listError}`, probeError && `hook-probe:${probeError}`],
    driftReasons,
    unsupportedReasons: [supported ? null : String(version.error?.message || version.stderr || 'Claude Code CLI unavailable').trim()],
    evidence: {
      cliVersion: supported ? version.stdout.trim() : null,
      pluginId: plugin?.id || null,
      pluginVersion: plugin?.version || null,
      installPath: installedRoot,
      enabled: plugin?.enabled === true,
      trustModel: activated ? 'host-managed-no-separate-hook-hash' : null,
      observedEvents,
    },
  });
}

async function runDoctor(options) {
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    projectRoot: options.projectDir,
    pluginRoot: options.pluginRoot,
    codexHome: options.codexHome,
    checks: [],
    hosts: {},
  };
  let manifest;
  try {
    ({ manifest } = readManifest(options.pluginRoot));
    report.checks.push(check('manifest', 'ok', 'Codex manifest explicitly selects hooks/codex-hooks.json.', { version: manifest.version }));
  } catch (error) {
    report.checks.push(check('manifest', 'error', error.message));
  }

  const env = { ...process.env, CODEX_HOME: options.codexHome };
  const versionResult = runCodex(['--version'], { cwd: options.projectDir, env, codexBin: options.codexBin, timeout: 10000 });
  if (versionResult.status === 0) {
    report.codexVersion = versionResult.stdout.trim();
    report.checks.push(check('codex-cli', 'ok', `Codex CLI responded: ${report.codexVersion}.`));
  } else {
    const reason = versionResult.error?.message || versionResult.stderr || 'unknown error';
    report.checks.push(check('codex-cli', 'error', `Codex CLI did not respond: ${String(reason).trim()}`));
  }

  const featureResult = runCodex(['features', 'list'], { cwd: options.projectDir, env, codexBin: options.codexBin, timeout: 10000 });
  const features = featureResult.status === 0 ? parseFeatures(featureResult.stdout) : {};
  const requiredFeatures = ['hooks', 'plugins', 'multi_agent'];
  const missingFeatures = requiredFeatures.filter(name => !features[name]?.enabled);
  report.checks.push(check(
    'capabilities',
    featureResult.status === 0 && missingFeatures.length === 0 ? 'ok' : 'error',
    featureResult.status === 0
      ? (missingFeatures.length === 0 ? 'Required Codex capabilities are enabled.' : `Required capabilities disabled or missing: ${missingFeatures.join(', ')}.`)
      : `codex features list failed: ${(featureResult.stderr || featureResult.error?.message || '').trim()}`,
    { required: Object.fromEntries(requiredFeatures.map(name => [name, features[name] || null])) }
  ));

  let pluginRow = null;
  let cachePath = null;
  let codexHooks = [];
  let server;
  try {
    server = await new CodexAppServer({ cwd: options.projectDir, env, codexBin: options.codexBin }).start();
    const [plugins, skills, hooks] = await Promise.all([
      server.request('plugin/list', { cwds: [options.projectDir] }),
      server.request('skills/list', { cwds: [options.projectDir], forceReload: true }),
      server.request('hooks/list', { cwds: [options.projectDir] }),
    ]);

    pluginRow = selectPlugin(plugins, options.pluginRoot);
    if (!pluginRow) {
      report.checks.push(check('plugin-source', 'error', 'Crabshell was not discovered in any Codex marketplace.', { marketplaceLoadErrors: plugins.marketplaceLoadErrors || [] }));
    } else {
      report.pluginId = pluginRow.plugin.id;
      report.checks.push(check('plugin-source', 'ok', `Codex discovered ${pluginRow.plugin.id} from ${pluginRow.plugin.source.path || pluginRow.plugin.source.type}.`, {
        marketplace: pluginRow.marketplace.name,
        marketplacePath: pluginRow.marketplace.path,
        source: pluginRow.plugin.source,
        installed: pluginRow.plugin.installed,
        enabled: pluginRow.plugin.enabled,
      }));
    }

    cachePath = findInstalledCache(options.codexHome, pluginRow);
    report.checks.push(check(
      'plugin-cache',
      pluginRow?.plugin.installed && cachePath ? 'ok' : 'warn',
      pluginRow?.plugin.installed
        ? (cachePath ? `Installed cache resolved to ${cachePath}.` : 'Plugin is installed but a unique materialized cache directory was not found.')
        : 'Plugin is available but not installed in this Codex profile.',
      { path: cachePath }
    ));

    const hookEntry = (hooks.data || []).find(entry => path.resolve(entry.cwd) === options.projectDir) || hooks.data?.[0];
    const pluginHooks = (hookEntry?.hooks || []).filter(hook => hook.pluginId === pluginRow?.plugin.id);
    const legacyHooks = pluginHooks.filter(hook => path.basename(hook.sourcePath).toLowerCase() === 'hooks.json');
    codexHooks = pluginHooks.filter(hook => path.basename(hook.sourcePath).toLowerCase() === 'codex-hooks.json');
    const hookStatus = legacyHooks.length > 0 ? 'error' : codexHooks.length > 0 ? 'ok' : pluginRow?.plugin.installed ? 'error' : 'warn';
    report.checks.push(check(
      'hook-source', hookStatus,
      legacyHooks.length > 0
        ? 'Claude hooks/hooks.json was discovered for the Codex plugin.'
        : codexHooks.length > 0
          ? 'Codex discovered only the explicit hooks/codex-hooks.json plugin source.'
          : 'No installed Crabshell plugin hook source is active in this profile.',
      { hooks: pluginHooks.map(hook => ({ key: hook.key, eventName: hook.eventName, sourcePath: hook.sourcePath, enabled: hook.enabled })) }
    ));
    report.checks.push(check(
      'hook-trust',
      codexHooks.length > 0 && codexHooks.every(hook => hook.trustStatus === 'trusted' || hook.trustStatus === 'managed') ? 'ok' : 'warn',
      codexHooks.length > 0
        ? `Hook trust state: ${[...new Set(codexHooks.map(hook => hook.trustStatus))].join(', ')}.`
        : 'Hook trust state is unavailable until the plugin is installed.',
      { hooks: codexHooks.map(hook => ({ key: hook.key, currentHash: hook.currentHash, trustStatus: hook.trustStatus })) }
    ));

    const skillEntry = (skills.data || []).find(entry => path.resolve(entry.cwd) === options.projectDir) || skills.data?.[0];
    const expected = expectedSkillNames(options.pluginRoot);
    const pluginSkills = (skillEntry?.skills || []).filter(skill => {
      const normalized = path.resolve(skill.path).toLowerCase();
      return normalized.includes(`${path.sep}codex-skills${path.sep}`) &&
        (cachePath ? normalized.startsWith(cachePath.toLowerCase()) : normalized.startsWith(options.pluginRoot.toLowerCase()));
    });
    const resolvedNames = pluginSkills.map(skill => path.basename(path.dirname(skill.path))).sort();
    const missing = expected.filter(name => !resolvedNames.includes(name));
    report.checks.push(check(
      'skills',
      missing.length === 0 && expected.length > 0 ? 'ok' : pluginRow?.plugin.installed ? 'error' : 'warn',
      missing.length === 0 && expected.length > 0
        ? `Codex resolved all ${expected.length} bundled Crabshell skills.`
        : `Bundled skills unresolved in this profile: ${missing.join(', ') || 'source set unavailable'}.`,
      { expected, resolved: resolvedNames, errors: skillEntry?.errors || [] }
    ));
  } catch (error) {
    report.checks.push(check('app-server', 'error', error.message));
  } finally {
    if (server) server.close();
  }

  const marketplaceName = pluginRow?.marketplace.name || 'crabshell-repo';
  const pluginName = pluginRow?.plugin.name || manifest?.name || 'crabshell';
  const dataPath = path.join(options.codexHome, 'plugins', 'data', `${pluginName}-${marketplaceName}`);
  if (options.writeProbe) {
    try {
      probePluginData(dataPath);
      report.checks.push(check('plugin-data', 'ok', `Plugin data path is writable: ${dataPath}.`, { path: dataPath }));
    } catch (error) {
      report.checks.push(check('plugin-data', 'error', `Plugin data write probe failed: ${error.message}`, { path: dataPath }));
    }
  } else {
    report.checks.push(check('plugin-data', 'warn', 'Plugin data write probe was skipped.', { path: dataPath }));
  }

  try {
    const reason = probeHook(cachePath || options.pluginRoot, options.projectDir);
    report.checks.push(check('hook-probe', 'ok', 'Codex adapter returned the native deny contract for a wrong-project memory path.', { reason }));
  } catch (error) {
    report.checks.push(check('hook-probe', 'error', `Codex hook probe failed: ${error.message}`));
  }

  const findCheck = id => report.checks.find(item => item.id === id);
  const unsupportedReasons = [];
  if (versionResult.status !== 0) unsupportedReasons.push('codex-cli-unavailable');
  if (featureResult.status !== 0) unsupportedReasons.push('feature-probe-failed');
  for (const feature of missingFeatures) unsupportedReasons.push(`capability-disabled:${feature}`);
  const codexDrift = cachePath ? installationDrift(options.pluginRoot, cachePath, 'codex') : [];
  if (codexHooks.some(hook => hook.trustStatus === 'modified')) codexDrift.push('trusted-hook-hash-modified');
  const codexInstalled = Boolean(pluginRow?.plugin.installed && cachePath);
  const codexActivated = Boolean(codexInstalled && pluginRow.plugin.enabled &&
    findCheck('hook-source')?.status === 'ok' && findCheck('skills')?.status === 'ok');
  const codexTrusted = Boolean(codexActivated && codexHooks.length > 0 &&
    codexHooks.every(hook => hook.trustStatus === 'trusted' || hook.trustStatus === 'managed'));
  report.hosts.codexCli = deriveSupportState({
    supported: unsupportedReasons.length === 0,
    installed: codexInstalled,
    activated: codexActivated,
    trusted: codexTrusted,
    behaviorVerified: codexActivated && findCheck('hook-probe')?.status === 'ok',
    driftReasons: codexDrift,
    degradedReasons: [
      pluginRow?.plugin.installed && !cachePath ? 'installed-cache-unresolved' : null,
      pluginRow?.plugin.installed && pluginRow.plugin.enabled === false ? 'plugin-disabled' : null,
    ],
    unsupportedReasons,
    evidence: {
      cliVersion: report.codexVersion || null,
      pluginId: pluginRow?.plugin.id || null,
      pluginVersion: pluginRow?.plugin.localVersion || pluginRow?.plugin.version || null,
      installPath: cachePath,
      enabled: pluginRow?.plugin.enabled === true,
      hookEvents: [...new Set(codexHooks.map(hook => hook.eventName))].sort(),
      hookTrust: [...new Set(codexHooks.map(hook => hook.trustStatus))].sort(),
    },
  });
  report.hosts.claudeCodeCli = probeClaudeSupport(options);
  report.hosts.codexApp = codexAppState();

  const counts = { ok: 0, warn: 0, error: 0 };
  for (const item of report.checks) counts[item.status] += 1;
  report.summary = counts;
  return report;
}

function printHuman(report) {
  console.log(`Crabshell Codex doctor (${report.codexVersion || 'Codex unavailable'})`);
  for (const item of report.checks) console.log(`[${item.status.toUpperCase()}] ${item.id}: ${item.summary}`);
  console.log(`Host state: Codex CLI=${report.hosts.codexCli.status}, Claude Code CLI=${report.hosts.claudeCodeCli.status}, Codex app=${report.hosts.codexApp.status}`);
  console.log(`Summary: ${report.summary.ok} ok, ${report.summary.warn} warnings, ${report.summary.error} errors`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDoctor(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (report.summary.error > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Crabshell Codex doctor failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  expectedSkillNames,
  findInstalledCache,
  main,
  parseArgs,
  parseFeatures,
  installationDrift,
  probeClaudeHooks,
  probeClaudeSupport,
  probeHook,
  probePluginData,
  readManifest,
  runDoctor,
  selectPlugin,
};
