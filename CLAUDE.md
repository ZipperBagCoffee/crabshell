# Project Notes

## ⚠️ CRITICAL RULES

**NEVER delete files without explicit user permission.**
- If you need to delete something, REPORT first and ASK for permission.
- This applies to ALL files - code, config, docs, anything.

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
