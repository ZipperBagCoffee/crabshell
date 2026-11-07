'use strict';
// What a tool call does, read from the shape of its input — and, once it has run, of
// its response — never from the tool's name (D143 §6). Hosts give the same action
// different names (Claude Bash and PowerShell, Codex exec_command, an MCP shell; Claude
// Write/Edit/NotebookEdit, Codex apply_patch, an MCP file writer), so a list of names
// misses every name it was not written for. Malformed input yields "neither" and never
// throws: hooks fail open.

// Codex apply_patch carries its patch in tool_input.command; this envelope and its file
// headers are that host's patch format (https://learn.chatgpt.com/docs/hooks).
const PATCH_START = /^\s*\*\*\* Begin Patch\b/;
const PATCH_HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/;

// After the call ran, a tool-content result (a list, or an object carrying a `content`
// list and none of these process-output fields — the MCP tool result) means `command`
// was some other tool's argument. Any other response stays a shell result: Claude
// Bash/PowerShell Output, Codex text, exec status objects ({ status, session_id }).
const PROCESS_OUTPUT_FIELDS = ['stdout', 'stderr', 'output', 'exit_code', 'exitCode', 'interrupted'];

function inputOf(payload) {
  const input = payload && typeof payload === 'object' ? payload.tool_input : null;
  return input && typeof input === 'object' && !Array.isArray(input) ? input : null;
}

function patchText(input) {
  return typeof input.command === 'string' && PATCH_START.test(input.command) ? input.command : null;
}

function isToolContentResult(response) {
  if (Array.isArray(response)) return true;
  return Boolean(response) && typeof response === 'object' && Array.isArray(response.content)
    && !PROCESS_OUTPUT_FIELDS.some(field => Object.prototype.hasOwnProperty.call(response, field));
}

// The shell command a call runs, or null. Codex's older exec_command spelled it `cmd`.
function shellCommand(payload) {
  const input = inputOf(payload);
  if (!input || patchText(input)) return null;
  const command = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : null;
  if (!command || !command.trim()) return null;
  if (isToolContentResult(payload.tool_response)) return null;
  return command;
}

function patchWrites(text) {
  const writes = [];
  let adding = null;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(PATCH_HEADER);
    if (header) {
      adding = null;
      const write = { path: header[2].trim(), kind: 'patch' };
      if (header[1] === 'Add File') { write.content = ''; adding = write; adding.lines = []; }
      writes.push(write);
    } else if (adding && line.startsWith('+')) {
      adding.lines.push(line.slice(1));
    } else if (/^\*\*\* /.test(line)) {
      adding = null;
    }
  }
  return writes.map(({ lines, ...write }) => (lines ? { ...write, content: lines.join('\n') } : write));
}

// Every file the call writes: [{ path, kind, ... }] — kind 'whole' (path + content),
// 'edit' (path + old/new string), 'cell' (a notebook cell), 'patch' (a patch file
// section; Add File sections carry their content). [] when the call writes no file.
function fileWrites(payload) {
  const input = inputOf(payload);
  if (!input) return [];
  const patch = patchText(input);
  if (patch) return patchWrites(patch);
  const filePath = [input.file_path, input.notebook_path, input.path].find(value => typeof value === 'string' && value);
  if (!filePath) return [];
  if (typeof input.content === 'string') return [{ path: filePath, kind: 'whole', content: input.content }];
  if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return [{ path: filePath, kind: 'edit', oldString: input.old_string, newString: input.new_string, replaceAll: input.replace_all === true }];
  }
  if (typeof input.new_source === 'string') return [{ path: filePath, kind: 'cell' }];
  return [];
}

const isShellCall = payload => shellCommand(payload) !== null;
const isFileWrite = payload => fileWrites(payload).length > 0;
const writtenPaths = payload => fileWrites(payload).map(write => write.path);

// A transcript tool_use block ({ name, input }) in the hook payload's shape.
function transcriptCall(block) {
  return block && typeof block === 'object' ? { tool_name: block.name, tool_input: block.input } : null;
}

module.exports = { fileWrites, isFileWrite, isShellCall, shellCommand, transcriptCall, writtenPaths };
