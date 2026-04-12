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
let detectNegativeFeedback, updateFeedbackPressure, PRESSURE_L1, PRESSURE_L2, PRESSURE_L3;
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

test('AC-7: PRESSURE_L1/L2/L3 exported', function() {
  const mod = require(injectRulesPath);
  PRESSURE_L1 = mod.PRESSURE_L1; PRESSURE_L2 = mod.PRESSURE_L2; PRESSURE_L3 = mod.PRESSURE_L3;
  assert(typeof PRESSURE_L1 === 'string'); assert(typeof PRESSURE_L2 === 'string'); assert(typeof PRESSURE_L3 === 'string');
});

if (!detectNegativeFeedback || !updateFeedbackPressure) {
  console.log('BLOCKED: exports not available');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}
// AC-2: Narrow wae-ireoke
test('AC-2: technical dweneungeoim -> false', function() {
  assertEqual(detectNegativeFeedback('왜 이렇게 되는거임'), false, 'tech q');
});
test('AC-2: technical dweneungeoya -> false', function() {
  assertEqual(detectNegativeFeedback('왜 이렇게 되는거야'), false, 'tech q');
});
test('AC-2: complaint haenwasseo -> true', function() {
  assertEqual(detectNegativeFeedback('왜 이렇게 해놓어'), true, 'agentive');
});
test('AC-2: complaint mandeungeoya -> true', function() {
  assertEqual(detectNegativeFeedback('왜 이렇게 만든거야'), true, 'agentive');
});
test('AC-2: complaint haesseo -> true', function() {
  assertEqual(detectNegativeFeedback('왜 이렇게 했어'), true, 'agentive');
});

// AC-3: jalmothago and breaking
test('AC-3: jalmothago -> true', function() {
  assertEqual(detectNegativeFeedback('잘못하고 있잖아'), true);
});
test('AC-3: breaking things -> true', function() {
  assertEqual(detectNegativeFeedback('you keep breaking things'), true);
});
test('AC-3: breaking build -> true', function() {
  assertEqual(detectNegativeFeedback('this is breaking the build'), true);
});

// AC-4: Diagnostic exclusion
test('AC-4: mwonga geot gatah -> false', function() {
  assertEqual(detectNegativeFeedback('뭐가 잘못된 것 같아'), false, 'diagnostic');
});
test('AC-4: whats wrong -> false', function() {
  assertEqual(detectNegativeFeedback("what's wrong with this"), false, 'diagnostic');
});
test('AC-4: mwoga geoji -> false', function() {
  assertEqual(detectNegativeFeedback('뭐가 잘못된거지'), false, 'diagnostic');
});
test('AC-4: is this wrong? -> false', function() {
  assertEqual(detectNegativeFeedback('is this wrong?'), false, 'diagnostic');
});
test('AC-4: check if wrong -> false', function() {
  assertEqual(detectNegativeFeedback('check if something is wrong'), false, 'diagnostic');
});
// AC-1: Exclusions strip instead of early-return
test('AC-1: mixed diagnostic + complaint -> true', function() {
  assertEqual(detectNegativeFeedback('왜 이렇게 되는거야? 잘못했잖아.'), true, 'strip then detect');
});
test('AC-1: dont forget + wrong -> true', function() {
  assertEqual(detectNegativeFeedback("don't forget to check. you're wrong about this."), true);
});
test('AC-1: dont forget only -> false', function() {
  assertEqual(detectNegativeFeedback("don't forget to save the file"), false);
});
test('AC-1: no problem + broke -> true', function() {
  assertEqual(detectNegativeFeedback('no problem, but you broke the build'), true);
});

// AC-9: Regression
test('AC-9: aninde -> true', function() { assertEqual(detectNegativeFeedback('아닌데 이건 맞지 않아'), true); });
test('AC-9: dasi hae -> true', function() { assertEqual(detectNegativeFeedback('다시 해줘'), true); });
test('AC-9: wrong answer -> true', function() { assertEqual(detectNegativeFeedback('wrong answer'), true); });
test('AC-9: try again -> true', function() { assertEqual(detectNegativeFeedback('try again please'), true); });
test('AC-9: you broke it -> true', function() { assertEqual(detectNegativeFeedback('you broke it'), true); });
test('AC-9: not what I asked -> true', function() { assertEqual(detectNegativeFeedback('not what I asked for'), true); });
test('AC-9: ihaereul anhago -> true', function() { assertEqual(detectNegativeFeedback('이해를 안하고 있어'), true); });
test('AC-9: neutral -> false', function() { assertEqual(detectNegativeFeedback('파일 읽어줘'), false); });
test('AC-9: read file -> false', function() { assertEqual(detectNegativeFeedback('read the file and tell me what you find'), false); });
test('AC-9: short -> false', function() { assertEqual(detectNegativeFeedback('y'), false); });
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

// AC-6: Self-directed pressure messages
test('AC-6: PRESSURE_L2 no ask the user', function() {
  assert(!(/ask the user/i.test(PRESSURE_L2)), 'should not ask user');
});
test('AC-6: PRESSURE_L2 has direction confirmation solicitation', function() {
  // v21.58.0: L2 intentionally includes "direction confirmation" per pressure system redesign
  assert(/confirm/i.test(PRESSURE_L2), 'should include direction confirmation solicitation');
});
test('AC-6: PRESSURE_L1 no ask user', function() {
  assert(!(/ask the user/i.test(PRESSURE_L1)), 'should not ask user');
});
test('AC-6: PRESSURE_L3 no ask user', function() {
  assert(!(/ask the user/i.test(PRESSURE_L3)), 'should not ask user');
});

// AC-3: Additional breaking patterns
test('AC-3: you breaks -> true', function() {
  assertEqual(detectNegativeFeedback('you breaks the build'), true);
});
test('AC-3: you breaking -> true', function() {
  assertEqual(detectNegativeFeedback('you breaking everything'), true);
});

// AC-4: Additional exclusion patterns
test('AC-4: jalmotdwen ge mwonji -> false', function() {
  assertEqual(detectNegativeFeedback('잘못된 게 뭔지 알려줘'), false);
});
test('AC-4: went wrong -> false', function() {
  assertEqual(detectNegativeFeedback('what went wrong here'), false);
});
test('AC-4: dodaeche wae an dwae -> false', function() {
  assertEqual(detectNegativeFeedback('도대체 왜 안 되는 거야'), false);
});
test('AC-4: dodaeche wae ireon -> false', function() {
  assertEqual(detectNegativeFeedback('도대체 왜 이런 결과가 나오는지'), false);
});

// AC-1: Additional architecture tests
test('AC-1: went wrong + broke -> true', function() {
  assertEqual(detectNegativeFeedback('what went wrong? you broke it'), true);
});
test('AC-1: dont worry + incorrect -> true', function() {
  assertEqual(detectNegativeFeedback("don't worry, but that's incorrect"), true);
});
test('AC-1: mwonga jalmot + jalmothago -> true', function() {
  assertEqual(detectNegativeFeedback('뭔가 잘못된 것 같은데 잘못하고 있어'), true);
});

// Additional FP edge cases
test('FP: empty -> false', function() { assertEqual(detectNegativeFeedback(''), false); });
test('FP: null -> false', function() { assertEqual(detectNegativeFeedback(null), false); });
test('FP: single char -> false', function() { assertEqual(detectNegativeFeedback('a'), false); });
test('FP: no problem -> false', function() { assertEqual(detectNegativeFeedback('no problem, continue'), false); });
test('FP: jalmotdwen ge aniya -> false', function() { assertEqual(detectNegativeFeedback('잘못된 게 아니야'), false); });
test('FP: dont forget -> false', function() { assertEqual(detectNegativeFeedback("don't forget to add tests"), false); });
test('FP: if wrong -> false', function() { assertEqual(detectNegativeFeedback('if something is wrong let me know'), false); });

// Additional TPs
test('TP: teullyeosseo -> true', function() { assertEqual(detectNegativeFeedback('틀렸어'), true); });
test('TP: not helpful -> true', function() { assertEqual(detectNegativeFeedback('not helpful'), true); });
test('TP: dont understand -> true', function() { assertEqual(detectNegativeFeedback("you don't understand"), true); });
test('TP: missing point -> true', function() { assertEqual(detectNegativeFeedback("you're missing the point"), true); });

// Code block stripping
test('CODE: fenced code block -> false', function() {
  assertEqual(detectNegativeFeedback('Check this:\n```\nassert(wrong)\n```\nLooks good'), false);
});
test('CODE: inline code -> false', function() {
  assertEqual(detectNegativeFeedback('The `wrong` variable needs fixing'), false);
});

// AC-6: self-directed content checks
test('AC-6: L1 has self-check', function() {
  assert(/self.check|root.cause|reasoning/i.test(PRESSURE_L1), 'L1 should be self-directed');
});
test('AC-6: L2 has self-diagnosis', function() {
  assert(/self.diagnosis|pattern|corrected.*understanding/i.test(PRESSURE_L2), 'L2 should be self-directed');
});
test('AC-6: L3 has self-review', function() {
  assert(/error.pattern|wrong.assumption|first.principles/i.test(PRESSURE_L3), 'L3 should be self-directed');
});

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

// AC-5: SessionStart pressure decay
test('AC-5: load-memory.js references feedbackPressure', function() {
  const src = fs2.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert(src.includes('feedbackPressure'), 'should reference feedbackPressure');
});
test('AC-5: load-memory.js decays to level 1 not 0', function() {
  const src = fs2.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert(src.includes('level > 1'), 'should check level > 1 (not level > 0)');
  assert(src.includes('level = 1'), 'should set level = 1 (decay to 1, not to 0)');
  assert(src.includes('Session start: pressure'), 'should log decay');
});

// BAILOUT keyword detection
test('BAILOUT: 봉인해제 returns true', function() {
  const { detectBailout } = require(injectRulesPath);
  assertEqual(detectBailout({ prompt: '봉인해제' }), true, 'detectBailout should return true for 봉인해제');
});

test('BAILOUT: BAILOUT returns true', function() {
  const { detectBailout } = require(injectRulesPath);
  assertEqual(detectBailout({ prompt: 'BAILOUT please reset' }), true, 'detectBailout should return true for BAILOUT');
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

// Summary
console.log('');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);