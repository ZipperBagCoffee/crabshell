'use strict';

const crypto = require('crypto');

function isTrivialTest(command) {
  const cmd = String(command || '').trim();
  if (cmd.length < 15 && !/\b(test|jest|mocha|vitest|pytest|tsc|eslint|lint|build|check|verify)\b/i.test(cmd)) return true;
  return /^\s*(echo|printf)\s+/i.test(cmd) && /\b(pass|ok|success|true)\b/i.test(cmd);
}

function isTestExecution(command) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim();
  if (isTrivialTest(cmd)) return false;
  return [
    /\bnpm\s+test\b/,
    /\bnpm\s+run\s+(test|check|verify|lint|build)\b/,
    /\bnpx\s+(jest|mocha|vitest)\b/,
    /\bpytest\b/,
    /\bcargo\s+test\b/,
    /\bgo\s+test\b/,
    /\bmake\s+test\b/,
    /\bnode(?:\.exe)?["']?\s+\S*\.test\.\S+/,
    /\bnode(?:\.exe)?["']?\s+\S*_test[_-]\S+/,
    /\btsc\b/,
    /\beslint\b/,
    /\bjest\b/,
    /\bmocha\b/,
    /\bvitest\b/,
  ].some(pattern => pattern.test(cmd));
}

function isGitCommit(command) {
  return typeof command === 'string' && /\bgit\s+commit\b/.test(command.trim());
}

function responseText(toolResponse) {
  if (toolResponse === undefined || toolResponse === null) return '';
  if (typeof toolResponse === 'string') return toolResponse;
  try { return JSON.stringify(toolResponse); } catch { return String(toolResponse); }
}

function getExitCode(toolResponse) {
  if (toolResponse && typeof toolResponse === 'object') {
    for (const key of ['exitCode', 'exit_code', 'code']) {
      if (typeof toolResponse[key] === 'number') return toolResponse[key];
    }
    for (const key of ['metadata', 'result', 'details']) {
      const nested = getExitCode(toolResponse[key]);
      if (nested !== null) return nested;
    }
    if (toolResponse.is_error === true || toolResponse.interrupted === true) return 1;
    if (toolResponse.is_error === false || toolResponse.success === true) return 0;
    if (toolResponse.success === false) return 1;
    if (typeof toolResponse.status === 'string') {
      if (/^(?:ok|passed|success|completed)$/i.test(toolResponse.status)) return 0;
      if (/^(?:error|failed|interrupted)$/i.test(toolResponse.status)) return 1;
    }
  }
  const match = responseText(toolResponse).match(/(?:^|[^A-Za-z])(?:Exit code|exit_code|exited with code)[:\s]+(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

function isToolFailure(toolResponse) {
  const exitCode = getExitCode(toolResponse);
  if (exitCode !== null) return exitCode !== 0;
  if (toolResponse && typeof toolResponse === 'object') {
    if (toolResponse.is_error === true || toolResponse.interrupted === true) return true;
  }
  return false;
}

function commandObservation(hookData = {}) {
  const command = hookData.tool_input?.command;
  if (hookData.tool_name !== 'Bash' || !isTestExecution(command)) return null;
  const text = responseText(hookData.tool_response).replace(/\s+/g, ' ').trim();
  const failed = isToolFailure(hookData.tool_response);
  const exitCode = getExitCode(hookData.tool_response);
  const excerpt = text.slice(0, 500);
  const fingerprint = crypto.createHash('sha256')
    .update(`${command}\n${exitCode === null ? (failed ? 1 : 0) : exitCode}\n${excerpt}`)
    .digest('hex');
  return {
    command,
    executed: true,
    conclusive: exitCode !== null,
    exitCode: exitCode === null ? (failed ? 1 : 0) : exitCode,
    passed: !failed,
    excerpt,
    fingerprint,
  };
}

module.exports = {
  commandObservation,
  getExitCode,
  isGitCommit,
  isTestExecution,
  isToolFailure,
  isTrivialTest,
  responseText,
};
