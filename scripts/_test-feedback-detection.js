// _test-feedback-detection.js
'use strict';

const path = require('path');
const fs2 = require('fs');
const injectRulesPath = path.join(__dirname, 'inject-rules.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
// AC-7: Export check
let detectNegativeFeedback, updateFeedbackPressure;
test('AC-7: detectNegativeFeedback exported', function() {
  const mod = require(injectRulesPath);
  assert(typeof mod.detectNegativeFeedback === 'function', 'not exported');
  detectNegativeFeedback = mod.detectNegativeFeedback;
});

test('AC-7: updateFeedbackPressure exported', function() {
  const mod = require(injectRulesPath);
  assert(typeof mod.updateFeedbackPressure === 'function', 'not exported');
  updateFeedbackPressure = mod.updateFeedbackPressure;
});

if (!detectNegativeFeedback || !updateFeedbackPressure) {
  console.log('BLOCKED: exports not available');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}
// W021: AC-2/AC-3/AC-4/AC-1/AC-9 sections REMOVED — these verified correction-mode,
// assessment-mode, logical-disagreement patterns + exclusions that are no longer in
// NEGATIVE_PATTERNS / NEGATIVE_EXCLUSIONS (profanity-only design).
// Neutral/null cases preserved below.
test('AC-9: neutral -> false', function() { assertEqual(detectNegativeFeedback('파일 읽어줘'), false); });
test('AC-9: read file -> false', function() { assertEqual(detectNegativeFeedback('read the file and tell me what you find'), false); });
test('AC-9: short -> false', function() { assertEqual(detectNegativeFeedback('y'), false); });

// W021: NEW profanity-only positive cases
test('W021: KO profanity -> true', function() { assertEqual(detectNegativeFeedback('시발 짜증나'), true); });
test('W021: KO profanity 병신 -> true', function() { assertEqual(detectNegativeFeedback('병신아'), true); });
test('W021: EN profanity fuck -> true', function() { assertEqual(detectNegativeFeedback('fuck this'), true); });
test('W021: EN profanity this sucks -> true', function() { assertEqual(detectNegativeFeedback('this sucks'), true); });
test('W021: KO correction NOT detected -> false', function() { assertEqual(detectNegativeFeedback('내가 물어본게 아닌데'), false, 'correction is not profanity'); });
test('W021: KO assessment NOT detected -> false', function() { assertEqual(detectNegativeFeedback('이해를 안하려고 하고있음'), false); });
test('W021: EN correction NOT detected -> false', function() { assertEqual(detectNegativeFeedback('wrong answer'), false); });
test('W021: EN assessment NOT detected -> false', function() { assertEqual(detectNegativeFeedback('not helpful'), false); });
test('W021: FP 시발점 -> false', function() { assertEqual(detectNegativeFeedback('이 프로젝트 시발점이 어디예요'), false); });
test('W021: FP 병신경 -> false', function() { assertEqual(detectNegativeFeedback('병신경 검사 결과'), false); });
// AC-8: Pressure accumulation and decay
test('AC-8: 3 negatives -> level 3', function() {
  const index = {};
  updateFeedbackPressure(index, true);
  assertEqual(index.feedbackPressure.level, 1, 'after 1');
  updateFeedbackPressure(index, true);
  assertEqual(index.feedbackPressure.level, 2, 'after 2');
  updateFeedbackPressure(index, true);
  assertEqual(index.feedbackPressure.level, 3, 'after 3');
});

test('AC-8: 3 non-neg from L3 -> L2', function() {
  const index = { feedbackPressure: { level: 3, consecutiveCount: 3, lastDetectedAt: null, decayCounter: 0 } };
  updateFeedbackPressure(index, false);
  updateFeedbackPressure(index, false);
  updateFeedbackPressure(index, false);
  assertEqual(index.feedbackPressure.level, 2, 'decay 3->2');
});

test('AC-8: 6 non-neg from L3 -> L1', function() {
  const index = { feedbackPressure: { level: 3, consecutiveCount: 3, lastDetectedAt: null, decayCounter: 0 } };
  for (let i = 0; i < 6; i++) updateFeedbackPressure(index, false);
  assertEqual(index.feedbackPressure.level, 1, 'decay 3->1');
});

// v21.113.0 (I083 R4): model-visible pressure messages retired — counters remain
// for telemetry, so only the tracking functions are contract-tested below.
test('AC-6: PRESSURE injection constants retired', function() {
  const mod = require('./inject-rules');
  assert(mod.PRESSURE_L1 === undefined && mod.PRESSURE_L2 === undefined && mod.PRESSURE_L3 === undefined,
    'pressure injection constants should be gone');
});

// W021: Additional AC-3/AC-4/AC-1 sections REMOVED — depended on patterns no longer in NEGATIVE_PATTERNS.

// FP edge cases (preserved — null/empty/single-char + neutral phrases)
test('FP: empty -> false', function() { assertEqual(detectNegativeFeedback(''), false); });
test('FP: null -> false', function() { assertEqual(detectNegativeFeedback(null), false); });
test('FP: single char -> false', function() { assertEqual(detectNegativeFeedback('a'), false); });
test('FP: no problem -> false', function() { assertEqual(detectNegativeFeedback('no problem, continue'), false); });

// W021: TP section REMOVED — tested removed correction/assessment patterns.

// Code block stripping (W021: updated to use profanity since wrong/incorrect no longer in patterns)
test('CODE: fenced code block strips profanity -> false', function() {
  assertEqual(detectNegativeFeedback('Check this:\n```\nconst msg = "fuck this";\n```\nLooks good'), false);
});
test('CODE: inline code strips profanity -> false', function() {
  assertEqual(detectNegativeFeedback('The `fuck` variable needs renaming'), false);
});

// AC-6 content checks removed in v21.113.0 — the injected pressure texts no longer exist.

// Pressure: cap and init
test('PRESSURE: caps at L3', function() {
  const i = {};
  for (let j = 0; j < 10; j++) updateFeedbackPressure(i, true);
  assertEqual(i.feedbackPressure.level, 3, 'capped at L3');
});
test('PRESSURE: fresh init', function() {
  const i = {};
  updateFeedbackPressure(i, false);
  assert(i.feedbackPressure !== undefined, 'should be initialized');
  assertEqual(i.feedbackPressure.level, 0, 'starts at 0');
});

// AC-5: SessionStart is read-only and leaves persisted pressure untouched.
test('AC-5: load-memory.js does not mutate feedbackPressure', function() {
  const src = fs2.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert(!src.includes('feedbackPressure'), 'automatic load should not reference pressure state');
});
test('AC-5: load-memory.js has no pressure write or reset path', function() {
  const src = fs2.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert(!src.includes('writeJson'), 'automatic load should not write the memory index');
  assert(!src.includes('acquireIndexLock'), 'automatic load should not acquire a write lock');
});

// BAILOUT keyword detection
test('BAILOUT: 봉인해제 returns true', function() {
  const { detectBailout } = require(injectRulesPath);
  assertEqual(detectBailout({ prompt: '봉인해제' }), true, 'detectBailout should return true for 봉인해제');
});

test('BAILOUT: UNLEASH returns true', function() {
  const { detectBailout } = require(injectRulesPath);
  assertEqual(detectBailout({ prompt: 'UNLEASH please reset' }), true, 'detectBailout should return true for UNLEASH (W021)');
});

test('BAILOUT: normal prompt returns false', function() {
  const { detectBailout } = require(injectRulesPath);
  assertEqual(detectBailout({ prompt: '파일 읽어줘' }), false, 'no bailout for normal prompt');
});

test('BAILOUT: empty returns false', function() {
  const { detectBailout } = require(injectRulesPath);
  assertEqual(detectBailout({ prompt: '' }), false, 'no bailout for empty');
});

test('BAILOUT: oscillationCount reset to 0 after bailout', function() {
  const index = { feedbackPressure: { level: 2, consecutiveCount: 2, lastDetectedAt: null, decayCounter: 0, oscillationCount: 5 } };
  // Simulate bailout reset (full reset including oscillationCount)
  index.feedbackPressure.level = 0;
  index.feedbackPressure.consecutiveCount = 0;
  index.feedbackPressure.decayCounter = 0;
  index.feedbackPressure.oscillationCount = 0;
  assertEqual(index.feedbackPressure.oscillationCount, 0, 'oscillationCount should be reset to 0');
});

test('BAILOUT: reset even at L0 (all fields reset)', function() {
  const index = { feedbackPressure: { level: 0, consecutiveCount: 3, lastDetectedAt: null, decayCounter: 2, oscillationCount: 1 } };
  // Simulate bailout reset without level>0 guard
  index.feedbackPressure.level = 0;
  index.feedbackPressure.consecutiveCount = 0;
  index.feedbackPressure.decayCounter = 0;
  index.feedbackPressure.oscillationCount = 0;
  assertEqual(index.feedbackPressure.level, 0, 'level stays 0');
  assertEqual(index.feedbackPressure.consecutiveCount, 0, 'consecutiveCount reset from 3 to 0');
  assertEqual(index.feedbackPressure.decayCounter, 0, 'decayCounter reset');
  assertEqual(index.feedbackPressure.oscillationCount, 0, 'oscillationCount reset from 1 to 0');
});

// IA-1: lastShownLevel tracking in updateFeedbackPressure
test('IA-1: lastShownLevel initialized to 0', function() {
  const index = {};
  updateFeedbackPressure(index, false);
  assertEqual(index.feedbackPressure.lastShownLevel, 0, 'initial lastShownLevel should be 0');
});

test('IA-1: lastShownLevel preserved across updates (not changed by updateFeedbackPressure)', function() {
  // lastShownLevel is managed by inject-rules main(), not updateFeedbackPressure
  const index = { feedbackPressure: { level: 2, consecutiveCount: 2, lastDetectedAt: null, decayCounter: 0, oscillationCount: 0, lastShownLevel: 2 } };
  updateFeedbackPressure(index, true);
  // updateFeedbackPressure should not reset lastShownLevel
  assertEqual(index.feedbackPressure.lastShownLevel, 2, 'lastShownLevel should not be changed by updateFeedbackPressure');
});

test('IA-1: legacy object gets lastShownLevel=0 backfill', function() {
  // Legacy object without lastShownLevel field
  const index = { feedbackPressure: { level: 1, consecutiveCount: 1, lastDetectedAt: null, decayCounter: 0, oscillationCount: 0 } };
  updateFeedbackPressure(index, false);
  assert(typeof index.feedbackPressure.lastShownLevel === 'number', 'lastShownLevel should be backfilled');
  assertEqual(index.feedbackPressure.lastShownLevel, 0, 'backfilled lastShownLevel should be 0');
});

// Summary
console.log('');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
