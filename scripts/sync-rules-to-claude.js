// scripts/sync-rules-to-claude.js
// Syncs RULES from inject-rules.js to CLAUDE.md
const fs = require('fs');
const path = require('path');

function getProjectDir() {
  if (process.env.PROJECT_DIR) return process.env.PROJECT_DIR;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.claude'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function extractRulesFromInjectRules(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Extract the RULES constant content between backticks
  const match = content.match(/const RULES = `([\s\S]*?)`;/);
  if (!match) return null;

  // Return full content (trimmed), not just bullet points
  return match[1].trim();
}

const MARKER_START = '## [MEMORY_KEEPER] Plugin Rules';
const MARKER_END = '---END MEMORY_KEEPER---';

function updateClaudeMd(claudePath, rulesContent) {
  let content = fs.readFileSync(claudePath, 'utf8');
  const rulesBlock = MARKER_START + '\n\n' + rulesContent + '\n\n' + MARKER_END;

  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Markers found → replace only between markers (inclusive)
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + MARKER_END.length);
    fs.writeFileSync(claudePath, before + rulesBlock + after);
    return true;
  }

  // No markers found - try legacy format
  console.error('Could not find MEMORY_KEEPER markers in CLAUDE.md. Run inject-rules.js first to migrate.');
  return false;
}

function main() {
  const projectDir = getProjectDir();
  const injectRulesPath = path.join(projectDir, 'scripts', 'inject-rules.js');
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');

  if (!fs.existsSync(injectRulesPath)) {
    console.error('inject-rules.js not found');
    process.exit(1);
  }

  if (!fs.existsSync(claudeMdPath)) {
    console.error('CLAUDE.md not found');
    process.exit(1);
  }

  const rulesContent = extractRulesFromInjectRules(injectRulesPath);
  if (!rulesContent) {
    console.error('Could not extract rules from inject-rules.js');
    process.exit(1);
  }

  console.log(`Extracted rules content (${rulesContent.length} chars) from inject-rules.js`);

  if (updateClaudeMd(claudeMdPath, rulesContent)) {
    console.log('CLAUDE.md updated successfully');
  } else {
    console.error('Failed to update CLAUDE.md');
    process.exit(1);
  }
}

main();
