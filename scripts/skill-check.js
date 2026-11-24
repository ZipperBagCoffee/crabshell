'use strict';

// D186: after the first batch of tool calls in a user prompt, tell the main agent once when
// no skill was opened in that prompt, so the working model (it has the installed skills'
// list) checks whether one covers the task before the work goes on. Decided after the
// batch, not before a call: in Code Mode a script's inner calls run one by one, so a Skill
// call later in the same script is only seen once the batch is done. A skill counts as
// opened when this prompt recorded a Skill call (PostToolUse, inner Code Mode calls
// included), a typed /command (UserPromptExpansion), or the batch holds a Skill call.
// Claude only; subagent payloads (agent_id) are neither recorded nor told.

const { readSessionState, sessionKey, writeSessionState } = require('./core/session-state');
const { sessionId, turnId } = require('./core/turn-id');

const REMINDER = '[CRABSHELL] No skill opened for this prompt yet. If an installed skill covers this task, open it before the work; if none does, go on.';
const STATE_NAME = 'skill-check';
// Claude Code's tool that opens a skill: the tool itself is what this check looks for.
const SKILL_TOOL = 'Skill';

// The payload this check may act on: the main agent's, with a prompt and a session to
// remember the check under (without one it could not tell a repeat from a first time).
function scope(payload) {
  if (!payload || typeof payload !== 'object' || payload.agent_id) return null;
  const prompt = turnId(payload);
  const session = sessionId(payload);
  return prompt && sessionKey(session) ? { prompt, session } : null;
}

// This prompt's entry; another prompt's entry counts as a fresh one.
function entryOf(projectDir, where) {
  const saved = readSessionState(projectDir, where.session, STATE_NAME, null);
  if (saved && saved.promptId === where.prompt) {
    return { promptId: where.prompt, skills: Array.isArray(saved.skills) ? saved.skills : [], checked: saved.checked === true };
  }
  return { promptId: where.prompt, skills: [], checked: false };
}

function saveEntry(projectDir, where, entry) {
  writeSessionState(projectDir, where.session, STATE_NAME, { ...entry, updatedAt: new Date().toISOString() });
}

function recordSkill(payload, projectDir, name) {
  const where = scope(payload);
  if (!where || typeof name !== 'string' || !name) return;
  const entry = entryOf(projectDir, where);
  if (!entry.skills.includes(name)) saveEntry(projectDir, where, { ...entry, skills: [...entry.skills, name] });
}

const skillNameOf = call => (call && call.tool_input && typeof call.tool_input.skill === 'string' && call.tool_input.skill) || SKILL_TOOL;
const isSkillCall = call => Boolean(call) && call.tool_name === SKILL_TOOL;

// PostToolUse of a Skill call.
function recordToolSkill(payload, projectDir) {
  if (isSkillCall(payload)) recordSkill(payload, projectDir, skillNameOf(payload));
}

// UserPromptExpansion: a /command the user typed (skills and custom commands); an MCP
// server prompt is not a skill.
function noteExpansion(payload, projectDir) {
  if (payload && payload.expansion_type === 'slash_command') recordSkill(payload, projectDir, payload.command_name);
}

// PostToolBatch: the reminder for this prompt's first batch, or null.
function batchReminder(payload, projectDir) {
  const where = scope(payload);
  if (!where) return null;
  const entry = entryOf(projectDir, where);
  if (entry.checked) return null;
  const inBatch = (Array.isArray(payload.tool_calls) ? payload.tool_calls : []).filter(isSkillCall).map(skillNameOf);
  saveEntry(projectDir, where, { ...entry, skills: [...new Set([...entry.skills, ...inBatch])], checked: true });
  return entry.skills.length || inBatch.length ? null : REMINDER;
}

module.exports = { REMINDER, STATE_NAME, batchReminder, noteExpansion, recordSkill, recordToolSkill };
