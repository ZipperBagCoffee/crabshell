'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { CodexAppServer, runCodex } = require('./core/codex-app-server');
const { validateCodexHookConfig } = require('./adapters/codex/hook-contract');

function parseArgs(argv) {
  const options = {
    json: false,
    writeProbe: true,
    projectDir: process.cwd(),
    pluginRoot: path.resolve(__dirname, '..'),
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    codexBin: process.env.CODEX_BIN || null,
  };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--no-write-probe') options.writeProbe = false;
    else if (arg.startsWith('--project-dir=')) options.projectDir = arg.slice('--project-dir='.length);
    else if (arg.startsWith('--plugin-root=')) options.pluginRoot = arg.slice('--plugin-root='.length);
    else if (arg.startsWith('--codex-home=')) options.codexHome = arg.slice('--codex-home='.length);
    else if (arg.startsWith('--codex-bin=')) options.codexBin = arg.slice('--codex-bin='.length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.projectDir = path.resolve(options.projectDir);
  options.pluginRoot = path.resolve(options.pluginRoot);
  options.codexHome = path.resolve(options.codexHome);
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
  return candidates.find(row => row.plugin.source && row.plugin.source.type === 'local' &&
    path.resolve(row.plugin.source.path).toLowerCase() === normalizedProject) ||
    candidates.find(row => row.marketplace.name === 'crabshell-repo') || candidates[0] || null;
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

async function runDoctor(options) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot: options.projectDir,
    pluginRoot: options.pluginRoot,
    codexHome: options.codexHome,
    checks: [],
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
    const codexHooks = pluginHooks.filter(hook => path.basename(hook.sourcePath).toLowerCase() === 'codex-hooks.json');
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

  const counts = { ok: 0, warn: 0, error: 0 };
  for (const item of report.checks) counts[item.status] += 1;
  report.summary = counts;
  return report;
}

function printHuman(report) {
  console.log(`Crabshell Codex doctor (${report.codexVersion || 'Codex unavailable'})`);
  for (const item of report.checks) console.log(`[${item.status.toUpperCase()}] ${item.id}: ${item.summary}`);
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
  probeHook,
  probePluginData,
  readManifest,
  runDoctor,
  selectPlugin,
};
