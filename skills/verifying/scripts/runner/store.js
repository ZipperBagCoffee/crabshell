'use strict';
// The runner's records beside the manifest: test-map.json (each check's inputs, the
// fingerprints it passed with, its last failure and duration, and the project snapshot)
// and the fail-before exemptions.

const fs = require('fs');
const path = require('path');
const { SCHEMA_VERSION } = require('./fingerprint');

const MAP_FILE = 'test-map.json';
// Tests that may pass on HEAD too (a refactor that keeps behavior), each with the
// sha256 of the test content it covers and a reason.
const EXEMPT_FILE = 'fail-before-exempt.json';

function mapPath(manifestPath) {
  return path.join(path.dirname(manifestPath), MAP_FILE);
}

function exemptPath(manifestPath) {
  return path.join(path.dirname(manifestPath), EXEMPT_FILE);
}

function readMap(manifestPath) {
  try {
    const map = JSON.parse(fs.readFileSync(mapPath(manifestPath), 'utf8'));
    return map && typeof map === 'object' && !Array.isArray(map) ? map : null;
  } catch (_) { return null; }
}

// The records a run can trust: only this schema's. An older map reads as no records
// (every check runs once, then follows its inputs).
function currentRecords(map) {
  return map && map.schema === SCHEMA_VERSION && map.entries && typeof map.entries === 'object' ? map.entries : null;
}

// Replace the map in one rename: the records of the checks that still exist, updated by
// this run, and the snapshot taken before it.
function writeMap({ manifestPath, startedAt, snapshot, records, ids, runs = null }) {
  try {
    const entries = {};
    for (const id of ids) if (records[id]) entries[id] = records[id];
    const map = { schema: SCHEMA_VERSION, createdAt: startedAt, snapshot, entries };
    // D151_T002: the latest runs (the commit each ran on, checks run, milliseconds).
    if (Array.isArray(runs)) map.runs = runs;
    const target = mapPath(manifestPath);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(map) + '\n');
    fs.renameSync(temporary, target);
  } catch (error) {
    console.error(`[VERIFY] WARN: load map not written: ${error.message}`);
  }
}

module.exports = { MAP_FILE, EXEMPT_FILE, mapPath, exemptPath, readMap, currentRecords, writeMap };
