#!/usr/bin/env bash
# find-node.sh — Locate Node.js and execute a script with all arguments.
# Uses exec for stdin passthrough (zero process overhead).
#
# Usage: bash find-node.sh <script.js> [args...]
#
# Search order:
#   1. NODE_BIN env var (advanced user escape hatch)
#   2. command -v node (fast path — works when PATH is correct)
#   3. Common Windows paths (Git Bash / standard installs)
#   4. Version managers: nvm, volta, fnm (direct path checks only)
#   5. macOS Homebrew paths
#   6. Linux common paths (/usr/local/bin, snap, etc.)
#
# IMPORTANT: Do NOT use recursive `find` to search version manager directories
# (e.g., ~/.nvm, ~/.volta, ~/.fnm). These directories can contain hundreds of
# thousands of files across cached packages, node_modules, and download
# artifacts. A recursive find can hang for 30+ seconds or saturate I/O,
# especially on Windows/WSL. Instead, use direct path checks or limited globs
# that target known binary locations within each manager's directory structure.

set -euo pipefail

# --- 1. NODE_BIN env var override ---
if [[ -n "${NODE_BIN:-}" ]] && [[ -x "$NODE_BIN" ]]; then
  exec "$NODE_BIN" "$@"
fi

# --- 2. command -v node (fast path) ---
if command -v node >/dev/null 2>&1; then
  exec node "$@"
fi

# --- 3. Common Windows paths ---
for p in \
  "/c/Program Files/nodejs/node.exe" \
  "/c/Program Files (x86)/nodejs/node.exe" \
  "$PROGRAMFILES/nodejs/node.exe" \
  "${LOCALAPPDATA:-}/Programs/node/node.exe" \
  "${LOCALAPPDATA:-}/Programs/nodejs/node.exe"; do
  if [[ -n "$p" ]] && [[ -x "$p" ]]; then
    exec "$p" "$@"
  fi
done

# --- 4. Version managers (direct path checks, NO recursive find) ---

# nvm — check default alias, then current, then latest installed version
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -d "$NVM_DIR/versions/node" ]]; then
  # Try default alias symlink
  if [[ -x "$NVM_DIR/alias/default" ]]; then
    DEFAULT_VER=$(cat "$NVM_DIR/alias/default" 2>/dev/null || true)
    if [[ -n "$DEFAULT_VER" ]] && [[ -x "$NVM_DIR/versions/node/$DEFAULT_VER/bin/node" ]]; then
      exec "$NVM_DIR/versions/node/$DEFAULT_VER/bin/node" "$@"
    fi
  fi
  # Try current symlink
  if [[ -x "$NVM_DIR/current/bin/node" ]]; then
    exec "$NVM_DIR/current/bin/node" "$@"
  fi
  # Pick the latest installed version (limited glob on version dirs only)
  LATEST=$(ls -1d "$NVM_DIR/versions/node"/v* 2>/dev/null | sort -V | tail -1)
  if [[ -n "${LATEST:-}" ]] && [[ -x "$LATEST/bin/node" ]]; then
    exec "$LATEST/bin/node" "$@"
  fi
fi

# nvm for Windows — installations live under NVM_HOME or APPDATA
NVM_HOME="${NVM_HOME:-${APPDATA:-}/nvm}"
if [[ -d "$NVM_HOME" ]]; then
  LATEST=$(ls -1d "$NVM_HOME"/v* 2>/dev/null | sort -V | tail -1)
  if [[ -n "${LATEST:-}" ]]; then
    for candidate in "$LATEST/node.exe" "$LATEST/bin/node"; do
      if [[ -x "$candidate" ]]; then
        exec "$candidate" "$@"
      fi
    done
  fi
fi

# volta — binary shim or managed installs
VOLTA_HOME="${VOLTA_HOME:-$HOME/.volta}"
if [[ -x "$VOLTA_HOME/bin/node" ]]; then
  exec "$VOLTA_HOME/bin/node" "$@"
fi
# volta managed node images (pick latest)
if [[ -d "$VOLTA_HOME/tools/image/node" ]]; then
  LATEST=$(ls -1d "$VOLTA_HOME/tools/image/node"/*/ 2>/dev/null | sort -V | tail -1)
  if [[ -n "${LATEST:-}" ]]; then
    for candidate in "${LATEST}bin/node" "${LATEST}bin/node.exe"; do
      if [[ -x "$candidate" ]]; then
        exec "$candidate" "$@"
      fi
    done
  fi
fi

# fnm — managed installs
FNM_DIR="${FNM_DIR:-$HOME/.fnm}"
if [[ -d "$FNM_DIR/node-versions" ]]; then
  LATEST=$(ls -1d "$FNM_DIR/node-versions"/v* 2>/dev/null | sort -V | tail -1)
  if [[ -n "${LATEST:-}" ]]; then
    for candidate in "$LATEST/installation/bin/node" "$LATEST/installation/node.exe"; do
      if [[ -x "$candidate" ]]; then
        exec "$candidate" "$@"
      fi
    done
  fi
fi
# fnm on Windows (LOCALAPPDATA)
FNM_WIN="${LOCALAPPDATA:-}/fnm_multishells"
if [[ -d "$FNM_WIN" ]]; then
  # fnm creates per-session dirs; pick the most recent one
  LATEST_SHELL=$(ls -1td "$FNM_WIN"/*/ 2>/dev/null | head -1)
  if [[ -n "${LATEST_SHELL:-}" ]] && [[ -x "${LATEST_SHELL}node.exe" ]]; then
    exec "${LATEST_SHELL}node.exe" "$@"
  fi
fi

# --- 5. macOS Homebrew paths ---
for p in \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node"; do
  if [[ -x "$p" ]]; then
    exec "$p" "$@"
  fi
done

# --- 6. Linux common paths ---
for p in \
  "/usr/bin/node" \
  "/usr/local/bin/node" \
  "/snap/bin/node"; do
  if [[ -x "$p" ]]; then
    exec "$p" "$@"
  fi
done

# --- Failure ---
echo "find-node.sh: ERROR — Node.js not found." >&2
echo "Searched: PATH, common install dirs, nvm, volta, fnm, brew, snap." >&2
echo "Fix: install Node.js, or set NODE_BIN=/path/to/node" >&2
exit 1
