---
description: Manually save current session context to memory
---

Save a session summary to ~/.claude/memory-keeper/sessions/

Filename format: [PROJECT_NAME]_[YYYY-MM-DD_HH-MM].md
- PROJECT_NAME = current directory name

Include:
1. **Project**: Full path
2. **Summary**: 1-2 sentence overview
3. **Changes**: Files modified/created with brief description
4. **Decisions**: Key decisions and rationale
5. **Discoveries**: Patterns, insights, or issues found
6. **Next Steps**: Actionable TODOs with checkboxes

Keep under 500 tokens. Create directory if needed.
