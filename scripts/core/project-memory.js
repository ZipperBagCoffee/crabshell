'use strict';

// The project description file (.crabshell/project.md) and its readers.

const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('../utils');
const { keepHead, keepFirst } = require('./cut');
const { PROJECT_CONCEPT_LINES, PROJECT_CONCEPT_CHARS, MODEL_ROUTING_CHARS } = require('./memory-budgets');

/**
 * Resolves the shared project description, preserving legacy data on migration.
 * @param {string} projectDir
 * @returns {string}
 */
function getProjectMemoryPath(projectDir) {
  const storageRoot = getStorageRoot(projectDir);
  const canonical = path.join(storageRoot, 'project.md');
  const legacy = path.join(storageRoot, 'memory', 'project.md');
  if (!fs.existsSync(canonical) && fs.existsSync(legacy)) {
    // Copy exclusively: concurrent readers cannot overwrite a setter or each
    // other. Keep the legacy bytes, including when both paths already exist.
    try { fs.copyFileSync(legacy, canonical, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return canonical;
}

/** Read the first maxLines/maxChars, or return an empty string when unavailable. */
function readProjectConcept(projectDir, maxLines = PROJECT_CONCEPT_LINES, maxChars = PROJECT_CONCEPT_CHARS) {
  try {
    const projectMdPath = getProjectMemoryPath(projectDir);
    if (!fs.existsSync(projectMdPath)) return '';
    const content = fs.readFileSync(projectMdPath, 'utf8').trim();
    if (!content) return '';
    // Whole lines first (a line count cut is marked), then the character cap at a line end.
    const allLines = content.split(/\r?\n/);
    // The marker line counts toward maxLines, so the result never has more lines than asked.
    const lines = (allLines.length > maxLines ? keepFirst(allLines, maxLines - 1, { label: 'more lines' }) : allLines).join('\n');
    return keepHead(lines, maxChars, { lineBoundary: true });
  } catch (e) {
    return '';
  }
}

/**
 * Reads the `## Model Routing` section from .crabshell/project.md.
 * Returns section content (including the header) up to maxChars.
 * Returns empty string if section not found or file doesn't exist.
 * @param {string} projectDir
 * @param {number} maxChars
 * @returns {string}
 */
function readModelRouting(projectDir, maxChars = MODEL_ROUTING_CHARS) {
  try {
    const projectMdPath = getProjectMemoryPath(projectDir);
    if (!fs.existsSync(projectMdPath)) return '';
    const content = fs.readFileSync(projectMdPath, 'utf8');
    const headerIndex = content.indexOf('## Model Routing');
    if (headerIndex === -1) return '';
    // Find the next ## header after the Model Routing header
    const afterHeader = content.indexOf('\n## ', headerIndex + 1);
    const section = afterHeader === -1
      ? content.substring(headerIndex)
      : content.substring(headerIndex, afterHeader);
    return keepHead(section.trim(), maxChars, { lineBoundary: true });
  } catch (e) {
    return '';
  }
}

module.exports = { getProjectMemoryPath, readProjectConcept, readModelRouting };
