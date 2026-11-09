'use strict';
// Failure classes. A project's verify-classify.js beside the launcher (one folder up
// from runner/) replaces these fallbacks.

let classify = function fallbackClassify(error, output) {
  const text = `${error || ''}\n${output || ''}`;
  if (/command not found|is not recognized|spawn .+ ENOENT/i.test(text)) return 'env-incompatible';
  if (/no such file|file not found|ENOENT/i.test(text)) return 'missing-file';
  if (/assert|mismatch|contract|forbidden|expected/i.test(text)) return 'assertion-fail';
  return 'unknown';
};
try {
  const localClassifier = require('../verify-classify');
  if (typeof localClassifier.classify === 'function') classify = localClassifier.classify;
} catch (_) {}

module.exports = {
  classify: (...args) => classify(...args),
};
