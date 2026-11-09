---
name: setup-project
description: "Auto-generates project.md from codebase analysis (manifest, README.md, git remote). Creates a 2-3 sentence project concept that is injected every prompt for drift prevention. Use when project.md doesn't exist or needs updating. Invoke with /setup-project."
---

## Paths and models

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.
- Models: follow `## Model Routing` in `.crabshell/project.md`, else the host's default (a first run has none). Checking the concept's quality and fit to the project's intent is judgment work; the rest is mechanical.

# Setup Project

Write `.crabshell/project.md`: a 2-3 sentence project concept that inject-rules.js injects into every prompt.
It holds at most 10 lines and 500 characters. It says what the project is, what it does and its tech stack.

## Steps

### Step 1: Check the existing file
Read `{PROJECT_DIR}/.crabshell/project.md`. If it exists, show its content and ask: "Update or keep?"

### Step 2: Scan sources
Read the available sources in priority order:
1. A manifest such as `package.json` or `pyproject.toml` — name + description fields
2. `README.md` — first non-empty paragraph after title
3. Git remote URL — extract repo name
4. Top-level directory names — detect framework/stack

### Step 3: Write the concept
From the extracted info, compose 2-3 sentences, under 500 characters in total:
- Line 1: "{name} is a {type} that {purpose}."
- Line 2: "{key features or tech stack}."
- Line 3 (optional): "{additional context}."

### Step 4: Show it
Show the text. The user approves, edits or rejects it.

### Step 5: Save it
Write the approved content to `{PROJECT_DIR}/.crabshell/project.md` with the Write tool.
If the directory does not exist, create it first:
```bash
"{NODE_PATH}" -e "require('fs').mkdirSync('{PROJECT_DIR}/.crabshell/memory',{recursive:true})"
```

### Step 6: Check it
Read the file back and confirm:
- It exists at the path above.
- It has 10 lines or fewer.
- It is under 500 characters.
