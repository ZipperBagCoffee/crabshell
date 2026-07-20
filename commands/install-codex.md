---
description: Legacy/development bridge that links a Claude-installed Crabshell checkout into Codex
allowed-tools: Bash
---

Prefer Codex's native repo marketplace (`codex plugin marketplace add .`, then
`codex plugin add crabshell@crabshell-repo`). Use this retained legacy/development
bridge only when you specifically need to link the Claude-installed checkout.

Run the bridge from the plugin root:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/find-node.sh" "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex.js"
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, locate the marketplace checkout and run:

```bash
bash ~/.claude/plugins/marketplaces/crabshell-marketplace/scripts/find-node.sh \
  ~/.claude/plugins/marketplaces/crabshell-marketplace/scripts/install-codex.js
```

After it finishes, tell the user to restart Codex.
