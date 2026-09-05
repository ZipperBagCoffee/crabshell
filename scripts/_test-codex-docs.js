'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell document skills '));
const installed = path.join(temp, 'plugin location with spaces');
const consumer = path.join(temp, 'ordinary project with spaces');
fs.mkdirSync(path.join(installed, 'scripts'), { recursive: true });
fs.mkdirSync(consumer);
for (const file of ['codex-docs.js', 'constants.js', 'utils.js']) {
  fs.copyFileSync(path.join(__dirname, file), path.join(installed, 'scripts', file));
}
const skills = ['discussing', 'planning', 'ticketing', 'investigating', 'hotfix', 'knowledge', 'regressing'];
let passed = 0;
for (const skill of skills) {
  const source = path.join(__dirname, '..', 'codex-skills', skill);
  const target = path.join(installed, 'codex-skills', skill);
  fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
  for (const file of ['SKILL.md', 'scripts/codex-docs.js']) {
    fs.copyFileSync(path.join(source, file), path.join(target, file));
  }
  const text = fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8');
  const commands = text.split(/\r?\n/).filter(line => line.startsWith('node '));
  assert.ok(commands.length, `${skill}: no documented invocation`);
  for (const command of commands) {
    const expanded = command.replaceAll('{SKILL_DIR}', target).replaceAll('{PROJECT_ROOT}', consumer);
    const tokens = expanded.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
      .map(token => token.replace(/["']/g, ''));
    assert.strictEqual(tokens.shift(), 'node');
    // Run from both the consumer and plugin directories. The target must never
    // depend on cwd, CLAUDE_PROJECT_DIR, or a source scripts directory there.
    for (const cwd of [consumer, installed]) {
      const result = spawnSync(process.execPath, tokens, {
        cwd, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, CLAUDE_PROJECT_DIR: installed },
      });
      assert.strictEqual(result.status, 0, `${skill}: ${result.stderr}`);
      const relative = result.stdout.trim();
      const document = path.resolve(consumer, relative);
      assert.ok(document.startsWith(path.join(consumer, '.crabshell') + path.sep), relative);
      const content = fs.readFileSync(document, 'utf8');
      assert.ok(content.includes('type:'), `${skill}: generated document missing`);
      assert.ok(fs.readFileSync(path.join(path.dirname(document), 'INDEX.md'), 'utf8').includes(path.basename(document, '.md')));
      assert.ok(!fs.existsSync(path.join(installed, '.crabshell')), 'plugin location must not receive documents');
      assert.ok(!fs.existsSync(path.join(consumer, 'scripts')), 'consumer must not need plugin source scripts');
    }
  }
  const missing = spawnSync(process.execPath, [path.join(target, 'scripts', 'codex-docs.js'), 'discussion', 'missing target'], {
    cwd: installed, encoding: 'utf8', windowsHide: true,
  });
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /requires --project-dir/);
  assert.ok(!fs.existsSync(path.join(installed, '.crabshell')));
  passed++;
  console.log(`PASS: ${skill} documented commands create consumer documents from both directories; missing target rejected`);
}
console.log(`RESULT: ${passed} passed, 0 failed`);
