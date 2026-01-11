const fs = require('fs');
const path = require('path');
const { getProjectDir, getTimestamp } = require('./utils');

// Read L1 file and format for LLM summarization
function prepareL1ForSummary(l1Path) {
  if (!fs.existsSync(l1Path)) {
    return null;
  }

  const lines = fs.readFileSync(l1Path, 'utf8').split('\n').filter(l => l.trim());
  const exchanges = [];
  let currentExchange = null;

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);

      if (entry.role === 'user') {
        // Start new exchange
        if (currentExchange) {
          exchanges.push(currentExchange);
        }
        currentExchange = {
          startLine: i + 1,
          user: entry.text,
          assistant: [],
          tools: [],
          files: new Set()
        };
      } else if (entry.role === 'assistant' && currentExchange) {
        currentExchange.assistant.push(entry.text);
      } else if (entry.role === 'tool' && currentExchange) {
        currentExchange.tools.push({
          name: entry.name,
          target: entry.target || entry.cmd || entry.pattern
        });
        if (entry.target) {
          // Extract filename from path
          const fileName = path.basename(entry.target);
          currentExchange.files.add(fileName);
        }
      }
    } catch (e) {
      // Skip invalid lines
    }
  }

  if (currentExchange) {
    currentExchange.endLine = lines.length;
    exchanges.push(currentExchange);
  }

  // Convert Sets to Arrays
  exchanges.forEach(ex => {
    ex.files = Array.from(ex.files);
  });

  return exchanges;
}

// Format exchanges for LLM prompt
function formatForLLM(exchanges, sessionId) {
  let output = `Generate L2 summaries for session ${sessionId}.\n\n`;
  output += `For each exchange below, output a JSON object with:\n`;
  output += `- id: "e001", "e002", etc.\n`;
  output += `- summary: 1-sentence summary of what was done\n`;
  output += `- details: 1-2 sentences with specifics\n`;
  output += `- files: array of files modified\n`;
  output += `- keywords: 3-5 keywords for searchability\n`;
  output += `- l1_range: [startLine, endLine]\n\n`;
  output += `Output as JSON array. Start with [\n\n`;

  exchanges.forEach((ex, i) => {
    output += `--- Exchange ${i + 1} (lines ${ex.startLine}-${ex.endLine || '?'}) ---\n`;
    output += `User: ${ex.user?.substring(0, 200)}${ex.user?.length > 200 ? '...' : ''}\n`;
    if (ex.assistant.length > 0) {
      output += `Assistant: ${ex.assistant.join(' ').substring(0, 300)}...\n`;
    }
    if (ex.tools.length > 0) {
      output += `Tools: ${ex.tools.map(t => `${t.name}(${t.target || ''})`).join(', ')}\n`;
    }
    if (ex.files.length > 0) {
      output += `Files: ${ex.files.join(', ')}\n`;
    }
    output += '\n';
  });

  return output;
}

// CLI: node generate-l2.js <l1-path>
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node generate-l2.js <l1-path>');
    process.exit(1);
  }

  const l1Path = args[0];
  const sessionId = path.basename(l1Path, '.l1.jsonl');
  const exchanges = prepareL1ForSummary(l1Path);

  if (!exchanges || exchanges.length === 0) {
    console.log('[MEMORY_KEEPER] No exchanges found in L1');
    process.exit(0);
  }

  console.log(formatForLLM(exchanges, sessionId));
}

module.exports = { prepareL1ForSummary, formatForLLM };
