'use strict';

const path = require('path');
const fs = require('fs');
const { readStdin } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir } = require('./utils');

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const filePath = (input.file_path || input.path || '').replace(/\\/g, '/');
  const isPlanDoc = /\.crabshell\/plan\/P\d{3}/.test(filePath);
  const isTicketDoc = /\.crabshell\/ticket\/P\d{3}_T\d{3}/.test(filePath);
  if (!isPlanDoc && !isTicketDoc) { process.exit(0); return; }

  const projectDir = getProjectDir();
  const { STORAGE_ROOT } = require('./constants');
  const statePath = path.join(projectDir, STORAGE_ROOT, 'memory', 'regressing-state.json');

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    process.exit(0); return; // No state file = no regressing active
  }

  if (!state || state.active !== true) { process.exit(0); return; }

  const { phase } = state;

  if (phase === 'planning' && isPlanDoc) {
    const output = {
      decision: "block",
      reason: 'Regressing phase "planning" requires /planning skill invocation first. Use Skill tool with skill="crabshell:planning" instead of writing the plan document directly.'
    };
    console.log(JSON.stringify(output));
    process.exit(2);
  }

  if (phase === 'ticketing' && isTicketDoc) {
    const output = {
      decision: "block",
      reason: 'Regressing phase "ticketing" requires /ticketing skill invocation first. Use Skill tool with skill="crabshell:ticketing" instead of writing the ticket document directly.'
    };
    console.log(JSON.stringify(output));
    process.exit(2);
  }

  // IA-2: Block ticketing when parent plan's agent sections are empty
  if (isTicketDoc) {
    const planId = state.planId;
    if (planId) {
      try {
        const planDir = path.join(projectDir, STORAGE_ROOT, 'plan');
        const planFiles = fs.readdirSync(planDir).filter(f => f.startsWith(planId) && f.endsWith('.md') && !/_T/.test(f));
        if (planFiles.length > 0) {
          const planContent = fs.readFileSync(path.join(planDir, planFiles[0]), 'utf8');
          const sections = ['Analysis Results', 'Review Results', 'Intent Check'];
          const emptySections = sections.filter(name => {
            // Bug fix (D106 cycle 5): use (?:^|\n) prefix to anchor at line start
            // without 'm' flag. Inline backticked references like `## Intent Check`
            // in Agent Execution section have a backtick (not newline) before them,
            // so (?:^|\n)## won't match. 'm' flag would also make $ match line-end,
            // breaking the body capture; explicit prefix avoids that side effect.
            const regex = new RegExp('(?:^|\\n)## ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)');
            const match = planContent.match(regex);
            if (!match) return false; // heading absent = unknown state, fail-open
            const body = match[1].trim();
            // Empty if: no content, or only parenthetical placeholder text
            return !body || /^\([^)]*\)$/.test(body);
          });
          if (emptySections.length > 0) {
            const output = {
              decision: "block",
              reason: `Ticketing blocked: Plan ${planId} has empty agent sections: ${emptySections.join(', ')}. Complete planning phase (WA/RA/Orchestrator) before creating tickets.`
            };
            console.log(JSON.stringify(output));
            process.exit(2);
          }
        }
      } catch (e) {
        // fail-open
      }
    }
  }

  process.exit(0);
}

main().catch(e => {
  console.error(`[REGRESSING GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
