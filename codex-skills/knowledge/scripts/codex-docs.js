#!/usr/bin/env node
'use strict';

require('../../../scripts/codex-docs').main(process.argv.slice(2), { requireProjectDir: true });
