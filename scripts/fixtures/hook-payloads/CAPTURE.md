# Capturing actual hook input

Set `CRABSHELL_HOOK_CAPTURE_DIR` to a path inside the active project's `.crabshell/`, for example `.crabshell/verification/captures`, when starting a diagnostic host session. Leave it unset for ordinary use.

Crabshell's stdin reader stores the original UTF-8 input in a unique `*.input.json` file and a separate `*.meta.json` record. The record identifies Claude/Codex, stdin versus legacy `HOOK_DATA`, whether input ended or timed out, byte count, and SHA-256. Codex adapters supply the host explicitly. A timed-out or malformed input is retained as received; it is not a fabricated complete hook envelope.

Capture is off by default. Paths outside `.crabshell`, directory links, and write failures do not change the original hook's result. No capture text is emitted on stdout. Diagnostic captures can contain tool input/output, so keep them local and review them before sharing. Do not add credentials or unrelated transcripts to fixtures.

When promoting a capture to a fixture, preserve the raw file and record the actual CLI version, event, source location, date, and any redaction separately. A deterministic local model endpoint can drive harmless tool calls through a real CLI: that establishes the CLI's actual hook envelope, not the quality of model reasoning. Capturing a transcript's `toolUseResult` alone does not establish every stdin field.
