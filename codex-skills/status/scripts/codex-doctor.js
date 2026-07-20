#!/usr/bin/env node
'use strict';

require('../../../scripts/codex-doctor').main().catch(error => {
  console.error(`Crabshell Codex doctor failed: ${error.message}`);
  process.exitCode = 1;
});
