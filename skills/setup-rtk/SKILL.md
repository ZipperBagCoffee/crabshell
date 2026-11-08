---
name: setup-rtk
description: "Install and configure RTK (Rust Token Killer) for CLI output compression. Opt-in utility — detects OS, downloads binary, adds to PATH, runs rtk init -g. Invoke with /setup-rtk."
---

# Setup RTK (Rust Token Killer)

RTK is a third-party CLI proxy (github.com/rtk-ai/rtk) that compresses Bash command output. It affects only Bash tool output.
It is opt-in: Crabshell works without it. Users invoke `/setup-rtk` only when they want CLI output compression.

## Steps

### Step 1: Check for an existing install

Run: `which rtk 2>/dev/null || where rtk 2>/dev/null`
- Found: report its version (`rtk --version`) and skip to Step 5.
- Not found: go to Step 2.

### Step 2: Detect OS and architecture

```bash
OS=$(uname -s 2>/dev/null || echo "Windows")
ARCH=$(uname -m 2>/dev/null || echo "x86_64")
```

Map them to the release asset:
| OS | Arch | Asset |
|---|---|---|
| Linux | x86_64 | `rtk-x86_64-unknown-linux-gnu.tar.gz` |
| Linux | aarch64 | `rtk-aarch64-unknown-linux-gnu.tar.gz` |
| Darwin | x86_64 | `rtk-x86_64-apple-darwin.tar.gz` |
| Darwin | arm64 | `rtk-aarch64-apple-darwin.tar.gz` |
| Windows / MINGW / MSYS | x86_64 | `rtk-x86_64-pc-windows-msvc.zip` |

If the OS and architecture pair is not in the table, report it and stop.

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

If the download fails, for example from a network error or a GitHub rate limit, report the error and stop. Do not retry.

### Step 4: Add to PATH

Pick the shell config file:
- `$SHELL` contains `zsh`: `~/.zshrc`
- `$SHELL` contains `bash`: `~/.bashrc`
- Windows Git Bash: `~/.bashrc`

Check whether the shell config already adds it:
```bash
grep -q 'tools/rtk' "$SHELL_CONFIG" 2>/dev/null
```
- Present: skip.
- Absent: append `export PATH="$HOME/tools/rtk:$PATH"`.

### Step 5: Initialize RTK for Claude Code

```bash
rtk init -g
```

This adds RTK instructions to `~/.claude/CLAUDE.md`.
On Windows it uses `--claude-md` mode: it works through text instructions, so the model must prefix commands with `rtk`.
On Mac and Linux it can use hook mode, which intercepts commands through PreToolUse hooks.

### Step 6: Report

Tell the user:
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
