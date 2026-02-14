const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Types to completely remove
const JUNK_TYPES = [
  'queue-operation',
  'file-history-snapshot'
];

// Process a single raw.jsonl file into l1.jsonl
async function refineRaw(inputPath, outputPath) {
  const output = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const refined = processLine(line);
    if (refined) {
      output.push(JSON.stringify(refined));
    }
  }

  fs.writeFileSync(outputPath, output.join('\n'));
  return output.length;
}

// Process a single line, return refined object or null
function processLine(line) {
  try {
    const obj = JSON.parse(line);
    return refineLine(obj);
  } catch (e) {
    return null;
  }
}

// Refine based on type
function refineLine(obj) {
  const type = obj.type;

  if (JUNK_TYPES.includes(type)) {
    return null;
  }

  switch (type) {
    case 'user': {
      // Check if this is a tool_result wrapped in user message
      const content = obj.message?.content;
      if (content?.length >= 1 && content[0].type === 'tool_result') {
        return processToolResult(obj, content[0]);
      }
      return processUser(obj);
    }
    case 'assistant': {
      // Check if this is a tool_use wrapped in assistant message
      const content = obj.message?.content;
      if (content?.length === 1 && content[0].type === 'tool_use') {
        return processToolUse(obj, content[0]);
      }
      return processAssistant(obj);
    }
    case 'tool_use': return processToolUse(obj, obj);
    case 'tool_result': return processToolResult(obj, obj);
    default: return null;
  }
}

// Extract tool use with summary
// wrapper = the raw line object (has timestamp), toolContent = the tool_use content
function processToolUse(wrapper, toolContent) {
  const tool = {
    ts: wrapper.timestamp || new Date().toISOString(),
    role: 'tool',
    name: toolContent.name || 'unknown'
  };

  const input = toolContent.input || {};

    // Extract relevant info based on tool type
    switch (tool.name) {
      case 'Read':
        tool.target = input.file_path || input.path;
        if (input.offset) tool.lines = `${input.offset}-${input.offset + (input.limit || 100)}`;
        break;

      case 'Edit':
        tool.target = input.file_path;
        // Create diff summary
        if (input.old_string && input.new_string) {
          const oldLines = input.old_string.split('\n').slice(0, 3).join('\n');
          const newLines = input.new_string.split('\n').slice(0, 3).join('\n');
          tool.diff = `-${oldLines.substring(0, 100)}\n+${newLines.substring(0, 100)}`;
        }
        break;

      case 'Write':
        tool.target = input.file_path;
        tool.size = input.content?.length || 0;
        break;

      case 'Bash':
        tool.cmd = (input.command || '').substring(0, 200);
        break;

      case 'Grep':
        tool.pattern = input.pattern;
        tool.path = input.path;
        break;

      case 'Glob':
        tool.pattern = input.pattern;
        break;

      default:
        // Generic: just store input keys
        tool.params = Object.keys(input).join(',');
    }

  return tool;
}

// Extract tool result (success/fail + brief output)
// wrapper = the raw line object (has timestamp), resultContent = the tool_result content
function processToolResult(wrapper, resultContent) {
  const result = {
    ts: wrapper.timestamp || new Date().toISOString(),
    role: 'tool_result',
    tool_use_id: resultContent.tool_use_id
  };

  // Check if error
  if (resultContent.is_error) {
    result.result = 'error';
    const content = extractToolResultContent(resultContent.content);
    result.output = content.substring(0, 200);
  } else {
    result.result = 'ok';
    // Brief output for context
    const content = extractToolResultContent(resultContent.content);
    if (content && content.length > 0) {
      result.output = content.substring(0, 200);
    }
  }

  return result;
}

// Extract text content from tool_result content (can be string, array, or object)
function extractToolResultContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    // Content is array of {type: 'text', text: '...'} objects
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content);
  }
  return '';
}

// Extract assistant message (text only, no thinking)
function processAssistant(obj) {
  if (obj.type === 'assistant' && obj.message?.content) {
    const textContent = obj.message.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    if (textContent) {
      return {
        ts: obj.timestamp || new Date().toISOString(),
        role: 'assistant',
        text: textContent
      };
    }
  }
  return null;
}

// Extract user message
function processUser(obj) {
  // User messages have type: "user" with message.content array
  if (obj.type === 'user' && obj.message?.content) {
    const textContent = obj.message.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    if (textContent) {
      return {
        ts: obj.timestamp || new Date().toISOString(),
        role: 'user',
        text: textContent
      };
    }
  }
  return null;
}

// Synchronous version for use in PostToolUse hook (check())
// Same logic as refineRaw but uses readFileSync instead of readline stream
function refineRawSync(inputPath, outputPath) {
  const content = fs.readFileSync(inputPath, 'utf8');
  const lines = content.split('\n');
  const output = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const refined = processLine(line);
    if (refined) {
      output.push(JSON.stringify(refined));
    }
  }

  fs.writeFileSync(outputPath, output.join('\n'));
  return output.length;
}

module.exports = { refineRaw, refineRawSync, processLine, refineLine };

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node refine-raw.js <input.raw.jsonl> <output.l1.jsonl>');
    process.exit(1);
  }
  refineRaw(args[0], args[1]).then(count => {
    console.log(`Refined ${count} lines`);
  });
}