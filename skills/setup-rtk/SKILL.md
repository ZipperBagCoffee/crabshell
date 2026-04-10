---
name: setup-rtk
description: "Install and configure RTK (Rust Token Killer) for CLI output compression. Opt-in utility — detects OS, downloads binary, adds to PATH, runs rtk init -g. Invoke with /setup-rtk."
---

# Setup RTK (Rust Token Killer)

Optional utility to install RTK — a CLI proxy that compresses Bash command output before it enters the context window. Reduces token consumption by 50-80% on common commands (git, ls, npm, etc.).

**This is opt-in.** RTK is not required for Crabshell to function. Users invoke `/setup-rtk` only when they want CLI output compression.

## Steps

### Step 1: Check if RTK is already installed

Run: `which rtk 2>/dev/null || where rtk 2>/dev/null`
- If found → report version (`rtk --version`) and skip to Step 5
- If not found → proceed to Step 2

### Step 2: Detect OS and architecture

```bash
OS=$(uname -s 2>/dev/null || echo "Windows")
ARCH=$(uname -m 2>/dev/null || echo "x86_64")
```

Map to RTK release asset name:
| OS | Arch | Asset |
|---|---|---|
| Linux | x86_64 | `rtk-x86_64-unknown-linux-gnu.tar.gz` |
| Linux | aarch64 | `rtk-aarch64-unknown-linux-gnu.tar.gz` |
| Darwin | x86_64 | `rtk-x86_64-apple-darwin.tar.gz` |
| Darwin | arm64 | `rtk-aarch64-apple-darwin.tar.gz` |
| Windows / MINGW / MSYS | x86_64 | `rtk-x86_64-pc-windows-msvc.zip` |

If OS/arch combination is not in the table → report and stop.

### Step 3: Download and extract

```bash
# Create install directory
mkdir -p "$HOME/tools/rtk"

# Download from GitHub releases (latest)
curl -sL "https://github.com/rtk-ai/rtk/releases/latest/download/{ASSET}" -o /tmp/rtk-download

# Extract
# For .tar.gz: tar -xzf /tmp/rtk-download -C "$HOME/tools/rtk/"
# For .zip: unzip -o /tmp/rtk-download -d "$HOME/tools/rtk/"

# Verify
"$HOME/tools/rtk/rtk" --version  # or rtk.exe on Windows
```

### Step 4: Add to PATH

Detect shell config file:
- If `$SHELL` contains `zsh` → `~/.zshrc`
- If `$SHELL` contains `bash` → `~/.bashrc`
- Windows Git Bash → `~/.bashrc`

Check if already in PATH config:
```bash
grep -q 'tools/rtk' "$SHELL_CONFIG" 2>/dev/null
```
- If already present → skip
- If not → append: `export PATH="$HOME/tools/rtk:$PATH"`

### Step 5: Initialize RTK for Claude Code

```bash
rtk init -g
```

This adds RTK usage instructions to `~/.claude/CLAUDE.md`. On Windows, this uses `--claude-md` mode (text instructions) instead of hook mode.

### Step 6: Report

Tell user:
```
RTK installed:
- Binary: ~/tools/rtk/rtk (or rtk.exe)
- Version: {version}
- PATH: added to {shell config file}
- Claude Code: ~/.claude/CLAUDE.md updated with RTK instructions
- Mode: {hook (Unix) or claude-md (Windows)}

Next session will automatically use RTK for Bash commands.
To verify: run `rtk --version` in a new terminal.
To uninstall: delete ~/tools/rtk/ and remove the PATH line from {shell config}.
```

## Notes
- RTK is a third-party tool (github.com/rtk-ai/rtk), not part of Crabshell
- On Windows, RTK operates via CLAUDE.md text instructions (model must prefix commands with `rtk`), not hooks
- On Unix (Mac/Linux), RTK can use PreToolUse hooks for automatic interception
- RTK only affects Bash tool output — does not touch Read/Edit/Write/Grep tools or memory pipeline
- If download fails (network issues, GitHub rate limit), report error and stop — do not retry
