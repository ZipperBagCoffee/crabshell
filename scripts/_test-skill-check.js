'use strict';
// D186: after the first batch of tool calls in a user prompt, the main agent is told once
// when no skill was opened in that prompt. Payload shapes come from real Claude Code
// 2.1.331 runs (scripts/fixtures/hook-payloads/skill-check/, path and session values made
// generic); the adapters run as real hook processes.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');
const skillCheck = require('./skill-check');

const report = h.createReporter('skill-check');
const FIXTURES = path.join(__dirname, 'fixtures', 'hook-payloads', 'skill-check');
const fixture = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const MAIN_BATCH = fixture('claude-PostToolBatch-main.json');
const SUB_BATCH = fixture('claude-PostToolBatch-subagent.json');
const EXPANSION = fixture('claude-UserPromptExpansion-slash.json');
const root = h.makeWorkRoot('skill-check');
let projects = 0;
const project = () => h.makeProject(root, `p${++projects}`);
const withPrompt = (payload, prompt_id) => ({ ...payload, prompt_id });
// The Skill call's PostToolUse, as the main agent and as a subagent sends it.
const skillUse = (base, extra = {}) => ({ session_id: base.session_id, prompt_id: base.prompt_id, hook_event_name: 'PostToolUse',
  tool_name: 'Skill', tool_input: { skill: 'crabshell:discussing' }, tool_use_id: 'toolu_skill_1', ...extra });
// A Code Mode batch: the script's inner calls, a shell call then a Skill call (measured order).
const codeModeBatch = base => ({ ...base, tool_calls: [
  { tool_name: 'Bash', tool_input: { command: 'echo probe-hello' }, tool_use_id: 'toolu_cc_1', tool_response: 'probe-hello' },
  { tool_name: 'Skill', tool_input: { skill: 'caveman:caveman-help' }, tool_use_id: 'toolu_cc_2', tool_response: 'Launching skill' },
] });

// AC1: once per prompt, again for the next prompt.
{
  const dir = project();
  report.check('S1 first batch of a prompt with no skill opened gets the reminder', skillCheck.batchReminder(MAIN_BATCH, dir) === skillCheck.REMINDER);
  report.check('S1 the next batch of the same prompt gets nothing', skillCheck.batchReminder(MAIN_BATCH, dir) === null);
  report.check('S1 the first batch of the next prompt gets the reminder again', skillCheck.batchReminder(withPrompt(MAIN_BATCH, 'prompt-next'), dir) === skillCheck.REMINDER);
}

// AC2: a skill opened in this prompt, by any of the three ways, means no reminder.
{
  const dir = project();
  skillCheck.recordToolSkill(skillUse(MAIN_BATCH), dir);
  report.check('S2 a Skill call recorded at PostToolUse in this prompt: no reminder', skillCheck.batchReminder(MAIN_BATCH, dir) === null);
  report.check('S2 a skill recorded for an earlier prompt does not count for the next one', skillCheck.batchReminder(withPrompt(MAIN_BATCH, 'prompt-later'), dir) === skillCheck.REMINDER);
}
{
  const dir = project();
  skillCheck.noteExpansion(EXPANSION, dir);
  report.check('S2 a typed /skill (UserPromptExpansion, same prompt id) counts as opened', skillCheck.batchReminder(withPrompt(MAIN_BATCH, EXPANSION.prompt_id), dir) === null);
  skillCheck.noteExpansion({ ...EXPANSION, prompt_id: 'prompt-mcp', expansion_type: 'mcp_prompt', command_name: 'server:prompt' }, dir);
  report.check('S2 an MCP prompt expansion is not a skill', skillCheck.batchReminder(withPrompt(MAIN_BATCH, 'prompt-mcp'), dir) === skillCheck.REMINDER);
}
{
  const dir = project();
  report.check('S2 a Skill call inside the batch itself (Code Mode script) counts', skillCheck.batchReminder(codeModeBatch(MAIN_BATCH), dir) === null);
  report.check('S2 after that batch the prompt is checked: later batches get nothing', skillCheck.batchReminder(MAIN_BATCH, dir) === null);
}

// AC3: subagents neither use up nor change the main agent's check; incomplete input is quiet.
{
  const dir = project();
  report.check('S3 a subagent batch gets no reminder', skillCheck.batchReminder(SUB_BATCH, dir) === null);
  skillCheck.recordToolSkill(skillUse(SUB_BATCH, { agent_id: SUB_BATCH.agent_id, agent_type: SUB_BATCH.agent_type }), dir);
  report.check('S3 the main batch of the same prompt still gets the reminder (subagent batch and skill ignored)',
    SUB_BATCH.prompt_id === MAIN_BATCH.prompt_id && skillCheck.batchReminder(MAIN_BATCH, dir) === skillCheck.REMINDER);
  const noPrompt = { ...MAIN_BATCH }; delete noPrompt.prompt_id;
  const noSession = { ...MAIN_BATCH, prompt_id: 'prompt-x' }; delete noSession.session_id;
  report.check('S3 no prompt id: nothing', skillCheck.batchReminder(noPrompt, project()) === null);
  report.check('S3 no session id: nothing (no place to remember it was asked)', skillCheck.batchReminder(noSession, project()) === null);
}

// AC4: the wiring and the real processes.
{
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const scriptOf = event => ((hooks[event] || [])[0]?.hooks?.[0]?.command || '').match(/scripts\/([^"]+\.js)/)?.[1];
  const batchScript = scriptOf('PostToolBatch');
  const expansionScript = scriptOf('UserPromptExpansion');
  report.check('S4 hooks.json wires PostToolBatch and UserPromptExpansion to scripts that exist',
    Boolean(batchScript && expansionScript) && [batchScript, expansionScript].every(s => fs.existsSync(path.join(__dirname, s))), `${batchScript} ${expansionScript}`);
  if (batchScript && expansionScript) {
    const dir = project();
    const first = h.runHook(root, batchScript, [], MAIN_BATCH, dir);
    let parsed = null; try { parsed = JSON.parse(first.stdout); } catch {}
    report.check('S4 post-tool-batch prints one JSON object carrying the reminder',
      first.status === 0 && first.stdout.trim().split('\n').length === 1 && parsed?.hookSpecificOutput?.hookEventName === 'PostToolBatch'
      && parsed.hookSpecificOutput.additionalContext === skillCheck.REMINDER, `status=${first.status} out=${first.stdout.slice(0, 200)} err=${first.stderr.slice(0, 200)}`);
    const second = h.runHook(root, batchScript, [], MAIN_BATCH, dir);
    report.check('S4 the second batch process prints nothing', second.status === 0 && second.stdout.trim() === '', second.stdout.slice(0, 200));
    const broken = require('child_process').spawnSync(process.execPath, [path.join(__dirname, batchScript)], { cwd: dir, env: h.hookEnv(dir, root), input: 'not json', encoding: 'utf8', windowsHide: true });
    report.check('S4 broken input: exit 0, nothing printed', broken.status === 0 && (broken.stdout || '').trim() === '', `status=${broken.status} out=${broken.stdout}`);

    const typed = project();
    const expansion = h.runHook(root, expansionScript, [], EXPANSION, typed);
    const afterTyped = h.runHook(root, batchScript, [], withPrompt(MAIN_BATCH, EXPANSION.prompt_id), typed);
    report.check('S4 prompt-expansion process records the typed skill; the batch then prints nothing',
      expansion.status === 0 && expansion.stdout.trim() === '' && afterTyped.status === 0 && afterTyped.stdout.trim() === '', `exp=${expansion.stdout.slice(0, 120)} batch=${afterTyped.stdout.slice(0, 120)}`);

    const used = project();
    const post = h.runHook(root, 'adapters/claude/post-tool-use.js', [], skillUse(MAIN_BATCH), used);
    const afterUse = h.runHook(root, batchScript, [], MAIN_BATCH, used);
    report.check('S4 post-tool-use process records the Skill call; the batch then prints nothing',
      post.status === 0 && afterUse.status === 0 && afterUse.stdout.trim() === '', `post=${post.stderr.slice(0, 160)} batch=${afterUse.stdout.slice(0, 160)}`);

    // A batch carries every tool result; time one large batch (reported, not asserted).
    const big = { ...MAIN_BATCH, prompt_id: 'prompt-big', tool_calls: [{ ...MAIN_BATCH.tool_calls[0], tool_response: 'x'.repeat(5 * 1024 * 1024) }] };
    const started = Date.now();
    const large = h.runHook(root, batchScript, [], big, project());
    const ms = Date.now() - started;
    let bigParsed = null; try { bigParsed = JSON.parse(large.stdout); } catch {}
    report.check('S4 a 5 MB batch is read whole and still answered', large.status === 0 && bigParsed?.hookSpecificOutput?.additionalContext === skillCheck.REMINDER, `status=${large.status} out=${large.stdout.slice(0, 120)}`);
    console.log(`INFO: 5 MB batch hook process took ${ms} ms`);
  }
}

report.finish();
