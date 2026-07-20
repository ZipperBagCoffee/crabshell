# Codex hook contract fixtures

`pre-tool-use.json` follows the native `PreToolUse` command-input schema in the
OpenAI Codex source tree (`codex-rs/hooks/schema/generated/`) at commit
`678157acaa819d5510adfe359abb5d0392cfe461`, inspected 2026-07-19. Tests replace
only project-specific values such as `cwd` and command paths.

The expected blocking response is the native `hookSpecificOutput` shape used by
Codex's `pre_tool_use.rs` integration tests. The deprecated Claude-compatible
top-level `decision: "block"` shape is intentionally not used by the Codex
adapter.
