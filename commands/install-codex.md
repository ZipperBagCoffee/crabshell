---
description: Link this Crabshell plugin into Codex
allowed-tools: Bash
---

Run the Crabshell Codex installer from the plugin root:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/find-node.sh" "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex.js"
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, locate the marketplace checkout and run:

```bash
bash ~/.claude/plugins/marketplaces/crabshell-marketplace/scripts/find-node.sh \
  ~/.claude/plugins/marketplaces/crabshell-marketplace/scripts/install-codex.js
```

After it finishes, tell the user to restart Codex.
