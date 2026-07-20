---
name: status
description: Diagnose the installed Crabshell Codex plugin source, cache, hook trust and hash, bundled skills, writable data path, capabilities, and native hook contract.
---

# Crabshell Codex Status

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the active project root. Run the bundled doctor by its
absolute path:

```bash
node "{SKILL_DIR}/scripts/codex-doctor.js" --json --project-dir="{PROJECT_ROOT}"
```

Report every check with its `ok`, `warn`, or `error` status. Do not replace the
reported feature/config probes with a version compatibility table. Treat an
uninstalled plugin or untrusted hook as a warning; treat a wrong hook source,
missing installed cache, missing bundled skills, failed data write probe, or
failed native hook probe as an error when the plugin is installed.
