const fs = require('fs');
const path = require('path');
const { getProjectDir, getStorageRoot, readJsonOrDefault } = require('./utils');
const { MEMORY_DIR, SESSIONS_DIR, INDEX_FILE, MEMORY_FILE, ARCHIVE_PREFIX } = require('./constants');

// --- Helpers ---

/**
 * Creates a matcher object with a test(text) method.
 * @param {string} query - search term or regex pattern
 * @param {object} options - { regex: boolean }
 * @returns {{ test: (text: string) => boolean }}
 */
function createMatcher(query, options = {}) {
  if (options.regex) {
    const re = new RegExp(query, 'i');
    return { test: (text) => re.test(text) };
  }
  const q = query.toLowerCase();
  return { test: (text) => text.toLowerCase().includes(q) };
}

/**
 * Extracts searchable text from an L1 JSONL entry object.
 * Combines text, output, name, target, and pattern fields.
 */
function getSearchableText(entry) {
  const parts = [];
  if (entry.text) parts.push(entry.text);
  if (entry.output) parts.push(entry.output);
  if (entry.name) parts.push(entry.name);
  if (entry.target) parts.push(entry.target);
  if (entry.pattern) parts.push(entry.pattern);
  return parts.join(' ');
}

/**
 * Truncates text to maxLen characters, appending '...' if truncated.
 */
function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text || '';
  return text.substring(0, maxLen) + '...';
}

// --- Main search ---

function searchMemory(query, options = {}) {
  const projectDir = getProjectDir();
  const memoryDir = path.join(getStorageRoot(projectDir), MEMORY_DIR);
  const results = [];
  const matcher = createMatcher(query, options);

  const memoryMatches = searchCurrentMemory(memoryDir, matcher);
  if (memoryMatches.length > 0) results.push({ source: 'logbook.md', matches: memoryMatches });

  const l3Matches = searchL3Summaries(memoryDir, matcher);
  if (l3Matches.length > 0) results.push({ source: 'L3 summaries', matches: l3Matches });

  const l2Matches = searchL2Archives(memoryDir, matcher);
  if (l2Matches.length > 0) results.push({ source: 'L2 archives', matches: l2Matches });

  if (options.deep) {
    const l1Matches = searchL1Sessions(projectDir, matcher, options);
    if (l1Matches.length > 0) results.push({ source: 'L1 sessions', matches: l1Matches });
  }

  return results;
}

// --- Layer-specific search functions ---

function searchCurrentMemory(memoryDir, matcher) {
  // Accept both matcher object and legacy string
  if (typeof matcher === 'string') matcher = createMatcher(matcher);
  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  if (!fs.existsSync(memoryPath)) return [];
  const lines = fs.readFileSync(memoryPath, 'utf8').split(/\r?\n/);
  const matches = [];
  lines.forEach((line, i) => {
    if (matcher.test(line)) matches.push({ line: i + 1, text: line.trim() });
  });
  return matches;
}

function searchL3Summaries(memoryDir, matcher) {
  // Accept both matcher object and legacy string
  if (typeof matcher === 'string') matcher = createMatcher(matcher);
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
        if (matcher.test(theme.name) || matcher.test(theme.summary)) {
          matches.push({ file: entry.file, type: 'theme', content: theme.name, detail: theme.summary });
        }
      }
    }
    if (summary.keyDecisions) {
      for (const dec of summary.keyDecisions) {
        if (matcher.test(dec.decision)) {
          matches.push({ file: entry.file, type: 'decision', content: dec.decision, reason: dec.reason });
        }
      }
    }
    if (summary.issues) {
      for (const issue of summary.issues) {
        if (matcher.test(issue.issue)) {
          matches.push({ file: entry.file, type: 'issue', content: issue.issue, status: issue.status });
        }
      }
    }
    if (summary.overallSummary && matcher.test(summary.overallSummary)) {
      matches.push({ file: entry.file, type: 'summary', content: truncate(summary.overallSummary, 200) });
    }
  }
  return matches;
}

function searchL2Archives(memoryDir, matcher) {
  // Accept both matcher object and legacy string
  if (typeof matcher === 'string') matcher = createMatcher(matcher);
  const files = fs.readdirSync(memoryDir).filter(f => (f.startsWith(ARCHIVE_PREFIX) || f.startsWith('memory_')) && f.endsWith('.md'));
  const matches = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(memoryDir, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (matcher.test(line)) matches.push({ file, line: i + 1, text: line.trim() });
    });
  }
  return matches;
}

/**
 * Search L1 session JSONL files with two-pass optimization.
 * Pass 1: whole-file includes check (skip files without any match).
 * Pass 2: line-by-line JSONL parse on hits, returning structured entries + context.
 *
 * @param {string} projectDir - project root
 * @param {object|string} matcher - matcher object or query string (legacy compat)
 * @param {object} options - { contextWindow: number (default 2) }
 * @returns {Array<{ file, matchIndex, entry: {ts, role, text}, context: [{ts, role, text}] }>}
 */
function searchL1Sessions(projectDir, matcher, options = {}) {
  // Accept both matcher object and legacy string
  if (typeof matcher === 'string') matcher = createMatcher(matcher);
  const contextWindow = options.contextWindow != null ? options.contextWindow : 2;
  const maxPerFile = options.maxPerFile != null ? options.maxPerFile : 5;
  const sessionsDir = path.join(getStorageRoot(projectDir), SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) return [];

  // Get files sorted newest-first by filename timestamp
  const files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l1.jsonl'))
    .sort((a, b) => b.localeCompare(a));

  const matches = [];
  const TEXT_MAX = 200;

  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Pass 1: whole-file pre-check — skip if no match anywhere in the raw text
    if (!matcher.test(content)) continue;

    // Pass 2: line-by-line JSONL parse
    const lines = content.split(/\r?\n/);
    const entries = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch (e) {
        // skip malformed lines
      }
    }

    let fileMatchCount = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const searchable = getSearchableText(entry);
      if (!matcher.test(searchable)) continue;
      if (++fileMatchCount > maxPerFile) break;

      // Build context window (entries before and after the match)
      const ctxStart = Math.max(0, i - contextWindow);
      const ctxEnd = Math.min(entries.length - 1, i + contextWindow);
      const context = [];
      for (let j = ctxStart; j <= ctxEnd; j++) {
        if (j === i) continue; // skip the match itself
        const ctxEntry = entries[j];
        context.push({
          ts: ctxEntry.ts,
          role: ctxEntry.role,
          text: truncate(getSearchableText(ctxEntry), TEXT_MAX)
        });
      }

      matches.push({
        file,
        matchIndex: i,
        entry: {
          ts: entry.ts,
          role: entry.role,
          text: truncate(searchable, TEXT_MAX)
        },
        context
      });
    }
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
  // Format: "2026-01-13_0839.l1.jsonl" or "2026-01-13_0839_abcd1234.l1.jsonl"
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(?:_[a-f0-9]+)?\.l1\.jsonl/);
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
        const firstLine = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)[0];
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

module.exports = { searchMemory, searchL3Summaries, searchL2Archives, searchL1Sessions, findL1ForTimestamp, createMatcher };
