# Project Notes

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
