const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, readFileOrDefault, readJsonOrDefault } = require('./utils');

// Hierarchical memory files in load order
const MEMORY_FILES = [
  { name: 'project.md', title: 'Project Overview' },
  { name: 'architecture.md', title: 'Architecture' },
  { name: 'conventions.md', title: 'Conventions' }
];

const MEMORY_TAIL_LINES = 50; // Last N lines of memory.md

function loadMemory() {
  const projectDir = getProjectDir();
  const projectName = getProjectName();
  const sections = [];

  // Load hierarchical memory files
  MEMORY_FILES.forEach(({ name, title }) => {
    const filePath = path.join(projectDir, name);
    if (fs.existsSync(filePath)) {
      const content = readFileOrDefault(filePath, '').trim();
      if (content) {
        sections.push(`## ${title}\n${content}`);
      }
    }
  });

  // Load rolling memory (last N lines)
  const memoryPath = path.join(projectDir, 'memory.md');
  if (fs.existsSync(memoryPath)) {
    const content = readFileOrDefault(memoryPath, '');
    const lines = content.split('\n');
    if (lines.length > MEMORY_TAIL_LINES) {
      const tail = lines.slice(-MEMORY_TAIL_LINES).join('\n');
      sections.push(`## Recent Sessions (last ${MEMORY_TAIL_LINES} lines)\n${tail}`);
    } else if (content.trim()) {
      sections.push(`## Recent Sessions\n${content}`);
    }
  }

  // Load facts summary
  const factsPath = path.join(projectDir, 'facts.json');
  if (fs.existsSync(factsPath)) {
    const facts = readJsonOrDefault(factsPath, null);
    if (facts) {
      const summary = [];
      if (facts.decisions && facts.decisions.length > 0) {
        summary.push(`Decisions: ${facts.decisions.length}`);
      }
      if (facts.patterns && facts.patterns.length > 0) {
        summary.push(`Patterns: ${facts.patterns.length}`);
      }
      if (facts.issues && facts.issues.length > 0) {
        const open = facts.issues.filter(i => i.status === 'open').length;
        summary.push(`Issues: ${facts.issues.length} (${open} open)`);
      }
      if (facts.concepts && Object.keys(facts.concepts).length > 0) {
        const concepts = Object.keys(facts.concepts).slice(0, 10);
        summary.push(`Concepts: ${concepts.join(', ')}${Object.keys(facts.concepts).length > 10 ? '...' : ''}`);
      }
      if (summary.length > 0) {
        sections.push(`## Facts Summary\n${summary.join(' | ')}\nUse \`node scripts/counter.js search\` for details.`);
      }
    }
  }

  // Output
  if (sections.length > 0) {
    console.log(`\n═══ Memory Keeper: ${projectName} ═══\n`);
    console.log(sections.join('\n\n---\n\n'));
    console.log(`\n═══ End of Memory ═══\n`);
  } else {
    console.log(`\n--- Memory Keeper: No memory for ${projectName} ---\n`);
    console.log('Create project.md, architecture.md, or conventions.md in .claude/memory/');
  }
}

loadMemory();
