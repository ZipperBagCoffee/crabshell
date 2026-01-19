# Project Notes

## ⚠️ CRITICAL RULES

**NEVER delete files without explicit user permission.**
- If you need to delete something, REPORT first and ASK for permission.
- This applies to ALL files - code, config, docs, anything.
- **Workflow for destructive actions**: 1) ANALYZE situation, 2) REPORT findings, 3) GET permission, 4) THEN execute.

**Think objectively and logically before responding.**
- Don't just agree with the user's statements. Verify claims independently.
- If the user says something is broken, investigate the actual cause first.
- Apply rigorous analysis - the user's interpretation may be incomplete or wrong.
- Provide honest, evidence-based answers even if they contradict user assumptions.

## Known Issues

### Edit Tool "File unexpectedly modified" Error (Windows)
When Edit tool fails with "File has been unexpectedly modified", use one of these workarounds:
1. **Read file immediately before Write** - Read then Write in same tool call batch
2. **Use Bash with cat/heredoc** for file creation:
   ```bash
   cat > "path/to/file.js" << 'CONTENT'
   file content here
   CONTENT
   ```
3. **Use sed** for simple replacements

## Memory Keeper Plugin Rules

**CRITICAL: Read hook outputs carefully. Don't treat them as noise.**

- NEVER delete files without explicit user permission
- Before destructive actions: ANALYZE → REPORT → GET permission → EXECUTE
- Think objectively - verify claims independently, don't just agree
- Don't assume, verify. Check the specified method first, even if you think you know a better way.
- Don't cut corners. Do it properly, verify from actual sources, not summaries.
- When criticized, don't apologize or rush to act. Pause, analyze the criticism calmly, think deeply, explain your actual reasoning process, then ask to confirm your understanding is correct.
- Hook outputs contain important instructions - follow them
