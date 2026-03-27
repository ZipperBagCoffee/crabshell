---
name: setup-project
description: "Auto-generates project.md from codebase analysis (package.json, README.md, git remote). Creates a 2-3 sentence project concept that is injected every prompt for drift prevention. Use when project.md doesn't exist or needs updating. Invoke with /setup-project."
---

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Setup Project

Generate `.claude/memory/project.md` — a 2-3 sentence project concept injected every prompt by inject-rules.js for drift prevention.

## Format Constraint
- First 3 lines, max 200 characters total (inject-rules.js truncation)
- Content: What is this project? What does it do? What tech stack?
- Example: "Memory Keeper is a Claude Code plugin that auto-saves session context. Provides hierarchical memory rotation, rules injection, and integrated search. Built with Node.js, runs as hooks."

## Steps

### Step 1: Check existing project.md
Read `{PROJECT_DIR}/.claude/memory/project.md`. If exists, show current content and ask: "Update or keep?"

### Step 2: Scan project sources
Read available sources in order of priority:
1. `package.json` or `.claude-plugin/plugin.json` — name + description fields
2. `README.md` — first non-empty paragraph after title
3. Git remote URL — extract repo name
4. Top-level directory names — detect framework/stack

### Step 3: Generate project concept
From extracted info, compose 2-3 sentences (under 200 chars total):
- Line 1: "{name} is a {type} that {purpose}."
- Line 2: "{key features or tech stack}."
- Line 3 (optional): "{additional context}."

### Step 4: Present to user
Show the generated text. User approves, edits, or rejects.

### Step 5: Write project.md
Save approved content to `{PROJECT_DIR}/.claude/memory/project.md`.
Use the Write tool to create `{PROJECT_DIR}/.claude/memory/project.md` with the approved content.
If the directory doesn't exist, create it first:
```bash
"{NODE_PATH}" -e "require('fs').mkdirSync('{PROJECT_DIR}/.claude/memory',{recursive:true})"
```

### Step 6: Verify
Read back the file and confirm inject-rules.js would pick it up:
- File exists at correct path
- Content is 3 lines or fewer
- Total length under 200 chars
