'use strict';
// The project's files as its runner sees them (D143_T013): hooks ask the runner's own
// snapshot and exclusion rule (skills/verifying/scripts/runner/project-state.js) whether
// the project changed and whether a file is part of it, so hooks and checks share one
// definition — no list of extensions, file names or folders of their own.
//
// The runner's module is loaded on first use (D143_T018): when it cannot be loaded (a
// partial or broken copy), every answer here is null — "no judgment" — and the hooks stay
// up. Callers decide what null means: a blocking check does not block on it, evidence is
// not evidence without it. The missing runner is named once (a file in the memory folder).

const fs = require('fs');
const path = require('path');
const { STORAGE_ROOT, MEMORY_DIR } = require('../constants');

// Crabshell keeps the project's runner and manifest in its verification folder.
const launcherDir = projectDir => path.join(projectDir, STORAGE_ROOT, 'verification');

// The content-hash cache behind contentIdentity (hooks' own, in the memory folder).
const contentCache = projectDir => path.join(projectDir, STORAGE_ROOT, MEMORY_DIR, 'project-index.json');
const MISSING_NOTE = 'runner-unavailable.json';

let runnerModule;
// The runner's project-state module, or null after naming the failure once. A runner that
// loads again clears the note, so a later failure is named again.
function runner(projectDir) {
  if (runnerModule !== undefined) return runnerModule;
  const note = path.join(projectDir, STORAGE_ROOT, MEMORY_DIR, MISSING_NOTE);
  try {
    runnerModule = require('../../skills/verifying/scripts/runner/project-state');
    try { fs.rmSync(note, { force: true }); } catch (_) {}
  } catch (error) {
    runnerModule = null;
    try {
      if (!fs.existsSync(note)) {
        require('../utils').writeJson(note, { at: new Date().toISOString(), error: String(error && error.message).split('\n')[0] });
        process.stderr.write(`[CRABSHELL] The verification runner modules could not be loaded (${String(error && error.message).split('\n')[0]}); checks that need them are skipped. Reinstall or update the plugin.\n`);
      }
    } catch (_) {}
  }
  return runnerModule;
}
// A runner answer, or null when the runner is unavailable or the answer fails.
function ask(projectDir, question) {
  const module = runner(projectDir);
  if (!module) return null;
  return question(module);
}

// One selection view (records, snapshot, context) per hook payload and project: every
// check of one hook call shares one walk of the project (D143_T015 review).
const views = new WeakMap();
function viewFor(payload, projectDir) {
  const build = () => ask(projectDir, module => {
    const state = module.projectState(projectDir, launcherDir(projectDir));
    return module.selectionView({ projectRoot: state.root, layout: state.layout, manifestPath: state.layout.manifestPath, manifest: state.manifest });
  });
  if (!payload || typeof payload !== 'object') return build();
  if (!views.has(payload)) views.set(payload, new Map());
  const byProject = views.get(payload);
  if (!byProject.has(projectDir)) byProject.set(projectDir, build());
  return byProject.get(projectDir);
}

// Two identities match only when both are known and equal: null means "no judgment",
// and two unknowns are not the same content.
const sameIdentity = (a, b) => typeof a === 'string' && a.length > 0 && a === b;

module.exports = {
  viewFor,
  sameIdentity,
  // Completion evidence: the files' contents, so a rewrite with the same bytes keeps it.
  contentIdentity: projectDir => ask(projectDir, module => module.contentIdentity(projectDir, launcherDir(projectDir), contentCache(projectDir))),
  isProjectInput: (projectDir, file) => ask(projectDir, module => module.isProjectInput(projectDir, launcherDir(projectDir), file)),
  projectIdentity: projectDir => ask(projectDir, module => module.projectIdentity(projectDir, launcherDir(projectDir))),
  projectState: projectDir => ask(projectDir, module => module.projectState(projectDir, launcherDir(projectDir))),
  // The runner's record of an entry it would not run now, or null (also when unavailable).
  entryUpToDate: (projectDir, entryId, view) => ask(projectDir, module => module.entryUpToDate(projectDir, launcherDir(projectDir), entryId, view)),
  // The checks that have not passed on the current files, or null (also when unavailable).
  pendingChecks: (projectDir, view) => ask(projectDir, module => module.pendingChecks(projectDir, launcherDir(projectDir), view)),
};
