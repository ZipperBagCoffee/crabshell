# Real hook payload fixtures

These files are captured from live hosts, not written by hand. Use them whenever code
reads `tool_response` (or any other hook field) so that a test proves the host contract,
not a shape somebody imagined. A synthetic `{ exitCode: 0, stdout }` response passes a
test and still bricks the commit gate on the real host — that is exactly what happened
with the first D117 bundle-1 implementation on 2026-09-05.

| File | Event | What it shows |
|---|---|---|
| `claude-posttooluse-bash-success.json` | Claude Code `PostToolUse`, tool `Bash` | The structured Output object: `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected`. **No exit-code field.** |
| `claude-posttoolusefailure-bash.json` | Claude Code failing `Bash` call | The result is a **string** `"Error: Exit code N\n<output>"` with `is_error: true` on the tool_result block. `PostToolUse` never receives it; it belongs to `PostToolUseFailure`. |

## Host facts (with sources)

- Claude Code hooks reference, "PostToolUse input" (https://code.claude.com/docs/en/hooks, read 2026-09-05):
  "PostToolUse hooks fire after a tool has already executed successfully." and
  "For tool calls that fail, add the same hook under PostToolUseFailure."
- Same page, "PostToolBatch": "PostToolUse passes the tool's structured Output object, such as
  `{filePath: "...", success: true}` for Write; PostToolBatch passes the serialized tool_result
  content the model sees."
- Bash Output object keys observed in the transcript of session 78811ea8 on this machine:
  `stdout, stderr, interrupted, isImage, noOutputExpected`.

## Consequences for Crabshell code

- A `PostToolUse` Bash payload whose `tool_response` is an object with `interrupted !== true`
  and no error/running indicator **is** exit-0 evidence; requiring an explicit exit code makes
  every real success "undetermined".
- Failure observations for Claude need a `PostToolUseFailure` hook; `PostToolUse` alone cannot
  see them (not wired as of v21.121.0).
- Codex payload shapes are a separate contract; see `../codex/` and do not assume they match.

## Adding a fixture

Capture, do not type: take the `toolUseResult` (or the hook's stdin JSON if you log it) from a
real session, keep `tool_input`/`tool_response` verbatim, and record host, date and source in
the `_captured` block. Never "clean up" a shape to make a test pass.
