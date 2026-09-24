'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TRIGGER_PATTERN = /\[CRABSHELL_[A-Z_]+\]/g;

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function looksMachineAbsolute(value) {
  if (typeof value !== 'string') return false;
  return /^[A-Za-z]:[\\/]/.test(value)
    || /^~[\\/]/.test(value)
    || /^\/(?:Users|home|tmp|var|opt|mnt|private|Program Files)(?:\/|$)/i.test(value);
}

function resolveInside(projectRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${label} must be a non-empty repo-relative path`);
  }
  if (path.isAbsolute(relativePath) || looksMachineAbsolute(relativePath)) {
    throw new Error(`${label} must be repo-relative: ${relativePath}`);
  }
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`${label} escapes project root: ${relativePath}`);
  }
  return resolved;
}

function resolveCliPath(projectRoot, value) {
  return path.isAbsolute(value) || looksMachineAbsolute(value)
    ? path.resolve(value)
    : path.resolve(projectRoot, value);
}

function parseCli(argv) {
  const parsed = {
    command: argv[0] || null,
    projectRoot: null,
    hooks: null,
    contract: null,
    hop: null,
    completeness: false,
    error: null
  };

  if (!['discover', 'check'].includes(parsed.command)) {
    parsed.error = 'Usage: check-pipeline-wiring.js <discover|check> [options]';
    return parsed;
  }

  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--completeness') {
      parsed.completeness = true;
      continue;
    }
    if (['--project-root', '--hooks', '--contract', '--hop'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        parsed.error = `${arg} requires a value`;
        return parsed;
      }
      index++;
      if (arg === '--project-root') parsed.projectRoot = value;
      else if (arg === '--hooks') parsed.hooks = value;
      else if (arg === '--contract') parsed.contract = value;
      else parsed.hop = value;
      continue;
    }
    parsed.error = `Unknown argument: ${arg}`;
    return parsed;
  }

  if (parsed.command === 'check' && !parsed.contract) {
    parsed.error = 'check requires --contract <path>';
  }
  if (parsed.command === 'discover' && (parsed.contract || parsed.hop || parsed.completeness)) {
    parsed.error = 'discover accepts only --project-root and --hooks';
  }
  return parsed;
}

function resolveProjectRoot(parsed) {
  return path.resolve(
    parsed.projectRoot
      || process.env.CLAUDE_PROJECT_DIR
      || process.env.PROJECT_ROOT
      || process.cwd()
  );
}

function splitCommand(command) {
  if (typeof command !== 'string') throw new Error('Hook command must be a string');
  const words = [];
  let current = '';
  let quote = null;

  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (char === '\\' && quote) {
      if (command[index + 1] === quote) {
        current += quote;
        index++;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (quote) throw new Error(`Unterminated quote in hook command: ${command}`);
  if (current) words.push(current);
  return words;
}

function normalizeHookCommand(command) {
  const words = splitCommand(command);
  if (words.length < 2 || !/^node(?:\.exe)?$/i.test(path.win32.basename(words[0]))) {
    throw new Error(`Unsupported hook command, expected node <script>: ${command}`);
  }
  let script = words[1].replace(/^\$\{CLAUDE_PLUGIN_ROOT\}[\\/]/, '');
  script = script.replace(/^\.\//, '');
  if (path.isAbsolute(script) || looksMachineAbsolute(script) || script.startsWith('..')) {
    throw new Error(`Hook script must resolve inside the repository: ${script}`);
  }
  return { script: toPosix(script), args: words.slice(2) };
}

function hookId(event, script, args) {
  let id = `${event}:${path.posix.basename(toPosix(script), '.js')}`;
  if (args.length > 0) id += `:${args[0]}`;
  return id.toLowerCase();
}

function readHookEntries(hooksPath) {
  const parsed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  if (!parsed || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) {
    throw new Error('hooks.json must contain a hooks object');
  }

  const entries = [];
  const idCounts = new Map();
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    if (!Array.isArray(groups)) throw new Error(`hooks.${event} must be an array`);
    for (const group of groups) {
      const matcher = Object.prototype.hasOwnProperty.call(group, 'matcher') ? group.matcher : null;
      const commands = Array.isArray(group.hooks) ? group.hooks : [];
      for (const hook of commands) {
        if (!hook || hook.type !== 'command' || typeof hook.command !== 'string') continue;
        const normalized = normalizeHookCommand(hook.command);
        const baseId = hookId(event, normalized.script, normalized.args);
        const count = (idCounts.get(baseId) || 0) + 1;
        idCounts.set(baseId, count);
        entries.push({
          id: count === 1 ? baseId : `${baseId}:${count}`,
          event,
          matcher,
          script: normalized.script,
          args: normalized.args
        });
      }
    }
  }
  return entries;
}

function stringLiteralContents(source) {
  const strings = [];
  for (let index = 0; index < source.length;) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (char !== '"' && char !== "'" && char !== '`') {
      index++;
      continue;
    }

    const quote = char;
    let value = '';
    let escaped = false;
    index++;
    while (index < source.length) {
      const current = source[index++];
      if (escaped) {
        value += current;
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === quote) {
        break;
      } else {
        value += current;
      }
    }
    strings.push(value);
  }
  return strings;
}

function tokensInJsStrings(source) {
  const tokens = new Set();
  for (const value of stringLiteralContents(source)) {
    for (const match of value.matchAll(TRIGGER_PATTERN)) tokens.add(match[0]);
  }
  return tokens;
}

function tokensInText(source) {
  return new Set(Array.from(source.matchAll(TRIGGER_PATTERN), match => match[0]));
}

function listScriptFiles(projectRoot) {
  const scriptsDir = path.join(projectRoot, 'scripts');
  if (!fs.existsSync(scriptsDir)) return [];
  return fs.readdirSync(scriptsDir)
    .filter(name => name.endsWith('.js') && fs.statSync(path.join(scriptsDir, name)).isFile())
    .sort()
    .map(name => ({ relative: `scripts/${name}`, absolute: path.join(scriptsDir, name) }));
}

function listSkillFiles(projectRoot) {
  const skillsDir = path.join(projectRoot, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  const files = [];
  for (const name of fs.readdirSync(skillsDir).sort()) {
    const skillPath = path.join(skillsDir, name, 'SKILL.md');
    if (fs.existsSync(skillPath) && fs.statSync(skillPath).isFile()) {
      files.push({ relative: `skills/${name}/SKILL.md`, absolute: skillPath });
    }
  }
  return files;
}

function listAgentFiles(projectRoot) {
  const agentsDir = path.join(projectRoot, 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir)
    .filter(name => name.endsWith('.md') && fs.statSync(path.join(agentsDir, name)).isFile())
    .sort()
    .map(name => ({ relative: `agents/${name}`, absolute: path.join(agentsDir, name) }));
}

function markdownSectionsContaining(content, token) {
  const lines = content.split(/\r?\n/);
  let currentHeading = null;
  const sections = [];
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) currentHeading = heading[2].trim();
    if (line.includes(token)) sections.push(currentHeading);
  }
  return sections;
}

function preferredConsumerSection(content, token) {
  const sections = markdownSectionsContaining(content, token);
  return sections.find(section => section && /trigger/i.test(section))
    || sections.find(Boolean)
    || null;
}

function readFrontmatterName(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const nameLine = match[1].match(/^name:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/m);
  if (!nameLine) return null;
  return (nameLine[1] || nameLine[2] || nameLine[3] || '').trim();
}

function discoverTriggers(projectRoot) {
  const producers = new Map();
  const consumers = new Map();

  for (const file of listScriptFiles(projectRoot)) {
    const tokens = tokensInJsStrings(fs.readFileSync(file.absolute, 'utf8'));
    for (const token of tokens) {
      if (!producers.has(token)) producers.set(token, new Set());
      producers.get(token).add(file.relative);
    }
  }

  for (const file of listSkillFiles(projectRoot)) {
    const content = fs.readFileSync(file.absolute, 'utf8');
    for (const token of tokensInText(content)) {
      if (!consumers.has(token)) consumers.set(token, new Map());
      consumers.get(token).set(file.relative, preferredConsumerSection(content, token));
    }
  }

  const allTokens = Array.from(new Set([...producers.keys(), ...consumers.keys()])).sort();
  return allTokens.map(token => ({
    id: `trigger:${token.slice(1, -1).toLowerCase()}`,
    token,
    producers: Array.from(producers.get(token) || []).sort().map(file => ({ file })),
    consumers: Array.from((consumers.get(token) || new Map()).entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([file, section]) => section ? { file, section } : { file })
  }));
}

function discoverAgents(projectRoot) {
  const skills = listSkillFiles(projectRoot).map(file => ({
    ...file,
    content: fs.readFileSync(file.absolute, 'utf8')
  }));
  const hops = [];
  const idCounts = new Map();

  for (const file of listAgentFiles(projectRoot)) {
    const agent = readFrontmatterName(fs.readFileSync(file.absolute, 'utf8')) || path.basename(file.relative, '.md');
    const matchingSkills = skills.filter(skill => skill.content.includes(agent));
    const pairs = matchingSkills.length > 0 ? matchingSkills : [null];
    for (const skill of pairs) {
      const baseId = `agent:${agent.toLowerCase()}`;
      const count = (idCounts.get(baseId) || 0) + 1;
      idCounts.set(baseId, count);
      hops.push({
        id: count === 1 ? baseId : `${baseId}:${count}`,
        skill: skill ? skill.relative : null,
        agent,
        agentFile: file.relative
      });
    }
  }
  return hops;
}

function displayHooksPath(projectRoot, hooksPath) {
  const relative = path.relative(projectRoot, hooksPath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? toPosix(relative)
    : toPosix(hooksPath);
}

function discoverProject(projectRoot, hooksPath) {
  return {
    schemaVersion: 1,
    generatedFrom: { hooks: displayHooksPath(projectRoot, hooksPath) },
    hooks: readHookEntries(hooksPath),
    triggers: discoverTriggers(projectRoot),
    agents: discoverAgents(projectRoot),
    ignore: { hooks: [], triggers: [], agents: [] }
  };
}

function validatePath(projectRoot, value, label, nullable) {
  if (nullable && value === null) return;
  resolveInside(projectRoot, value, label);
}

function validateContract(contract, projectRoot) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('Contract must be a JSON object');
  }
  if (contract.schemaVersion !== 1) throw new Error('Contract schemaVersion must be 1');
  for (const key of ['hooks', 'triggers', 'agents']) {
    if (!Array.isArray(contract[key])) throw new Error(`Contract ${key} must be an array`);
  }
  if (!contract.ignore || typeof contract.ignore !== 'object') {
    throw new Error('Contract ignore must be an object');
  }
  if (!contract.generatedFrom || typeof contract.generatedFrom.hooks !== 'string') {
    throw new Error('Contract generatedFrom.hooks is required');
  }
  validatePath(projectRoot, contract.generatedFrom.hooks, 'generatedFrom.hooks', false);
  for (const key of ['hooks', 'triggers', 'agents']) {
    if (!Array.isArray(contract.ignore[key])) throw new Error(`Contract ignore.${key} must be an array`);
  }

  const ids = new Set();
  for (const [kind, items] of [['hooks', contract.hooks], ['triggers', contract.triggers], ['agents', contract.agents]]) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) {
        throw new Error(`${kind}[${index}].id is required`);
      }
      if (ids.has(item.id)) throw new Error(`Duplicate contract hop id: ${item.id}`);
      ids.add(item.id);
    }
  }

  contract.hooks.forEach((hook, index) => {
    if (typeof hook.event !== 'string' || !hook.event) throw new Error(`hooks[${index}].event is required`);
    if (hook.matcher !== null && typeof hook.matcher !== 'string') throw new Error(`hooks[${index}].matcher must be a string or null`);
    validatePath(projectRoot, hook.script, `hooks[${index}].script`, false);
    if (!Array.isArray(hook.args) || !hook.args.every(arg => typeof arg === 'string')) {
      throw new Error(`hooks[${index}].args must be a string array`);
    }
  });

  contract.triggers.forEach((trigger, index) => {
    if (typeof trigger.token !== 'string' || !/^\[CRABSHELL_[A-Z_]+\]$/.test(trigger.token)) {
      throw new Error(`triggers[${index}].token is invalid`);
    }
    if (!Array.isArray(trigger.producers) || !Array.isArray(trigger.consumers)) {
      throw new Error(`triggers[${index}] producers and consumers must be arrays`);
    }
    trigger.producers.forEach((producer, producerIndex) => {
      validatePath(projectRoot, producer.file, `triggers[${index}].producers[${producerIndex}].file`, false);
    });
    trigger.consumers.forEach((consumer, consumerIndex) => {
      validatePath(projectRoot, consumer.file, `triggers[${index}].consumers[${consumerIndex}].file`, false);
      if (consumer.section !== undefined && typeof consumer.section !== 'string') {
        throw new Error(`triggers[${index}].consumers[${consumerIndex}].section must be a string`);
      }
    });
  });

  contract.agents.forEach((agent, index) => {
    if (typeof agent.agent !== 'string' || !agent.agent) throw new Error(`agents[${index}].agent is required`);
    validatePath(projectRoot, agent.skill, `agents[${index}].skill`, true);
    validatePath(projectRoot, agent.agentFile, `agents[${index}].agentFile`, false);
  });
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addFailure(failures, hop, kind, reason, detail) {
  failures.push({ hop, kind, reason, detail });
}

function checkHookHop(hook, actualHooks, projectRoot, failures) {
  const matchingCommand = actualHooks.filter(actual =>
    actual.event === hook.event
    && actual.script === hook.script
    && sameArray(actual.args, hook.args)
  );
  if (matchingCommand.length === 0) {
    addFailure(failures, hook.id, 'hook', 'hook-entry-missing',
      `No ${hook.event} hook runs ${hook.script} with args ${JSON.stringify(hook.args)}`);
  } else if (hook.matcher !== null && !matchingCommand.some(actual => actual.matcher === hook.matcher)) {
    addFailure(failures, hook.id, 'hook', 'hook-matcher-mismatch',
      `Expected matcher ${JSON.stringify(hook.matcher)} for ${hook.event} -> ${hook.script}`);
  }

  const scriptPath = resolveInside(projectRoot, hook.script, `${hook.id}.script`);
  if (!fs.existsSync(scriptPath)) {
    addFailure(failures, hook.id, 'hook', 'script-missing', `${hook.script} does not exist`);
    return;
  }
  const syntax = spawnSync(process.execPath,
    ['--preserve-symlinks', '--preserve-symlinks-main', '--check', scriptPath],
    { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (syntax.status !== 0 || syntax.error) {
    const detail = syntax.error ? syntax.error.message : (syntax.stderr || syntax.stdout || '').trim();
    addFailure(failures, hook.id, 'hook', 'script-syntax-error', detail || `${hook.script} failed node --check`);
  }
}

function sectionBodies(content, sectionText) {
  const lines = content.split(/\r?\n/);
  const headings = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ line: index, level: match[1].length, text: match[2].trim() });
  }
  const matching = headings.filter(heading => heading.text.toLowerCase().includes(sectionText.toLowerCase()));
  return matching.map(heading => {
    const next = headings.find(candidate => candidate.line > heading.line && candidate.level <= heading.level);
    const end = next ? next.line : lines.length;
    return lines.slice(heading.line + 1, end).join('\n');
  });
}

function checkTriggerHop(trigger, projectRoot, failures) {
  if (trigger.producers.length === 0 || trigger.consumers.length === 0) {
    addFailure(failures, trigger.id, 'trigger', 'trigger-one-sided',
      `${trigger.token} has ${trigger.producers.length} producers and ${trigger.consumers.length} consumers`);
  }

  for (const producer of trigger.producers) {
    const producerPath = resolveInside(projectRoot, producer.file, `${trigger.id}.producer.file`);
    if (!fs.existsSync(producerPath)) {
      addFailure(failures, trigger.id, 'trigger', 'producer-missing', `${producer.file} does not exist`);
      continue;
    }
    const tokens = tokensInJsStrings(fs.readFileSync(producerPath, 'utf8'));
    if (!tokens.has(trigger.token)) {
      addFailure(failures, trigger.id, 'trigger', 'producer-token-missing',
        `${producer.file} does not contain ${trigger.token} inside a JavaScript string literal`);
    }
  }

  for (const consumer of trigger.consumers) {
    const consumerPath = resolveInside(projectRoot, consumer.file, `${trigger.id}.consumer.file`);
    if (!fs.existsSync(consumerPath)) {
      addFailure(failures, trigger.id, 'trigger', 'consumer-missing', `${consumer.file} does not exist`);
      continue;
    }
    const content = fs.readFileSync(consumerPath, 'utf8');
    if (consumer.section) {
      const bodies = sectionBodies(content, consumer.section);
      if (bodies.length === 0) {
        addFailure(failures, trigger.id, 'trigger', 'consumer-section-missing',
          `${consumer.file} has no heading containing ${JSON.stringify(consumer.section)}`);
      } else if (!bodies.some(body => body.includes(trigger.token))) {
        addFailure(failures, trigger.id, 'trigger', 'consumer-token-missing',
          `${consumer.file} does not contain ${trigger.token} in section ${JSON.stringify(consumer.section)}`);
      }
    } else if (!content.includes(trigger.token)) {
      addFailure(failures, trigger.id, 'trigger', 'consumer-token-missing',
        `${consumer.file} does not contain ${trigger.token}`);
    }
  }
}

function checkAgentHop(agent, projectRoot, failures) {
  if (agent.skill === null) {
    addFailure(failures, agent.id, 'agent', 'skill-missing', `${agent.agent} is not referenced by a skill`);
  } else {
    const skillPath = resolveInside(projectRoot, agent.skill, `${agent.id}.skill`);
    if (!fs.existsSync(skillPath)) {
      addFailure(failures, agent.id, 'agent', 'skill-missing', `${agent.skill} does not exist`);
    } else if (!fs.readFileSync(skillPath, 'utf8').includes(agent.agent)) {
      addFailure(failures, agent.id, 'agent', 'skill-agent-ref-missing',
        `${agent.skill} does not mention ${agent.agent}`);
    }
  }

  const agentPath = resolveInside(projectRoot, agent.agentFile, `${agent.id}.agentFile`);
  if (!fs.existsSync(agentPath)) {
    addFailure(failures, agent.id, 'agent', 'agent-file-missing', `${agent.agentFile} does not exist`);
    return;
  }
  const observedName = readFrontmatterName(fs.readFileSync(agentPath, 'utf8'));
  if (observedName !== agent.agent) {
    addFailure(failures, agent.id, 'agent', 'agent-name-mismatch',
      `${agent.agentFile} frontmatter name is ${JSON.stringify(observedName)}, expected ${JSON.stringify(agent.agent)}`);
  }
}

function ignoreValues(items) {
  return new Set(items.map(item => typeof item === 'string' ? item : item && item.id).filter(Boolean));
}

function hookContractMatches(actual, contractHook) {
  return actual.event === contractHook.event
    && actual.script === contractHook.script
    && sameArray(actual.args, contractHook.args)
    && (contractHook.matcher === null || actual.matcher === contractHook.matcher);
}

function checkCompleteness(contract, actual, failures) {
  let checked = 0;
  const ignoredHooks = ignoreValues(contract.ignore.hooks);
  const ignoredTriggers = ignoreValues(contract.ignore.triggers);
  const ignoredAgents = ignoreValues(contract.ignore.agents);

  for (const hook of actual.hooks) {
    checked++;
    if (ignoredHooks.has(hook.id)) continue;
    const matches = contract.hooks.filter(contractHook => hookContractMatches(hook, contractHook));
    if (matches.length !== 1) {
      addFailure(failures, hook.id, 'completeness', 'unclassified-hook',
        `${hook.event} -> ${hook.script} ${JSON.stringify(hook.args)} matches ${matches.length} contract hooks`);
    }
  }

  for (const trigger of actual.triggers) {
    checked++;
    if (ignoredTriggers.has(trigger.id) || ignoredTriggers.has(trigger.token)) continue;
    const matches = contract.triggers.filter(contractTrigger => contractTrigger.token === trigger.token);
    if (matches.length !== 1) {
      addFailure(failures, trigger.id, 'completeness', 'unclassified-trigger',
        `${trigger.token} matches ${matches.length} contract triggers`);
    }
  }

  const agentFiles = new Map();
  for (const agent of actual.agents) agentFiles.set(agent.agentFile, agent);
  for (const agent of agentFiles.values()) {
    checked++;
    if (ignoredAgents.has(agent.id) || ignoredAgents.has(agent.agent) || ignoredAgents.has(agent.agentFile)) continue;
    const matches = contract.agents.filter(contractAgent => contractAgent.agentFile === agent.agentFile);
    if (matches.length === 0) {
      addFailure(failures, agent.id, 'completeness', 'unclassified-agent',
        `${agent.agentFile} is not covered by a contract agent hop`);
    }
  }
  return checked;
}

function runCheck(contract, projectRoot, hooksPath, hopId, completeness) {
  const actual = discoverProject(projectRoot, hooksPath);
  const allHops = [
    ...contract.hooks.map(value => ({ kind: 'hook', value })),
    ...contract.triggers.map(value => ({ kind: 'trigger', value })),
    ...contract.agents.map(value => ({ kind: 'agent', value }))
  ];
  let selected = allHops;
  const failures = [];
  if (hopId) {
    selected = allHops.filter(hop => hop.value.id === hopId);
    if (selected.length === 0) {
      addFailure(failures, hopId, 'completeness', 'hop-not-in-contract',
        `${hopId} is not present in the wiring contract`);
    }
  }

  for (const hop of selected) {
    if (hop.kind === 'hook') checkHookHop(hop.value, actual.hooks, projectRoot, failures);
    else if (hop.kind === 'trigger') checkTriggerHop(hop.value, projectRoot, failures);
    else checkAgentHop(hop.value, projectRoot, failures);
  }

  let checked = selected.length;
  if (completeness) checked += checkCompleteness(contract, actual, failures);
  return {
    passed: failures.length === 0,
    checked,
    discovered: actual.hooks.length + actual.triggers.length + actual.agents.length,
    failures
  };
}

function failUsage(message) {
  console.log(JSON.stringify({ passed: false, error: message }));
  return 2;
}

function main(argv = process.argv.slice(2)) {
  const parsed = parseCli(argv);
  if (parsed.error) return failUsage(parsed.error);

  try {
    const projectRoot = resolveProjectRoot(parsed);
    const hooksPath = parsed.hooks
      ? resolveCliPath(projectRoot, parsed.hooks)
      : path.join(projectRoot, 'hooks', 'hooks.json');
    if (parsed.command === 'discover') {
      console.log(JSON.stringify(discoverProject(projectRoot, hooksPath), null, 2));
      return 0;
    }

    const contractPath = resolveCliPath(projectRoot, parsed.contract);
    let contract;
    try {
      contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    } catch (error) {
      return failUsage(`Cannot read contract: ${error.message}`);
    }
    validateContract(contract, projectRoot);
    const result = runCheck(contract, projectRoot, hooksPath, parsed.hop, parsed.completeness);
    console.log(JSON.stringify(result));
    return result.passed ? 0 : 1;
  } catch (error) {
    return failUsage(error.message);
  }
}

if (require.main === module) process.exit(main());

module.exports = {
  parseCli,
  looksMachineAbsolute,
  resolveInside,
  splitCommand,
  normalizeHookCommand,
  readHookEntries,
  tokensInJsStrings,
  readFrontmatterName,
  discoverProject,
  validateContract,
  runCheck,
  main
};
