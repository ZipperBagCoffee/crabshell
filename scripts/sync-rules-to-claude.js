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

function updateClaudeMd(claudePath, rulesContent) {
  let content = fs.readFileSync(claudePath, 'utf8');

  // Find the "Memory Keeper Plugin Rules" section
  const sectionStart = content.indexOf('## Memory Keeper Plugin Rules');
  if (sectionStart === -1) {
    console.error('Could not find "## Memory Keeper Plugin Rules" section in CLAUDE.md');
    return false;
  }

  // Find the end of this section (next ## or end of file)
  const afterSection = content.slice(sectionStart);
  const nextSection = afterSection.indexOf('\n## ', 1);
  const sectionEnd = nextSection === -1 ? content.length : sectionStart + nextSection;

  // Build new section content - use full rules content
  const newSection = `## Memory Keeper Plugin Rules

**CRITICAL: Read hook outputs carefully. Don't treat them as noise.**

${rulesContent}
- Hook outputs contain important instructions - follow them
`;

  // Replace the section
  const before = content.slice(0, sectionStart);
  const after = content.slice(sectionEnd);
  const newContent = before + newSection + after;

  fs.writeFileSync(claudePath, newContent);
  return true;
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
