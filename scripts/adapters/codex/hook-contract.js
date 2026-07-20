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
  const events = Object.keys(config.hooks);
  if (events.length !== 1 || events[0] !== 'PreToolUse') {
    throw new Error(`Codex Cycle 1 permits only PreToolUse; found ${events.join(', ') || '<none>'}.`);
  }
  for (const group of config.hooks.PreToolUse) {
    if (!Array.isArray(group.hooks) || group.hooks.length === 0) throw new Error('PreToolUse matcher group has no handlers.');
    for (const handler of group.hooks) {
      if (handler.type !== 'command') throw new Error(`Unsupported Codex hook handler type: ${handler.type}.`);
      if (handler.async === true) throw new Error('Async Codex hooks are forbidden in Cycle 1.');
      if (!String(handler.command || '').includes('${PLUGIN_ROOT}')) throw new Error('Codex hook command must resolve from PLUGIN_ROOT.');
      if (!String(handler.commandWindows || '').includes('%PLUGIN_ROOT%')) throw new Error('Codex Windows hook command must resolve from PLUGIN_ROOT.');
    }
  }
  return true;
}

module.exports = { denyOutput, findProjectRoot, normalizePreToolUse, normalizeToolName, validateCodexHookConfig };
