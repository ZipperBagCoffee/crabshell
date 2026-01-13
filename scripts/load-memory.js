const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, readFileOrDefault, readJsonOrDefault } = require('./utils');

/**
 * Hierarchical Memory Loading (H-MEM inspired)
 *
 * Layer Structure:
 * - L4 (Domain): Permanent rules, solutions, core logic - ALWAYS loaded
 * - L3 (Category): Concepts grouped by topic - Recent N loaded
 * - L2 (Memory Trace): Session summaries - Recent N loaded
 * - L1 (Episode): Raw sessions - On-demand search only
 *
 * Startup loads L4 fully, L3/L2 recent items within token budget
 */

// Config
const CONFIG = {
  L4_RULES_MAX: 10,        // Max permanent rules to show
  L4_SOLUTIONS_MAX: 5,     // Max solutions to show
  L3_CONCEPTS_MAX: 8,      // Max recent concepts
  L2_SESSIONS_MAX: 5,      // Max recent L2 summaries
  MEMORY_TAIL_LINES: 30,   // Last N lines of memory.md (reduced)
  TOKEN_BUDGET: 3000       // Approximate token budget for startup
};

// Static memory files
const MEMORY_FILES = [
  { name: 'project.md', title: 'Project Overview' },
  { name: 'architecture.md', title: 'Architecture' },
  { name: 'conventions.md', title: 'Conventions' }
];

/**
 * L4: Load permanent memory (Domain Layer)
 * Always loaded - highest abstraction, most important
 */
function loadL4Permanent(projectDir) {
  const factsPath = path.join(projectDir, 'facts.json');
  const facts = readJsonOrDefault(factsPath, null);
  if (!facts || !facts.permanent) return null;

  const sections = [];
  const perm = facts.permanent;

  // Rules (validated, high-confidence patterns)
  if (perm.rules && perm.rules.length > 0) {
    const rules = perm.rules
      .filter(r => r.confidence >= 0.7)
      .slice(0, CONFIG.L4_RULES_MAX)
      .map(r => `  - ${r.content}`)
      .join('\n');
    if (rules) sections.push(`**Rules:**\n${rules}`);
  }

  // Solutions (problem-solution pairs)
  if (perm.solutions && perm.solutions.length > 0) {
    const solutions = perm.solutions
      .slice(0, CONFIG.L4_SOLUTIONS_MAX)
      .map(s => `  - ${s.problem}: ${s.solution}`)
      .join('\n');
    if (solutions) sections.push(`**Solutions:**\n${solutions}`);
  }

  // Core logic (critical system knowledge)
  if (perm.core_logic && perm.core_logic.length > 0) {
    const core = perm.core_logic
      .slice(0, 5)
      .map(c => `  - ${c.feature}: ${c.description}`)
      .join('\n');
    if (core) sections.push(`**Core Logic:**\n${core}`);
  }

  return sections.length > 0 ? sections.join('\n') : null;
}

/**
 * L3: Load concepts (Category Layer)
 * Recent concepts with their associated keywords/files
 */
function loadL3Concepts(projectDir) {
  const conceptsPath = path.join(projectDir, 'concepts.json');
  const data = readJsonOrDefault(conceptsPath, null);
  if (!data || !data.concepts || data.concepts.length === 0) return null;

  // Sort by updated date, get recent ones
  const recent = data.concepts
    .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
    .slice(0, CONFIG.L3_CONCEPTS_MAX);

  const lines = recent.map(c => {
    const keywords = c.keywords?.slice(0, 5).join(', ') || '';
    const files = c.files?.slice(0, 3).join(', ') || '';
    let line = `  - **${c.name}**`;
    if (keywords) line += ` [${keywords}]`;
    if (files) line += ` → ${files}`;
    return line;
  });

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * L2: Load recent session summaries (Memory Trace Layer)
 * Condensed session-level information
 */
function loadL2Sessions(projectDir) {
  const sessionsDir = path.join(projectDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) return null;

  // Find all L2 files
  const l2Files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l2.json'))
    .sort()
    .reverse()
    .slice(0, CONFIG.L2_SESSIONS_MAX);

  if (l2Files.length === 0) return null;

  const summaries = [];
  for (const file of l2Files) {
    const l2Path = path.join(sessionsDir, file);
    const l2Data = readJsonOrDefault(l2Path, null);
    if (!l2Data || !l2Data.exchanges) continue;

    const sessionId = file.replace('.l2.json', '');
    const exchangeSummaries = l2Data.exchanges
      .slice(0, 3)  // Max 3 exchanges per session
      .map(ex => ex.summary || 'No summary')
      .join('; ');

    if (exchangeSummaries) {
      summaries.push(`  - **${sessionId}**: ${exchangeSummaries.substring(0, 150)}${exchangeSummaries.length > 150 ? '...' : ''}`);
    }
  }

  return summaries.length > 0 ? summaries.join('\n') : null;
}

/**
 * L4 Keywords: Quick keyword index for search hints
 */
function loadKeywordHints(projectDir) {
  const factsPath = path.join(projectDir, 'facts.json');
  const facts = readJsonOrDefault(factsPath, null);
  if (!facts || !facts.keywords) return null;

  const keywords = Object.keys(facts.keywords);
  if (keywords.length === 0) return null;

  // Show top 15 keywords by reference count
  const sorted = keywords
    .map(k => ({ keyword: k, count: facts.keywords[k].length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map(k => k.keyword);

  return sorted.length > 0 ? `Indexed: ${sorted.join(', ')}` : null;
}

/**
 * Load facts summary (decisions, patterns, issues)
 */
function loadFactsSummary(projectDir) {
  const factsPath = path.join(projectDir, 'facts.json');
  const facts = readJsonOrDefault(factsPath, null);
  if (!facts) return null;

  const parts = [];

  // Recent decisions (last 3)
  if (facts.decisions && facts.decisions.length > 0) {
    const recent = facts.decisions.slice(-3);
    const items = recent.map(d => `  - ${d.content.substring(0, 80)}${d.content.length > 80 ? '...' : ''}`).join('\n');
    parts.push(`**Recent Decisions (${facts.decisions.length} total):**\n${items}`);
  }

  // Open issues
  if (facts.issues && facts.issues.length > 0) {
    const open = facts.issues.filter(i => i.status === 'open');
    if (open.length > 0) {
      const items = open.slice(0, 3).map(i => `  - ${i.content}`).join('\n');
      parts.push(`**Open Issues (${open.length}):**\n${items}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Main: Load hierarchical memory
 */
function loadMemory() {
  const projectDir = getProjectDir();
  const projectName = getProjectName();
  const sections = [];

  // === Static Memory Files (project.md, architecture.md, conventions.md) ===
  MEMORY_FILES.forEach(({ name, title }) => {
    const filePath = path.join(projectDir, name);
    if (fs.existsSync(filePath)) {
      const content = readFileOrDefault(filePath, '').trim();
      if (content) {
        sections.push(`## ${title}\n${content}`);
      }
    }
  });

  // === L4: Permanent Memory (Domain Layer) - Always Load ===
  const l4Content = loadL4Permanent(projectDir);
  if (l4Content) {
    sections.push(`## L4: Permanent Knowledge\n${l4Content}`);
  }

  // === L3: Concepts (Category Layer) ===
  const l3Content = loadL3Concepts(projectDir);
  if (l3Content) {
    sections.push(`## L3: Active Concepts\n${l3Content}`);
  }

  // === L2: Recent Sessions (Memory Trace Layer) ===
  const l2Content = loadL2Sessions(projectDir);
  if (l2Content) {
    sections.push(`## L2: Recent Sessions\n${l2Content}`);
  }

  // === Facts Summary (Decisions, Issues) ===
  const factsSummary = loadFactsSummary(projectDir);
  if (factsSummary) {
    sections.push(`## Facts\n${factsSummary}`);
  }

  // === Keyword Index (L4 search hints) ===
  const keywordHints = loadKeywordHints(projectDir);
  if (keywordHints) {
    sections.push(`## Keywords\n${keywordHints}\nSearch: \`node scripts/counter.js search-keywords <query>\``);
  }

  // === Rolling Memory (memory.md tail - reduced) ===
  const memoryPath = path.join(projectDir, 'memory.md');
  if (fs.existsSync(memoryPath)) {
    const content = readFileOrDefault(memoryPath, '');
    const lines = content.split('\n');
    if (lines.length > CONFIG.MEMORY_TAIL_LINES) {
      const tail = lines.slice(-CONFIG.MEMORY_TAIL_LINES).join('\n');
      sections.push(`## Recent Sessions (last ${CONFIG.MEMORY_TAIL_LINES} lines)\n${tail}`);
    } else if (content.trim()) {
      sections.push(`## Recent Sessions\n${content}`);
    }
  }

  // === Output ===
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
