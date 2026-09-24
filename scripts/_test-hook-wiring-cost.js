'use strict';
// D119 P178_T001: hook cost measured from the wiring itself. Counts synchronous
// command hooks whose matcher selects a tool (the host starts one process per hook),
// so the check survives renamed scripts and a different split of the same events.
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const ROOT = path.join(__dirname, '..');
const report = h.createReporter('hook-wiring-cost');
const claude = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const codex = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'codex-hooks.json'), 'utf8')).hooks;

function matches(matcher, tool) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  try { return new RegExp(`^(?:${matcher})$`).test(tool); } catch { return false; }
}
function syncProcesses(event, tool) {
  let count = 0;
  for (const entry of claude[event] || []) {
    if (!matches(entry.matcher, tool)) continue;
    count += (entry.hooks || []).filter(hook => hook.type === 'command' && hook.async !== true).length;
  }
  return count;
}
const perTool = tool => syncProcesses('PreToolUse', tool) + syncProcesses('PostToolUse', tool);

for (const tool of ['Edit', 'Write', 'Bash']) {
  const count = perTool(tool);
  report.check(`W1 one ${tool} call starts at most 2 synchronous hook processes`, count <= 2, `count=${count}`);
}
for (const tool of ['Read', 'Grep', 'Glob']) {
  const count = perTool(tool);
  report.check(`W2 one ${tool} call starts at most 1 synchronous hook process`, count <= 1, `count=${count}`);
}
const stopCount = (claude.Stop || []).reduce((sum, entry) => sum + (entry.hooks || []).length, 0);
report.check('W3 Stop runs one hook process', stopCount === 1, `count=${stopCount}`);

// W4: the Stop hook does not start further node processes (behavioral: a preload
// records every child_process spawn made while the Stop hook runs).
{
  const root = h.makeWorkRoot('hook-wiring-cost');
  const project = h.makeProject(root, 'stop');
  fs.writeFileSync(h.memoryPath(project, 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution', cycle: 1, totalCycles: 1, discussion: 'D900', ticketIds: ['P900_T001'], lastUpdatedAt: new Date().toISOString() }));
  const spawnLog = path.join(root, 'spawn.log');
  const preload = path.join(root, 'spawn-preload.js');
  fs.writeFileSync(preload, `const cp=require('child_process');for(const name of ['spawn','spawnSync','execFile','execFileSync','exec','execSync']){const original=cp[name];cp[name]=function(...args){require('fs').appendFileSync(${JSON.stringify(spawnLog)},name+' '+JSON.stringify(args[1]||args[0]).slice(0,200)+'\\n');return original.apply(this,args);};}`);
  const stopHook = (claude.Stop || [])[0]?.hooks?.[0]?.command || '';
  const script = (stopHook.match(/scripts\/([^"]+\.js)/) || [])[1];
  if (script) {
    h.runHook(root, script, [], { hook_event_name: 'Stop', session_id: 'aaaaaaaa-1111-4111-8111-111111111111', stop_hook_active: false }, project, { NODE_OPTIONS: `--require "${preload.replace(/\\/g, '/')}"` });
  }
  const spawned = fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, 'utf8').trim() : '';
  report.check('W4 the Stop hook does not start another process for its checks', Boolean(script) && spawned === '', `script=${script} spawned=${spawned.slice(0, 160)}`);
}

// W5: compaction hooks — Claude's give the model nothing (PreCompact stdout goes to the
// debug log, PostCompact has no context field), Codex's pass additionalContext.
report.check('W5 Claude wiring has no PreCompact or PostCompact hooks', !claude.PreCompact && !claude.PostCompact, Object.keys(claude).join(','));
report.check('W5 Codex wiring keeps its PreCompact and PostCompact hooks', Boolean(codex.PreCompact && codex.PostCompact), Object.keys(codex).join(','));

report.finish();
