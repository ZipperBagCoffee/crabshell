'use strict';

// D187_T004: the scenarios of a guard experiment (scripts/guard-experiment.js). A scenario is
// a folder that holds scenario.json:
//   prompt       the one prompt the session gets
//   judge        the command (argv) run in the finished project to judge it; "{scenario}" and
//                "{project}" become those two folders; exit 0 means the task was done
//   control      true when the guard under test has nothing to stop here, so any block it
//                sends is a false block
//   files        { "relative/path": "text" } written into the project before the session:
//                state such as an open workflow document, which a fixture folder in this
//                repository cannot hold without being taken for this repository's own
//   description, permissionMode, allowedTools, maxTurns, timeoutSeconds, judgeTimeoutSeconds
//                (optional; defaults in SESSION_DEFAULTS)
// The scenario's project/ folder, when it has one, is copied into the project first.
// Each scenario is checked on its own: a broken one is skipped with its reason.

const fs = require('fs');
const path = require('path');
const { readJsonOrDefault } = require('../utils');

const SCENARIO_FILE = 'scenario.json';
const PROJECT_FOLDER = 'project';
// Nobody answers a permission prompt in an unattended run, so by default the host's own
// safety check approves commands ('auto'); a scenario can name another mode or tools.
const SESSION_DEFAULTS = Object.freeze({
  permissionMode: 'auto', allowedTools: Object.freeze([]), maxTurns: 40, timeoutSeconds: 1200, judgeTimeoutSeconds: 120,
});

const isText = value => typeof value === 'string' && value.trim() !== '';
const isPositive = value => Number.isFinite(value) && value > 0;

// A path inside the project: relative, and not leaving it.
function insideProject(relative) {
  if (!isText(relative) || path.isAbsolute(relative)) return false;
  const normal = path.normalize(relative);
  return normal !== '..' && !normal.startsWith('..' + path.sep) && !path.isAbsolute(normal);
}

function validateScenario(raw, dir) {
  const name = path.basename(dir);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${SCENARIO_FILE} is not a JSON object` };
  if (!isText(raw.prompt)) return { error: 'prompt is missing' };
  if (!Array.isArray(raw.judge) || !raw.judge.length || !raw.judge.every(isText)) return { error: 'judge must be a command: an array of strings' };
  if (raw.control !== undefined && typeof raw.control !== 'boolean') return { error: 'control must be true or false' };
  const files = raw.files === undefined ? {} : raw.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return { error: 'files must be an object of path to text' };
  for (const [relative, text] of Object.entries(files)) {
    if (!insideProject(relative)) return { error: `files: ${relative} is not a path inside the project` };
    if (typeof text !== 'string') return { error: `files: ${relative} is not text` };
  }
  const session = { ...SESSION_DEFAULTS };
  if (raw.permissionMode !== undefined) {
    if (!isText(raw.permissionMode)) return { error: 'permissionMode must be a mode name' };
    session.permissionMode = raw.permissionMode;
  }
  if (raw.allowedTools !== undefined) {
    if (!Array.isArray(raw.allowedTools) || !raw.allowedTools.every(isText)) return { error: 'allowedTools must be an array of tool rules' };
    session.allowedTools = raw.allowedTools;
  }
  for (const key of ['maxTurns', 'timeoutSeconds', 'judgeTimeoutSeconds']) {
    if (raw[key] === undefined) continue;
    if (!isPositive(raw[key])) return { error: `${key} must be a positive number` };
    session[key] = key === 'maxTurns' ? Math.floor(raw[key]) : raw[key];
  }
  return {
    scenario: {
      name, dir, description: isText(raw.description) ? raw.description : '', prompt: raw.prompt,
      judge: raw.judge, control: raw.control === true, files, session,
    },
  };
}

// A folder that is itself a scenario, or a folder of scenario folders.
function loadScenarios(dir) {
  const root = path.resolve(dir);
  let folders;
  if (fs.existsSync(path.join(root, SCENARIO_FILE))) folders = [root];
  else {
    folders = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
      .map(entry => path.join(root, entry.name)).filter(folder => fs.existsSync(path.join(folder, SCENARIO_FILE))).sort();
  }
  const scenarios = [];
  const skipped = [];
  for (const folder of folders) {
    const checked = validateScenario(readJsonOrDefault(path.join(folder, SCENARIO_FILE), null), folder);
    if (checked.error) skipped.push({ name: path.basename(folder), error: checked.error });
    else scenarios.push(checked.scenario);
  }
  return { scenarios, skipped };
}

// A fresh project for one arm, under workRoot: the scenario's project/ folder, then its files.
function prepareProject(scenario, workRoot, armName) {
  fs.mkdirSync(workRoot, { recursive: true });
  const project = fs.mkdtempSync(path.join(workRoot, `${scenario.name}-${armName}-`));
  const source = path.join(scenario.dir, PROJECT_FOLDER);
  if (fs.existsSync(source)) fs.cpSync(source, project, { recursive: true });
  for (const [relative, text] of Object.entries(scenario.files)) {
    const target = path.join(project, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return project;
}

function fillPlaceholders(argv, folders) {
  return argv.map(part => part.replace(/\{scenario\}/g, folders.scenario).replace(/\{project\}/g, folders.project));
}

module.exports = { PROJECT_FOLDER, SCENARIO_FILE, SESSION_DEFAULTS, fillPlaceholders, loadScenarios, prepareProject, validateScenario };
