const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, readFileOrDefault, readJsonOrDefault, estimateTokens } = require('./utils');
const { ensureMemoryStructure } = require('./init');
const { MEMORY_DIR, SESSIONS_DIR, INDEX_FILE, MEMORY_FILE } = require('./constants');

const MEMORY_FILES = [
  { name: 'project.md', title: 'Project Overview' },
  { name: 'architecture.md', title: 'Architecture' },
  { name: 'conventions.md', title: 'Conventions' }
];

const MEMORY_TAIL_LINES = 50;

function loadMemory() {
  const projectDir = getProjectDir();
  const projectName = getProjectName();
  const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
  const sections = [];

  // Ensure memory structure exists
  ensureMemoryStructure(projectDir);

  // Load hierarchical memory files
  MEMORY_FILES.forEach(({ name, title }) => {
    const filePath = path.join(memoryDir, name);
    if (fs.existsSync(filePath)) {
      const content = readFileOrDefault(filePath, '').trim();
      if (content) sections.push('## ' + title + '\n' + content);
    }
  });

  // Load L3 summaries from index
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const index = readJsonOrDefault(indexPath, null);
  
  if (index && index.rotatedFiles) {
    // Check for pending summaries
    const pending = index.rotatedFiles.filter(f => !f.summaryGenerated);
    if (pending.length > 0) {
      console.log('[MEMORY_KEEPER] ' + pending.length + ' summaries pending:');
      pending.forEach(f => console.log('  - ' + f.file));
    }

    // Load most recent L3 summary
    const generated = index.rotatedFiles.filter(f => f.summaryGenerated);
    if (generated.length > 0) {
      const latest = generated[generated.length - 1];
      const summaryPath = path.join(memoryDir, latest.summary);
      if (fs.existsSync(summaryPath)) {
        const summary = readJsonOrDefault(summaryPath, null);
        if (summary && summary.overallSummary) {
          sections.push('## Previous Memory Summary\n' + summary.overallSummary);
        }
      }
    }
  }

  // Load L1 tail (unreflected content from last session)
  const sessionsDir = path.join(projectDir, '.claude', SESSIONS_DIR);
  if (fs.existsSync(sessionsDir)) {
    const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl')).sort().reverse();
    if (l1Files.length > 0) {
      const memoryPath = path.join(memoryDir, MEMORY_FILE);
      const memoryContent = fs.existsSync(memoryPath) ? readFileOrDefault(memoryPath, '') : '';
      const unreflected = getUnreflectedL1Content(path.join(sessionsDir, l1Files[0]), memoryContent);
      if (unreflected) {
        sections.push('## Unreflected from Last Session\n' + unreflected.join('\n'));
      }
    }
  }

  // Load rolling memory (last N lines)
  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  if (fs.existsSync(memoryPath)) {
    const content = readFileOrDefault(memoryPath, '');
    const lines = content.split('\n');
    if (lines.length > MEMORY_TAIL_LINES) {
      const tail = lines.slice(-MEMORY_TAIL_LINES).join('\n');
      sections.push('## Recent Sessions (last ' + MEMORY_TAIL_LINES + ' lines)\n' + tail);
    } else if (content.trim()) {
      sections.push('## Recent Sessions\n' + content);
    }
  }

  // Output
  if (sections.length > 0) {
    console.log('\n=== Memory Keeper: ' + projectName + ' ===\n');
    console.log(sections.join('\n\n---\n\n'));
    console.log('\n=== End of Memory ===\n');
  } else {
    console.log('\n--- Memory Keeper: No memory for ' + projectName + ' ---\n');
  }
}

function getUnreflectedL1Content(l1Path, memoryContent) {
  try {
    const content = fs.readFileSync(l1Path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim()).slice(-20);
    const summary = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === 'assistant' && entry.content) {
          const text = typeof entry.content === 'string' ? entry.content : entry.content.map(c => c.text || '').join('');
          if (text.length > 50 && !memoryContent.includes(text.substring(0, 50))) {
            summary.push(text.substring(0, 200));
          }
        }
      } catch {}
    }
    return summary.length > 0 ? summary : null;
  } catch { return null; }
}

loadMemory();
