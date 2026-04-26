'use strict';
/**
 * Tests for D104 IA-2 — classifyTurnType() 5-class detection cascade in
 * behavior-verifier.js.
 *
 * Cascade order (first match wins):
 *   clarification → trivial → notification → workflow-internal → user-facing
 *
 * Covers (6 cases per ticket P136_T001 AC11):
 *  1) ?-only response → 'clarification'
 *  2) length<50 substantive (no ?) → 'trivial'
 *  3) hookData.prompt with line-start <task-notification> → 'notification'
 *  4) assistantText body contains <task-notification> mention (no line-start
 *     in hookData.prompt) → NOT 'notification' (false-positive avoided);
 *     resolves to 'user-facing' (or 'workflow-internal' if ticket-id present).
 *  5) workflowActive=true (regressing-state.active=true emulated as flag) →
 *     'workflow-internal' (overrides ticket-id detection)
 *  6) substantive default → 'user-facing'
 */

const path = require('path');

const SCRIPT = path.join(__dirname, 'behavior-verifier.js');
const { classifyTurnType } = require(SCRIPT);

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

const SUBSTANTIVE = 'I have implemented the function and verified it returns the expected value across three test cases. The behavior matches the specification.';

// ---------- Case 1 — ?-only response → clarification ----------
(function() {
  const result = classifyTurnType({
    assistantText: 'Which file did you want me to inspect? Should I check the test file?',
    hookData: { prompt: 'do something' },
    workflowActive: false
  });
  ok('1 ?-only response → clarification', result === 'clarification',
     'got=' + result);
})();

// ---------- Case 2 — length<50 substantive → trivial ----------
(function() {
  const result = classifyTurnType({
    assistantText: 'Done. File saved.',
    hookData: { prompt: 'save it' },
    workflowActive: false
  });
  ok('2 length<50 substantive → trivial', result === 'trivial',
     'got=' + result);
})();

// ---------- Case 3 — hookData.prompt line-start <task-notification> → notification ----------
(function() {
  // line-start anchor: prompt MUST start with <task-notification> on its own line.
  const result = classifyTurnType({
    assistantText: SUBSTANTIVE,
    hookData: { prompt: '<task-notification>Background agent finished.</task-notification>\nMore content here.' },
    workflowActive: false
  });
  ok('3 hookData.prompt line-start <task-notification> → notification',
     result === 'notification', 'got=' + result);
})();

// ---------- Case 4 — assistantText body mention (no line-start) → NOT notification ----------
(function() {
  // The literal string "<task-notification>" appears in BODY of assistantText, NOT
  // at line-start of hookData.prompt. classifyTurnType anchors on hookData.prompt
  // line-start only → false-positive avoided.
  const result = classifyTurnType({
    assistantText: 'Quick aside: the framework uses <task-notification> tags for background. ' + SUBSTANTIVE,
    hookData: { prompt: 'explain task notifications' }, // no line-start anchor
    workflowActive: false
  });
  ok('4 assistantText body mention (no line-start in prompt) → NOT notification',
     result !== 'notification' && (result === 'user-facing' || result === 'workflow-internal'),
     'got=' + result);
})();

// ---------- Case 5 — workflowActive=true → workflow-internal ----------
(function() {
  const result = classifyTurnType({
    assistantText: SUBSTANTIVE,
    hookData: { prompt: 'continue regressing' },
    workflowActive: true
  });
  ok('5 workflowActive=true → workflow-internal', result === 'workflow-internal',
     'got=' + result);
})();

// ---------- Case 6 — substantive default → user-facing ----------
(function() {
  const result = classifyTurnType({
    assistantText: 'Here is a longer explanation about how Crabshell handles memory rotation. The rotation threshold is 25K tokens, and we maintain a logbook.md as the rolling buffer. When threshold is exceeded, older content moves to archive.',
    hookData: { prompt: 'how does memory rotation work' },
    workflowActive: false
  });
  ok('6 substantive default (no ?, no <task-notification>, no ticket-id) → user-facing',
     result === 'user-facing', 'got=' + result);
})();

// ---------- Bonus: verify ticket-id pattern triggers workflow-internal ----------
(function() {
  const result = classifyTurnType({
    assistantText: SUBSTANTIVE + ' See P136_T001 for the implementation context. We will track work via this ticket.',
    hookData: { prompt: 'work on P136_T001' },
    workflowActive: false
  });
  ok('bonus ticket-id pattern P136_T001 in assistantText → workflow-internal',
     result === 'workflow-internal', 'got=' + result);
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
