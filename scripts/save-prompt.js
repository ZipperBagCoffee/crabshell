const path = require('path');
const { getProjectDir, getProjectName, getTimestamp } = require('./utils');

const projectName = getProjectName();
const projectDir = getProjectDir();
const timestamp = getTimestamp();

console.log(`
=== MEMORY KEEPER: SESSION END ===

Save this session's memory NOW. This is a command hook, you MUST execute this.

1. Create directory: ${projectDir}/sessions/
2. Save session summary to: ${projectDir}/sessions/${timestamp}.md
3. Update rolling summary: ${projectDir}/memory.md

Format for memory.md:
\`\`\`markdown
# Project Memory: ${projectName}

## Core Decisions
[List key decisions made in this and previous sessions]

## Current State
- Last updated: ${new Date().toISOString()}
- Last session: [brief description]

## Recent Context
[Summary of recent work - what was done, what's pending]

## Known Issues
[Any unresolved problems or blockers]
\`\`\`

Use the Write tool to save these files. Do it NOW.
`);
