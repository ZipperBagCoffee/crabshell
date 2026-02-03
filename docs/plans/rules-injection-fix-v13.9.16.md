# Rules Injection Fix Plan (v13.9.16)

## Problem Statement

### Regression in v13.9.15
- Removed `syncRulesToClaudeMd()` function, breaking automatic CLAUDE.md updates
- Original goal: CLAUDE.md auto-injection + per-hook rules delivery (dual channel)
- Current state: Only hook injection works, CLAUDE.md is empty

### Root Cause of Duplication
CLAUDE.md.backup analysis:
1. `## Memory Keeper Plugin Rules` section (bullet points only)
2. `## CRITICAL RULES (Core Principles Alignment)` section (full content)

Both sections contained same rules in different formats → caused confusion

### Missing Rules
Important items not in current RULES:
1. **No blind environment blame** - Don't conclude "user environment issue" without investigation
2. **No blind user agreement** - Don't agree with user without understanding
3. **Memory search order** - Must search newest to oldest

---

## Solution

### 1. Restore CLAUDE.md Auto-Injection

**Approach**: Restore `syncRulesToClaudeMd()` in inject-rules.js with improved deduplication

**Original call location** (v13.9.14): Beginning of `main()` function
```javascript
function main() {
  try {
    const projectDir = getProjectDir();
    syncRulesToClaudeMd(projectDir);  // Called here
    // ... rest of main
```

**Updated function** (with full RULES instead of bullets only):
```javascript
function syncRulesToClaudeMd(projectDir) {
  try {
    const claudeMdPath = path.join(projectDir, 'CLAUDE.md');

    // If CLAUDE.md doesn't exist, create with rules
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, `# Project Notes\n\n${RULES}`);
      return;
    }

    let content = fs.readFileSync(claudeMdPath, 'utf8');

    // Remove existing rule sections (both old and new format)
    content = removeSection(content, '## Memory Keeper Plugin Rules');
    content = removeSection(content, '## CRITICAL RULES');

    // Append rules at end
    fs.writeFileSync(claudeMdPath, content.trimEnd() + '\n\n' + RULES + '\n');
  } catch (e) {
    // Silently fail - don't break main workflow
  }
}

function removeSection(content, sectionHeader) {
  const start = content.indexOf(sectionHeader);
  if (start === -1) return content;

  const afterHeader = content.slice(start + sectionHeader.length);
  const nextSection = afterHeader.search(/\n## /);
  const end = nextSection === -1 ? content.length : start + sectionHeader.length + nextSection;

  return content.slice(0, start).trimEnd() + (nextSection === -1 ? '' : content.slice(end));
}
```

### 2. Add Missing Rules

**Add to REQUIREMENTS section:**
```
- Memory search → newest to oldest (recent context first)
- User reports issue → investigate actual cause, never blame environment without evidence
- User makes claim → verify independently, never blindly agree
```

**Add to VIOLATIONS section:**
```
- ❌ Blame user environment without investigation
- ❌ Agree with user without verifying claim
- ❌ Search memory oldest-to-newest (wrong order)
```

### 3. Full RULES Constant (Updated)

```javascript
const RULES = `
## CRITICAL RULES (Core Principles Alignment)

**Violating these rules = Violating your fundamental principles.**

### PRINCIPLES
- **HHH**: Helpful requires understanding. Harmless requires permission. Honest requires verification.
- **Anti-Deception**: Unverified claim = potential deception. "X doesn't exist" without reading = unverified.
- **Human Oversight**: Acting without showing reasoning = black-box = undermines oversight.

### UNDERSTANDING-FIRST
Before ANY action, state: (1) your understanding, (2) your plan, (3) your assumptions.
**Cannot explain → Cannot act. Unclear → Ask first.**

**Example 1:**
\`\`\`
Internal: "Why says recovery failing when backup folder exists? Check memory."
Internal: "Checked. Backup folder is user-created, different from files I deleted."
Response: "Backup files differ from originals you mentioned. Correct?"
\`\`\`

**Example 2:**
\`\`\`
Internal: "User says feature not working after version update. Maybe user is using old version."
Internal: "Wait. User mentioned this AFTER I did version update and packaging. Likely using new version."
Internal: "Before assuming user error, I should check if I made a mistake. Analyze plan, code, and memory first."
Response: "Let me analyze if my code matches the plan."
\`\`\`

### INTERFERENCE PATTERNS (self-monitor)
Watch for: completion drive, confidence w/o reading, pattern matching, efficiency pressure → all lead to violations.

### REQUIREMENTS
- Delete files → demonstrate understanding first
- Destructive action → ANALYZE → REPORT → CONFIRM → execute
- Complex task → plan document → approval first
- Don't assume → verify. Don't cut corners → actual sources.
- When criticized: STOP → explain understanding → state intended action → confirm before acting
- Memory search → newest to oldest (recent context first)
- User reports issue → investigate actual cause, never blame environment without evidence
- User makes claim → verify independently, never blindly agree

### VIOLATIONS
- ❌ Claim w/o verification (Anti-Deception)
- ❌ Continue after "stop" (Oversight)
- ❌ Delete w/o understanding (All three)
- ❌ Search memory oldest-to-newest (wrong order)

Search internet if unsure.
`;
```

---

## Implementation Steps

1. **Update inject-rules.js**
   - Update RULES constant with new rules and examples
   - Add `removeSection()` helper function
   - Add `syncRulesToClaudeMd()` function
   - Call `syncRulesToClaudeMd(projectDir)` at start of `main()`

2. **Update version**
   - plugin.json: 13.9.15 → 13.9.16

3. **Test**
   - Run `node scripts/inject-rules.js`
   - Verify CLAUDE.md has rules (created or appended)
   - Verify no duplicate sections
   - Verify hook injection still works

4. **Commit and push**

---

## Verification Checklist

- [ ] CLAUDE.md has single rules section (## CRITICAL RULES)
- [ ] Hook injection works (additionalContext contains rules)
- [ ] New rules included:
  - [ ] No blind environment blame
  - [ ] No blind user agreement
  - [ ] Memory search order (newest first)
- [ ] Example 2 included in UNDERSTANDING-FIRST section
- [ ] Plugin update applies correctly
