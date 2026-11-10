---
name: setup-project
description: "Auto-generates project.md from codebase analysis (manifest, README.md, git remote). Creates a 2-3 sentence project concept that is injected every prompt for drift prevention. Use when project.md doesn't exist or needs updating. Invoke with /setup-project."
---

## Paths and models

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.
- Models: follow `## Model Routing` in `.crabshell/project.md`, else the host's default (a first run has none). Checking the concept's quality and fit to the project's intent is judgment work; the rest is mechanical.

# Setup Project

Write the concept at the top of `.crabshell/project.md`: 2-3 sentences that inject-rules.js injects into every prompt.
The concept is the text before the file's first `## ` heading. It holds at most 10 lines and 500 characters, and says what the project is, what it does and its tech stack. The sections after it (such as `## Constraints` and `## Model Routing`) belong to the project and are never changed here.

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
Replace only the concept: when the file exists, keep everything from its first `## ` heading to the end exactly as it is, and put the approved text before it. When the file does not exist, write the approved text alone. Use the Edit tool on an existing file and the Write tool on a new one.
If the directory does not exist, create it first:
```bash
"{NODE_PATH}" -e "require('fs').mkdirSync('{PROJECT_DIR}/.crabshell/memory',{recursive:true})"
```

### Step 6: Check it
Read the file back and confirm:
- It exists at the path above.
- The concept (the text before the first `## ` heading) has 10 lines or fewer and is under 500 characters.
- Every `## ` section the file had before is still there, unchanged.
