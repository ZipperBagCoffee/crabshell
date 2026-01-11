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

  // Remove junk types
  if (JUNK_TYPES.includes(type)) {
    return null;
  }

  // TODO: Process each type
  return null;
}

module.exports = { refineRaw, processLine, refineLine };

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