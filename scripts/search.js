const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault } = require('./utils');
const { MEMORY_DIR, SESSIONS_DIR, INDEX_FILE, MEMORY_FILE } = require('./constants');

function searchMemory(query, options = {}) {
  const projectDir = getProjectDir();
  const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
  const results = [];
  const queryLower = query.toLowerCase();

  const memoryMatches = searchCurrentMemory(memoryDir, queryLower);
  if (memoryMatches.length > 0) results.push({ source: 'memory.md', matches: memoryMatches });

  const l3Matches = searchL3Summaries(memoryDir, queryLower);
  if (l3Matches.length > 0) results.push({ source: 'L3 summaries', matches: l3Matches });

  const l2Matches = searchL2Archives(memoryDir, queryLower);
  if (l2Matches.length > 0) results.push({ source: 'L2 archives', matches: l2Matches });

  if (options.deep) {
    const l1Matches = searchL1Sessions(projectDir, queryLower);
    if (l1Matches.length > 0) results.push({ source: 'L1 sessions', matches: l1Matches });
  }

  return results;
}

function searchCurrentMemory(memoryDir, query) {
  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  if (!fs.existsSync(memoryPath)) return [];
  const lines = fs.readFileSync(memoryPath, 'utf8').split('\n');
  const matches = [];
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(query)) matches.push({ line: i + 1, text: line.trim() });
  });
  return matches;
}

function searchL3Summaries(memoryDir, query) {
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const index = readJsonOrDefault(indexPath, { rotatedFiles: [] });
  const matches = [];
  const rotatedFiles = Array.isArray(index.rotatedFiles) ? index.rotatedFiles : [];

  for (const entry of rotatedFiles) {
    if (!entry.summaryGenerated) continue;
    const summaryPath = path.join(memoryDir, entry.summary);
    if (!fs.existsSync(summaryPath)) continue;
    const summary = readJsonOrDefault(summaryPath, null);
    if (!summary) continue;

    if (summary.themes) {
      for (const theme of summary.themes) {
        if (theme.name.toLowerCase().includes(query) || theme.summary.toLowerCase().includes(query)) {
          matches.push({ file: entry.file, type: 'theme', content: theme.name, detail: theme.summary });
        }
      }
    }
    if (summary.keyDecisions) {
      for (const dec of summary.keyDecisions) {
        if (dec.decision.toLowerCase().includes(query)) {
          matches.push({ file: entry.file, type: 'decision', content: dec.decision, reason: dec.reason });
        }
      }
    }
    if (summary.issues) {
      for (const issue of summary.issues) {
        if (issue.issue.toLowerCase().includes(query)) {
          matches.push({ file: entry.file, type: 'issue', content: issue.issue, status: issue.status });
        }
      }
    }
    if (summary.overallSummary && summary.overallSummary.toLowerCase().includes(query)) {
      matches.push({ file: entry.file, type: 'summary', content: summary.overallSummary.substring(0, 200) + '...' });
    }
  }
  return matches;
}

function searchL2Archives(memoryDir, query) {
  const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('memory_') && f.endsWith('.md'));
  const matches = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(memoryDir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(query)) matches.push({ file, line: i + 1, text: line.trim() });
    });
  }
  return matches;
}

function searchL1Sessions(projectDir, query) {
  const sessionsDir = path.join(projectDir, '.claude', SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) return [];
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));
  const matches = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(sessionsDir, file), 'utf8');
    if (content.toLowerCase().includes(query)) matches.push({ file, found: true });
  }
  return matches;
}

// Parse timestamp string to Date object
function parseTimestamp(ts) {
  // Format: "2026-01-13_0830" or "2026-01-13_0830"
  const match = ts.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
  if (!match) return null;
  return new Date(match[1], match[2] - 1, match[3], match[4], match[5]);
}

// Parse L1 filename to Date object
function parseFilenameTimestamp(filename) {
  // Format: "2026-01-13_0839.l1.jsonl"
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.l1\.jsonl/);
  if (!match) return null;
  return new Date(match[1], match[2] - 1, match[3], match[4], match[5]);
}

// Find the L1 file that covers a given timestamp
function findL1ForTimestamp(timestamp, sessionsDir) {
  if (!fs.existsSync(sessionsDir)) return null;
  const targetTime = parseTimestamp(timestamp);
  if (!targetTime) return null;

  const l1Files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l1.jsonl'))
    .map(f => {
      const filePath = path.join(sessionsDir, f);
      try {
        const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
        const startTs = JSON.parse(firstLine).ts;
        const endTs = parseFilenameTimestamp(f);
        return { file: f, start: new Date(startTs), end: endTs };
      } catch (e) {
        return null;
      }
    })
    .filter(f => f !== null);

  // Find L1 where target time is within range
  return l1Files.find(l1 => targetTime >= l1.start && targetTime <= l1.end);
}

module.exports = { searchMemory, searchL3Summaries, searchL2Archives, findL1ForTimestamp };
