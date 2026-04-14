'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
let query = '';
let top = 5;
let projectDir = process.cwd();

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--query=')) {
    query = arg.slice('--query='.length).replace(/^["']|["']$/g, '');
  } else if (arg.startsWith('--top=')) {
    const n = parseInt(arg.slice('--top='.length), 10);
    if (!isNaN(n) && n > 0) top = n;
  } else if (arg.startsWith('--project-dir=')) {
    projectDir = arg.slice('--project-dir='.length).replace(/^["']|["']$/g, '');
  }
}

projectDir = path.resolve(projectDir);
const crabshellDir = path.join(projectDir, '.crabshell');

// ---------------------------------------------------------------------------
// Stopwords
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to',
  'for', 'of', 'and', 'or', 'but', 'not', 'with', 'from', 'by', 'as',
  'this', 'that', 'it', 'be', 'have', 'do', 'will', 'can', 'has',
]);

// ---------------------------------------------------------------------------
// Document directories to scan
// ---------------------------------------------------------------------------
const DOC_DIRS = ['discussion', 'investigation', 'plan', 'ticket', 'worklog', 'knowledge', 'hotfix'];

// ---------------------------------------------------------------------------
// tokenize(text): lowercase, split on delimiters, filter length>1, no stopwords
// ---------------------------------------------------------------------------
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[\s\-_/\\.,;:!?()\[\]{}"']+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

// ---------------------------------------------------------------------------
// parseFrontmatter(content): extract id, title, status, tags from YAML block
// ---------------------------------------------------------------------------
function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { id: '', title: '', status: '', tags: [] };
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) return { id: '', title: '', status: '', tags: [] };
  const block = content.slice(4, end);

  const idMatch     = block.match(/^id:\s*(.+)$/m);
  const titleMatch  = block.match(/^title:\s*"?(.+?)"?\s*$/m);
  const statusMatch = block.match(/^status:\s*(.+)$/m);
  const tagsMatch   = block.match(/^tags:\s*\[([^\]]*)\]/m);

  const id     = idMatch     ? idMatch[1].trim()     : '';
  const title  = titleMatch  ? titleMatch[1].trim()  : '';
  const status = statusMatch ? statusMatch[1].trim() : '';
  const tags   = tagsMatch
    ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
    : [];

  return { id, title, status, tags };
}

// ---------------------------------------------------------------------------
// scanDocs(projectDir): scan all DOC_DIRS for .md files, parse frontmatter + body
// ---------------------------------------------------------------------------
function scanDocs(projectDirPath) {
  const docs = [];

  for (const dir of DOC_DIRS) {
    const dirPath = path.join(crabshellDir, dir);
    if (!fs.existsSync(dirPath)) continue;

    let files;
    try {
      files = fs.readdirSync(dirPath).filter(f =>
        f.endsWith('.md') && f !== 'INDEX.md' && !f.endsWith('.bak')
      );
    } catch (e) {
      continue;
    }

    for (const filename of files) {
      const filePath = path.join(dirPath, filename);
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        continue;
      }

      const fm = parseFrontmatter(content);

      // Extract body (strip frontmatter if present)
      let body = content;
      if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
        const end = content.indexOf('\n---', 4);
        body = end !== -1 ? content.slice(end + 4) : content;
      }

      // Fall back to filename-derived id if frontmatter id is empty
      const id = fm.id || path.basename(filename, '.md').match(/^([A-Z]\d{3}(?:_T\d{3})?)/)?.[1] || '';

      docs.push({
        id,
        title: fm.title,
        status: fm.status,
        tags: fm.tags,
        body: body.trim(),
        filePath,
      });
    }
  }

  return docs;
}

// ---------------------------------------------------------------------------
// buildIndex(docs): inverted index Map<term, Map<docIdx, fieldFreqs>>
// Also computes per-doc total token count for BM25 avgdl
// ---------------------------------------------------------------------------
function buildIndex(docs) {
  // Map<term, Map<docIdx, {titleFreq, tagsFreq, idFreq, bodyFreq}>>
  const index = new Map();
  const docLengths = new Array(docs.length).fill(0);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];

    const titleTokens = tokenize(doc.title);
    const tagsTokens  = doc.tags.flatMap(t => tokenize(t));
    const idTokens    = tokenize(doc.id);
    const bodyTokens  = tokenize(doc.body);

    docLengths[i] = titleTokens.length + tagsTokens.length + idTokens.length + bodyTokens.length;

    const addTokens = (tokens, field) => {
      for (const term of tokens) {
        if (!index.has(term)) index.set(term, new Map());
        const postings = index.get(term);
        if (!postings.has(i)) {
          postings.set(i, { titleFreq: 0, tagsFreq: 0, idFreq: 0, bodyFreq: 0 });
        }
        postings.get(i)[field]++;
      }
    };

    addTokens(titleTokens, 'titleFreq');
    addTokens(tagsTokens,  'tagsFreq');
    addTokens(idTokens,    'idFreq');
    addTokens(bodyTokens,  'bodyFreq');
  }

  return { index, docLengths };
}

// ---------------------------------------------------------------------------
// bm25Score: BM25 with field boosts
// k1=1.5, b=0.75; boosts: title 3x, tags 2x, id 1.5x, body 1x
// ---------------------------------------------------------------------------
function bm25Score(queryStr, index, docs, docLengths) {
  const k1 = 1.5;
  const b  = 0.75;
  const N  = docs.length;

  const FIELD_BOOST = { titleFreq: 3, tagsFreq: 2, idFreq: 1.5, bodyFreq: 1 };

  const avgdl = docLengths.reduce((s, l) => s + l, 0) / (N || 1);
  const scores = new Array(N).fill(0);

  const queryTerms = tokenize(queryStr);

  for (const term of queryTerms) {
    const postings = index.get(term);
    if (!postings) continue;

    const df = postings.size;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

    for (const [docIdx, freqs] of postings) {
      const dl = docLengths[docIdx];
      // Combine weighted freq across all fields
      let weightedFreq = 0;
      for (const [field, boost] of Object.entries(FIELD_BOOST)) {
        weightedFreq += (freqs[field] || 0) * boost;
      }

      const norm = k1 * (1 - b + b * dl / avgdl);
      const termScore = idf * (weightedFreq * (k1 + 1)) / (weightedFreq + norm);
      scores[docIdx] += termScore;
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// formatResults: numbered list of top results
// ---------------------------------------------------------------------------
function formatResults(docs, scores, topN) {
  const ranked = scores
    .map((score, idx) => ({ score, idx }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  if (ranked.length === 0) {
    return 'No matching documents found.';
  }

  return ranked.map((r, i) => {
    const doc = docs[r.idx];
    const rel = path.relative(projectDir, doc.filePath);
    return `${i + 1}. [${doc.id}] ${doc.title || '(no title)'} (${doc.status || 'unknown'}) — ${rel} (score: ${r.score.toFixed(2)})`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  if (!fs.existsSync(crabshellDir)) {
    console.log(`No .crabshell/ directory found under ${projectDir}. Nothing to search.`);
    process.exit(0);
  }

  if (!query) {
    console.log('Usage: search-docs.js --query=STRING [--top=N] [--project-dir=PATH]');
    process.exit(0);
  }

  const docs = scanDocs(projectDir);

  if (docs.length === 0) {
    console.log('No documents with frontmatter found in .crabshell/ directories.');
    process.exit(0);
  }

  const { index, docLengths } = buildIndex(docs);
  const scores = bm25Score(query, index, docs, docLengths);
  const output = formatResults(docs, scores, top);

  console.log(`Search results for "${query}" (top ${top}):\n`);
  console.log(output);

} catch (e) {
  // Fail-open: exit 0 on any error
  console.error('search-docs error:', e.message || e);
  process.exit(0);
}
