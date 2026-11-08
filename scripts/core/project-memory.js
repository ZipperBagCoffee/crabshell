'use strict';

// The project description file (.crabshell/project.md) and its readers.

const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('../utils');

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
function readProjectConcept(projectDir, maxLines = 20, maxChars = 1000) {
  try {
    const projectMdPath = getProjectMemoryPath(projectDir);
    if (!fs.existsSync(projectMdPath)) return '';
    const content = fs.readFileSync(projectMdPath, 'utf8').trim();
    if (!content) return '';
    const lines = content.split(/\r?\n/).slice(0, maxLines).join('\n');
    return lines.substring(0, maxChars);
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
function readModelRouting(projectDir, maxChars = 300) {
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
    return section.trim().substring(0, maxChars);
  } catch (e) {
    return '';
  }
}

module.exports = { getProjectMemoryPath, readProjectConcept, readModelRouting };
