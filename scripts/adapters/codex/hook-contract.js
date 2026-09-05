'use strict';

const fs = require('fs');
const path = require('path');

function findProjectRoot(cwd) {
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    const markers = [
      path.join(current, '.crabshell'),
      path.join(current, '.git'),
      path.join(current, '.codex-plugin', 'plugin.json'),
    ];
    if (markers.some(marker => fs.existsSync(marker))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd || process.cwd());
    current = parent;
  }
}

function normalizeToolName(toolName) {
  if (toolName === 'shell_command' || toolName === 'exec_command') return 'Bash';
  return toolName;
}

function normalizePreToolUse(payload) {
  if (!payload || payload.hook_event_name !== 'PreToolUse') return null;
  if (typeof payload.tool_name !== 'string' || !payload.tool_input || typeof payload.tool_input !== 'object') return null;
  return {
    projectDir: findProjectRoot(payload.cwd),
    hookData: {
      tool_name: normalizeToolName(payload.tool_name),
      tool_input: payload.tool_input,
    },
  };
}

function normalizeUserPromptSubmit(payload) {
  if (!payload || payload.hook_event_name !== 'UserPromptSubmit') return null;
  if (typeof payload.prompt !== 'string') return null;
  return {
    projectDir: findProjectRoot(payload.cwd),
    hookData: payload,
  };
}

function normalizeSessionStart(payload) {
  if (!payload || payload.hook_event_name !== 'SessionStart') return null;
  const allowedSources = new Set(['startup', 'resume', 'clear', 'compact']);
  return {
    projectDir: findProjectRoot(payload.cwd),
    source: allowedSources.has(payload.source) ? payload.source : 'startup',
    hookData: payload,
  };
}

function normalizeCompaction(payload, eventName) {
  if (!['PreCompact', 'PostCompact'].includes(eventName)) return null;
  if (!payload || payload.hook_event_name !== eventName) return null;
  const allowedTriggers = new Set(['manual', 'auto']);
  return {
    projectDir: findProjectRoot(payload.cwd),
    trigger: allowedTriggers.has(payload.trigger) ? payload.trigger : 'auto',
    hookData: payload,
  };
}

function normalizeSubagentStart(payload) {
  if (!payload || payload.hook_event_name !== 'SubagentStart') return null;
  return {
    projectDir: findProjectRoot(payload.cwd),
    agentType: payload.agent_type || payload.subagent_type || 'unknown',
    hookData: payload,
  };
}

function denyOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function validateCodexHookConfig(config) {
  if (!config || !config.hooks || typeof config.hooks !== 'object') throw new Error('Codex hook config must contain hooks.');
  const events = Object.keys(config.hooks).sort();
  const requiredEvents = ['PostCompact', 'PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit'];
  if (events.length !== requiredEvents.length || events.some((event, index) => event !== requiredEvents[index])) {
    throw new Error(`Codex hooks must contain exactly ${requiredEvents.join(' and ')}; found ${events.join(', ') || '<none>'}.`);
  }
  for (const eventName of requiredEvents) {
    if (!Array.isArray(config.hooks[eventName]) || config.hooks[eventName].length === 0) {
      throw new Error(`${eventName} must contain at least one matcher group.`);
    }
    for (const group of config.hooks[eventName]) {
    if (!Array.isArray(group.hooks) || group.hooks.length === 0) throw new Error(`${eventName} matcher group has no handlers.`);
    for (const handler of group.hooks) {
      if (handler.type !== 'command') throw new Error(`Unsupported Codex hook handler type: ${handler.type}.`);
      if (handler.async === true) throw new Error('Async Codex hooks are not supported.');
      if (!String(handler.command || '').includes('process.env.PLUGIN_ROOT')) throw new Error('Codex hook command must resolve PLUGIN_ROOT inside Node.');
      if (!String(handler.commandWindows || '').includes('process.env.PLUGIN_ROOT')) throw new Error('Codex Windows hook command must resolve PLUGIN_ROOT inside Node.');
      for (const command of [handler.command, handler.commandWindows]) {
        if (!String(command || '').includes('Promise.resolve().then(') || !String(command || '').includes('.catch(')) {
          throw new Error('Codex hook commands must catch loader and adapter failures so hooks fail open.');
        }
      }
      if (/%PLUGIN_ROOT%|\$\{PLUGIN_ROOT\}|\$env:PLUGIN_ROOT/i.test(String(handler.commandWindows || ''))) {
        throw new Error('Codex Windows hook command must not depend on shell-specific PLUGIN_ROOT expansion.');
      }
    }
    }
  }
  const promptHandlers = config.hooks.UserPromptSubmit.flatMap(group => group.hooks);
  if (!promptHandlers.every(handler => /adapters[\\/]codex[\\/]user-prompt-submit\.js/.test(String(handler.command)))) {
    throw new Error('UserPromptSubmit must use the shared Codex user-prompt adapter.');
  }
  const sessionHandlers = config.hooks.SessionStart.flatMap(group => group.hooks);
  if (!sessionHandlers.every(handler => /adapters[\\/]codex[\\/]session-start\.js/.test(String(handler.command)))) {
    throw new Error('SessionStart must use the shared Codex memory adapter.');
  }
  const subagentHandlers = config.hooks.SubagentStart.flatMap(group => group.hooks);
  if (!subagentHandlers.every(handler => /adapters[\\/]codex[\\/]subagent-start\.js/.test(String(handler.command)))) {
    throw new Error('SubagentStart must use the shared Codex subagent adapter.');
  }
  const postToolHandlers = config.hooks.PostToolUse.flatMap(group => group.hooks);
  if (!config.hooks.PostToolUse.every(group => group.matcher === 'Bash|Write|Edit')
      || !postToolHandlers.every(handler => /adapters[\/]codex[\/]post-tool-use\.js/.test(String(handler.command)))) {
    throw new Error('PostToolUse must use the shared Codex parent-evidence adapter for commands and edits.');
  }
  for (const eventName of ['Stop', 'SubagentStop']) {
    const handlers = config.hooks[eventName].flatMap(group => group.hooks);
    if (handlers.length !== 1 || !handlers.every(handler => /adapters[\/]codex[\/]stop\.js/.test(String(handler.command)))) {
      throw new Error(`${eventName} must have one shared Codex completion adapter.`);
    }
  }
  for (const eventName of ['PreCompact', 'PostCompact']) {
    if (!config.hooks[eventName].every(group => group.matcher === 'manual|auto')) {
      throw new Error(`${eventName} must match manual|auto compaction triggers.`);
    }
    const expectedAdapter = eventName === 'PreCompact' ? 'pre-compact.js' : 'post-compact.js';
    const handlers = config.hooks[eventName].flatMap(group => group.hooks);
    if (!handlers.every(handler => String(handler.command).replace(/\\/g, '/').includes(`/adapters/codex/${expectedAdapter}`))) {
      throw new Error(`${eventName} must use the Codex ${expectedAdapter} adapter.`);
    }
  }
  return true;
}

module.exports = {
  denyOutput,
  findProjectRoot,
  normalizeCompaction,
  normalizePreToolUse,
  normalizeSessionStart,
  normalizeSubagentStart,
  normalizeToolName,
  normalizeUserPromptSubmit,
  validateCodexHookConfig,
};
