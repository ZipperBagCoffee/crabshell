#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = { dryRun: false, home: os.homedir(), force: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg.startsWith('--home=')) args.home = path.resolve(arg.slice('--home='.length));
    else if (arg.startsWith('--plugin-root=')) args.pluginRoot = path.resolve(arg.slice('--plugin-root='.length));
    else if (arg === '--help' || arg === '-h') args.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage: node scripts/install-codex.js [--dry-run] [--force] [--home=<path>] [--plugin-root=<path>]

Links this Crabshell plugin into Codex:
- ~/.agents/plugins/plugins/crabshell -> <plugin-root>
- ~/.agents/plugins/marketplace.json local crabshell entry
- ~/.codex/skills/<skill> -> <plugin-root>/codex-skills/<skill>

Use --dry-run to print actions without writing.`);
}

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function sameTarget(a, b) {
  const ra = real(a);
  const rb = real(b);
  return Boolean(ra && rb && ra === rb);
}

function ensureDir(dir, dryRun) {
  if (fs.existsSync(dir)) return;
  console.log(`create dir: ${dir}`);
  if (!dryRun) fs.mkdirSync(dir, { recursive: true });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function removeLink(linkPath, dryRun) {
  console.log(`replace link: ${linkPath}`);
  if (!dryRun) fs.rmSync(linkPath, { force: true, recursive: false });
}

function moveAside(linkPath, dryRun) {
  const backup = `${linkPath}.${stamp()}.bak`;
  console.log(`move existing path aside: ${linkPath} -> ${backup}`);
  if (!dryRun) fs.renameSync(linkPath, backup);
}

function linkDir(target, linkPath, dryRun, force) {
  if (!fs.existsSync(target)) {
    throw new Error(`Target does not exist: ${target}`);
  }

  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (sameTarget(linkPath, target)) {
      console.log(`ok link: ${linkPath} -> ${target}`);
      return;
    }
    if (!stat.isSymbolicLink() && !force) {
      throw new Error(`Refusing to replace non-symlink path: ${linkPath}. Re-run with --force if this is intentional.`);
    }
    if (stat.isSymbolicLink()) removeLink(linkPath, dryRun);
    else moveAside(linkPath, dryRun);
  }

  console.log(`link: ${linkPath} -> ${target}`);
  if (!dryRun) {
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(target, linkPath, type);
  }
}

function backupFile(file) {
  if (!fs.existsSync(file)) return null;
  const backup = `${file}.${stamp()}.bak`;
  fs.copyFileSync(file, backup);
  return backup;
}

function readMarketplace(file) {
  if (!fs.existsSync(file)) {
    return {
      name: 'local-marketplace',
      interface: { displayName: 'Local Marketplace' },
      plugins: []
    };
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function upsertMarketplace(file, dryRun) {
  const marketplace = readMarketplace(file);
  if (!marketplace.name) marketplace.name = 'local-marketplace';
  if (!marketplace.interface) marketplace.interface = { displayName: 'Local Marketplace' };
  if (!marketplace.interface.displayName) marketplace.interface.displayName = 'Local Marketplace';
  if (!Array.isArray(marketplace.plugins)) marketplace.plugins = [];

  const entry = {
    name: 'crabshell',
    source: {
      source: 'local',
      path: './plugins/crabshell'
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL'
    },
    category: 'Productivity'
  };

  const idx = marketplace.plugins.findIndex(p => p && p.name === 'crabshell');
  if (idx === -1) marketplace.plugins.push(entry);
  else marketplace.plugins[idx] = entry;

  const text = `${JSON.stringify(marketplace, null, 2)}\n`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === text) {
    console.log(`ok marketplace: ${file}`);
    return;
  }

  console.log(`${current ? 'update' : 'create'} marketplace: ${file}`);
  if (!dryRun) {
    const backup = backupFile(file);
    if (backup) console.log(`backup: ${backup}`);
    fs.writeFileSync(file, text, 'utf8');
  }
}

function installSkills(pluginRoot, home, dryRun, force) {
  const skillsRoot = path.join(pluginRoot, 'codex-skills');
  if (!fs.existsSync(skillsRoot)) {
    throw new Error(`codex-skills directory does not exist: ${skillsRoot}`);
  }

  const destRoot = path.join(home, '.codex', 'skills');
  ensureDir(destRoot, dryRun);
  for (const item of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    linkDir(path.join(skillsRoot, item.name), path.join(destRoot, item.name), dryRun, force);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const pluginRoot = path.resolve(args.pluginRoot || process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..'));
  const codexManifest = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  if (!fs.existsSync(codexManifest)) {
    throw new Error(`Not a Codex-compatible Crabshell plugin root: ${pluginRoot}`);
  }

  const agentsRoot = path.join(args.home, '.agents', 'plugins');
  const localPluginsRoot = path.join(agentsRoot, 'plugins');
  const crabshellLink = path.join(localPluginsRoot, 'crabshell');
  const marketplaceFile = path.join(agentsRoot, 'marketplace.json');

  console.log(`plugin root: ${pluginRoot}`);
  console.log(`home: ${args.home}`);
  if (args.dryRun) console.log('mode: dry-run');

  ensureDir(localPluginsRoot, args.dryRun);
  linkDir(pluginRoot, crabshellLink, args.dryRun, args.force);
  upsertMarketplace(marketplaceFile, args.dryRun);
  installSkills(pluginRoot, args.home, args.dryRun, args.force);

  console.log('Done. Restart Codex to pick up the Crabshell plugin and skills.');
}

try {
  main();
} catch (err) {
  console.error(`install-codex: ERROR: ${err.message}`);
  process.exit(1);
}
