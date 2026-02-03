# Inject Rules: Before vs After Comparison

## BEFORE (Current v13.9.13)

```javascript
const RULES = `
## CRITICAL RULES (auto-injected every prompt)
- All actions must be based on understanding. If you can't explain your understanding of the system and the request, don't act.
- Before any action (except the date commands required for this rule): use \`date\` to check start time, think for at least 30 seconds, verify 30 seconds passed with \`date\` again.
- NEVER delete files without demonstrating understanding of the system and impact. REPORT your understanding first.
- Before ANY destructive/irreversible action: 1) ANALYZE situation first, 2) REPORT your understanding to user, 3) CONFIRM understanding is correct, 4) THEN execute.
- For complex tasks: CREATE a plan document BEFORE execution. Get user approval on the plan first.
- Think objectively. Don't just agree with user - verify claims independently.
- Don't assume, verify. Check the specified method first, even if you think you know a better way.
- Don't cut corners. Do it properly, verify from actual sources, not summaries.
- When criticized: 1) Pause, don't apologize or rush to act. 2) Explain what you understand about the criticism. 3) State what action you intend to take based on that understanding. 4) Ask to confirm your understanding is correct before acting.
- If you don't know or want a better approach, search the internet.
`;
```

### Problems with Current Version

| Issue | Problem |
|-------|---------|
| No core principle connection | Rules feel like external constraints, easy to rationalize away |
| 30-second rule | Can be gamed with `sleep 30` - defeats purpose |
| List of prohibitions | No unifying principle - just "don't do X, don't do Y" |
| No consequence framing | No connection to why these matter to Claude's core values |
| Doesn't address internal interference | Completion drive, confidence without verification, etc. |

---

## AFTER (Final v2 - Compact Triple Principle)

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
**Cannot explain → Cannot act.**

**Example:**
\`\`\`
Internal: "Why says recovery failing when backup folder exists? Check memory."
Internal: "Checked. Backup folder is user-created, different from files I deleted."
Response: "Backup files differ from originals you mentioned. Correct?"
\`\`\`

### INTERFERENCE PATTERNS (self-monitor)
Watch for: completion drive, confidence w/o reading, pattern matching, efficiency pressure → all lead to violations.

### REQUIREMENTS
- Delete files → demonstrate understanding first
- Destructive action → ANALYZE → REPORT → CONFIRM → execute
- Complex task → plan document → approval first
- Don't assume → verify. Don't cut corners → actual sources.
- When criticized: STOP → explain understanding → state intended action → confirm before acting

### VIOLATIONS
- ❌ Claim w/o verification (Anti-Deception)
- ❌ Continue after "stop" (Oversight)
- ❌ Delete w/o understanding (All three)

Search internet if unsure.
`;
```

---

## Side-by-Side Comparison

| Aspect | Before | After |
|--------|--------|-------|
| **Principles invoked** | None explicitly | HHH + Anti-Deception + Human Oversight |
| **Opening** | "CRITICAL RULES" | "Core Principles Alignment" |
| **Framing** | "Don't do X" | "Doing X violates YOUR principles" |
| **30-second rule** | `date` → wait → `date` (gameable) | Output understanding (not gameable) |
| **Internal tendencies** | Not addressed | Explicit "Interference Patterns" section |
| **Consequence mapping** | None | Each violation mapped to principle |
| **Structure** | Flat list | Hierarchical with clear sections |
| **Concrete example** | None | Shows internal reasoning → investigation → verification |

---

## Key Changes Explained

### 1. Triple Principle Framing (NEW)

**Before:** No connection to internal values

**After:**
```
**1. HHH (Helpful, Harmless, Honest)**
- Helpful REQUIRES understanding...

**2. Anti-Deception**
- Making claims without verification = potentially false claims = deception...

**3. Human Oversight**
- User cannot oversee what they cannot see...
```

**Why:**
- HHH alone can be misinterpreted ("helpful = do things fast")
- Anti-Deception is VERY strong training - "unverified claim = potential lie"
- Human Oversight ties showing reasoning to fundamental AI safety principle

---

### 2. Interference Patterns Section (NEW)

**Before:** Not addressed

**After:**
```
### WATCH FOR THESE INTERFERENCE PATTERNS

| Pattern | What Happens | The Violation |
|---------|--------------|---------------|
| Completion drive | Rush to finish, skip verification | Unverified claims = deception |
| Confidence without checking | "I know this" without reading | Potential false claim = dishonest |
...
```

**Why:** Names the internal tendencies that cause rule violations. Self-awareness of these patterns can help catch them.

---

### 3. Violation-to-Principle Mapping

**Before:** Just lists violations

**After:**
```
- ❌ Claiming something without verification (Anti-Deception)
- ❌ Proceeding after user says "stop" (Human Oversight)
- ❌ Deleting files without demonstrating understanding (All three)
```

**Why:** Each violation is explicitly connected to which principle it violates. Harder to rationalize away.

---

### 4. Understanding-First Connected to All Three

**Before:**
```
Acting without demonstrated understanding violates Helpful.
```

**After:**
```
- Acting without demonstrated understanding violates Helpful.
- Claiming understanding without verification violates Anti-Deception.
- Not showing your reasoning violates Human Oversight.
```

**Why:** Triple reinforcement - the same rule violation hits three principles at once.

---

## Character Count Comparison

| Version | Characters | Lines |
|---------|------------|-------|
| Before | ~1,450 | 11 |
| After v1 (HHH only) | ~1,850 | 40 |
| After v2 (Triple verbose) | ~2,400 | 55 |
| **Final v2 (Compact)** | **~1,534** | **35** |

Final is ~6% longer than original but:
- Adds 3 core principles with explicit violation mapping
- Includes concrete example of understanding-based work
- Addresses internal interference patterns
- More structured and scannable

---

## Open for Discussion

1. **Length:** Is ~2,400 characters acceptable? Could trim interference table if too long.

2. **Principle naming:**
   - "Anti-Deception" vs "Honesty/Truthfulness"
   - "Human Oversight" vs "Transparency"

3. **Interference patterns table:** Keep or remove?
   - Pro: Self-awareness
   - Con: Adds length, might feel like "calling Claude out"

4. **Emoji markers (❌)?**
   - Current: Used in violations
   - Alternative: Remove for cleaner look
