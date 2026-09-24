'use strict';

// Keep the background fail-open guard before imports so a broken dependency
// cannot interrupt summarization subprocesses.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const path = require('path');
const { readStdin } = require('./transcript-utils');
const { getProjectDir } = require('./utils');
const { buildMemoryContext, createSessionStartOutput } = require('./core/memory-context');

function projectDirFromArgs(argv = process.argv.slice(2)) {
  const argument = argv.find(value => value.startsWith('--project-dir='));
  return argument ? path.resolve(argument.slice('--project-dir='.length)) : getProjectDir();
}

async function main(options = {}) {
  const hookData = options.hookData || await readStdin(3000) || {};
  const projectDir = options.projectDir || projectDirFromArgs(options.argv);
  if (hookData.source === 'compact') {
    // Compaction drops the loaded skill instructions, so document writes must
    // go through the skill again (docs-guard reads this session's flag).
    if (hookData.session_id) {
      try { require('./core/skill-flag').clearSkillActive(projectDir, hookData.session_id); } catch {}
    }
    // Claude has no PostCompact wiring (its output reaches no model); its effects
    // run here: the next prompt re-injects the pressure notice, and the
    // compaction is logged.
    try { require('./core/post-compact-effects').runPostCompactEffects(projectDir); } catch {}
  }
  const context = buildMemoryContext(projectDir, {
    source: hookData.source || 'unknown',
    sessionId: hookData.session_id,
    tailLines: options.tailLines,
  });
  const output = createSessionStartOutput(context);
  const nativeHook = options.nativeOutput === true || hookData.hook_event_name === 'SessionStart';

  if (options.emit !== false) {
    if (nativeHook) process.stdout.write(JSON.stringify(output) + '\n');
    else process.stdout.write(context);
  }
  return { context, output, projectDir };
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CRABSHELL SESSION START ERROR] ${error.message}\n`);
  });
}

module.exports = { main, projectDirFromArgs };
