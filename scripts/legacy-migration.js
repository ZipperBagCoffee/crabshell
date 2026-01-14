const fs = require('fs');
const path = require('path');
const { ROTATION_THRESHOLD_TOKENS, CARRYOVER_TOKENS } = require('./constants');
const { estimateTokens, extractTailByTokens, updateIndex } = require('./utils');

function parseDateSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    const match = line.match(/^## (\d{4}-\d{2}-\d{2})/);
    if (match) {
      if (currentSection) sections.push(currentSection);
      currentSection = { date: match[1], content: line + '\n' };
    } else if (currentSection) {
      currentSection.content += line + '\n';
    }
  }
  if (currentSection) sections.push(currentSection);

  if (sections.length === 0) {
    sections.push({ date: new Date().toISOString().split('T')[0], content });
  }
  return sections;
}

function forceSplitSection(section, threshold) {
  const tokens = estimateTokens(section.content);
  if (tokens <= threshold) return [section];

  const lines = section.content.split('\n');
  const chunks = [];
  let currentChunk = { lines: [], tokens: 0 };

  for (const line of lines) {
    const lineTokens = estimateTokens(line + '\n');
    if (currentChunk.tokens + lineTokens > threshold && currentChunk.lines.length > 0) {
      chunks.push({ date: section.date, content: currentChunk.lines.join('\n') });
      currentChunk = { lines: [line], tokens: lineTokens };
    } else {
      currentChunk.lines.push(line);
      currentChunk.tokens += lineTokens;
    }
  }
  if (currentChunk.lines.length > 0) {
    chunks.push({ date: section.date, content: currentChunk.lines.join('\n') });
  }
  return chunks;
}

function generateArchiveName(baseDate, sequence) {
  const dateStr = baseDate.replace(/-/g, '');
  const seqStr = sequence.toString().padStart(2, '0');
  return 'memory_' + dateStr + '_2359' + seqStr + '.md';
}

function splitLegacyMemory(memoryPath) {
  const memoryDir = path.dirname(memoryPath);
  const content = fs.readFileSync(memoryPath, 'utf8');
  const tokens = estimateTokens(content);

  if (tokens <= ROTATION_THRESHOLD_TOKENS) return null;

  const rawSections = parseDateSections(content);
  const sections = [];
  for (const section of rawSections) {
    sections.push(...forceSplitSection(section, ROTATION_THRESHOLD_TOKENS));
  }

  const chunks = [];
  let currentChunk = { sections: [], tokens: 0 };

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content);
    if (currentChunk.tokens + sectionTokens > ROTATION_THRESHOLD_TOKENS) {
      if (currentChunk.sections.length > 0) chunks.push(currentChunk);
      currentChunk = { sections: [section], tokens: sectionTokens };
    } else {
      currentChunk.sections.push(section);
      currentChunk.tokens += sectionTokens;
    }
  }
  if (currentChunk.sections.length > 0) chunks.push(currentChunk);

  const archives = [];
  const triggers = [];
  let sequence = 0;

  for (let i = 0; i < chunks.length - 1; i++) {
    const chunk = chunks[i];
    const lastDate = chunk.sections[chunk.sections.length - 1].date;
    const archiveContent = chunk.sections.map(s => s.content).join('\n');
    const archiveName = generateArchiveName(lastDate, sequence++);
    const archiveFullPath = path.join(memoryDir, archiveName);

    fs.writeFileSync(archiveFullPath, archiveContent);
    updateIndex(archiveFullPath, chunk.tokens, memoryDir);
    triggers.push('[MEMORY_KEEPER_ROTATE] file=' + archiveName);
    archives.push({ file: archiveName, tokens: chunk.tokens, dateRange: { first: chunk.sections[0].date, last: lastDate } });
  }

  const lastChunk = chunks[chunks.length - 1];
  const lastChunkContent = lastChunk.sections.map(s => s.content).join('\n');
  const newMemoryContent = extractTailByTokens(lastChunkContent, CARRYOVER_TOKENS);
  const tempPath = memoryPath + '.tmp';
  fs.writeFileSync(tempPath, newMemoryContent);
  fs.renameSync(tempPath, memoryPath);

  return { archives, newMemoryContent, triggers };
}

module.exports = { splitLegacyMemory, parseDateSections, forceSplitSection };
