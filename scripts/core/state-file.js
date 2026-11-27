'use strict';

// Reading a state file without losing what is in it.
//   ok       parsed, written by this or an older version
//   missing  no file
//   corrupt  not parseable (or the wrong shape): a copy of the original is kept next to
//            it as <name>.corrupt-<YYYYMMDDHHmmss> before the caller overwrites it
//   newer    written by a newer Crabshell: the value comes back as the file holds it,
//            marked so writeJson refuses to overwrite it

const fs = require('fs');
const path = require('path');

// Not enumerable and a symbol: JSON.stringify, Object.keys and {...spread} never see it.
const NO_WRITE = Symbol.for('crabshell.stateFile.noWrite');

function markNoWrite(value, info) {
  if (value && typeof value === 'object') {
    Object.defineProperty(value, NO_WRITE, { value: info, enumerable: false, configurable: true });
  }
  return value;
}

// {file, version} when the value must not be written back, else null.
function writeBlock(value) {
  return value && typeof value === 'object' ? (value[NO_WRITE] || null) : null;
}

function stamp(date) {
  const pad = n => String(n).padStart(2, '0');
  return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate())
    + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds());
}

// Copies a corrupt original once: not again when a copy with the same content exists.
function preserveCorrupt(file, raw, now = new Date()) {
  try {
    if (!raw || !String(raw).trim()) return null;
    const dir = path.dirname(file);
    const prefix = path.basename(file) + '.corrupt-';
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      try { if (fs.readFileSync(path.join(dir, name), 'utf8') === raw) return path.join(dir, name); } catch (_) {}
    }
    const copy = path.join(dir, prefix + stamp(now));
    fs.writeFileSync(copy, raw, { encoding: 'utf8', flag: 'wx' });
    return copy;
  } catch (_) { return null; }
}

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// Editors on Windows may save JSON with a byte-order mark.
const withoutBom = text => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);

// version/versionField: the version this code writes and the field holding it (no version:
// the file is never "newer"). defaults: the value for a missing or corrupt file; an object
// default also means the file must hold an object.
function readState(file, { version = null, versionField = 'version', defaults = null } = {}) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error && error.code === 'ENOENT') return { value: defaults, status: 'missing' };
    return { value: defaults, status: 'corrupt' };
  }
  let parsed;
  try { parsed = JSON.parse(withoutBom(raw)); } catch (_) {
    preserveCorrupt(file, raw);
    return { value: defaults, status: 'corrupt' };
  }
  if (isPlainObject(defaults) && !isPlainObject(parsed)) {
    preserveCorrupt(file, raw);
    return { value: defaults, status: 'corrupt' };
  }
  const found = isPlainObject(parsed) ? parsed[versionField] : undefined;
  if (typeof version === 'number' && typeof found === 'number' && found > version) {
    return { value: markNoWrite(parsed, { file, version: found }), status: 'newer' };
  }
  return { value: parsed, status: 'ok' };
}

module.exports = { NO_WRITE, markNoWrite, writeBlock, preserveCorrupt, readState };
