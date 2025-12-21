# Auto Fact Extraction Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Claude automatically record decisions/patterns/issues without manual CLI commands or intermediate session files.

**Architecture:** Simplify auto-save flow by having Claude directly execute add-decision/add-pattern/add-issue commands instead of writing session files then extracting.

**Tech Stack:** Node.js, Claude Code Hooks (PostToolUse, Stop)

---

## Current Flow (Problem)

```
PostToolUse trigger (every 5 tools)
    ↓
Claude receives instructions to:
    1. Write to memory.md
    2. Create session file with specific format
    3. Run extract-facts command
    ↓
Claude may skip steps or format incorrectly
    ↓
Facts not extracted properly
```

**Problems:**
- 3-step process is complex
- Session file format must be exact
- Claude may not follow all steps
- extract-facts depends on correct formatting

---

## New Flow (Solution)

```
PostToolUse trigger (every 5 tools)
    ↓
Claude receives STRONG instructions to:
    1. Write to memory.md (1 line)
    2. Run add-decision/add-pattern/add-issue directly
    ↓
Facts saved immediately
```

**Benefits:**
- 2-step process (simpler)
- No intermediate file format
- Direct CLI execution
- Immediate persistence

---

## Implementation

### Task 1: Update check() function in counter.js

**Files:**
- Modify: `scripts/counter.js:128-201` (check function)

**Changes:**

Replace current instructions with simplified version:

```javascript
const instructions = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - ${counter} tool uses reached
═══════════════════════════════════════════════════════════════

**YOU MUST EXECUTE THESE COMMANDS NOW:**

1. APPEND to memory.md:
   \`\`\`bash
   echo -e "\\n## ${timestamp}\\n[1-2 sentence summary of this session]" >> "${projectDir}/memory.md"
   \`\`\`

2. RECORD any decisions made (run for EACH decision):
   \`\`\`bash
   node "${scriptPath}" add-decision "what was decided" "why" "architecture|technology|approach" "file1.ts,file2.ts" "concept1,concept2"
   \`\`\`

3. RECORD any patterns established (run for EACH pattern):
   \`\`\`bash
   node "${scriptPath}" add-pattern "pattern description" "convention|best-practice|anti-pattern" "files" "concepts"
   \`\`\`

4. RECORD any issues found/fixed (run for EACH issue):
   \`\`\`bash
   node "${scriptPath}" add-issue "issue description" "open|resolved" "bugfix|performance|security|feature" "files" "concepts"
   \`\`\`

IMPORTANT:
- Files and concepts are OPTIONAL (omit if not applicable)
- Run commands for ALL relevant items from this session
- If no decisions/patterns/issues, skip those steps
- DO NOT create session.md file - use commands directly

═══════════════════════════════════════════════════════════════`;
```

**Key changes:**
- "YOU MUST EXECUTE" instead of "EXECUTE THESE STEPS"
- Removed session.md creation step
- Removed extract-facts step
- Direct CLI commands only
- Clear IMPORTANT section

---

### Task 2: Update final() function in counter.js

**Files:**
- Modify: `scripts/counter.js:204-358` (final function)

**Changes:**

Similar simplification for session end:

```javascript
const instructions = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] SESSION ENDING - Final Save Required
═══════════════════════════════════════════════════════════════
${rawSaved ? `✓ Raw transcript saved: ${rawSaved}` : '⚠ Raw transcript not saved'}

**YOU MUST EXECUTE THESE COMMANDS NOW:**

1. APPEND complete summary to memory.md:
   \`\`\`bash
   echo -e "\\n## ${timestamp} (Session End)\\n[Complete session summary - be thorough]" >> "${projectDir}/memory.md"
   \`\`\`

2. RECORD ALL decisions from this session:
   \`\`\`bash
   node "${scriptPath}" add-decision "decision" "reason" "type" "files" "concepts"
   \`\`\`

3. RECORD ALL patterns from this session:
   \`\`\`bash
   node "${scriptPath}" add-pattern "pattern" "type" "files" "concepts"
   \`\`\`

4. RECORD ALL issues from this session:
   \`\`\`bash
   node "${scriptPath}" add-issue "issue" "status" "type" "files" "concepts"
   \`\`\`

5. RUN compression:
   \`\`\`bash
   node "${scriptPath}" compress
   \`\`\`

IMPORTANT:
- Review ENTIRE session for decisions/patterns/issues
- This is your FINAL chance to save important context
- Be thorough - next session starts fresh

═══════════════════════════════════════════════════════════════`;
```

---

### Task 3: Update documentation

**Files:**
- Modify: `README.md` - Update "How It Works" section
- Modify: `docs/USER-MANUAL.md` - Update auto-save description
- Modify: `commands/save-memory.md` - Update manual save instructions

**Changes:**
- Remove references to session.md creation during auto-save
- Document direct CLI command approach
- Keep extract-facts for manual use (parsing old session files)

---

### Task 4: Version bump and test

**Files:**
- Modify: `.claude-plugin/plugin.json` - Bump to v7.1.0

**Verification:**
1. Run `node scripts/counter.js check` multiple times
2. Verify instructions show direct CLI commands
3. Verify no mention of session.md creation
4. Test `add-decision`, `add-pattern`, `add-issue` commands work

---

## Backward Compatibility

- `extract-facts` command remains for parsing old session files
- Session files from previous versions still work
- No breaking changes to facts.json structure

---

## Success Criteria

1. Auto-save instructions are simpler (2 steps vs 3)
2. No intermediate session.md file required
3. Facts saved directly via CLI commands
4. Strong language ("YOU MUST") improves compliance

---

## References

- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices) - "IMPORTANT", "YOU MUST" improve adherence
- [CLAUDE.md Guide](https://www.claude.com/blog/using-claude-md-files) - System context is followed strictly
- [Hooks Reference](https://docs.claude.com/en/docs/claude-code/hooks) - additionalContext usage
