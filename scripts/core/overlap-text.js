'use strict';
// Shared by the overlap guards (D175: overlap-guard, resource-guard, pending-inputs): the
// override as the tool that runs the command spells it, and reading a JSON object file.
// Nothing here loads the runner's modules, so a guard module still loads without them.

const fs = require('fs');

// How to run a command anyway: <variable>=<value> before it, in Bash or PowerShell syntax.
function overrideSyntax(payload, command, variable, value = '1') {
  return payload && payload.tool_name === 'PowerShell'
    ? `\`$env:${variable}='${value}'; ${command}\``
    : `\`${variable}=${value} ${command}\``;
}

// A JSON file holding an object (a leading byte-order mark allowed), or null.
function readJsonObject(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) { return null; }
}

module.exports = { overrideSyntax, readJsonObject };
