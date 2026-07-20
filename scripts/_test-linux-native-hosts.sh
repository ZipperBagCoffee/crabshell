#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?repository root is required}"
codex_version="${2:?Codex version is required}"
claude_version="${3:?Claude version is required}"
runtime_root="$(mktemp -d -t crabshell-linux-hosts-XXXXXX)"
trap 'rm -rf -- "$runtime_root"' EXIT

case "$(uname -m)" in
  x86_64) node_arch="x64" ;;
  aarch64|arm64) node_arch="arm64" ;;
  *) printf 'Unsupported Linux architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

node_version="22.17.0"
node_archive="node-v${node_version}-linux-${node_arch}.tar.xz"
curl --fail --silent --show-error --location \
  "https://nodejs.org/dist/v${node_version}/${node_archive}" \
  --output "${runtime_root}/${node_archive}"
tar -xJf "${runtime_root}/${node_archive}" -C "$runtime_root"
node_root="${runtime_root}/node-v${node_version}-linux-${node_arch}"
export PATH="${node_root}/bin:${PATH}"

npm install --prefix "${runtime_root}/tools" --no-audit --no-fund --silent \
  "@anthropic-ai/claude-code@${claude_version}" \
  "@openai/codex@${codex_version}"
export CLAUDE_BIN="${runtime_root}/tools/node_modules/.bin/claude"
export CODEX_BIN="${runtime_root}/tools/node_modules/@openai/codex/bin/codex.js"
if [[ -f "${HOME}/.claude/.credentials.json" ]]; then
  export CRABSHELL_CLAUDE_CREDENTIALS="${HOME}/.claude/.credentials.json"
fi

cd "$repo_root"
node scripts/_test-claude-native-install.js
node scripts/_test-codex-native-install.js
printf 'LINUX_NATIVE_HOSTS_COMPLETE\n'
